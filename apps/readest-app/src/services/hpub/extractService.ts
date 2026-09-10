/**
 * Palimpsest extraction service — drives the Marker sidecar.
 *
 * After a digital-born PDF enters the library, this service kicks off the
 * background extraction job (Tauri command `hpub_extract` →
 * resources/hpub/make_hpub.py) that builds the book's text layer:
 * content.md + manifest.json + assets/, written directly into the book's
 * Books/<hash>/ directory.
 *
 * Hard constraint #4: the text layer + manifest are what make a library book
 * a Palimpsest book. Books imported from a prebuilt .hpub package already
 * carry their artifacts and are skipped (detected via manifest.json).
 *
 * Status is persisted per book (`extraction.json` next to the artifacts) and
 * broadcast on an event bus, so the library can show "building / failed /
 * rejected" and a crashed job is retried on next library load
 * (repairMissingTextLayers). Jobs run strictly sequentially: Marker loads
 * multi-GB model weights and a parallel job would OOM the machine.
 * Throughput ≈3.4 s/page on M-series; the sidecar's --workdir cache makes a
 * retried job resume instead of restarting extraction.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauriAppPlatform } from '@/services/environment';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { getDir, getLocalBookFilename } from '@/utils/book';
import { useSettingsStore } from '@/store/settingsStore';

export type HpubRejectionReason = 'scanned' | 'quality_gate' | 'empty_extraction';

export interface HpubExtractionResult {
  status: 'ok' | 'rejected' | 'error';
  reason?: HpubRejectionReason;
  /** Failure stage from the sidecar protocol — e.g. 'watchdog' when the
   *  Rust stall watchdog killed a wedged child; `detail` then carries the
   *  user-facing explanation verbatim. */
  stage?: string;
  detail?: string;
  page_count?: number;
  anchored?: number;
  containment?: { mean: number; min: number };
}

/** Persisted per-book extraction state (`Books/<hash>/extraction.json`). */
export interface ExtractionStatus {
  status: 'running' | 'ok' | 'rejected' | 'error';
  reason?: HpubRejectionReason;
  detail?: string;
  attempts: number;
  updatedAt: number;
  /** Live progress for `running` jobs: 1..6 mirrors the sidecar's stage log.
   *  In-memory only (event bus), never persisted. */
  stage?: number;
  stageDetail?: string;
  /** Which pipeline stage an error came from (e.g. 'watchdog', 'marker'). */
  errorStage?: string;
  /** Extraction ran with LLM assist (OpenRouter) — better math fidelity. */
  llm?: boolean;
}

const STATUS_FILENAME = 'extraction.json';
/** Sidecar telemetry written next to the artifacts (make_hpub.py, 2026-09-10). */
const REPORT_FILENAME = 'conversion_report.json';
/** Cap on automatic repair attempts; a rejected book is never retried. */
const MAX_ATTEMPTS = 3;
/** A 'running' status younger than this may belong to a still-alive sidecar
 * from a previous webview session (Tauri doesn't cancel commands on reload)
 * — repair must not start a second Marker beside it. */
const RUNNING_STALE_MS = 30 * 60 * 1000;
/** Sidecar stderr progress lines: `[make_hpub +  12.3s] N/6 stage title…` */
const STAGE_RE = /^\[make_hpub \+[\s\d.]+s\]\s+(\d)\/6\s+(.*)$/;

export const isExtractionAvailable = (): boolean => isTauriAppPlatform();

/** Post-extraction telemetry: quality.ok=false means garbled glyphs
 *  (U+FFFD/PUA) survived into content.md — the import succeeds but some
 *  passages will narrate wrong. Returns the persisted detail, or undefined
 *  when the report is clean/missing. */
const readConversionReportWarning = async (
  appService: AppService,
  book: Book,
): Promise<string | undefined> => {
  try {
    const path = `${getDir(book)}/${REPORT_FILENAME}`;
    if (!(await appService.exists(path, 'Books'))) return undefined;
    const raw = await appService.readFile(path, 'Books', 'text');
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const report = JSON.parse(text) as {
      quality?: { ok?: boolean; replacement_chars?: number; pua_chars?: number };
    };
    if (!report.quality || report.quality.ok !== false) return undefined;
    const garbled = (report.quality.replacement_chars ?? 0) + (report.quality.pua_chars ?? 0);
    return (
      `Text layer built, but ${garbled} garbled glyphs survived extraction — ` +
      `some passages may narrate incorrectly. Details in ${REPORT_FILENAME}.`
    );
  } catch (e) {
    console.warn('conversion report read failed', e);
    return undefined;
  }
};

