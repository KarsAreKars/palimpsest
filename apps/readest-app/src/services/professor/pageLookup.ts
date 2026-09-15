/**
 * pageLookup — the desk answers "I will look" (Workbench 2.x, campaign item 2).
 *
 * The professor emits [LOOK page:N]; the desk resolves that page's span from
 * the book manifest's alignment and shows a "consulting the book" indicator
 * (rendered by the tab, from the lookedUp metadata on the transcript block).
 * Resolution is pure and frontend-side: the same { md, manifest } the tiered
 * pack builder slices (contextPack.ts). Honesty contract: a page is returned
 * only when its text will actually be injected into the next turn's prompt —
 * unanchored, out-of-range, or empty pages are reported as `missing`, never
 * as empty text, and never enter the citation whitelist.
 */
import environmentConfig from '@/services/environment';
import { getDir } from '@/utils/book';
import type { AppService } from '@/types/system';
import { getNarration } from '@/services/narration/speakMode';
import type { HpubManifest } from '@/services/narration';
import type { TOCItem } from '@/libs/document';
import { useBookDataStore } from '@/store/bookDataStore';

/** Hard cap on pages per [LOOK] (the audit's Risk 2 bound — do not raise). */
export const LOOK_MAX_PAGES = 4;
/** Per-page character cap for looked-up text (mirrors the T0 excerpt cap). */
export const LOOKUP_PAGE_MAX_CHARS = 6000;

export interface LookedUpPage {
  /** 1-based page. */
  page: number;
  /** The page's text from the book's machine layer. */
  text: string;
  truncated: boolean;
  page_class: 'prose' | 'mixed' | 'visual' | null;
}

export interface PageLookupResult {
  /** Pages whose text was actually fetched, ascending, deduped. */
  pages: number[];
  results: LookedUpPage[];
  /** Requested pages that were out of range, unanchored, or empty — the
   *  honesty guard: these must never enter the citation whitelist. */
  missing: number[];
}

/**
 * Pure lookup over the manifest's alignment. For each requested page: find
 * `manifest.alignment.find(a => a.page === page)`; the page qualifies only
 * when `md_char_start !== null && md_char_end !== null` AND the sliced,
 * trimmed text is non-empty. Qualifying text is capped at maxCharsPerPage
 * (record `truncated`). Requests are deduped and sorted ascending before
 * resolving; the list is then sliced to LOOK_MAX_PAGES (the excess pages
 * are reported in `missing`); pages < 1 or > manifest.page_count are
 * missing.
 */
export function lookupPages(args: {
  md: string;
  manifest: HpubManifest;
  /** 1-based pages; deduped, sorted, sliced to LOOK_MAX_PAGES. */
  pages: number[];
  maxCharsPerPage?: number;
}): PageLookupResult {
  const { md, manifest, pages, maxCharsPerPage = LOOKUP_PAGE_MAX_CHARS } = args;
  const sorted = [...new Set(pages)].filter((p) => Number.isInteger(p)).sort((a, b) => a - b);
  const kept = sorted.slice(0, LOOK_MAX_PAGES);
  const dropped = sorted.slice(LOOK_MAX_PAGES);
  const results: LookedUpPage[] = [];
  const missing: number[] = [...dropped];
  for (const page of kept) {
    const entry = manifest.alignment.find((a) => a.page === page);
    const start = entry?.md_char_start;
    const end = entry?.md_char_end;
    if (!entry || start === null || start === undefined || end === null || end === undefined) {
      missing.push(page);
      continue;
    }
    if (page < 1 || page > manifest.page_count) {
      missing.push(page);
      continue;
    }
    const raw = md.slice(start, end);
    if (raw.trim().length === 0) {
      missing.push(page);
      continue;
    }
    const truncated = raw.length > maxCharsPerPage;
    results.push({
      page,
      text: truncated ? raw.slice(0, maxCharsPerPage) : raw,
      truncated,
      page_class: entry.page_class ?? null,
    });
  }
  missing.sort((a, b) => a - b);
  return {
    pages: results.map((r) => r.page),
    results,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Book source — moved verbatim from workbenchSession.ts (audit §1.2: the
// move kills the circular import a lookup-from-session would create).
// ---------------------------------------------------------------------------

const toText = (c: string | ArrayBuffer): string =>
  typeof c === 'string' ? c : new TextDecoder().decode(c);

/** TOC for T1 chapter bounds — the bookDoc when loaded, else empty (T1 then
 *  degrades gracefully to the reader's own page). */
function bookToc(bookKey: string): TOCItem[] {
  return useBookDataStore.getState().getBookData(bookKey)?.bookDoc?.toc ?? [];
}

/**
 * The book's machine layer: narration controller first (already in
 * memory), content.md + manifest.json from the Books file API second.
 * Everything defensive: a missing text layer is null, not a crash — the
 * caller treats the lookup as a quiet no-op. (Formerly the private
 * readBookSource in workbenchSession.ts — body and null posture unchanged.)
 */
export async function loadBookSource(
  bookKey: string,
): Promise<{ md: string; manifest: HpubManifest; toc: TOCItem[] } | null> {
  try {
    const controller = getNarration(bookKey)?.controller;
    if (controller?.md && controller?.manifest) {
      return { md: controller.md, manifest: controller.manifest, toc: bookToc(bookKey) };
    }
    const book = useBookDataStore.getState().getBookData(bookKey)?.book ?? null;
    if (!book) return null;
    const appService: AppService = await environmentConfig.getAppService();
    const dir = getDir(book);
    const [md, rawManifest] = await Promise.all([
      appService.readFile(`${dir}/content.md`, 'Books', 'text'),
      appService.readFile(`${dir}/manifest.json`, 'Books', 'text'),
    ]);
    return {
      md: toText(md),
      manifest: JSON.parse(toText(rawManifest)) as HpubManifest,
      toc: bookToc(bookKey),
    };
  } catch {
    return null;
  }
}

/**
 * Book-level convenience for the turn seam: resolves the same
 * { md, manifest } the pack uses (loadBookSource above), then lookupPages.
 * Returns null when the book source cannot be read — the caller treats the
 * lookup as a quiet no-op, matching loadBookSource's defensive posture.
 */
export async function lookupBookPages(
  bookKey: string,
  pages: number[],
): Promise<PageLookupResult | null> {
  const source = await loadBookSource(bookKey);
  if (!source) return null;
  return lookupPages({ ...source, pages });
}
