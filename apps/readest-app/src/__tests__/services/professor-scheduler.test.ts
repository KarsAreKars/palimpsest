/**
 * Wave 2 contract tests — "The Professor Remembers" (audit Ruling 4):
 * the FSRS-5 scheduler and the graded-outcome ledger.
 *
 * The load-bearing guarantees:
 *  1. A graded check creates/updates a concept's FSRS card; an ungraded
 *     ask (or a check the Prof never graded) creates NOTHING (mechanism
 *     #33 — the ledger is fed by verdicts, never by asks).
 *  2. Scheduling behaves like memory: answered well → the card moves out
 *     LONGER; answered poorly → it comes back SOONER.
 *  3. The 3-state mastery (unknown/edge/known) derives from the last-10
 *     graded window only.
 *  4. The review sitting composes ~2/3 due + ~1/3 new, interleaved.
 */
import { describe, it, expect } from 'vitest';
import {
  DAY_MS,
  DECAY,
  DESIRED_RETENTION,
  FACTOR,
  FSRS_DEFAULT_WEIGHTS,
  RATING_AGAIN,
  RATING_GOOD,
  SESSION_CARD_CAP,
  composeReviewQueue,
  dueCards,
  initialCard,
  nextIntervalDays,
  retrievability,
  reviewCard,
  reviewCardLeitner,
  type CardState,
  type LeitnerCard,
} from '@/services/professor/scheduler';
import {
  applyExchange,
  emptyLearner,
  gradedAccuracy,
  masteryOf,
  type LearnerExchange,
} from '@/services/professor/learner';

const T0 = Date.parse('2026-11-19T09:00:00.000Z');
const DAY = (n: number): string => new Date(T0 + n * DAY_MS).toISOString();

const ex = (over: Partial<LearnerExchange>): LearnerExchange => ({
  ts: DAY(0),
  concept: 'associated_primes',
  page: 117,
  question_kind: 'why',
  question: 'why does the empty intersection matter?',
  resolved: true,
  ...over,
});

const stateOf = (exchanges: LearnerExchange[]) => exchanges.reduce(applyExchange, emptyLearner());

// --- FSRS-5 math -------------------------------------------------------------

describe('FSRS-5 reference math', () => {
  it('ships the 17 default weights and retention 0.90 (R5, L2 §15)', () => {
    expect(FSRS_DEFAULT_WEIGHTS).toHaveLength(17);
    expect(DESIRED_RETENTION).toBe(0.9);
  });

  it('interval at the default retention equals stability (formula invariant)', () => {
    // I(r, S) = (S / FACTOR) * (r^(1/DECAY) - 1); FACTOR = 0.9^(1/DECAY) - 1.
    expect(nextIntervalDays(3.173)).toBe(3);
    expect(nextIntervalDays(10)).toBe(10);
    expect(nextIntervalDays(0.4)).toBe(1); // day-granularity floor
  });

  it('retrievability decays with elapsed days and grows with stability', () => {
    const early = retrievability(1, 5);
    const late = retrievability(10, 5);
    const stable = retrievability(10, 50);
    expect(early).toBeGreaterThan(late);
    expect(stable).toBeGreaterThan(late);
    expect(early).toBeLessThanOrEqual(1);
  });

  it('constants are self-consistent: FACTOR = 0.9 ** (1 / DECAY) - 1', () => {
    expect(FACTOR).toBeCloseTo(0.9 ** (1 / DECAY) - 1, 10);
  });
});

