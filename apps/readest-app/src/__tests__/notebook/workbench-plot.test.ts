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

describe('[CHART] tag grammar + document', () => {
  test('bar chart with title and rows parses', () => {
    const r = parseProfessorTags('[CHART bar title:Sizes | STM,3 | MT,7]');
    expect(r.chart?.kind).toBe('bar');
    expect(r.chart?.title).toBe('Sizes');
    expect(r.chart?.rows).toEqual([
      { label: 'STM', value: 3 },
      { label: 'MT', value: 7 },
    ]);
  });

  test('line chart without title parses; mid-prose is prose', () => {
    const r = parseProfessorTags('[CHART line | Jan,1 | Feb,-2]');
    expect(r.chart?.kind).toBe('line');
    expect(r.chart?.rows).toEqual([
      { label: 'Jan', value: 1 },
      { label: 'Feb', value: -2 },
    ]);
    const prose = parseProfessorTags('see [CHART bar | A,1] here');
    expect(prose.chart).toBeUndefined();
  });

  test('chart field round-trips; malformed rows are stripped by sanitize', () => {
    const blocks = [
      profBlock({ id: 'c1', chart: { kind: 'bar', rows: [{ label: 'A', value: 2 }] } }),
      profBlock({
        id: 'c2',
        chart: { kind: 'bar', rows: [] } as never, // malformed: no rows
      }),
    ];
    const parsed = parseTranscript(serializeTranscript(blocks));
    expect(parsed![0]?.chart?.rows).toEqual([{ label: 'A', value: 2 }]);
    expect(parsed![1]?.chart).toBeUndefined();
  });
});

describe('block style payloads', () => {
  test('style round-trips; unknown color/size values are dropped', () => {
    const blocks = [
      profBlock({ id: 's1', style: { color: 'stamp', size: 'xl' } }),
      profBlock({ id: 's2', style: { color: 'chartreuse' as never, size: 'm' } }),
    ];
    const parsed = parseTranscript(serializeTranscript(blocks));
    expect(parsed![0]?.style).toEqual({ color: 'stamp', size: 'xl' });
    expect(parsed![1]?.style).toEqual({ size: 'm' });
  });
});
