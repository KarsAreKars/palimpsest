/**
 * Wave 4 Specificity Engine — the chapter misconception generation+verify
 * pipeline (audit Ruling 4 WAVE 4). The load-bearing guarantee is the
 * accuracy law, mechanized: the model may PROPOSE wrong readings, but only
 * candidates whose evidence quote appears VERBATIM on the page survive
 * into the store. A missing repair falls back to the hint ladder; a
 * fabricated one would teach a wrong book.
 */
import { describe, expect, it, vi } from 'vitest';

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
// The provider factory pulls the settings/supabase chain at import time;
// the pipeline's model seam is mocked away (pure-function discipline).
vi.mock('ai', () => ({ generateText: generateTextMock }));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => ({ id: 'fake-model' }) }),
}));

import type { AISettings } from '@/services/ai/types';
import {
  generateChapterMisconceptions,
  libraryKey,
  misconceptionsForConcept,
  storeChapterMisconceptions,
  verifyChapterMisconception,
  MAX_GENERATED_PER_CONCEPT,
  type ChapterMisconception,
  type MisconceptionLibrary,
} from '@/services/professor/misconceptions';

const PAGE_TEXT =
  'Researchers observed that ice cream sales and drowning deaths rise together every summer. ' +
  'The passage stresses that the two merely share a common cause — hot weather — and warns ' +
  'readers not to conclude that one produces the other. Correlation, it says, is not causation.';

const settings = { enabled: true } as AISettings;

const seeded = (over: Partial<ChapterMisconception> = {}): ChapterMisconception => ({
  id: 'correlation.treated_correlation_as_proof_of',
  concept: 'correlation',
  wrongReading: 'treated correlation as proof of causation',
  correction: 'the two merely share a common cause',
  evidenceQuote: 'warns readers not to conclude that one produces the other',
  sourceRef: { page: 42 },
  provenance: ['wave4-generated', 'book-verified'],
  confidencePrior: 0.5,
  ...over,
});

// --- verification: the accuracy law, mechanized ------------------------------

describe('verifyChapterMisconception — book-verified or dropped', () => {
  it('accepts a verbatim quote from the page', () => {
    expect(verifyChapterMisconception(seeded(), PAGE_TEXT)).toBe(true);
  });

  it('tolerates case, curly quotes, and whitespace drift', () => {
    const m = seeded({
      evidenceQuote: '  WARNS  readers not to conclude\nthat one produces the OTHER ',
    });
    expect(verifyChapterMisconception(m, PAGE_TEXT)).toBe(true);
  });

  it('rejects an invented quote — never stored, never spoken', () => {
    const m = seeded({ evidenceQuote: 'the authors prove ice cream causes drowning deaths' });
    expect(verifyChapterMisconception(m, PAGE_TEXT)).toBe(false);
  });

  it('rejects a quote too short to verify', () => {
    const m = seeded({ evidenceQuote: 'causation' }); // 9 chars < MIN_QUOTE_CHARS
    expect(verifyChapterMisconception(m, PAGE_TEXT)).toBe(false);
  });

  it('rejects empty clauses', () => {
    expect(verifyChapterMisconception(seeded({ wrongReading: ' ' }), PAGE_TEXT)).toBe(false);
    expect(verifyChapterMisconception(seeded({ correction: '' }), PAGE_TEXT)).toBe(false);
  });
});

// --- the store: keyed by concept + page --------------------------------------

