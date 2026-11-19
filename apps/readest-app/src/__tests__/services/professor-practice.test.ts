/**
 * Wave 'Learn Mode' contract tests — PRACTICE (practice.ts): its own
 * mode, distinct from reading. A focused run of checks over the Wave 2
 * FSRS due queue, interleaved with varied problems from the goal's
 * concept nodes (the route), graded through the existing
 * verdict-contract voice loop.
 *
 * Load-bearing guarantees:
 *  1. The queue is a MIX: due cards (FSRS-authoritative) + forming
 *     problems from the route, interleaved, due-weighted, capped.
 *  2. The round's question carries the verdict + caption + logging-tag
 *     contract and the retry → re-explain → re-ask rule — the session.ts
 *     loop, baked into one prompt; no new UI machinery.
 */
import { describe, it, expect } from 'vitest';
import {
  composePracticeQueue,
  buildPracticeQuestion,
  PRACTICE_CAP,
} from '@/services/professor/practice';
import { planRoute, type RouteSeed } from '@/services/professor/planRoute';
import { applyExchange, emptyLearner, type LearnerExchange } from '@/services/professor/learner';

const T0 = Date.parse('2026-11-19T09:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = T0 + 30 * DAY_MS; // well past every card's first interval

const check = (concept: string, verdict: 'pass' | 'retry', i: number): LearnerExchange => ({
  ts: new Date(T0 + i * 60_000).toISOString(),
  concept,
  page: 5 + i,
  question_kind: 'check-me',
  question: `${concept} check ${i}`,
  resolved: true,
  verdict,
});

const graded = (concept: string, verdicts: Array<'pass' | 'retry'>) =>
  verdicts.reduce((s, v, i) => applyExchange(s, check(concept, v, i)), emptyLearner());

/** Merge several graded single-concept ledgers into one state. */
const merge = (...states: ReturnType<typeof graded>[]) => ({
  exchanges: states.flatMap((s) => s.exchanges),
  concept_states: Object.assign({}, ...states.map((s) => s.concept_states)),
});

const SEEDS: RouteSeed[] = [
  { name: 'Matrices', page: 12 },
  { name: 'Eigenvalues', page: 44 },
  { name: 'Diagonalization', page: 51 },
];

// matrices + eigenvalues carry graded cards (both long due by NOW);
// determinants exists only as a seed — a fresh problem.
const ledger = () => merge(graded('matrices', ['pass', 'retry']), graded('eigenvalues', ['pass']));

describe('composePracticeQueue', () => {
  it('returns a due + interleaved mix: both kinds present, due first-class', () => {
    const conceptStates = ledger().concept_states;
    const route = planRoute({
      goal: 'Diagonalization',
      conceptStates,
      seeds: SEEDS,
    });
    const items = composePracticeQueue({ conceptStates, route, now: NOW });
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has('due')).toBe(true);
    expect(kinds.has('forming')).toBe(true);
    // Both graded cards are due (30 days out) and both ride in.
    const dueConcepts = items.filter((i) => i.kind === 'due').map((i) => i.concept);
    expect(dueConcepts).toContain('matrices');
    expect(dueConcepts).toContain('eigenvalues');
    // The route's destination practices as a varied problem — practice
    // aims at the road, and the goal is on it.
    expect(items.some((i) => i.kind === 'forming' && i.concept === 'diagonalization')).toBe(true);
    // Interleaved, due-weighted: the sitting opens on a due card.
    expect(items[0]!.kind).toBe('due');
    // Capped.
    expect(items.length).toBeLessThanOrEqual(PRACTICE_CAP);
  });

  it('interleaves rather than grouping: fresh problems break up the due run', () => {
    // Four cards deep in the red + a route whose fresh lane holds two
    // nodes — long enough for forming problems to split the due run.
    const conceptStates = merge(
      graded('matrices', ['pass', 'retry']),
      graded('eigenvalues', ['pass']),
      graded('vector_spaces', ['pass', 'pass', 'pass', 'pass']),
      graded('basis_change', ['pass', 'retry']),
    ).concept_states;
    const route = planRoute({ goal: 'Diagonalization', conceptStates, seeds: SEEDS });
    const items = composePracticeQueue({ conceptStates, route, now: NOW });
    expect(items.filter((i) => i.kind === 'due')).toHaveLength(4);
    const seq = items.map((i) => i.kind);
    // A forming item appears BEFORE the due run is exhausted — practice
    // never reads as a block of reviews.
    expect(seq.indexOf('forming')).toBeLessThan(seq.lastIndexOf('due'));
  });

  it('without a route the forming lane falls back to the ledger’s engaged concepts', () => {
    const conceptStates = ledger().concept_states;
    const items = composePracticeQueue({ conceptStates, now: NOW });
    expect(items.map((i) => i.concept).sort()).toEqual(['eigenvalues', 'matrices']);
    expect(items.every((i) => i.kind === 'due')).toBe(true);
  });

  it('respects an explicit cap and never includes bookkeeping concepts', () => {
    const withSession = merge(ledger(), graded('chapter_session', ['pass']));
    const route = planRoute({
      goal: 'Diagonalization',
      conceptStates: withSession.concept_states,
      seeds: SEEDS,
    });
    const items = composePracticeQueue({
      conceptStates: withSession.concept_states,
      route,
      now: NOW,
      cap: 3,
    });
    expect(items.length).toBeLessThanOrEqual(3);
    expect(items.some((i) => i.concept === 'chapter_session')).toBe(false);
  });

  it('nothing to practise → an empty queue (the button hides)', () => {
    expect(composePracticeQueue({ conceptStates: {}, now: NOW })).toEqual([]);
  });

  it('a card not yet due practices as forming, not due', () => {
    const fresh = graded('fresh_concept', ['pass']); // card due ~3 days out
    const items = composePracticeQueue({
      conceptStates: fresh.concept_states,
      route: planRoute({ goal: 'fresh concept', conceptStates: fresh.concept_states, seeds: [] }),
      now: T0 + 60_000, // one minute later — nothing due yet
    });
    expect(items).toEqual([{ concept: 'fresh_concept', kind: 'forming' }]);
  });
});

describe('buildPracticeQuestion', () => {
  it('carries the verdict contract, the queue, and the ledger tags', () => {
    const conceptStates = ledger().concept_states;
    const route = planRoute({ goal: 'Diagonalization', conceptStates, seeds: SEEDS });
    const items = composePracticeQueue({ conceptStates, route, now: NOW });
    const q = buildPracticeQuestion(items)!;
    expect(q).toContain('Practice round');
    expect(q).toContain(`${items.length} checks`);
    for (const it of items) expect(q).toContain(it.concept.replace(/_/g, ' '));
    expect(q).toContain('[PASS]');
    expect(q).toContain('[RETRY]');
    expect(q).toContain('[CAPTION:the one-line takeaway]');
    expect(q).toContain('[CONCEPT:<name>][QKIND:check-me]');
    // Its own mode: ask, don't tell; and the session.ts retry loop's rule.
    expect(q).toContain('practice, not reading');
    expect(q).toContain('never an instant advance, never an identical repeat');
    // Math checks defer to the desk's existing silent checker.
    expect(q).toContain('trust the checker');
  });

  it('null for an empty queue — a practice round with no checks is no round', () => {
    expect(buildPracticeQuestion([])).toBeNull();
  });
});
