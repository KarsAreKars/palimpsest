/**
 * Spaced-repetition scheduler (Learning Engine Wave 2 — "The Professor
 * Remembers"). The FSRS due-date is now the authoritative answer to "when
 * does this concept come back?" — it supersedes the old fixed 24/72/168h
 * retest queue (audit Ruling 3 #7, Ruling 4 Wave 2).
 *
 * Choice of implementation: FSRS-5 reference implementation, hand-ported
 * (~80 lines) rather than imported. King R5 accepts the dependency, but the
 * formulas are small, stable, and published; a local port keeps the bundle
 * dependency-lean and makes every constant visible to review. Default
 * weights, desired retention 0.90 (L2 §15). A 4-box Leitner scheduler sits
 * behind the same call shape as the pre-built fallback seam (R5) — FSRS is
 * the default.
 *
 * Ratings map from graded check outcomes (learner.ts applies them):
 *   verdict "pass" → Good (3), verdict "retry" → Again (1).
 *
 * Day granularity, deliberately: reviews surface only at a section
 * boundary (R3), so sub-day precision would be wasted precision. The
 * short-term (same-day) FSRS step is therefore omitted — the first graded
 * check schedules the first day-scale review, matching the card lifecycle
 * in L2 §15.
 *
 * Everything here is pure so scheduling is contract-testable: a seeded
 * learner state must produce correct due-dates in tests.
 */

/** FSRS-5 default weights (17), from the open-spaced-repetition reference. */
export const FSRS_DEFAULT_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  2.0815, 0.0973, 0.89055, 2.2478, 0.336, 2.9662,
] as const;

/** The retention the schedule defends (L2 §15: desired retention 0.90). */
export const DESIRED_RETENTION = 0.9;

/** FSRS forgetting-curve constants: FACTOR = 0.9 ** (1 / DECAY) - 1. */
export const DECAY = -0.5;
export const FACTOR = 19 / 81;

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Per-session review cap (L2 §15: cap 20 cards/session). */
export const SESSION_CARD_CAP = 20;

/** Again / Hard / Good / Easy — mapped from graded check outcomes. */
export type Rating = 1 | 2 | 3 | 4;

export const RATING_AGAIN = 1 as const;
export const RATING_GOOD = 3 as const;

/** Per-concept FSRS card state (lives on ConceptState.card in learner.ts). */
export interface CardState {
  /** Difficulty D, clamped 1..10. */
  difficulty: number;
  /** Stability S, in days — the FSRS memory model for this concept. */
  stability: number;
  /** ms epoch when the next review is due. Authoritative. */
  due_ts: number;
  /** ms epoch of the last review (graded outcome). */
  last_review_ts: number;
  reps: number;
  lapses: number;
}

type Weights = readonly number[];

const clampDifficulty = (d: number): number => Math.min(10, Math.max(1, d));

/** Forgetting curve: probability of recall after elapsedDays (FSRS-5). */
export function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

/**
 * Days until the next review for a given stability at the requested
 * retention: I(r, S) = (S / FACTOR) * (r^(1/DECAY) - 1). At the default
 * retention 0.90 this equals S (FACTOR cancels) — a handy invariant the
 * tests pin. Minimum 1 day (day granularity).
 */
export function nextIntervalDays(stability: number, retention: number = DESIRED_RETENTION): number {
  const days = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return Math.max(1, Math.round(days));
}

/** First graded outcome initializes the card (FSRS init_ds / init_s). */
export function initialCard(
  rating: Rating,
  now: number,
  weights: Weights = FSRS_DEFAULT_WEIGHTS,
): CardState {
  const stability = weights[rating - 1] ?? weights[0]!;
  const difficulty = clampDifficulty(weights[4]! - Math.exp(weights[5]! * (rating - 1)) + 1);
  return {
    difficulty,
    stability,
    due_ts: now + nextIntervalDays(stability, DESIRED_RETENTION) * DAY_MS,
    last_review_ts: now,
    reps: 1,
    lapses: rating === RATING_AGAIN ? 1 : 0,
  };
}

