import { describe, expect, it } from 'vitest';
import {
  applyDirectorsPass,
  parseDirectorResponse,
  polishBatch,
} from '@/services/narration/director';
import type { NarrationUnit } from '@/services/narration';

const unit = (n: number, kind: string, speak?: string): NarrationUnit =>
  ({ unit: n, kind, md_start: 0, md_end: 1, page: 1, speak }) as NarrationUnit;

describe('director pass', () => {
  it('parses fenced and bare JSON arrays', () => {
    expect(parseDirectorResponse('["a","b"]')).toEqual(['a', 'b']);
    expect(parseDirectorResponse('```json\n["a"]\n```')).toEqual(['a']);
    expect(parseDirectorResponse('not json')).toBeNull();
    expect(parseDirectorResponse('{"a":1}')).toBeNull();
  });

  it('polishes prose/heading units and never touches math or skip units', async () => {
    const units = [
      unit(0, 'heading', 'Chapter 0. Background'),
      unit(1, 'prose', 'We begin with rings. They are commutative.'),
      unit(2, 'inline_math', 'the sum $x^2$ converges'),
      unit(3, 'display_eq', 'the fraction with numerator a'),
      unit(4, 'skip', undefined),
      unit(5, 'prose', 'Tiny.'), // too short to be a target (<12 chars trimmed? "Tiny." is 5)
    ];
    const seen: string[] = [];
    const out = await applyDirectorsPass(units, async (prompt) => {
      seen.push(prompt);
      // echo back with an em-dash flourish
      return [...prompt.matchAll(/^\[\d+\] (.*)$/gm)].map((m) => m[1] + ' — indeed.');
    });
    expect(out[0]!.speak).toBe('Chapter 0. Background — indeed.');
    expect(out[1]!.speak).toBe('We begin with rings. They are commutative. — indeed.');
    expect(out[2]).toBe(units[2]); // identity: math untouched
    expect(out[3]).toBe(units[3]);
    expect(out[4]).toBe(units[4]);
    expect(out[5]).toBe(units[5]);
    expect(seen.length).toBe(1); // one batch for two targets
  });

  it('falls back per-line when the model misaligns or pads', async () => {
    const lines = ['short line one here.', 'short line two here.'];
    // model returns only one line → line 2 falls back
    const out = await polishBatch(lines, async () => ['polished one.']);
    expect(out).toEqual(['polished one.', 'short line two here.']);
    // model returns garbage → all fall back
    const out2 = await polishBatch(lines, async () => {
      throw new Error('boom');
    });
    expect(out2).toEqual(lines);
    // runaway rewrite (3x length) falls back
    const out3 = await polishBatch(lines, async () => ['ok.', 'x'.repeat(400)]);
    expect(out3[1]).toBe('short line two here.');
  });
});
