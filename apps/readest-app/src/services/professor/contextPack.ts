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
import { getPageBlocks } from '@/services/narration';
import type { ConceptState } from './learner';

export interface ProfessorExchange {
  q: string;
  a: string;
}

/** A block reference the professor may annotate (HP-2). Bbox stays
 *  render-side; the model only needs identity + a hint of the content. */
export interface ProfessorBlockRef {
  id: string;
  type: string;
  text_head: string;
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
  /** Annotatable blocks on this page (HP-2). Empty when the book's manifest
   *  carries no block geometry — the professor then answers text-only. */
  blocks: ProfessorBlockRef[];
  /** Tail of the previous page, for "this follows from…" continuity. */
  chapter_context: string;
  recent_exchanges: ProfessorExchange[];
  /** HP-4 evidence base (plan §4/§6): what the reader has asked about, how
   *  often, and the tracked Bloom level. Empty until their first logged
   *  exchange. Capped to the most-asked concepts to keep the pack small. */
  concept_states: Record<string, ConceptState>;
}

export const DEFAULT_MAX_EXCERPT_CHARS = 6000;
export const CHAPTER_CONTEXT_TAIL_CHARS = 800;

export function buildContextPack(args: {
  md: string;
  manifest: HpubManifest;
  /** 1-based page. */
  page: number;
  /** Other pages visible alongside the primary one (the second leaf of a
   *  two-page spread). Their annotatable blocks are included so the model
   *  can point at anything on screen. */
  extraPages?: number[];
  currentUnit?: NarrationUnit | null;
  recentExchanges?: ProfessorExchange[];
  conceptStates?: Record<string, ConceptState>;
  maxExcerptChars?: number;
}): ProfessorContextPack {
  const {
    md,
    manifest,
    page,
    extraPages = [],
    currentUnit,
    recentExchanges = [],
    conceptStates = {},
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
    blocks: [page, ...extraPages].flatMap((p) =>
      getPageBlocks(manifest, p).map((b) => ({
        id: b.id,
        type: b.type,
        text_head: (b.text_head ?? '').slice(0, 80),
      })),
    ),
    chapter_context: chapterContext,
    recent_exchanges: recentExchanges.slice(-2),
    concept_states: Object.fromEntries(
      Object.entries(conceptStates)
        .sort((a, b) => b[1].asked - a[1].asked)
        .slice(0, 10),
    ),
  };
}
