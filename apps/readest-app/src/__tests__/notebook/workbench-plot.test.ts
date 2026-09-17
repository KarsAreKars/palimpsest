/**
 * workbench-plot — the computed-plot wave. Pure contracts:
 * tag grammar (own-line only), block round-trip, evaluation correctness,
 * degradation on garbage, budget counting.
 */
import { describe, expect, test } from 'vitest';

import { parseProfessorTags } from '@/services/professor/professorTags';
import {
  evaluateFunctionAt,
  evaluatePlotSpec,
  sampleFunction,
} from '@/app/reader/components/notebook/plotCompute';
import {
  parseTranscript,
  serializeTranscript,
  type TranscriptBlock,
} from '@/app/reader/components/notebook/workbenchChat';

const profBlock = (over: Partial<TranscriptBlock>): TranscriptBlock => ({
  id: over.id ?? 'p1',
  author: 'professor',
  content: over.content ?? 'Words.',
  at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('[PLOT] tag grammar', () => {
  test('own-line [PLOT f:x^2] captures one rule', () => {
    const r = parseProfessorTags('Look.\n[PLOT f:x^2]');
    expect(r.plot?.fns).toEqual(['x^2']);
    expect(r.plot?.range).toBeUndefined();
    expect(r.display).not.toContain('[PLOT');
  });

  test('multi-rule with range parses in order', () => {
    const r = parseProfessorTags('[PLOT f:sin(x), x^2; range:-3,3]');
    expect(r.plot?.fns).toEqual(['sin(x)', 'x^2']);
    expect(r.plot?.range).toEqual([-3, 3]);
  });

  test('mid-prose [PLOT f:x] is prose and passes through', () => {
    const r = parseProfessorTags('see [PLOT f:x] here');
    expect(r.plot).toBeUndefined();
    expect(r.display).toContain('[PLOT f:x]');
  });
});

describe('plot evaluation (accuracy by construction)', () => {
  test('x^2 sampled at 2 evaluates to 4', () => {
    expect(evaluateFunctionAt('x^2', 2)).toBeCloseTo(4);
  });

  test('sin(0) evaluates to 0', () => {
    expect(evaluateFunctionAt('sin(x)', 0)).toBeCloseTo(0);
  });

  test('a spec yields finite traces across the range', () => {
    const r = evaluatePlotSpec({ fns: ['x^2'], range: [-2, 2] });
    expect(r).not.toBeNull();
    expect(r!.traces).toHaveLength(1);
    expect(r!.traces[0]!.points.every((p) => Number.isFinite(p.y))).toBe(true);
  });

  test('garbage LaTeX degrades to null (the slip falls back to prose)', () => {
    expect(evaluatePlotSpec({ fns: ['}{not latex at all'] })).toBeNull();
  });

  test('sampleFunction respects the requested range', () => {
    const pts = sampleFunction('x', [5, 7], 3);
    expect(pts).not.toBeNull();
    expect(pts![0]!.x).toBe(5);
    expect(pts![pts!.length - 1]!.x).toBe(7);
  });
});

describe('plot blocks in the document', () => {
  test('plot field round-trips through serialize/parse', () => {
    const blocks = [profBlock({ id: 'p9', plot: { fns: ['x^2'], range: [-4, 4] } })];
    const parsed = parseTranscript(serializeTranscript(blocks));
    expect(parsed).not.toBeNull();
    expect(parsed![0]?.plot?.fns).toEqual(['x^2']);
    expect(parsed![0]?.plot?.range).toEqual([-4, 4]);
  });

  test('blocks without plot parse clean (additive contract)', () => {
    const blocks = [profBlock({ id: 'p1' })];
    const parsed = parseTranscript(serializeTranscript(blocks));
    expect(parsed).not.toBeNull();
    expect(parsed![0]?.plot).toBeUndefined();
  });
});
