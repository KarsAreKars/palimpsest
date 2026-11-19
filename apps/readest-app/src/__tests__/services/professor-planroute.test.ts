/**
 * Wave 'Learn Mode' contract tests — the PLAN (planRoute.ts) and the
 * latent MEASURE (senseEdge), Palimpsest-style per audit Ruling 5:
 *   #6 measurement is latent — the edge is sensed from the EXISTING
 *      graded ledger, never an upfront quiz; a silent log starts the
 *      route conservatively.
 *   #3 minimal KG — the route reuses [CONCEPT:name] ledger keys + cheap
 *      TOC seeds (King R6), emitted via the EXISTING catalogue tag.
 *
 * Load-bearing guarantees:
 *  1. A seeded ledger produces an ordered route: known first, edge next,
 *     unknown after, the goal LAST — whether the goal is a known
 *     candidate or a brand-new destination.
 *  2. A mastery flip re-routes: the plan adapts because planRoute is
 *     pure and re-called with the fresh ledger.
 *  3. The emission is the existing [CONCEPTS …; goal:…] tag — parsed
 *     back by the existing desk parser, no new machinery.
 */
import { describe, it, expect } from 'vitest';
import {
  planRoute,
  probeCandidates,
  routeTagLine,
  senseEdge,
  ROUTE_MAX_NODES,
  type RouteSeed,
} from '@/services/professor/planRoute';
import {
  applyExchange,
  emptyLearner,
  masteryOf,
  type LearnerExchange,
  type LearnerState,
} from '@/services/professor/learner';
import { parseProfessorTags } from '@/services/professor/professorTags';

const T0 = Date.parse('2026-11-19T09:00:00.000Z');

const check = (concept: string, verdict: 'pass' | 'retry', i: number): LearnerExchange => ({
  ts: new Date(T0 + i * 60_000).toISOString(),
  concept,
  page: 10 + i,
  question_kind: 'check-me',
  question: `${concept} check ${i}`,
  resolved: true,
  verdict,
});

/** Grade a concept n times with the given verdicts (newest last). */
const graded = (concept: string, verdicts: Array<'pass' | 'retry'>): LearnerState =>
  verdicts.reduce(
    (s, v, i) => applyExchange(s, check(concept, v, i)),
    emptyLearner() as LearnerState,
  );

const SEEDS: RouteSeed[] = [
  { name: 'Linear Maps', page: 1 },
  { name: 'Matrices', page: 12 },
  { name: 'Determinants', page: 30 },
  { name: 'Eigenvalues', page: 44 },
  { name: 'Diagonalization', page: 51 },
];

// A ledger with one KNOWN concept (window ≥ 0.8 passes) and one EDGE
// concept (mixed), merged with the seeds above.
const seededLedger = (): LearnerState => {
  let s = graded('matrices', ['pass', 'pass', 'pass', 'pass']);
  s = {
    ...s,
    concept_states: {
      ...s.concept_states,
      ...graded('eigenvalues', ['pass', 'retry', 'pass', 'retry']).concept_states,
    },
  };
  return s;
};

// --- the latent measure (Ruling 5 #6) ---------------------------------------

describe('senseEdge — the measure is latent', () => {
  it('partitions by the graded window only: asks are unknown, never credit', () => {
    const s = applyExchange(emptyLearner(), {
      ...check('soft_concepts', 'pass', 0),
      question_kind: 'why', // an ask, not a check — the verdict must not count
      verdict: undefined,
    });
    const sense = senseEdge(s.concept_states);
    expect(sense.known).toEqual([]);
    expect(sense.edge).toEqual([]);
    expect(sense.unknown).toEqual(['soft_concepts']);
    expect(masteryOf(s.concept_states['soft_concepts']!)).toBe('unknown');
  });

  it('a never-graded ledger reports everything unknown — and that is fine', () => {
    const sense = senseEdge({});
    expect(sense).toEqual({ known: [], edge: [], unknown: [] });
  });
});

// --- PLAN: ordering ----------------------------------------------------------