/** One review through the FSRS-5 update. `now` is a ms epoch. */
export function reviewCard(
  card: CardState,
  rating: Rating,
  now: number,
  weights: Weights = FSRS_DEFAULT_WEIGHTS,
): CardState {
  const elapsedDays = Math.max(0, (now - card.last_review_ts) / DAY_MS);
  const r = retrievability(elapsedDays, card.stability);
  const difficulty = clampDifficulty(card.difficulty - weights[6]! * (rating - 3));
  let stability: number;
  if (rating === RATING_AGAIN) {
    // Lapse: stability collapses toward the relearning curve.
    stability =
      weights[11]! *
      Math.pow(difficulty, -weights[12]!) *
      (Math.pow(card.stability + 1, weights[13]!) - 1) *
      Math.exp(weights[14]! * (1 - r));
  } else {
    stability =
      card.stability *
      (1 +
        Math.exp(weights[8]!) *
          (11 - difficulty) *
          Math.pow(card.stability, -weights[9]!) *
          (Math.exp(weights[10]! * (1 - r)) - 1));
  }
  return {
    difficulty,
    stability,
    due_ts: now + nextIntervalDays(stability, DESIRED_RETENTION) * DAY_MS,
    last_review_ts: now,
    reps: card.reps + 1,
    lapses: card.lapses + (rating === RATING_AGAIN ? 1 : 0),
  };
}

// --- Leitner-4 fallback seam (King R5: pre-built fallback, not the default) --

export type SchedulerKind = 'fsrs' | 'leitner';

export interface LeitnerCard {
  box: 0 | 1 | 2 | 3;
  due_ts: number;
  reps: number;
  lapses: number;
}

/** 4-box Leitner intervals: 1d / 3d / 7d / 16d; wrong → box 1 (L2 §15). */
export const LEITNER_INTERVALS_DAYS = [1, 3, 7, 16] as const;

export function reviewCardLeitner(card: LeitnerCard, correct: boolean, now: number): LeitnerCard {
  const box = (correct ? Math.min(3, card.box + 1) : 0) as LeitnerCard['box'];
  return {
    box,
    due_ts: now + LEITNER_INTERVALS_DAYS[box] * DAY_MS,
    reps: card.reps + 1,
    lapses: card.lapses + (correct ? 0 : 1),
  };
}

// --- Review queue composition (interleaving, L2 §3/§15) ----------------------

export interface ReviewPick {
  concept: string;
  /** Book identifier for cross-book queues; absent = current book. */
  book?: string;
}

export interface DueCard extends ReviewPick {
  card: CardState;
}

/** All cards due as of `now`, oldest due first. Cross-book when callers
 *  merge several books' concept_states (same pure call per book). */
export function dueCards(
  states: Record<string, { card?: CardState }>,
  now: number,
  book?: string,
): DueCard[] {
  return Object.entries(states)
    .filter(([, s]) => s.card !== undefined && s.card.due_ts <= now)
    .map(([concept, s]) => ({ concept, card: s.card!, ...(book !== undefined ? { book } : {}) }))
    .sort((a, b) => a.card.due_ts - b.card.due_ts);
}

/**
 * Compose one review sitting: ~2/3 due reviews, ~1/3 new-or-lapsed
 * (L2 §15 session composition), interleaved so cards never group by
 * document. Anything beyond `cap` waits for the next sitting.
 */
export function composeReviewQueue(
  due: ReviewPick[],
  fresh: ReviewPick[],
  cap: number = SESSION_CARD_CAP,
): ReviewPick[] {
  const dueTake = Math.min(due.length, Math.ceil((cap * 2) / 3));
  const freshTake = Math.min(fresh.length, cap - dueTake);
  // Slots the fresh queue couldn't fill go back to due reviews — a
  // sitting never shrinks below its due burden just because nothing new
  // was available.
  const d = due.slice(0, Math.min(due.length, cap - freshTake));
  const f = fresh.slice(0, freshTake);
  const out: ReviewPick[] = [];
  let di = 0;
  let fi = 0;
  while (di < d.length || fi < f.length) {
    if (di < d.length) out.push(d[di++]!);
    if (di < d.length) out.push(d[di++]!);
    if (fi < f.length) out.push(f[fi++]!);
  }
  return out.slice(0, cap);
}
