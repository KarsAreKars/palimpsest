/**
 * Wave 'Learn Mode' contract tests — the minimal KNOWLEDGE GRAPH
 * (conceptGraph.ts), per audit Ruling 5 #3: nodes + 1-bit mastery +
 * timestamps + a source back-reference to the book/page. NO proposition
 * graph, no graph DB.
 *
 * Load-bearing guarantees:
 *  1. Two books carrying the same [CONCEPT:name] LINK: one node, a
 *     source from each book.
 *  2. The 1-bit follows the FRESHEST graded review, never an ask.
 *  3. The graph lives on the learner profile (additive) and survives the
 *     profile's tolerant normalize round-trip.
 */
import { describe, it, expect } from 'vitest';
import {
  syncBookIntoGraph,
  syncProfileGraph,
  toneOf,
  GRAPH_SOURCES_MAX,
} from '@/services/professor/conceptGraph';
import {
  applyExchange,
  emptyLearner,
  type LearnerExchange,
  type LearnerState,
} from '@/services/professor/learner';
import { normalizeProfile, type LearnerProfile } from '@/services/professor/learnerProfile';

const T0 = Date.parse('2026-11-19T09:00:00.000Z');

const check = (
  concept: string,
  verdict: 'pass' | 'retry',
  i: number,
  over: Partial<LearnerExchange> = {},
): LearnerExchange => ({
  ts: new Date(T0 + i * 3_600_000).toISOString(),
  concept,
  page: 20 + i,
  question_kind: 'check-me',
  question: `${concept} check ${i}`,
  resolved: true,
  verdict,
  ...over,
});

const graded = (concept: string, verdicts: Array<'pass' | 'retry'>): LearnerState =>
  verdicts.reduce((s, v, i) => applyExchange(s, check(concept, v, i)), emptyLearner());

// --- the cross-book link ------------------------------------------------------

