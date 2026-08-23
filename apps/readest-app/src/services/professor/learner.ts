/**
 * Learner store (HP-4, hey_prof_integration_plan §6) — the question log.
 *
 * Every professor exchange appends to `learner.json` in the book's
 * directory, and the distilled study note to `notes.md` (plan §7). The log
 * is the pedagogy engine's evidence base: it never guesses what the reader
 * knows — it counts what they asked.
 *
 * Concept state (Bloom tracker):
 *   - A concept starts at Bloom level 2 (understand) the first time it is
 *     asked about — asking means they engaged but haven't got it yet.
 *   - Re-asking the SAME concept drops the level (min 1): the previous
 *     explanation didn't land. This is the stuck signal.
 *   - A resolved "check-me" exchange (the reader explains it back and the
 *     professor confirms) raises it (max 6).
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
}

export interface ConceptState {
  bloom: number; // 1..6
  asked: number;
  last_ts: string;
}

export interface LearnerState {
  exchanges: LearnerExchange[];
  concept_states: Record<string, ConceptState>;
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
  } else if (ex.question_kind === 'check-me' && ex.resolved) {
    bloom = Math.min(6, prev.bloom + 1);
  } else {
    bloom = Math.max(1, prev.bloom - 1); // re-asking = the last explanation failed
  }
  const concept_states = {
    ...state.concept_states,
    [ex.concept]: { bloom, asked: (prev?.asked ?? 0) + 1, last_ts: ex.ts },
  };
  return { exchanges, concept_states };
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

const toText = (c: string | ArrayBuffer): string =>
  typeof c === 'string' ? c : new TextDecoder().decode(c);

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
