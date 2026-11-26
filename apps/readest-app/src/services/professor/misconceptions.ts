/**
 * Misconception library — the BOOK-SCOPED chapter library (Wave 4; audit
 * Ruling 4, the Specificity Engine). Per chapter, the model pre-generates
 * the common wrong readings of a concept and every candidate is
 * BOOK-VERIFIED against the page before it may be stored — the repair a
 * learner hears is grounded in the page, never invented (the accuracy
 * law). diagnose.ts matches a failed check's answer against this library.
 *
 * The Wave-3 seeded library (SEEDED_LIBRARY, retrieveMisconceptions,
 * templateRegex, heuristic, getMisconception) was deleted: it fed only the
 * retired LLM diagnosis stage and had zero consumers (simplicity audit A1).
 */
import { generateText } from 'ai';
import type { AISettings } from '@/services/ai/types';
import { getAIProvider } from '@/services/ai/providers';

// ---------------------------------------------------------------------------
// Wave 4 — the book-scoped chapter library (generation + verification)
// ---------------------------------------------------------------------------

/** Where a wrong reading lives: the page (and, cross-book, the book). */
export interface MisconceptionSourceRef {
  /** Book identifier (hash) — optional inside one book's own store. */
  book?: string;
  /** 1-based page the reading AND its correction were read from. */
  page: number;
}

/** One pre-generated, book-verified wrong reading of a concept. */
export interface ChapterMisconception {
  /** Stable id: `<concept>.<slug of the wrong reading>`. */
  id: string;
  /** Ledger concept slug this reading is a wrong turn of. */
  concept: string;
  /** The wrong reading as ONE clause in the learner's terms, verb-first
   *  ("treated correlation as proof of causation") so the repair can say
   *  "You treated correlation as proof of causation, but on page N…". */
  wrongReading: string;
  /** What the page actually says instead — one clause, the correction. */
  correction: string;
  /** VERBATIM quote from the page the correction rests on. Verified by
   *  verifyChapterMisconception before storage (accuracy law). */
  evidenceQuote: string;
  sourceRef: MisconceptionSourceRef;
  provenance: string[];
  /** Prior probability this reading is the fault when it matches. */
  confidencePrior: number;
}

/** The per-book store, keyed by concept + page. Serializable — it rides
 *  learner.json as `misconception_library` (learner.ts). */
export type MisconceptionLibrary = Record<string, ChapterMisconception[]>;

export const libraryKey = (concept: string, page: number): string => `${concept}:${page}`;

/** Dedupe-append verified entries into the store. Pure. */
export function storeChapterMisconceptions(
  library: MisconceptionLibrary,
  entries: ChapterMisconception[],
): MisconceptionLibrary {
  if (entries.length === 0) return library;
  const out: MisconceptionLibrary = { ...library };
  for (const m of entries) {
    const key = libraryKey(m.concept, m.sourceRef.page);
    const existing = out[key] ?? [];
    if (existing.some((e) => e.id === m.id)) continue;
    out[key] = [...existing, m];
  }
  return out;
}

/** Every known wrong reading of a concept — all pages, or one page's. */
export function misconceptionsForConcept(
  library: MisconceptionLibrary,
  concept: string,
  page?: number,
): ChapterMisconception[] {
  if (page !== undefined) return library[libraryKey(concept, page)] ?? [];
  const out: ChapterMisconception[] = [];
  for (const [key, list] of Object.entries(library)) {
    if (key.startsWith(`${concept}:`)) out.push(...list);
  }
  return out;
}

// --- verification (the accuracy law, mechanized) ----------------------------

/** Normalize for quote containment: case, curly quotes, whitespace. */
const normText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** A quote shorter than this cannot be verified — and unverifiable is
 *  unverified. */
export const MIN_QUOTE_CHARS = 12;

/**
 * Book-verify one candidate against the page it claims to come from: the
 * evidence quote must appear VERBATIM (modulo case/whitespace/quotes) in
 * the page text, and both clauses must be present. Anything else is
 * invented, and invented repairs are dropped before they can be stored.
 */