describe('the library store — keyed by concept + page', () => {
  it('stores under concept:page and dedupes by id', () => {
    let lib: MisconceptionLibrary = {};
    lib = storeChapterMisconceptions(lib, [seeded()]);
    lib = storeChapterMisconceptions(lib, [seeded()]); // same id — no double
    expect(Object.keys(lib)).toEqual([libraryKey('correlation', 42)]);
    expect(lib[libraryKey('correlation', 42)]).toHaveLength(1);
  });

  it('is pure — the input library is untouched', () => {
    const lib: MisconceptionLibrary = {};
    storeChapterMisconceptions(lib, [seeded()]);
    expect(lib).toEqual({});
  });

  it('an empty batch is a no-op returning the same object', () => {
    const lib: MisconceptionLibrary = {};
    expect(storeChapterMisconceptions(lib, [])).toBe(lib);
  });

  it('lookup: all pages of a concept, or one page only', () => {
    let lib: MisconceptionLibrary = {};
    lib = storeChapterMisconceptions(lib, [
      seeded(),
      seeded({ id: 'correlation.other_reading', sourceRef: { page: 43 } }),
      seeded({ id: 'sampling.small_sample', concept: 'sampling' }),
    ]);
    expect(misconceptionsForConcept(lib, 'correlation')).toHaveLength(2);
    expect(misconceptionsForConcept(lib, 'correlation', 42)).toHaveLength(1);
    expect(misconceptionsForConcept(lib, 'correlation', 99)).toEqual([]);
    expect(misconceptionsForConcept(lib, 'unknown_concept')).toEqual([]);
  });
});

// --- the generation pipeline: propose → verify → store-ready -----------------

describe('generateChapterMisconceptions — the model proposes, the page decides', () => {
  // NB: no mockReset/mockClear in beforeEach — under vitest 4 a cleared
  // mock's later rejections are misreported as unhandled. Each test sets
  // its own behavior; isolation is by call-count snapshot.
  it('keeps the book-verified candidate and drops the invented one', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        misconceptions: [
          {
            wrong_reading: 'treated correlation as proof of causation',
            correction: 'the two merely share a common cause — hot weather',
            evidence_quote: 'warns readers not to conclude that one produces the other',
          },
          {
            wrong_reading: 'believed the study was a randomized trial',
            correction: 'it was an observational survey',
            evidence_quote: 'the randomized trial assigned each swimmer to an ice cream arm',
          },
        ],
      }),
    });
    const out = await generateChapterMisconceptions({
      concept: 'correlation',
      page: 42,
      pageText: PAGE_TEXT,
      aiSettings: settings,
    });
    expect(out).toHaveLength(1);
    const m = out[0]!;
    expect(m.id).toBe('correlation.treated_correlation_as_proof_of');
    expect(m.concept).toBe('correlation');
    expect(m.sourceRef.page).toBe(42);
    expect(m.provenance).toContain('book-verified');
    // And the survivor really is verifiable against the page.
    expect(verifyChapterMisconception(m, PAGE_TEXT)).toBe(true);
  });

  it('caps the library at MAX_GENERATED_PER_CONCEPT', async () => {
    const quote = 'warns readers not to conclude that one produces the other';
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        misconceptions: Array.from({ length: MAX_GENERATED_PER_CONCEPT + 2 }, (_, i) => ({
          wrong_reading: `misreading number ${i} of the passage`,
          correction: 'what the page says',
          evidence_quote: quote,
        })),
      }),
    });
    const out = await generateChapterMisconceptions({
      concept: 'correlation',
      page: 42,
      pageText: PAGE_TEXT,
      aiSettings: settings,
    });
    expect(out).toHaveLength(MAX_GENERATED_PER_CONCEPT);
  });

  it('malformed JSON → [] (never fabricated)', async () => {
    generateTextMock.mockResolvedValue({ text: 'I cannot help with that.' });
    const out = await generateChapterMisconceptions({
      concept: 'correlation',
      page: 42,
      pageText: PAGE_TEXT,
      aiSettings: settings,
    });
    expect(out).toEqual([]);
  });

  it('a provider failure → [] (never throws)', async () => {
    generateTextMock.mockRejectedValue(new Error('model exploded'));
    const out = await generateChapterMisconceptions({
      concept: 'correlation',
      page: 42,
      pageText: PAGE_TEXT,
      aiSettings: settings,
    });
    expect(out).toEqual([]);
  });

  it('AI disabled → [] without touching the model', async () => {
    const callsBefore = generateTextMock.mock.calls.length;
    const out = await generateChapterMisconceptions({
      concept: 'correlation',
      page: 42,
      pageText: PAGE_TEXT,
      aiSettings: { enabled: false } as AISettings,
    });
    expect(out).toEqual([]);
    expect(generateTextMock.mock.calls.length).toBe(callsBefore);
  });
});
