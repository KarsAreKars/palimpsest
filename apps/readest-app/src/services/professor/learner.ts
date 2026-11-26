/**
 * Learner store (HP-4, hey_prof_integration_plan §6) — the question log.
 *
 * Every professor exchange appends to `learner.json` in the book's
 * directory, and the distilled study note to `notes.md` (plan §7). The log
 * is the pedagogy engine's evidence base: it never guesses what the reader
 * knows — it counts what they asked.
 *
 * Concept state (Bloom tracker + Wave 2 mastery ledger):
 *   - A concept starts at Bloom level 2 (understand) the first time it is
 *     asked about — asking means they engaged but haven't got it yet.
 *   - Re-asking the SAME concept drops the level (min 1): the previous
 *     explanation didn't land. This is the stuck signal.
 *   - A "check-me" exchange raises the level (max 6) ONLY on an explicit
 *     graded verdict of "pass". No verdict → asked-only: never credit,
 *     never a penalty (audit #33 — the student model is fed by graded
 *     outcomes, not by asks or by inferred "resolved" flags).
 *
 * Wave 2 (audit Ruling 4): the graded-outcome ledger. A concept earns
 *   - an FSRS card (ConceptState.card) — created and advanced ONLY by a
 *     graded check verdict; the card's due_ts is the authoritative return
 *     date (it supersedes the old fixed 24/72/168h retest queue, removed
 *     in this wave — old files carrying retest_queue simply stop
 *     propagating it on the next write), and
 *   - a 3-state mastery (unknown/edge/known) derived from the last-10
 *     graded-outcome window (gradedAccuracy ≥ 0.8 → known). Asks feed
 *     nothing here: no card, no mastery credit (mechanism #33).
 *
 * Stuck rule (plan §6): a concept asked ≥ STUCK_THRESHOLD times means the
 * professor must switch strategy — never repeat an explanation — and offer
 * a Feynman session. `stuckNoteForPrompt` renders that instruction for the
 * context pack.
 *
 * The pure state machine (applyExchange / isStuck) is separated from file
 * IO so the pedagogy rules are contract-testable without a filesystem.
 */
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { getDir } from '@/utils/book';
import type { CardState } from './scheduler';
import type { MisconceptionLibrary } from './misconceptions';
import { initialCard, reviewCard, RATING_AGAIN, RATING_GOOD } from './scheduler';
import { toText } from './io';

export const LEARNER_FILENAME = 'learner.json';
export const NOTES_FILENAME = 'notes.md';
export const STUCK_THRESHOLD = 3;

export type QuestionKind = 'define' | 'why' | 'how-connects' | 'example' | 'check-me' | 'other';

export const normalizeQKind = (raw: string | undefined): QuestionKind => {
  switch (raw) {
    case 'define':
    case 'why':
    case 'how-connects':
    case 'example':
    case 'check-me':
      return raw;
    default:
      return 'other';
  }
};

export interface LearnerExchange {
  ts: string; // ISO timestamp
  concept: string; // slug, e.g. "associated_primes"
  page: number; // 1-based PDF page where it was asked
  question_kind: QuestionKind;
  question: string; // the reader's own words
  resolved: boolean;
  /** The Prof's graded verdict when this exchange was a check-me the Prof
   *  graded ([PASS]/[RETRY]). Ground truth for Bloom credit — without it a
   *  failed check-me counted as resolved (review finding, 2026-09-13). */
  verdict?: 'pass' | 'retry';
}

export interface ConceptState {
  bloom: number; // 1..6
  asked: number;
  last_ts: string;
  /** Misconceptions named for this concept (dedupe-appended; additive). */
  misconception_ids?: string[];
  /** FSRS card state — exists ONLY once a graded check verdict has landed
   *  (Wave 2 ledger; additive — absent in old logs and in never-graded
   *  concepts). The card's due_ts is the authoritative review date. */
  card?: CardState;
  /** Graded check outcomes, newest last, capped at 10 — the accuracy
   *  window behind mastery (additive; absent in old logs). */
  graded?: Array<'pass' | 'retry'>;
}

/** 3-state mastery, derived from the graded-outcome window (Wave 2). */
export type Mastery = 'unknown' | 'edge' | 'known';

