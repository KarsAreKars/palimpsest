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
 * Jobs run strictly sequentially: Marker loads multi-GB model weights and a
 * parallel job would OOM the machine. Throughput ≈3.4 s/page on M-series.
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { getDir, getLocalBookFilename } from '@/utils/book';

export type HpubRejectionReason = 'scanned' | 'quality_gate' | 'empty_extraction';

export interface HpubExtractionResult {
  status: 'ok' | 'rejected' | 'error';
  reason?: HpubRejectionReason;
  detail?: string;
  page_count?: number;
  anchored?: number;
  containment?: { mean: number; min: number };
}

export const isExtractionAvailable = (): boolean => isTauriAppPlatform();

/** Does this book already carry its text layer? */
export const hasTextLayer = async (appService: AppService, book: Book): Promise<boolean> =>
  appService.exists(`${getDir(book)}/manifest.json`, 'Books');

class ExtractionQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  private listeners = new Set<(book: Book, result: HpubExtractionResult) => void>();

  onResult(listener: (book: Book, result: HpubExtractionResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    this.queue.push(async () => {
      const pdfPath = await appService.resolveFilePath(getLocalBookFilename(book), 'Books');
      const outDir = await appService.resolveFilePath(getDir(book), 'Books');
      const result = await invoke<HpubExtractionResult>('hpub_extract', {
        pdfPath,
        outDir,
        title: book.sourceTitle || book.title,
      });
      this.emit(book, result);
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
