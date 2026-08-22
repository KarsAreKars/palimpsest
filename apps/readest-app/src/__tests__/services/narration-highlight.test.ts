import { describe, expect, it } from 'vitest';
import { findSpanRange } from '@/services/narration/highlight';

// Simulated PDF.js text-layer spans for a page fragment.
const SPANS = [
  'Let A be a ',
  'Noetherian ring',
  ' and M a finite ',
  'module. Then ',
  'every ideal is ',
  'finitely generated.',
];

describe('findSpanRange', () => {
  it('locates a sentence spanning multiple text-layer spans', () => {
    const range = findSpanRange(SPANS, 'Let A be a Noetherian ring and M a finite module.');
    expect(range).toEqual({ start: 0, end: 3 });
  });

  it('matches across span boundaries', () => {
    const range = findSpanRange(SPANS, 'every ideal is finitely generated');
    expect(range).toEqual({ start: 4, end: 5 });
  });

  it('falls back to prefix matching when the unit text has trailing markup', () => {
    // Unit text includes LaTeX math that has no glyph match in the text layer.
    const range = findSpanRange(SPANS, 'Let A be a Noetherian ring and $x_i^2$ holds.');
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(range!.end).toBeGreaterThanOrEqual(1);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(findSpanRange(SPANS, 'NOETHERIAN RING')).toEqual({ start: 1, end: 1 });
  });

  it('returns null for absent or too-short targets', () => {
    expect(findSpanRange(SPANS, 'the quick brown zebra jumps over')).toBeNull();
    expect(findSpanRange(SPANS, 'ab')).toBeNull();
    expect(findSpanRange([], 'anything at all')).toBeNull();
  });
});