export function verifyChapterMisconception(
  m: Pick<ChapterMisconception, 'wrongReading' | 'correction' | 'evidenceQuote'>,
  pageText: string,
): boolean {
  if (m.wrongReading.trim().length === 0 || m.correction.trim().length === 0) return false;
  const quote = normText(m.evidenceQuote);
  if (quote.length < MIN_QUOTE_CHARS) return false;
  return normText(pageText).includes(quote);
}

// --- generation (pre-generate per chapter, then verify) ---------------------

const GENERATE_SYSTEM = `You are preparing a tutor's notes on the wrong readings a real reader may take from a book page. Given a concept and the page's text, list up to 3 plausible WRONG READINGS of that concept a reader could honestly walk away with — misreadings of what THIS page says, never invented topics.

For each wrong reading give:
- "wrong_reading": the wrong reading as ONE clause in the reader's terms, starting with a verb ("treated correlation as proof of causation", "thought the limit must be attained").
- "correction": what the page actually says instead, one clause.
- "evidence_quote": a VERBATIM sentence copied character-for-character from the page text that the correction rests on. If no sentence on the page grounds the correction, drop the wrong reading.

Respond with ONLY a JSON object, no prose, no code fences:
{"misconceptions": [{"wrong_reading": string, "correction": string, "evidence_quote": string}]}`;

/** Generation cap — a chapter's key concept has a handful of classic
 *  wrong turns, not a catalogue (LEARNING_SCIENCE §11: 2–4 turn budget). */
export const MAX_GENERATED_PER_CONCEPT = 3;

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .split('_')
    .slice(0, 5)
    .join('_');

/** Lenient JSON extraction (same discipline as diagnose.ts): strip fences,
 *  slice from the first '{' to the last '}', else null. */
function lenientParseObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface GenerateMisconceptionsInput {
  /** Ledger concept slug. */
  concept: string;
  /** 1-based page the concept is read on. */
  page: number;
  /** The page's text — the ONLY ground truth candidates are checked against. */
  pageText: string;
  aiSettings?: AISettings | null;
  signal?: AbortSignal;
}

/**
 * The generation+verify pipeline (Wave 4): the model PROPOSES the common
 * wrong readings of a concept on a page; every candidate is then
 * book-verified against the page text and the unverifiable ones are
 * dropped. Returns only grounded entries — and [] on any failure (no
 * provider, timeout, malformed JSON). Never throws, never fabricates:
 * a missing library falls back to the hint ladder; a fabricated one
 * would teach a wrong book.
 */
export async function generateChapterMisconceptions(
  input: GenerateMisconceptionsInput,
): Promise<ChapterMisconception[]> {
  const { aiSettings, signal } = input;
  if (!aiSettings?.enabled) return [];
  let model;
  try {
    model = getAIProvider(aiSettings).getModel();
  } catch {
    return [];
  }
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const { text } = await generateText({
      model,
      system: GENERATE_SYSTEM,
      prompt: `Concept: ${input.concept}\n\nPage ${input.page} text:\n${input.pageText}`,
      abortSignal: combined,
    });
    const raw = lenientParseObject(text);
    const list = raw && Array.isArray(raw['misconceptions']) ? raw['misconceptions'] : [];
    const out: ChapterMisconception[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      if (out.length >= MAX_GENERATED_PER_CONCEPT) break;
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Record<string, unknown>;
      const wrongReading =
        typeof rec['wrong_reading'] === 'string' ? rec['wrong_reading'].trim() : '';
      const correction = typeof rec['correction'] === 'string' ? rec['correction'].trim() : '';
      const evidenceQuote =
        typeof rec['evidence_quote'] === 'string' ? rec['evidence_quote'].trim() : '';
      // The accuracy law, mechanized: unverifiable against the page → dropped.
      if (!verifyChapterMisconception({ wrongReading, correction, evidenceQuote }, input.pageText))
        continue;
      const slug = slugify(wrongReading);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({
        id: `${input.concept}.${slug}`,
        concept: input.concept,
        wrongReading,
        correction,
        evidenceQuote,
        sourceRef: { page: input.page },
        provenance: ['wave4-generated', 'book-verified'],
        confidencePrior: 0.5,
      });
    }
    return out;
  } catch {
    return [];
  }
}
