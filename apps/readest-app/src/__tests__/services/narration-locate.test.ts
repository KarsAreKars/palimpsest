import { describe, expect, it } from 'vitest';
import {
  findUnitAtOffset,
  locateWordInSpan,
  resolveClickToUnit,
  unitsForPage,
} from '@/services/narration/locate';
import type { NarrationUnit, HpubManifest } from '@/services/narration';

// Verified offsets: ring=22..26, Then=28..32, every=33..38, ideal=39..44,
// finitely=48..56, generated=57..66, QED=68..71, len=72.
const MD = 'Let A be a Noetherian ring. Then every ideal is finitely generated. QED.';

const units: NarrationUnit[] = [
  {
    unit: 0,
    md_start: 0,
    md_end: 27,
    page: 1,
    kind: 'prose',
    speak: 'Let A be a Noetherian ring.',
  },
  {
    unit: 1,
    md_start: 28,
    md_end: 67,
    page: 1,
    kind: 'prose',
    speak: 'Then every ideal is finitely generated.',
  },
  { unit: 2, md_start: 68, md_end: 72, page: 2, kind: 'prose', speak: 'QED.' },
];

const manifest: HpubManifest = {
  format: 'hpub/0.1',
  page_count: 2,
  alignment: [
    { page: 1, md_char_start: 0, md_char_end: 67 },
    { page: 2, md_char_start: 68, md_char_end: 72 },
  ],
};

describe('findUnitAtOffset', () => {
  it('finds the containing unit', () => {
    expect(findUnitAtOffset(units, 0)!.unit).toBe(0);
    expect(findUnitAtOffset(units, 40)!.unit).toBe(1);
    expect(findUnitAtOffset(units, 70)!.unit).toBe(2);
  });

  it('resolves gaps to the next unit', () => {
    // offset 27 sits between unit 0 (ends 27) and unit 1 (starts 28)
    expect(findUnitAtOffset(units, 27)!.unit).toBe(1);
  });
});

describe('locateWordInSpan', () => {
  it('finds exact words', () => {
    expect(locateWordInSpan(MD, 0, 67, 'ideal')).toBe(39);
  });

  it('matches case- and punctuation-insensitively', () => {
    expect(locateWordInSpan(MD, 0, 67, 'Ring')).toBe(22);
    expect(locateWordInSpan(MD, 0, 67, 'generated')).toBe(57);
  });

  it('falls back to prefix and fuzzy matches', () => {
    expect(locateWordInSpan(MD, 0, 67, 'finitely')).toBe(48);
    expect(locateWordInSpan(MD, 0, 67, 'evry')).toBe(33); // one deletion from "every"
  });

  it('returns null for nonsense', () => {
    expect(locateWordInSpan(MD, 0, 67, 'zebra')).toBeNull();
  });
});

describe('resolveClickToUnit (plan §5 steps 2-4)', () => {
  it('maps a clicked word on a page to the right narration unit', () => {
    const hit = resolveClickToUnit(MD, manifest, units, 1, 'finitely');
    expect(hit!.unit.unit).toBe(1);
    expect(hit!.mdOffset).toBe(48);
  });

  it('scopes matches to the clicked page', () => {
    // "QED" only exists on page 2
    const hit = resolveClickToUnit(MD, manifest, units, 2, 'QED');
    expect(hit!.unit.unit).toBe(2);
  });

  it('returns null for pages without a span', () => {
    const sparse: HpubManifest = {
      format: 'hpub/0.1',
      page_count: 3,
      alignment: [...manifest.alignment, { page: 3, md_char_start: null, md_char_end: null }],
    };
    expect(resolveClickToUnit(MD, sparse, units, 3, 'QED')).toBeNull();
  });
});

describe('unitsForPage', () => {
  it('collects units per page in order', () => {
    expect(unitsForPage(units, 1).map((u) => u.unit)).toEqual([0, 1]);
    expect(unitsForPage(units, 2).map((u) => u.unit)).toEqual([2]);
    expect(unitsForPage(units, 99)).toEqual([]);
  });
});