/** Pass ratio over the last-10 graded check window (0 when never graded). */
export function gradedAccuracy(state: ConceptState): number {
  const graded = state.graded ?? [];
  if (graded.length === 0) return 0;
  return graded.filter((v) => v === 'pass').length / graded.length;
}

/**
 * Mastery state: unknown until a graded check exists; known once the
 * last-10 window is ≥ 80% passes (L2 §15's ≥80% gate, windowed); edge in
 * between — including "every check failed so far", which is engaged but
 * unproven, never unknown.
 */
export function masteryOf(state: ConceptState): Mastery {
  const graded = state.graded ?? [];
  if (graded.length === 0) return 'unknown';
  return gradedAccuracy(state) >= 0.8 ? 'known' : 'edge';
}

export interface LearnerState {
  exchanges: LearnerExchange[];
  concept_states: Record<string, ConceptState>;
  /** Anti-gaming telemetry per problem (additive). */
  gaming_signals?: Record<string, { hint_velocity: number; flags: number }>;
  /** Opaque per-problem tutoring sessions, keyed by problem (additive). */
  problem_sessions?: Record<string, unknown>;
  /** Wave 4 (Specificity Engine): the book-scoped, book-verified chapter
   *  misconception library, keyed by concept + page (misconceptions.ts).
   *  Additive — absent in old logs. */
  misconception_library?: MisconceptionLibrary;
}

export const emptyLearner = (): LearnerState => ({ exchanges: [], concept_states: {} });

export const UNCATEGORIZED_CONCEPT = 'uncategorized';

/**
 * Fold one exchange into the state. Also settles the PREVIOUS exchange's
 * `resolved` flag: if the reader moved to a different concept, the previous
 * one landed; if they re-asked the same concept, it didn't.
 */
export function applyExchange(state: LearnerState, ex: LearnerExchange): LearnerState {
  const exchanges = state.exchanges.map((prev, i) =>
    i === state.exchanges.length - 1 ? { ...prev, resolved: prev.concept !== ex.concept } : prev,
  );
  exchanges.push(ex);

  const prev = state.concept_states[ex.concept];
  let bloom: number;
  if (!prev) {
    bloom = 2; // first contact: engaged, not yet mastered
  } else if (ex.question_kind === 'check-me' && ex.verdict === 'pass') {
    bloom = Math.min(6, prev.bloom + 1); // graded pass — the only source of credit
  } else if (ex.question_kind === 'check-me') {
    bloom = prev.bloom; // a check-me with no graded outcome is asked-only: no credit, no penalty
  } else {
    bloom = Math.max(1, prev.bloom - 1); // re-asking = the last explanation failed
  }
  // --- Wave 2 ledger: graded check outcomes only (mechanism #33). An ask
  // --- — even a check-me the Prof never graded — touches neither the
  // --- graded window nor the FSRS card.
  const now = Date.parse(ex.ts);
  const when = Number.isNaN(now) ? Date.now() : now;
  const isGradedCheck =
    ex.question_kind === 'check-me' && (ex.verdict === 'pass' || ex.verdict === 'retry');
  const graded = isGradedCheck ? [...(prev?.graded ?? []), ex.verdict!].slice(-10) : prev?.graded;
  const rating = ex.verdict === 'pass' ? RATING_GOOD : RATING_AGAIN;
  const card = isGradedCheck
    ? prev?.card
      ? reviewCard(prev.card, rating, when)
      : initialCard(rating, when)
    : prev?.card;
  const concept_states = {
    ...state.concept_states,
    [ex.concept]: {
      bloom,
      asked: (prev?.asked ?? 0) + 1,
      last_ts: ex.ts,
      ...(graded !== undefined ? { graded } : {}),
      ...(card !== undefined ? { card } : {}),
    },
  };
  // Additive fields (gaming_signals, problem_sessions, Wave 4's
  // misconception_library, …) ride through untouched.
  return { ...state, exchanges, concept_states };
}

/** Dedupe-append a named misconception to a concept's state. Pure. */
export function recordMisconceptionHit(state: ConceptState, id: string): ConceptState {
  if (state.misconception_ids?.includes(id)) return state;
  return { ...state, misconception_ids: [...(state.misconception_ids ?? []), id] };
}

