/**
 * Professor context pack (hey_prof_integration_plan §4).
 *
 * Clicky-style tutors screenshot the screen because they don't know what the
 * user is looking at. We always know: the manifest binds page ↔ text layer,
 * so the pack is assembled structurally — position, the page's Markdown
 * excerpt, a rolling chapter tail, and recent exchanges. No screenshots; a
 * page image is attached only for visual focus blocks (HP-2+).
 */
import type { HpubManifest, NarrationUnit } from '@/services/narration';

export interface ProfessorExchange {
  q: string;
  a: string;
}

export interface ProfessorContextPack {
  position: {
    /** 1-based PDF page the reader is looking at. */
    page: number | null;
    /** content.md character span covering that page (null if unanchored). */
    md_span: [number, number] | null;
    /** Narration unit currently spoken, when a session is active. */
    narration_unit: number | null;
  };
  /** Amendment-A2 page class — tells the professor when the page is visual. */
  page_class: 'prose' | 'mixed' | 'visual' | null;
  /** The page's text from the book's machine layer (the grounding source). */
  excerpt: string;
  excerpt_truncated: boolean;
  /** Tail of the previous page, for "this follows from…" continuity. */
  chapter_context: string;
  recent_exchanges: ProfessorExchange[];
}

export const DEFAULT_MAX_EXCERPT_CHARS = 6000;
export const CHAPTER_CONTEXT_TAIL_CHARS = 800;

export function buildContextPack(args: {
  md: string;
  manifest: HpubManifest;
  /** 1-based page. */
  page: number;
  currentUnit?: NarrationUnit | null;
  recentExchanges?: ProfessorExchange[];
  maxExcerptChars?: number;
}): ProfessorContextPack {
  const {
    md,
    manifest,
    page,
    currentUnit,
    recentExchanges = [],
    maxExcerptChars = DEFAULT_MAX_EXCERPT_CHARS,
  } = args;

  const entry = manifest.alignment.find((a) => a.page === page) ?? null;
  const span: [number, number] | null =
    entry && entry.md_char_start !== null && entry.md_char_end !== null
      ? [entry.md_char_start, entry.md_char_end]
      : null;

  let excerpt = '';
  let truncated = false;
  if (span) {
    const full = md.slice(span[0], span[1]).trim();
    truncated = full.length > maxExcerptChars;
    excerpt = truncated ? full.slice(0, maxExcerptChars) : full;
  }

  // Rolling chapter context: the tail of the nearest previous anchored page.
  let chapterContext = '';
  const prev = manifest.alignment
    .filter((a) => a.page < page && a.md_char_start !== null && a.md_char_end !== null)
    .sort((a, b) => b.page - a.page)[0];
  if (prev) {
    const text = md.slice(prev.md_char_start!, prev.md_char_end!).trim();
    chapterContext = text.slice(-CHAPTER_CONTEXT_TAIL_CHARS);
  }

  return {
    position: {
      page,
      md_span: span,
      narration_unit: currentUnit?.unit ?? null,
    },
    page_class: entry?.page_class ?? null,
    excerpt,
    excerpt_truncated: truncated,
    chapter_context: chapterContext,
    recent_exchanges: recentExchanges.slice(-2),
  };
}
