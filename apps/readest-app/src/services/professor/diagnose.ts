/**
 * Fault-path diagnosis — the DETERMINISTIC stage (Wave 4; audit Ruling 4,
 * the Specificity Engine): match a failed check's answer text against the
 * book's pre-generated, book-verified chapter library (misconceptions.ts).
 * A match yields a repair that NAMES the learner's exact wrong reading and
 * cites the page (Oppia-style); no match yields null and the generic hint
 * ladder stands — never generic feedback when a specific repair exists.
 *
 * The Wave-3 LLM stage (diagnoseFaultPath + friends) was deleted: Wave 4
 * superseded it and nothing called it (simplicity audit A2).
 */
import type { ChapterMisconception, MisconceptionLibrary } from './misconceptions';
import { misconceptionsForConcept } from './misconceptions';

// ---------------------------------------------------------------------------
// Deterministic match against the book's verified chapter library
// (audit Ruling 4 WAVE 4; LEARNING_SCIENCE §11 misconception-tailored
// feedback — AutoTutor's shallow matching already carried the effect).
// ---------------------------------------------------------------------------

/** Words that carry no diagnostic signal in an answer or a wrong reading. */
const MATCH_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'as',
  'is',
  'are',
  'was',
  'were',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'you',
  'your',
  'i',
  'we',
  'they',
  'so',
  'but',
  'not',
  'no',
  'be',
  'by',
  'at',
  'from',
  'than',
  'then',
  'there',
  'their',
  'because',
  'since',
  'must',
  'can',
  'could',
  'would',
  'should',
]);

/** Content tokens: lowercase alnum words, stopwords and short noise out. */
function contentTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !MATCH_STOPWORDS.has(w)),
  );
}

/**
 * Similarity between a failed answer and one wrong reading: the fraction
 * of the wrong reading's signature tokens present in the answer. One
 * shared word is a coincidence, not a diagnosis — every signature needs
 * at least two hits (or ALL of its tokens when it is shorter than two,
 * so a 2-token reading never matches on one shared word).
 */
export function misconceptionSimilarity(answerText: string, wrongReading: string): number {
  const answer = contentTokens(answerText);
  const signature = contentTokens(wrongReading);
  if (answer.size === 0 || signature.size === 0) return 0;
  let hits = 0;
  for (const t of signature) if (answer.has(t)) hits += 1;
  if (hits < Math.min(2, signature.size)) return 0;
  return hits / signature.size;
}

/** Half the wrong reading's signature must be visible in the answer. */
export const MISCONCEPTION_MATCH_THRESHOLD = 0.5;

/**
 * Match a failed check's answer text to the closest wrong reading in the
 * candidates. Returns null below the threshold — no match, no named
 * repair, and the caller falls back to the hint ladder.
 */
export function matchMisconception(
  answerText: string,
  candidates: ChapterMisconception[],
  threshold = MISCONCEPTION_MATCH_THRESHOLD,
): ChapterMisconception | null {
  const scored = candidates
    .map((m) => ({ m, score: misconceptionSimilarity(answerText, m.wrongReading) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || b.m.confidencePrior - a.m.confidencePrior);
  return scored[0]?.m ?? null;
}

/** Quotes longer than this are trimmed in the spoken repair line. */
export const MAX_REPAIR_QUOTE_CHARS = 220;

/**
 * The Oppia-style repair line: NAME the learner's exact wrong reading in
 * their terms, cite the page, and correct it from the verified quote.
 * ("You treated correlation as proof of causation, but on page 42 the
 * book says: …")
 */
export function renderNamedRepair(m: ChapterMisconception): string {
  const quote =
    m.evidenceQuote.length > MAX_REPAIR_QUOTE_CHARS
      ? `${m.evidenceQuote.slice(0, MAX_REPAIR_QUOTE_CHARS).trimEnd()}…`
      : m.evidenceQuote;
  return (
    `You ${m.wrongReading}, but on page ${m.sourceRef.page} the book says: ` +
    `"${quote}" — ${m.correction}.`
  );
}

export interface NamedRepair {
  misconception: ChapterMisconception;
  /** The repair line — names the wrong reading, cites the page. */
  text: string;
  /** The similarity that matched (telemetry/tests). */
  score: number;
}

/**
 * Given a failed check (the learner's wrong answer), find the specific
 * repair. Returns null when no stored wrong reading matches — the generic
 * hint ladder is the fallback, and it is a FALLBACK, never the default
 * when a specific repair exists.
 */
export function diagnoseFailedCheck(args: {
  answerText: string;
  concept: string;
  library: MisconceptionLibrary;
  /** Restrict to one page's readings; default is the concept's, all pages. */
  page?: number;
  threshold?: number;
}): NamedRepair | null {
  const candidates = misconceptionsForConcept(args.library, args.concept, args.page);
  const match = matchMisconception(args.answerText, candidates, args.threshold);
  if (!match) return null;
  return {
    misconception: match,
    text: renderNamedRepair(match),
    score: misconceptionSimilarity(args.answerText, match.wrongReading),
  };
}