/** Does this book already carry its text layer? */
export const hasTextLayer = async (appService: AppService, book: Book): Promise<boolean> =>
  appService.exists(`${getDir(book)}/manifest.json`, 'Books');

// ── status persistence + event bus ──────────────────────────────────────────

type StatusListener = (bookHash: string, status: ExtractionStatus) => void;
const statusListeners = new Set<StatusListener>();

export const onExtractionStatus = (listener: StatusListener): (() => void) => {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
};

const emitStatus = (book: Book, status: ExtractionStatus) => {
  for (const l of statusListeners) {
    try {
      l(book.hash, status);
    } catch (e) {
      console.warn('extraction status listener failed', e);
    }
  }
};

export const readExtractionStatus = async (
  appService: AppService,
  book: Book,
): Promise<ExtractionStatus | null> => {
  try {
    const path = `${getDir(book)}/${STATUS_FILENAME}`;
    if (!(await appService.exists(path, 'Books'))) return null;
    const raw = await appService.readFile(path, 'Books', 'text');
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    return JSON.parse(text) as ExtractionStatus;
  } catch {
    return null;
  }
};

const writeExtractionStatus = async (
  appService: AppService,
  book: Book,
  status: Omit<ExtractionStatus, 'updatedAt'>,
): Promise<void> => {
  const full: ExtractionStatus = { ...status, updatedAt: Date.now() };
  try {
    await appService.writeFile(`${getDir(book)}/${STATUS_FILENAME}`, 'Books', JSON.stringify(full));
  } catch (e) {
    console.warn('failed to persist extraction status', e);
  }
  emitStatus(book, full);
};

class ExtractionQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  /** Book hashes currently queued or running — dedupes import + repair. */
  private inflight = new Set<string>();
  private listeners = new Set<(book: Book, result: HpubExtractionResult) => void>();

  onResult(listener: (book: Book, result: HpubExtractionResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isBusy(): boolean {
    return this.running || this.queue.length > 0;
  }

  private emit(book: Book, result: HpubExtractionResult) {
    for (const l of this.listeners) {
      try {
        l(book, result);
      } catch (e) {
        console.warn('hpub extraction listener failed', e);
      }
    }
  }

  enqueue(appService: AppService, book: Book): void {
    if (this.inflight.has(book.hash)) return;
    this.inflight.add(book.hash);
    this.queue.push(async () => {
      const prior = await readExtractionStatus(appService, book);
      const attempts = (prior?.attempts ?? 0) + 1;
      await writeExtractionStatus(appService, book, { status: 'running', attempts });
      // Live, in-memory view of the job for the library badge — stage ticks
      // ride the event bus without touching disk.
      const live: ExtractionStatus = {
        status: 'running',
        attempts,
        updatedAt: Date.now(),
      };
      // LLM assist: when the user configured an OpenAI-compatible key
      // (Settings → AI — any compatible endpoint: OpenAI, OpenRouter, …),
      // Marker routes equation/table blocks through it — the difference
      // between display math becoming spoken LaTeX and being silently
      // dropped from the text layer.
      const aiSettings = useSettingsStore.getState().settings?.aiSettings;
      const llmKey = aiSettings?.openrouterApiKey ?? '';
      // Vision-assist extraction (--use-llm) is OFF by default: marker's
      // OpenAI service issues hundreds of serial per-block vision calls and
      // wedges silently on dead sockets (CLOSE_WAIT, 0% CPU, zero API usage
      // — observed live, 2026-08-27). The text-only LLM cleanup pass in the
      // sidecar (stage 3/6) is validated, fault-tolerant, and covers the
      // repair job. Vision mode stays available in the sidecar for a future
      // hardened toggle (needs a per-call watchdog first).
      const useLlm = false;
      live.llm = Boolean(llmKey); // the cleanup pass still runs when keyed
      let unlisten: (() => void) | undefined;
      try {
        unlisten = await listen<{ jobId: string; line: string }>('hpub-progress', (ev) => {
          if (ev.payload.jobId !== book.hash) return;
          const m = STAGE_RE.exec(ev.payload.line);
          if (m) {
            live.stage = parseInt(m[1]!, 10);
            live.stageDetail = m[2]!.trim();
            emitStatus(book, { ...live });
          }
        });
        const pdfPath = await appService.resolveFilePath(getLocalBookFilename(book), 'Books');
        const outDir = await appService.resolveFilePath(getDir(book), 'Books');
        const result = await invoke<HpubExtractionResult>('hpub_extract', {
          pdfPath,
          outDir,
          title: book.sourceTitle || book.title,
          workdir: `${outDir}/.work`,
          jobId: book.hash,
          useLlm,
          llmApiKey: llmKey,
          llmBaseUrl: aiSettings?.openrouterBaseUrl ?? '',
          llmModel: aiSettings?.openrouterModel ?? '',
        });
        // Watchdog kills arrive as a structured result ({status:'error',
        // stage:'watchdog'}), not a throw — result.detail is persisted
        // verbatim below so the user sees exactly where the job stalled.
        // On success, fold in the conversion report's glyph-garbage warning.
        if (result.status === 'ok') {
          const warning = await readConversionReportWarning(appService, book);
          if (warning) result.detail = warning;
        }
        this.emit(book, result);
        await writeExtractionStatus(appService, book, {
          status: result.status === 'ok' ? 'ok' : result.status,
          reason: result.reason,
          detail: result.detail,
          errorStage: result.stage,
          attempts,
          llm: useLlm,
        });
        // Chain the narration pipeline: extraction landed the text layer,
        // now build the spoken script (plan §4). Failure here must not eat
        // the extraction result — the text layer is still valid.
        if (result.status === 'ok') {
          try {
            live.stage = 5;
            live.stageDetail = 'building spoken script…';
            emitStatus(book, { ...live });
            const { buildNarrationForBook } = await import('@/services/narration');
            await buildNarrationForBook(appService, book, { director: true });
          } catch (e) {
            console.warn('narration build failed after extraction', e);
          } finally {
            // The badge clears on status 'ok' (BookItem renders nothing) —
            // without this the LAST live event stays the stage-5 'running'
            // beat and the library shows "Converting (5/6)" until relaunch
            // (Nemotron import, 2026-09-10: job done at 20:30, badge stuck).
            emitStatus(book, { status: 'ok', attempts, updatedAt: Date.now(), llm: useLlm });
          }
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.warn('hpub extraction job failed', e);
        this.emit(book, { status: 'error', detail });
        await writeExtractionStatus(appService, book, {
          status: 'error',
          detail,
          attempts,
        });
      } finally {
        unlisten?.();
        this.inflight.delete(book.hash);
      }
    });
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        try {
          await job();
        } catch (e) {
          console.warn('hpub extraction job failed', e);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const extractionQueue = new ExtractionQueue();

/**
 * Kick off background text-layer extraction for a freshly imported PDF.
 * Fire-and-forget: the book is readable immediately; the machine layer
 * arrives when Marker finishes. No-op on web or when the text layer exists.
 */
export const enqueueTextLayerExtraction = (appService: AppService, book: Book): void => {
  if (!isExtractionAvailable()) return;
  if (book.format !== 'PDF') return;
  void hasTextLayer(appService, book).then((has) => {
    if (has) return; // imported from a .hpub package — artifacts already present
    extractionQueue.enqueue(appService, book);
  });
};

/**
 * Repair pass, called when the library loads: any PDF book whose text layer
 * is missing gets extraction re-enqueued. Skips books the quality gate
 * permanently rejected and books that already failed MAX_ATTEMPTS times —
 * those keep their persisted status so the user can see what happened.
 * A stale 'running' status (previous session died mid-job) is retried; the
 * sidecar's workdir cache makes the retry resume instead of restart.
 */
export const repairMissingTextLayers = async (
  appService: AppService,
  books: Book[],
): Promise<void> => {
  if (!isExtractionAvailable()) return;
  for (const book of books) {
    if (book.format !== 'PDF' || book.deletedAt) continue;
    try {
      if (await hasTextLayer(appService, book)) continue;
      const status = await readExtractionStatus(appService, book);
      if (status?.status === 'rejected') continue; // permanent — gate decision
      if (status && status.status === 'error' && status.attempts >= MAX_ATTEMPTS) continue;
      if (status?.status === 'running' && Date.now() - status.updatedAt < RUNNING_STALE_MS) {
        continue; // a previous session's job may still be alive
      }
      extractionQueue.enqueue(appService, book);
    } catch (e) {
      console.warn('text-layer repair check failed for', book.title, e);
    }
  }
};
