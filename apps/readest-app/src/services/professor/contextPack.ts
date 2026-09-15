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
import type { TOCItem } from '@/libs/document';
import type { ConceptState, LearnerExchange } from './learner';
import { getChapterText } from './session';

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
  /** Workbench 2.1 whole-book mode: true when the book's full text layer fit
   *  the token budget, in which case whole_book_text carries it with [Page N]
   *  markers. False (or absent) means the pack fell back to the page-window
   *  behavior. Optional so older pack consumers keep compiling. */
  wholeBook?: boolean;
  whole_book_text?: string;
  /** Context architecture T1 — the chapter window the reader is inside
   *  (additive; absent in packs built before tiers). */
  chapter_window?: { label: string; text: string };
  /** Context architecture T2 — the "what they've struggled with follows
   *  them" tier: page excerpts keyed by 1-based page (additive). */
  concept_pages?: Record<number, string>;
  /** Context architecture citation whitelist — the pages the professor may
   *  anchor this turn, sorted ascending for byte-stable prompts (additive). */
  pages_included?: number[];
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

// ---------------------------------------------------------------------------
// Workbench 2.1 — whole-book context mode
// ---------------------------------------------------------------------------

/** Small-book gate (T4): ≤80k chars (~20k tok) → whole book, every turn. */
export const SMALL_BOOK_MAX_CHARS = 80_000;
/** Local/ollama hard cap on the assembled pack (~15k tok); tiers drop
 *  bottom-up to fit it, and whole_book_text is never emitted locally. */
export const LOCAL_PACK_MAX_CHARS = 60_000;
/** T1 chapter-window cap. */
export const CHAPTER_TIER_CHARS = 30_000;
/** T2 per-page excerpt cap. */
export const CONCEPT_PAGE_CHARS = 3_000;
/** T2 page budget — the top-N struggled-with concepts. */
export const CONCEPT_TIER_PAGE_COUNT = 3;

/**
 * The book's full text layer with page markers, or null when it exceeds the
 *  budget. Markers are [Page N] lines derived from manifest.alignment page
 *  anchors (md_char_start offsets), so professor citations stay grounded:
 *  every quote is attributable to a page.
 */
export function buildWholeBookText(
  md: string,
  manifest: HpubManifest,
  budgetChars: number = SMALL_BOOK_MAX_CHARS,
): string | null {
  if (md.length > budgetChars) return null;
  const anchors = manifest.alignment
    .filter((a) => a.md_char_start !== null)
    .sort((a, b) => a.md_char_start! - b.md_char_start!);
  const parts: string[] = [];
  let cursor = 0;
  for (const a of anchors) {
    const start = Math.min(a.md_char_start!, md.length);
    if (start < cursor) continue; // overlapping/duplicate anchors — first wins
    parts.push(md.slice(cursor, start));
    parts.push(`\n[Page ${a.page}]\n`);
    cursor = start;
  }
  parts.push(md.slice(cursor));
  return parts.join('');
}

/**
 * T2 — concept-anchored pages (context architecture §6): for each of the
 * top-N concept_states (deterministic: asked desc, name asc on ties), find
 * the first anchored page whose text contains the concept name; fall back
 * to the page where the concept was last logged in the learner exchange
 * history. Each included page is capped at capPerPage chars. Returns at
 * most CONCEPT_TIER_PAGE_COUNT entries, keyed by 1-based page.
 */
export function buildConceptPages(
  md: string,
  manifest: HpubManifest,
  conceptStates: Record<string, ConceptState>,
  capPerPage: number = CONCEPT_PAGE_CHARS,
  learnerExchanges: LearnerExchange[] = [],
): Record<number, string> {
  const top = Object.entries(conceptStates)
    .sort((a, b) => b[1].asked - a[1].asked || a[0].localeCompare(b[0]))
    .slice(0, CONCEPT_TIER_PAGE_COUNT);
  const anchored = manifest.alignment
    .filter((a) => a.md_char_start !== null && a.md_char_end !== null)
    .sort((a, b) => a.page - b.page);
  const out: Record<number, string> = {};
  for (const [slug] of top) {
    if (Object.keys(out).length >= CONCEPT_TIER_PAGE_COUNT) break;
    const needle = slug.replace(/_/g, ' ').toLowerCase();
    // Search anchored pages' spans for the concept string…
    let page = anchored.find((a) =>
      md.slice(a.md_char_start!, a.md_char_end!).toLowerCase().includes(needle),
    )?.page;
    if (page === undefined) {
      // …otherwise reuse the page where the concept was last logged.
      for (const ex of learnerExchanges) {
        if (ex.concept === slug) page = ex.page;
      }
    }
    if (page === undefined || out[page] !== undefined) continue;
    const entry = anchored.find((a) => a.page === page);
    if (!entry) continue;
    const full = md.slice(entry.md_char_start!, entry.md_char_end!).trim();
    out[page] = full.length > capPerPage ? full.slice(0, capPerPage) : full;
  }
  return out;
}

export interface TieredPackArgs {
  md: string;
  manifest: HpubManifest;
  /** 1-based page the reader is looking at. */
  page: number;
  /** T1 chapter bounds; empty/omitted degrades T1 to the current page. */
  toc?: TOCItem[];
  extraPages?: number[];
  currentUnit?: NarrationUnit | null;
  recentExchanges?: ProfessorExchange[];
  conceptStates?: Record<string, ConceptState>;
  /** Learner log — T2 fallback pages for concepts not found in the text. */
  learnerExchanges?: LearnerExchange[];
  maxExcerptChars?: number;
  /** Local/ollama mode: hard-caps the pack at LOCAL_PACK_MAX_CHARS by
   *  dropping tiers bottom-up, and never emits whole_book_text. */
  localMode?: boolean;
}