describe('syncBookIntoGraph', () => {
  it('links two books’ shared concept into ONE node with two sources', () => {
    // Book A: eigenvalues proven (4/4) on page 23.
    const bookA = graded('eigenvalues', ['pass', 'pass', 'pass', 'pass']);
    // Book B: same concept, engaged but shaky (1/3), later, on page 7 —
    // plus a concept only B carries.
    let bookB = graded('eigenvalues', ['pass', 'retry', 'retry']);
    bookB = {
      ...bookB,
      exchanges: [
        ...bookB.exchanges,
        ...graded('gaussian_elimination', ['pass', 'retry']).exchanges,
      ],
      concept_states: {
        ...bookB.concept_states,
        ...graded('gaussian_elimination', ['pass', 'retry']).concept_states,
      },
    };

    let graph = syncBookIntoGraph({}, 'bookA', bookA);
    graph = syncBookIntoGraph(graph, 'bookB', bookB);

    // The shared concept is ONE node, linked across books.
    const node = graph['eigenvalues']!;
    expect(node).toBeDefined();
    expect(node.sources).toEqual([
      { book: 'bookA', page: 23 },
      { book: 'bookB', page: 22 },
    ]);
    // Book-only concept links only to its own book.
    expect(graph['gaussian_elimination']!.sources).toEqual([{ book: 'bookB', page: 21 }]);
  });

  it('the FRESHEST graded review wins the 1-bit — never the older, never an ask', () => {
    const bookA = graded('eigenvalues', ['pass', 'pass', 'pass', 'pass']); // known, earlier

    // The same concept a fortnight LATER, engaged but shaky (1/3) —
    // bookB's window is the fresher evidence and must win the bit.
    const late = (verdicts: Array<'pass' | 'retry'>): LearnerState =>
      verdicts.reduce(
        (s, v, i) =>
          applyExchange(s, {
            ...check('eigenvalues', v, i),
            ts: new Date(T0 + (14 * 24 + i) * 3_600_000).toISOString(),
          }),
        emptyLearner(),
      );
    const bookB = late(['pass', 'retry', 'retry']);
    expect(bookB.concept_states['eigenvalues']!.card!.last_review_ts).toBeGreaterThan(
      bookA.concept_states['eigenvalues']!.card!.last_review_ts,
    );

    let graph = syncBookIntoGraph({}, 'bookA', bookA);
    expect(graph['eigenvalues']!.known).toBe(true);
    expect(toneOf(graph['eigenvalues']!)).toBe('known');

    graph = syncBookIntoGraph(graph, 'bookB', bookB);
    expect(graph['eigenvalues']!.known).toBe(false); // fresher window says not yet
    expect(toneOf(graph['eigenvalues']!)).toBe('edge'); // reviewed, unproven
  });

  it('asks write nothing: no card, no review stamp, muted tone', () => {
    const s = applyExchange(emptyLearner(), {
      ...check('spectral_radius', 'pass', 0),
      question_kind: 'why', // an ask, even with a stray verdict, is not a check
      verdict: undefined,
    });
    const graph = syncBookIntoGraph({}, 'bookA', s);
    const node = graph['spectral_radius']!;
    expect(node.known).toBe(false);
    expect(node.last_review_ts).toBeUndefined();
    expect(toneOf(node)).toBe('unknown');
  });

  it('last_review_ts is the card’s stamp; tones fall out of bit + timestamps', () => {
    const s = graded('eigenvalues', ['pass', 'pass', 'pass', 'pass']);
    const graph = syncBookIntoGraph({}, 'bookA', s);
    const ts = graph['eigenvalues']!.last_review_ts;
    expect(ts).toBe(s.concept_states['eigenvalues']!.card!.last_review_ts);
    expect(toneOf(graph['eigenvalues']!)).toBe('known');
  });

  it('source lists dedupe by book:page and cap', () => {
    const s = graded('eigenvalues', ['pass', 'pass', 'pass', 'pass']);
    let graph = syncBookIntoGraph({}, 'bookA', s);
    graph = syncBookIntoGraph(graph, 'bookA', s); // same book, same page — no dup
    expect(graph['eigenvalues']!.sources).toHaveLength(1);
    for (let i = 0; i < GRAPH_SOURCES_MAX + 4; i += 1) {
      graph = syncBookIntoGraph(graph, `book${i}`, s);
    }
    expect(graph['eigenvalues']!.sources.length).toBeLessThanOrEqual(GRAPH_SOURCES_MAX);
  });

  it('bookkeeping concepts never become graph nodes', () => {
    const s = applyExchange(emptyLearner(), { ...check('chapter_session', 'pass', 0) });
    const graph = syncBookIntoGraph({}, 'bookA', s);
    expect(graph['chapter_session']).toBeUndefined();
  });
});

// --- the profile is the store (additive) --------------------------------------

describe('the graph on the learner profile', () => {
  it('syncProfileGraph folds a book in and returns the same object when nothing moved', () => {
    const profile: LearnerProfile = {};
    const bookA = graded('eigenvalues', ['pass', 'pass', 'pass', 'pass']);
    const once = syncProfileGraph(profile, 'bookA', bookA);
    expect(once).not.toBe(profile); // moved → new object
    expect(once.concept_graph?.['eigenvalues']?.sources).toEqual([{ book: 'bookA', page: 23 }]);
    const twice = syncProfileGraph(once, 'bookA', bookA);
    expect(twice).toBe(once); // unchanged → same reference, caller skips the save
  });

  it('survives the profile’s tolerant normalize round-trip', () => {
    const bookA = graded('eigenvalues', ['pass', 'pass', 'pass', 'pass']);
    const profile = syncProfileGraph({ study_goal: 'Diagonalization' }, 'bookA', bookA);
    const roundTripped = normalizeProfile(JSON.parse(JSON.stringify(profile)));
    expect(roundTripped.study_goal).toBe('Diagonalization');
    expect(roundTripped.concept_graph?.['eigenvalues']).toMatchObject({
      known: true,
      sources: [{ book: 'bookA', page: 23 }],
    });
    // Junk fields degrade, never throw.
    const junk = normalizeProfile({
      concept_graph: { good: { known: true, sources: [{ book: 'b' }] }, bad: 'nope' },
    });
    expect(junk.concept_graph).toEqual({
      good: { name: 'good', known: true, sources: [{ book: 'b' }] },
    });
  });
});
