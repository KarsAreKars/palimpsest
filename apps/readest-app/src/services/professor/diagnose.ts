/**
 * Fault-path diagnosis (shadow-safe): the LLM stage that picks among the
 * retriever's candidate misconceptions.
 *
 * Wave 4 (audit Ruling 4, the Specificity Engine) adds the DETERMINISTIC
 * stage below: match a failed check's answer text against the book's
 * pre-generated, book-verified chapter library (misconceptions.ts). A
 * match yields a repair that NAMES the learner's exact wrong reading and
 * cites the page (Oppia-style); no match yields null and the generic hint
 * ladder stands — never generic feedback when a specific repair exists.
 *
 * Mirrors tutor.ts's non-streaming discipline (see distillNote): acquire the
 * model through getAIProvider, guard with a timeout, and — the cardinal rule —
 * a missing diagnosis beats a fabricated one. ANY error, malformed JSON, or
 * validation failure returns null. The caller degrades to rung-based hints;
 * the student is never told a wrong story about their own reasoning.
 */
import { generateText } from 'ai';
import type { AISettings } from '@/services/ai/types';
import { getAIProvider } from '@/services/ai/providers';
import type { ChapterMisconception, Misconception, MisconceptionLibrary } from './misconceptions';
import { misconceptionsForConcept } from './misconceptions';

export interface Diagnosis {
  /** The chosen candidate, or null when none of them explains the fault. */
  misconception_id: string | null;
  confidence: number; // 0..1
  /** The student's likely reasoning, reconstructed in their own terms. */
  reconstruction: string;
  /** The sub-expression or line the clue should point at. */
  clue_target: string;
  /** Phrases that must NOT appear in anything the professor says. */
  do_not_say: string[];
}

export interface DiagnoseInput {
  problemStatement: string;
  correctSteps: string[];
  studentSteps: string[];
  /** Index into both step arrays where the student's line first diverges. */
  divergingIndex: number;
  /** CAS counterexample evidence, if the checker produced one. */
  counterexample?: string;
  /** Candidates from retrieveMisconceptions — the LLM picks among these. */
  candidates: Misconception[];
  /** The student's known misconception history (recency-ordered). */
  historyIds: string[];
  aiSettings?: AISettings | null;
  signal?: AbortSignal;
}

const DIAGNOSE_SYSTEM = `You are diagnosing a student's faulty reasoning path in a math problem. You are given the problem, the correct derivation, the student's steps, the index where they first diverge, an optional counterexample from the math engine, and a list of candidate misconceptions.

Your job: pick the candidate whose description best explains the student's exact faulty line (or null if none of them fits — do not stretch). Reconstruct the student's likely reasoning in THEIR own terms, name the sub-expression the next hint should point at, and list words or phrases that would tip them off too directly (those go in do_not_say).

Clue discipline: the next hint must point at a TEST the student can run (plug in a number, check a sign, count a factor), never at the answer. do_not_say must fence any phrase that names the rule or the fix.

Respond with ONLY a JSON object, no prose, no code fences:
{"misconception_id": string|null, "confidence": number, "reconstruction": string, "clue_target": string, "do_not_say": string[]}`;

const buildPrompt = (input: DiagnoseInput): string => {
  const candidateLines = input.candidates.map(
    (c) => `- ${c.id}: ${c.name}. Root cause: ${c.rootCause}`,
  );
  return [
    `Problem:\n${input.problemStatement}`,
    `Correct derivation (one step per line):\n${input.correctSteps.map((s, i) => `${i}: ${s}`).join('\n')}`,
    `Student's derivation (one step per line):\n${input.studentSteps.map((s, i) => `${i}: ${s}`).join('\n')}`,
    `First diverging step index: ${input.divergingIndex}`,
    input.counterexample ? `Counterexample from the math engine:\n${input.counterexample}` : '',
    `Candidate misconceptions (choose one of these ids, or null):\n${candidateLines.join('\n')}`,
    input.historyIds.length > 0
      ? `Student's known misconception history (recency order):\n${input.historyIds.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
};

/**
 * Lenient JSON extraction: strip code fences, then slice from the first '{'
 * to the last '}'. Models that wrap JSON in prose still parse; anything else
 * returns null.
 */
function lenientParse(raw: string): Record<string, unknown> | null {
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

/** Hand-validate (zod stays a peer dependency we don't lean on here). */
function validateDiagnosis(raw: Record<string, unknown>, candidateIds: Set<string>): Diagnosis {
  let id: string | null = null;
  const rawId = raw['misconception_id'];
  if (typeof rawId === 'string' && candidateIds.has(rawId)) {
    id = rawId; // an id outside the candidates would be fabricated
  }
  const rawConfidence = raw['confidence'];
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0.5;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const rawDoNotSay = raw['do_not_say'];
  const do_not_say = Array.isArray(rawDoNotSay)
    ? rawDoNotSay.filter((x): x is string => typeof x === 'string')
    : [];
  return {
    misconception_id: id,
    confidence,
    reconstruction: str(raw['reconstruction']),
    clue_target: str(raw['clue_target']),
    do_not_say,
  };
}

/**
 * Diagnose the fault path. Returns null when AI is disabled, the provider is
 * missing, the call fails, or the output cannot be validated — never throws,
 * never fabricates.
 */
export async function diagnoseFaultPath(input: DiagnoseInput): Promise<Diagnosis | null> {
  const { aiSettings, signal } = input;
  if (!aiSettings?.enabled) return null;
  let model;
  try {
    model = getAIProvider(aiSettings).getModel();
  } catch {
    return null;
  }

  // Shorter budget than the tutor's 45s: diagnosis blocks the hint pipeline,
  // and a fast null keeps the rung-based fallback snappy.
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const { text } = await generateText({
      model,
      system: DIAGNOSE_SYSTEM,
      prompt: buildPrompt(input),
      abortSignal: combined,
    });
    const raw = lenientParse(text);
    if (!raw) return null;
    return validateDiagnosis(raw, new Set(input.candidates.map((c) => c.id)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Wave 4 — deterministic match against the book's verified chapter library
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
 * shared word is a coincidence, not a diagnosis — a signature of 3+ tokens
 * demands at least two hits.
 */
export function misconceptionSimilarity(answerText: string, wrongReading: string): number {
  const answer = contentTokens(answerText);
  const signature = contentTokens(wrongReading);
  if (answer.size === 0 || signature.size === 0) return 0;
  let hits = 0;
  for (const t of signature) if (answer.has(t)) hits += 1;
  if (signature.size >= 3 && hits < 2) return 0;
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