/**
 * Context architecture §6 — tiered assembly, rebuilt every turn:
 *   T0 current page (buildContextPack excerpt + blocks),
 *   T1 chapter window (getChapterText, CHAPTER_TIER_CHARS cap),
 *   T2 concept-struggle pages (buildConceptPages, CONCEPT_PAGE_CHARS/page),
 *   T4 whole book via buildWholeBookText when md ≤ SMALL_BOOK_MAX_CHARS
 *      and not local mode (wholeBook=true only when T4 fired).
 * Local mode enforces LOCAL_PACK_MAX_CHARS by dropping T1 then T2.
 * Returns pages_included — the citation whitelist the prompt lists as
 * "Pages in your context". Tier content is deterministic (no timestamps)
 * so the shared prefix is cache-friendly across turns; only T3 (harness
 * side: history + where-we-are) varies per turn.
 */
export function buildTieredPack(args: TieredPackArgs): ProfessorContextPack {
  const {
    md,
    manifest,
    page,
    toc = [],
    extraPages = [],
    currentUnit,
    recentExchanges = [],
    conceptStates = {},
    learnerExchanges = [],
    maxExcerptChars,
    localMode = false,
  } = args;

  const pack = buildContextPack({
    md,
    manifest,
    page,
    extraPages,
    currentUnit,
    recentExchanges,
    conceptStates,
    ...(maxExcerptChars !== undefined ? { maxExcerptChars } : {}),
  });

  // T1 — chapter window (empty TOC degrades to the reader's own page).
  const chapter = getChapterText({ md, manifest, toc, page, maxChars: CHAPTER_TIER_CHARS });
  // T2 — what they've struggled with follows them.
  const conceptPages = buildConceptPages(
    md,
    manifest,
    conceptStates,
    CONCEPT_PAGE_CHARS,
    learnerExchanges,
  );
  // T4 — small book only, never in local mode.
  const whole =
    !localMode && md.length <= SMALL_BOOK_MAX_CHARS
      ? buildWholeBookText(md, manifest, SMALL_BOOK_MAX_CHARS)
      : null;

  // Local-mode cap: drop tiers bottom-up (chapter first, concept pages next).
  let chapterWindow = chapter.text ? { label: chapter.label, text: chapter.text } : undefined;
  let conceptTier = conceptPages;
  if (localMode) {
    // Size everything the assembled prompt actually ships (the whitelist
    // line too — undercounting let packs sail past LOCAL_PACK_MAX_CHARS).
    const whitelistChars = (list: number[]): number =>
      list.length > 0 ? `Pages in your context: ${list.join(', ')}\n`.length : 0;
    const size = (): number =>
      pack.excerpt.length +
      (chapterWindow?.text.length ?? 0) +
      Object.values(conceptTier).reduce((n, t) => n + t.length, 0) +
      (whole?.length ?? 0) +
      whitelistChars(
        Array.from(
          new Set([
            ...(pack.position.md_span !== null && pack.excerpt ? [page] : []),
            ...(chapterWindow ? (chapter.includedPages ?? chapter.pages ?? []) : []),
            ...Object.keys(conceptTier).map(Number),
          ]),
        ).sort((a, b) => a - b),
      );
    if (chapterWindow && size() > LOCAL_PACK_MAX_CHARS) chapterWindow = undefined;
    if (size() > LOCAL_PACK_MAX_CHARS) conceptTier = {};
  }

  // With the whole book in context every anchored page is citeable.
  const pagesIncluded =
    whole !== null
      ? manifest.alignment
          .filter((a) => a.md_char_start !== null)
          .map((a) => a.page)
          .sort((a, b) => a - b)
      : Array.from(
          new Set([
            // The current page is citeable only when its text actually
            // rides in the prompt (an unanchored page ships no excerpt).
            ...(pack.position.md_span !== null && pack.excerpt ? [page] : []),
            // Chapter-window pages past the truncation cut are out; so are
            // extraPages in v1 — their text is never embedded in the prompt.
            ...(chapterWindow ? (chapter.includedPages ?? chapter.pages ?? []) : []),
            ...Object.keys(conceptTier).map(Number),
          ]),
        ).sort((a, b) => a - b);

  return {
    ...pack,
    chapter_window: chapterWindow,
    ...(Object.keys(conceptTier).length > 0 ? { concept_pages: conceptTier } : {}),
    wholeBook: whole !== null,
    ...(whole !== null ? { whole_book_text: whole } : {}),
    pages_included: pagesIncluded,
  };
}

/**
 * Workbench variant of the context pack — backward-compat shim (context
 * architecture edit list #5): re-implemented as buildTieredPack with the
 * legacy wholeBook flag, true only when the small-book tier (T4) fired.
 * The old wholeBookBudgetChars argument is accepted but ignored
 * (deprecated); gating is SMALL_BOOK_MAX_CHARS, and the pack never emits
 * whole_book_text in local mode.
 */
export function buildWorkbenchContextPack(args: {
  md: string;
  manifest: HpubManifest;
  page: number;
  toc?: TOCItem[];
  extraPages?: number[];
  currentUnit?: NarrationUnit | null;
  recentExchanges?: ProfessorExchange[];
  conceptStates?: Record<string, ConceptState>;
  learnerExchanges?: LearnerExchange[];
  maxExcerptChars?: number;
  localMode?: boolean;
  /** @deprecated Ignored — the whole-book gate is SMALL_BOOK_MAX_CHARS. */
  wholeBookBudgetChars?: number;
}): ProfessorContextPack {
  const { wholeBookBudgetChars: _ignored, ...packArgs } = args;
  return buildTieredPack(packArgs);
}
