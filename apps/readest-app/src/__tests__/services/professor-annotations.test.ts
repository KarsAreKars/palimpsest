/**
 * Professor annotation DSL — contract tests (HP-2).
 *
 * The two hard contracts:
 *  1. Tags never reach the spoken/displayed text (stripAnnotations is the
 *     ONLY text the speech path and the overlay bubble may see).
 *  2. Hallucinated block IDs are dropped silently — the answer renders
 *     minus that mark, never a crash, never a wrong-page scribble.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  parseAnnotations,
  stripAnnotations,
  validateAnnotations,
} from '@/services/professor/annotations';
import type { HpubBlock } from '@/services/narration';

const BLOCKS: HpubBlock[] = [
  { id: '/page/29/Text/3', type: 'Text', bbox: [50, 100, 540, 130] },
  { id: '/page/29/Equation/4', type: 'Equation', bbox: [100, 200, 400, 260] },
  { id: '/page/29/Text/5', type: 'Text', bbox: [50, 300, 540, 330] },
];

describe('parseAnnotations', () => {
  it('parses every tag kind', () => {
    const answer = [
      'Look at the second equation — that is where the ring structure enters.',
      '[POINT:block:/page/29/Equation/4]',
      '[HIGHLIGHT:block:/page/29/Text/3]',
      '[BOX:block:/page/29/Text/5]',
      '[ARROW:block:/page/29/Text/3->block:/page/29/Equation/4]',
      '[WRITE:block:/page/29/Equation/4 | \\mathfrak{p} \\text{ prime} \\implies \\mathfrak{p} \\text{ radical}]',
      '[CAPTION:prime ideals are the atoms here]',
      '[PAGE:31]',
    ].join('\n');
    const out = parseAnnotations(answer);
    expect(out).toEqual([
      { kind: 'point', blockId: '/page/29/Equation/4' },
      { kind: 'highlight', blockId: '/page/29/Text/3' },
      { kind: 'box', blockId: '/page/29/Text/5' },
      { kind: 'arrow', fromBlockId: '/page/29/Text/3', toBlockId: '/page/29/Equation/4' },
      {
        kind: 'write',
        anchorBlockId: '/page/29/Equation/4',
        latex: '\\mathfrak{p} \\text{ prime} \\implies \\mathfrak{p} \\text{ radical}',
      },
      { kind: 'caption', text: 'prime ideals are the atoms here' },
      { kind: 'page', page: 31 },
    ]);
  });

  it('accepts unicode arrow separators', () => {
    expect(parseAnnotations('[ARROW:block:A→block:B]')).toEqual([
      { kind: 'arrow', fromBlockId: 'A', toBlockId: 'B' },
    ]);
  });

  it('ignores malformed tags instead of throwing', () => {
    expect(parseAnnotations('[HIGHLIGHT:wrong:/page/29/Text/3]')).toEqual([]);
    expect(parseAnnotations('[ARROW:block:OnlyOne]')).toEqual([]);
    expect(parseAnnotations('[WRITE:block:/page/29/Text/3]')).toEqual([]); // no |
    expect(parseAnnotations('[PAGE:notanumber]')).toEqual([]);
    expect(parseAnnotations('[UNKNOWN:x]')).toEqual([]);
  });

  it('returns nothing for plain prose', () => {
    expect(parseAnnotations('No annotations here, just a good explanation.')).toEqual([]);
  });
});

describe('stripAnnotations — the speech contract', () => {
  it('removes all tags so none can reach TTS or the bubble', () => {
    const answer =
      'See the second equation. [HIGHLIGHT:block:/page/29/Equation/4] That is the key step.\n[CAPTION:atoms]\n[PAGE:31]';
    const clean = stripAnnotations(answer);
    expect(clean).toBe('See the second equation. That is the key step.');
    expect(clean).not.toMatch(/\[(POINT|HIGHLIGHT|BOX|ARROW|WRITE|CAPTION|PAGE)/);
  });

  it('leaves ordinary square brackets alone', () => {
    expect(stripAnnotations('the interval [0, 1] is compact')).toBe(
      'the interval [0, 1] is compact',
    );
  });

  it('collapses the whitespace a stripped tag leaves behind', () => {
    expect(stripAnnotations('word  [POINT:block:x]  word')).toBe('word word');
  });
});

describe('validateAnnotations — hallucination containment', () => {
  it('drops unknown block IDs with a warning, keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = validateAnnotations(
      [
        { kind: 'highlight', blockId: '/page/29/Text/3' },
        { kind: 'point', blockId: '/page/99/Ghost/0' }, // hallucinated
        { kind: 'arrow', fromBlockId: '/page/29/Text/3', toBlockId: '/page/99/Ghost/0' },
        { kind: 'write', anchorBlockId: '/page/29/Equation/4', latex: 'x^2' },
        { kind: 'caption', text: 'always passes' },
        { kind: 'page', page: 5 },
      ],
      BLOCKS,
    );
    expect(out).toEqual([
      { kind: 'highlight', blockId: '/page/29/Text/3' },
      { kind: 'write', anchorBlockId: '/page/29/Equation/4', latex: 'x^2' },
      { kind: 'caption', text: 'always passes' },
      { kind: 'page', page: 5 },
    ]);
    expect(warn).toHaveBeenCalledTimes(2); // the ghost point + the half-ghost arrow
    warn.mockRestore();
  });

  it('keeps everything when the model plays by the rules', () => {
    const out = validateAnnotations(
      [
        { kind: 'box', blockId: '/page/29/Text/5' },
        { kind: 'arrow', fromBlockId: '/page/29/Text/3', toBlockId: '/page/29/Equation/4' },
      ],
      BLOCKS,
    );
    expect(out).toHaveLength(2);
  });
});