describe('planRoute', () => {
  it('orders the route known … edge … unknown … goal, goal LAST', () => {
    const route = planRoute({
      goal: 'Diagonalization',
      conceptStates: seededLedger().concept_states,
      seeds: SEEDS,
      book: 'bookA',
    });
    expect(route.nodes[route.nodes.length - 1]).toMatchObject({
      name: 'diagonalization',
      role: 'goal',
    });
    expect(route.nodes.map((n) => n.name)).toEqual([
      'matrices', // known (seed order among known)
      'eigenvalues', // edge
      'linear_maps', // unknown, seed order
      'determinants', // unknown, seed order
      'diagonalization', // goal
    ]);
    expect(route.nodes.map((n) => n.role)).toEqual(['known', 'edge', 'unknown', 'unknown', 'goal']);
  });

  it('carries a sourceRef (book/page) from seeds and the log', () => {
    const ledger = seededLedger();
    const route = planRoute({
      goal: 'Diagonalization',
      conceptStates: ledger.concept_states,
      seeds: SEEDS,
      book: 'bookA',
      pages: { matrices: 14 },
    });
    const matrices = route.nodes.find((n) => n.name === 'matrices')!;
    expect(matrices.sourceRef).toEqual({ book: 'bookA', page: 14 }); // the log outranks the seed
    const determinants = route.nodes.find((n) => n.name === 'determinants')!;
    expect(determinants.sourceRef).toEqual({ book: 'bookA', page: 30 }); // from the seed
  });

  it('appends a goal the book and the log have never seen, still last', () => {
    const route = planRoute({
      goal: 'Spectral Theorem',
      conceptStates: seededLedger().concept_states,
      seeds: SEEDS,
    });
    const last = route.nodes[route.nodes.length - 1]!;
    expect(last).toMatchObject({ name: 'spectral_theorem', role: 'goal', mastery: 'unknown' });
    expect(route.nodes.filter((n) => n.role === 'goal')).toHaveLength(1);
  });

  it('starts conservatively when the log is silent: seeds in the book’s own order', () => {
    const route = planRoute({ goal: 'Diagonalization', conceptStates: {}, seeds: SEEDS });
    expect(route.nodes.map((n) => n.name)).toEqual([
      'linear_maps',
      'matrices',
      'determinants',
      'eigenvalues',
      'diagonalization',
    ]);
    expect(route.nodes.slice(0, -1).every((n) => n.mastery === 'unknown')).toBe(true);
  });

  it('ADAPTS: a mastery flip re-routes the node into the known spine', () => {
    const before = planRoute({
      goal: 'Diagonalization',
      conceptStates: seededLedger().concept_states,
      seeds: SEEDS,
    });
    expect(before.nodes.find((n) => n.name === 'eigenvalues')!.role).toBe('edge');

    // The learner's next checks flip eigenvalues to known (window ≥ 0.8)
    // — re-plan.
    const flipped = graded('eigenvalues', ['pass', 'pass', 'pass', 'pass']);
    const after = planRoute({
      goal: 'Diagonalization',
      conceptStates: flipped.concept_states,
      seeds: SEEDS,
    });
    const ev = after.nodes.find((n) => n.name === 'eigenvalues')!;
    expect(ev).toMatchObject({ role: 'known', mastery: 'known' });
    // Known spine leads the route: eigenvalues now walks ahead of every
    // edge/unknown node.
    expect(after.nodes.indexOf(ev)).toBeLessThan(
      after.nodes.findIndex((n) => n.role === 'edge' || n.role === 'unknown'),
    );
  });

  it('caps over-long routes without ever dropping the goal', () => {
    const many: RouteSeed[] = Array.from({ length: 30 }, (_, i) => ({
      name: `Concept Number ${i + 1}`,
      page: i + 1,
    }));
    const route = planRoute({ goal: 'Concept Number 30', conceptStates: {}, seeds: many });
    expect(route.nodes.length).toBeLessThanOrEqual(ROUTE_MAX_NODES);
    expect(route.nodes[route.nodes.length - 1]!.role).toBe('goal');
  });

  it('never routes the bookkeeping concepts', () => {
    const ledger = applyExchange(emptyLearner(), {
      ...check('chapter_session', 'pass', 0),
      concept: 'chapter_session',
    });
    const route = planRoute({
      goal: 'Diagonalization',
      conceptStates: ledger.concept_states,
      seeds: [],
    });
    expect(route.nodes.some((n) => n.name === 'chapter_session')).toBe(false);
  });
});

// --- emission: the EXISTING catalogue tag ------------------------------------

describe('routeTagLine + probes', () => {
  it('emits the route as the existing [CONCEPTS …; goal:…] tag', () => {
    const route = planRoute({
      goal: 'Diagonalization',
      conceptStates: seededLedger().concept_states,
      seeds: SEEDS,
    });
    const line = routeTagLine(route);
    expect(line.startsWith('[CONCEPTS ')).toBe(true);
    expect(line).toContain('known:matrices');
    expect(line).toContain('edge:eigenvalues');
    expect(line).toContain('unknown:linear maps, determinants');
    expect(line.endsWith('; goal:Diagonalization]')).toBe(true);
  });

  it('round-trips through the EXISTING desk parser — no new tag machinery', () => {
    const route = planRoute({
      goal: 'Diagonalization',
      conceptStates: seededLedger().concept_states,
      seeds: SEEDS,
    });
    const parsed = parseProfessorTags(`The road, as filed.\n${routeTagLine(route)}`);
    expect(parsed.conceptMap).toMatchObject({
      known: ['matrices'],
      edge: ['eigenvalues'],
      goal: 'Diagonalization',
    });
    // The route's destination is NOT duplicated onto a shelf.
    expect(parsed.conceptMap!.unknown).not.toContain('Diagonalization');
  });

  it('a plain catalogue (no goal) still parses with no goal — no regression', () => {
    const parsed = parseProfessorTags('[CONCEPTS known:a; edge:b; unknown:c]');
    expect(parsed.conceptMap).toEqual({ known: ['a'], edge: ['b'], unknown: ['c'] });
  });

  it('probeCandidates offers the edge first — a couple, never a gate', () => {
    const route = planRoute({
      goal: 'Diagonalization',
      conceptStates: seededLedger().concept_states,
      seeds: SEEDS,
    });
    expect(probeCandidates(route)).toEqual(['eigenvalues']);
    expect(probeCandidates(route, 5)).toEqual(['eigenvalues']);

    // No edge yet → the probes fall to the nearest unknowns (conservative).
    const fresh = planRoute({ goal: 'Diagonalization', conceptStates: {}, seeds: SEEDS });
    expect(probeCandidates(fresh)).toEqual(['linear maps', 'matrices']);
  });
});