/** Plan §6: same concept asked ≥3× → switch strategy, offer a Feynman session. */
export function isStuck(state: LearnerState, concept: string): boolean {
  return (state.concept_states[concept]?.asked ?? 0) >= STUCK_THRESHOLD;
}

export function stuckConcepts(state: LearnerState): string[] {
  return Object.entries(state.concept_states)
    .filter(([, s]) => s.asked >= STUCK_THRESHOLD)
    .map(([c]) => c);
}

/** The prompt line the professor sees when the evidence says "stuck". */
export function stuckNoteForPrompt(state: LearnerState, concept: string): string | null {
  const s = state.concept_states[concept];
  if (!s || s.asked < STUCK_THRESHOLD) return null;
  return (
    `The reader has now asked about "${concept.replace(/_/g, ' ')}" ${s.asked} times. ` +
    'Your earlier explanations did not land. Do NOT repeat any of them — switch strategy ' +
    'entirely: if you used abstraction, use a tiny concrete example; if you used an example, ' +
    'use an analogy from everyday life. Keep it shorter than usual. End by asking them to ' +
    'explain the idea back to you in their own words (a Feynman check).'
  );
}

// ---------------------------------------------------------------------------
// Persistence (per book, in the Books base dir — travels with the .hpub)
// ---------------------------------------------------------------------------

// Read-modify-write must not interleave across overlapping exchanges; one
// in-flight chain per book serializes appends.
const chains = new Map<string, Promise<unknown>>();

const serialized = <T>(bookHash: string, fn: () => Promise<T>): Promise<T> => {
  const prev = chains.get(bookHash) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    bookHash,
    next.catch(() => undefined),
  );
  return next;
};

export async function loadLearner(appService: AppService, book: Book): Promise<LearnerState> {
  try {
    const raw = toText(
      await appService.readFile(`${getDir(book)}/${LEARNER_FILENAME}`, 'Books', 'text'),
    );
    const parsed = JSON.parse(raw) as Partial<LearnerState>;
    return {
      exchanges: Array.isArray(parsed.exchanges) ? parsed.exchanges : [],
      concept_states: parsed.concept_states ?? {},
      // Additive fields: tolerate absence in old logs, preserve when present.
      // retest_queue (Wave 1) is deliberately dropped: the FSRS due-date
      // superseded it, and the next appendExchange re-serializes the state
      // without it — that re-write is the migration.
      ...(parsed.gaming_signals && typeof parsed.gaming_signals === 'object'
        ? { gaming_signals: parsed.gaming_signals }
        : {}),
      ...(parsed.problem_sessions && typeof parsed.problem_sessions === 'object'
        ? { problem_sessions: parsed.problem_sessions }
        : {}),
      ...(parsed.misconception_library && typeof parsed.misconception_library === 'object'
        ? { misconception_library: parsed.misconception_library }
        : {}),
    };
  } catch {
    return emptyLearner(); // first exchange ever, or a corrupt log — start clean
  }
}

export async function appendExchange(
  appService: AppService,
  book: Book,
  ex: LearnerExchange,
): Promise<LearnerState> {
  return serialized(book.hash, async () => {
    const state = applyExchange(await loadLearner(appService, book), ex);
    await appService.writeFile(
      `${getDir(book)}/${LEARNER_FILENAME}`,
      'Books',
      JSON.stringify(state, null, 2),
    );
    return state;
  });
}

export async function appendNote(
  appService: AppService,
  book: Book,
  noteMd: string,
): Promise<void> {
  return serialized(book.hash, async () => {
    let existing = '';
    try {
      existing = toText(
        await appService.readFile(`${getDir(book)}/${NOTES_FILENAME}`, 'Books', 'text'),
      );
    } catch {
      existing = '';
    }
    const sep = existing.trim().length > 0 ? '\n\n' : '';
    await appService.writeFile(
      `${getDir(book)}/${NOTES_FILENAME}`,
      'Books',
      `${existing}${sep}${noteMd.trim()}\n`,
    );
  });
}