describe('card lifecycle: well answered moves out, poorly answered comes back', () => {
  it('a Good review schedules FURTHER out than the card it replaced', () => {
    const first = initialCard(RATING_GOOD, T0); // graded pass creates the card
    const again = reviewCard(first, RATING_GOOD, T0 + 3 * DAY_MS);
    expect(again.due_ts).toBeGreaterThan(first.due_ts);
    expect(again.stability).toBeGreaterThan(first.stability);
    expect(again.reps).toBe(first.reps + 1);
    expect(again.lapses).toBe(0);
  });

  it('an Again lapse schedules SOONER than a Good at the same moment (and records the lapse)', () => {
    const first = initialCard(RATING_GOOD, T0);
    const reviewAt = T0 + 3 * DAY_MS;
    const lapsed = reviewCard(first, RATING_AGAIN, reviewAt);
    const gradedWell = reviewCard(first, RATING_GOOD, reviewAt);
    // Poor answer → back sooner: the lapse horizon is strictly shorter
    // than what a Good review would have earned at the same moment.
    expect(lapsed.due_ts).toBeLessThan(gradedWell.due_ts);
    expect(lapsed.stability).toBeLessThan(gradedWell.stability);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.reps).toBe(first.reps + 1);
  });

  it('repeated passes lengthen the schedule; a lapse cuts it back', () => {
    let card: CardState = initialCard(RATING_GOOD, T0);
    const horizon = (c: CardState) => c.due_ts - c.last_review_ts;
    const h1 = horizon(card);
    card = reviewCard(card, RATING_GOOD, card.due_ts);
    const h2 = horizon(card);
    card = reviewCard(card, RATING_GOOD, card.due_ts);
    const h3 = horizon(card);
    expect(h2).toBeGreaterThan(h1);
    expect(h3).toBeGreaterThan(h2);
    const beforeLapse = card;
    card = reviewCard(card, RATING_AGAIN, card.due_ts);
    // The lapse horizon is strictly shorter than a Good at the same moment
    // would have produced. (FSRS-5 keeps mature-card stability high after
    // a lapse — sooner than a pass, not necessarily nearer than yesterday's
    // schedule. The relative comparison is the truthful one.)
    expect(horizon(card)).toBeLessThan(
      horizon(reviewCard(beforeLapse, RATING_GOOD, beforeLapse.due_ts)),
    );
  });

  it('difficulty stays inside [1, 10] however the card is graded', () => {
    let card: CardState = initialCard(RATING_AGAIN, T0);
    for (let i = 0; i < 20; i++) {
      card = reviewCard(card, i % 2 ? RATING_AGAIN : RATING_GOOD, card.due_ts);
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it('Leitner seam (R5 fallback): correct climbs 1d→3d→7d→16d, wrong resets', () => {
    let card: LeitnerCard = { box: 0, due_ts: T0, reps: 0, lapses: 0 };
    card = reviewCardLeitner(card, true, T0);
    expect(card.box).toBe(1);
    expect(card.due_ts).toBe(T0 + 3 * DAY_MS); // box 2 → 3d
    const afterMiss = reviewCardLeitner(card, false, card.due_ts);
    expect(afterMiss.box).toBe(0); // wrong → back to box 1
    expect(afterMiss.lapses).toBe(1);
    let climb = afterMiss;
    for (let i = 0; i < 3; i++) climb = reviewCardLeitner(climb, true, climb.due_ts);
    expect(climb.box).toBe(3);
    expect(climb.due_ts).toBe(afterMiss.due_ts + (3 + 7 + 16) * DAY_MS);
  });
});

// --- The ledger: graded outcomes only (#33) ----------------------------------

describe('graded-outcome ledger (learner.ts × scheduler)', () => {
  it('a graded pass creates the card, due a few days out', () => {
    const s = stateOf([ex({ question_kind: 'check-me', verdict: 'pass' })]);
    const c = s.concept_states['associated_primes']!;
    expect(c.card).toBeDefined();
    expect(c.card!.due_ts).toBeGreaterThan(T0);
    expect(c.card!.due_ts - T0).toBeLessThanOrEqual(4 * DAY_MS); // Good ≈ 3d
    expect(c.graded).toEqual(['pass']);
  });

  it('a graded retry creates the card too — but brings it back tomorrow', () => {
    const s = stateOf([ex({ question_kind: 'check-me', verdict: 'retry' })]);
    const c = s.concept_states['associated_primes']!;
    expect(c.card).toBeDefined();
    // First graded outcome with a fail: stability S₀(Again) = w₀ ≈ 0.40d
    // → the day-granularity floor: tomorrow.
    expect(c.card!.due_ts - T0).toBe(DAY_MS);
    expect(c.card!.lapses).toBe(1);
    expect(c.graded).toEqual(['retry']);
  });

  it('a plain ask creates NO card and NO graded window (#33)', () => {
    const s = stateOf([ex({}), ex({}), ex({})]);
    const c = s.concept_states['associated_primes']!;
    expect(c.card).toBeUndefined();
    expect(c.graded).toBeUndefined();
    expect(masteryOf(c)).toBe('unknown');
  });

  it('a check-me the Prof never graded is asked-only: NO card (#33)', () => {
    const s = stateOf([ex({ question_kind: 'check-me', resolved: true })]);
    const c = s.concept_states['associated_primes']!;
    expect(c.card).toBeUndefined();
    expect(masteryOf(c)).toBe('unknown');
  });

  it('each graded check advances the FSRS card: pass pushes out, retry pulls in', () => {
    const pass = ex({ question_kind: 'check-me', verdict: 'pass' });
    const retry = ex({ question_kind: 'check-me', verdict: 'retry' });
    let s = stateOf([pass]);
    const cardAfterPass = s.concept_states['associated_primes']!.card!;
    // Reviewed AT its due date with a retry vs. a pass: the lapse schedules
    // strictly sooner than the pass would have.
    const lapsed = reviewCard(cardAfterPass, RATING_AGAIN, cardAfterPass.due_ts);
    const repassed = reviewCard(cardAfterPass, RATING_GOOD, cardAfterPass.due_ts);
    s = applyExchange(s, { ...retry, ts: new Date(cardAfterPass.due_ts).toISOString() });
    expect(s.concept_states['associated_primes']!.card!.due_ts).toBe(lapsed.due_ts);
    expect(lapsed.due_ts).toBeLessThan(repassed.due_ts);
    // And the next pass pushes it back out.
    s = applyExchange(s, { ...pass, ts: new Date(lapsed.due_ts).toISOString() });
    const after = s.concept_states['associated_primes']!.card!;
    expect(after.due_ts).toBeGreaterThan(lapsed.due_ts);
    expect(after.lapses).toBe(1); // the lapse stays on record
    expect(s.concept_states['associated_primes']!.graded).toEqual(['pass', 'retry', 'pass']);
  });

  it('the graded window caps at the last 10 outcomes', () => {
    let s = emptyLearner();
    for (let i = 0; i < 12; i++) {
      s = applyExchange(s, ex({ question_kind: 'check-me', verdict: 'pass', ts: DAY(i) }));
    }
    const graded = s.concept_states['associated_primes']!.graded!;
    expect(graded).toHaveLength(10);
  });
});

// --- 3-state mastery ---------------------------------------------------------

describe('mastery states', () => {
  it('unknown → edge → known as graded evidence accumulates', () => {
    const retry = ex({ question_kind: 'check-me', verdict: 'retry' });
    const pass = ex({ question_kind: 'check-me', verdict: 'pass' });
    let s = emptyLearner();
    expect(
      masteryOf(
        s.concept_states['associated_primes'] ?? {
          bloom: 2,
          asked: 0,
          last_ts: '',
        },
      ),
    ).toBe('unknown');
    s = applyExchange(s, retry);
    expect(masteryOf(s.concept_states['associated_primes']!)).toBe('edge'); // failed but engaged
    s = applyExchange(s, { ...pass, ts: DAY(1) });
    expect(masteryOf(s.concept_states['associated_primes']!)).toBe('edge'); // 1/2 < 0.8
    s = applyExchange(s, { ...pass, ts: DAY(2) });
    s = applyExchange(s, { ...pass, ts: DAY(3) });
    s = applyExchange(s, { ...pass, ts: DAY(4) });
    expect(gradedAccuracy(s.concept_states['associated_primes']!)).toBeGreaterThanOrEqual(0.8);
    expect(masteryOf(s.concept_states['associated_primes']!)).toBe('known');
  });

  it('a fresh lapse after mastery drops it back to edge', () => {
    let s = emptyLearner();
    for (let i = 0; i < 3; i++) {
      s = applyExchange(s, ex({ question_kind: 'check-me', verdict: 'pass', ts: DAY(i) }));
    }
    expect(masteryOf(s.concept_states['associated_primes']!)).toBe('known'); // 3/3
    s = applyExchange(s, ex({ question_kind: 'check-me', verdict: 'retry', ts: DAY(5) }));
    expect(gradedAccuracy(s.concept_states['associated_primes']!)).toBeCloseTo(0.75);
    expect(masteryOf(s.concept_states['associated_primes']!)).toBe('edge');
  });
});

// --- Due queue ---------------------------------------------------------------

describe('due queue', () => {
  it('dueCards surfaces only cards past their due date, oldest first', () => {
    let s = emptyLearner();
    s = applyExchange(
      s,
      ex({ concept: 'fresh_pass', question_kind: 'check-me', verdict: 'pass', ts: DAY(0) }),
    );
    s = applyExchange(
      s,
      ex({ concept: 'old_retry', question_kind: 'check-me', verdict: 'retry', ts: DAY(0) }),
    );
    const now = T0 + 5 * DAY_MS; // both cards are due
    const due = dueCards(s.concept_states, now);
    // Oldest due first: the retry (due +1d) before the pass (due +3d).
    expect(due.map((d) => d.concept)).toEqual(['old_retry', 'fresh_pass']);
    // Only the retry is due at +2d.
    expect(dueCards(s.concept_states, T0 + 2 * DAY_MS).map((d) => d.concept)).toEqual([
      'old_retry',
    ]);
  });

  it('composeReviewQueue holds the 2/3 due : 1/3 new mix, interleaved', () => {
    const due = Array.from({ length: 12 }, (_, i) => ({ concept: `due_${i}` }));
    const fresh = Array.from({ length: 6 }, (_, i) => ({ concept: `new_${i}` }));
    const q = composeReviewQueue(due, fresh);
    const dueCount = q.filter((p) => p.concept.startsWith('due_')).length;
    const freshCount = q.filter((p) => p.concept.startsWith('new_')).length;
    expect(dueCount).toBe(12);
    expect(freshCount).toBe(6);
    // Interleaved: no fresh card appears before the first due card.
    expect(q[0]!.concept).toBe('due_0');
    // Fresh cards never cluster: each fresh slot is separated by dues.
    const freshIdx = q.map((p, i) => (p.concept.startsWith('new_') ? i : -1)).filter((i) => i >= 0);
    for (let k = 1; k < freshIdx.length; k++) {
      expect(freshIdx[k]! - freshIdx[k - 1]!).toBeGreaterThanOrEqual(2);
    }
  });

  it('caps the sitting at SESSION_CARD_CAP (20)', () => {
    const due = Array.from({ length: 30 }, (_, i) => ({ concept: `due_${i}` }));
    expect(composeReviewQueue(due, []).length).toBe(SESSION_CARD_CAP);
    expect(SESSION_CARD_CAP).toBe(20);
  });

  it('with nothing due, the sitting is all new; with nothing new, all due', () => {
    expect(composeReviewQueue([], [{ concept: 'a' }]).map((p) => p.concept)).toEqual(['a']);
    expect(composeReviewQueue([{ concept: 'a' }], []).map((p) => p.concept)).toEqual(['a']);
  });
});
