/**
 * Wave 4 — deterministic failed-check diagnosis (audit Ruling 4 WAVE 4;
 * LEARNING_SCIENCE §11 misconception-tailored feedback). A seeded wrong
 * answer on a seeded (book-verified) misconception yields the NAMED repair
 * citing the page ("You treated X as Y, but on page N…"); a non-matching
 * wrong answer yields null and the generic hint ladder stands.
 */
import { describe, expect, it, vi } from 'vitest';

// diagnose.ts pulls the provider chain at import time; these are pure
// functions, so the factory is mocked away (same discipline as session).
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => ({ id: 'fake-model' }) }),
}));

import {
  diagnoseFailedCheck,
  matchMisconception,
  misconceptionSimilarity,
  renderNamedRepair,
  MISCONCEPTION_MATCH_THRESHOLD,
} from '@/services/professor/diagnose';
import {
  misconceptionsForConcept,
  storeChapterMisconceptions,
  type ChapterMisconception,
  type MisconceptionLibrary,
} from '@/services/professor/misconceptions';

const LIBRARY: MisconceptionLibrary = storeChapterMisconceptions({}, [
  {
    id: 'correlation.treated_correlation_as_proof_of',
    concept: 'correlation',
    wrongReading: 'treated correlation as proof of causation',
    correction:
      'the passage says the two share a common cause and never claims one produces the other',
    evidenceQuote: 'Correlation, it says, is not causation.',
    sourceRef: { page: 42 },
    provenance: ['wave4-generated', 'book-verified'],
    confidencePrior: 0.5,
  },
  {
    id: 'correlation.thought_sample_size_settles',
    concept: 'correlation',
    wrongReading: 'thought a large sample size settles the causal question',
    correction: 'no amount of data turns an observed association into a cause',
    evidenceQuote: 'warns readers not to conclude that one produces the other',
    sourceRef: { page: 43 },
    provenance: ['wave4-generated', 'book-verified'],
    confidencePrior: 0.5,
  },
]);

// The seeded wrong answer: the classic correlation→causation reading.
const WRONG_ANSWER =
  'Ice cream sales rise with drowning deaths, so the sales must drive the drownings — ' +
  'correlation is proof of causation here.';

// A genuinely different wrong answer (about sampling), which matches NOTHING.
const NON_MATCHING_ANSWER =
  'The researcher surveyed only two neighborhoods over two weekends, so I think the ' +
  'sampling method itself was the weak point of this study.';

describe('similarity — the wrong answer against one wrong reading', () => {
  it('scores the seeded wrong answer well above the floor', () => {
    expect(
      misconceptionSimilarity(WRONG_ANSWER, LIBRARY['correlation:42']![0]!.wrongReading),
    ).toBeGreaterThan(MISCONCEPTION_MATCH_THRESHOLD);
  });

  it('one shared word is a coincidence, not a diagnosis', () => {
    expect(
      misconceptionSimilarity(
        'so what about causation though',
        'treated correlation as proof of causation',
      ),
    ).toBe(0);
  });

  it('a 2-token signature needs BOTH words — one shared word never matches (bug-hunt #6)', () => {
    expect(
      misconceptionSimilarity(
        'I swapped the order of integration and Fubini says that is fine',
        'swapped bounds',
      ),
    ).toBe(0);
    expect(misconceptionSimilarity('I swapped the bounds here', 'swapped bounds')).toBe(1);
  });

  it('an unrelated answer scores zero', () => {
    for (const m of misconceptionsForConcept(LIBRARY, 'correlation')) {
      expect(misconceptionSimilarity(NON_MATCHING_ANSWER, m.wrongReading)).toBe(0);
    }
  });
});

describe('matchMisconception — the closest stored wrong reading', () => {
  it('picks the correlation-as-causation reading, not the sampling one', () => {
    const m = matchMisconception(WRONG_ANSWER, misconceptionsForConcept(LIBRARY, 'correlation'));
    expect(m?.id).toBe('correlation.treated_correlation_as_proof_of');
  });

  it('no match → null (the ladder fallback)', () => {
    expect(
      matchMisconception(NON_MATCHING_ANSWER, misconceptionsForConcept(LIBRARY, 'correlation')),
    ).toBeNull();
  });

  it('prefers the higher prior on a tie', () => {
    const a: ChapterMisconception = {
      ...LIBRARY['correlation:42']![0]!,
      wrongReading: 'treated correlation as proof of causation',
      confidencePrior: 0.3,
    };
    const b: ChapterMisconception = {
      ...LIBRARY['correlation:42']![0]!,
      id: 'correlation.variant',
      wrongReading: 'read correlation as proof of causation',
      confidencePrior: 0.9,
    };
    expect(misconceptionSimilarity(WRONG_ANSWER, a.wrongReading)).toBe(
      misconceptionSimilarity(WRONG_ANSWER, b.wrongReading),
    );
    expect(matchMisconception(WRONG_ANSWER, [a, b])?.id).toBe('correlation.variant');
  });
});

describe('renderNamedRepair — names the wrong reading, cites the page', () => {
  it('produces the Oppia-style line from the seeded entry', () => {
    const m = LIBRARY['correlation:42']![0]!;
    const text = renderNamedRepair(m);
    expect(text).toContain('You treated correlation as proof of causation');
    expect(text).toContain('page 42');
    expect(text).toContain('"Correlation, it says, is not causation."');
  });
});

describe('diagnoseFailedCheck — the campaign gate', () => {
  it('a seeded wrong answer yields the NAMED repair citing the page', () => {
    const repair = diagnoseFailedCheck({
      answerText: WRONG_ANSWER,
      concept: 'correlation',
      library: LIBRARY,
    });
    expect(repair).not.toBeNull();
    expect(repair!.misconception.sourceRef.page).toBe(42);
    expect(repair!.text).toMatch(/You treated correlation as proof of causation.*page 42/s);
    expect(repair!.score).toBeGreaterThanOrEqual(MISCONCEPTION_MATCH_THRESHOLD);
  });

  it('a non-matching wrong answer → null: the hint ladder stands', () => {
    expect(
      diagnoseFailedCheck({
        answerText: NON_MATCHING_ANSWER,
        concept: 'correlation',
        library: LIBRARY,
      }),
    ).toBeNull();
  });

  it('a concept with no library → null (nothing to name yet)', () => {
    expect(
      diagnoseFailedCheck({
        answerText: WRONG_ANSWER,
        concept: 'never_generated',
        library: LIBRARY,
      }),
    ).toBeNull();
  });

  it('page-restricted lookup sees only that page\u2019s readings', () => {
    expect(
      diagnoseFailedCheck({
        answerText: WRONG_ANSWER,
        concept: 'correlation',
        page: 43,
        library: LIBRARY,
      }),
    ).toBeNull(); // page 43's reading is about sample size, not this answer
  });
});
