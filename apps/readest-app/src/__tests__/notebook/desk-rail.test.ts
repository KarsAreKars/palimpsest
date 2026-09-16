/**
 * desk-rail — the traffic-light rail's row model (d3 §B). Pure-function
 * idiom: buildDeskRail flattens a ConceptMapData in catalogue order, and a
 * round-trip through latestConceptMap + commitProfessorBlock pins the
 * thread resolution to the LATEST professor block carrying [CONCEPT:name]
 * (mirrors workbench-pedagogy.test.ts's thread-resolution case, now through
 * the rail model).
 */
import { describe, expect, test } from 'vitest';
import {
  buildDeskRail,
  commitProfessorBlock,
  latestConceptMap,
  type ConceptMapData,
} from '@/app/reader/components/notebook/workbenchChat';

describe('buildDeskRail', () => {
  test('flattens in catalogue order (known, edge, unknown), tones attached, null threadIds inert, null map → []', () => {
    const map: ConceptMapData = {
      known: [
        { name: 'limits', threadId: 'blk_limits' },
        { name: 'series', threadId: null }, // discussed, thread unresolved
      ],
      edge: [{ name: 'convergence', threadId: 'blk_conv' }],
      unknown: [{ name: 'parseval', threadId: null }],
    };
    const entries = buildDeskRail(map);
    expect(entries.map((e) => e.name)).toEqual(['limits', 'series', 'convergence', 'parseval']);
    expect(entries.map((e) => e.shelf)).toEqual(['known', 'known', 'edge', 'unknown']);
    expect(entries[0]).toEqual({ name: 'limits', shelf: 'known', threadId: 'blk_limits' });
    expect(entries[1]!.threadId).toBeNull();
    expect(entries[3]).toEqual({ name: 'parseval', shelf: 'unknown', threadId: null });

    expect(buildDeskRail(null)).toEqual([]);
  });

  test('round-trip: entries resolve to the LATEST professor block id through latestConceptMap', () => {
    const first = commitProfessorBlock('First discussion of Fourier.\n[CONCEPT:Fourier]', []);
    const second = commitProfessorBlock('A later, fuller discussion.\n[CONCEPT:Fourier]', [first]);
    const catalogue = commitProfessorBlock(
      'The catalogue so far.\n[CONCEPTS known:Fourier; edge:Parseval; unknown:Wavelets]',
      [first, second],
    );
    const blocks = [first, second, catalogue];
    const map = latestConceptMap(blocks);
    expect(map).not.toBeNull();

    const entries = buildDeskRail(map);
    expect(entries).toEqual([
      { name: 'Fourier', shelf: 'known', threadId: second.id }, // latest wins, not first.id
      { name: 'Parseval', shelf: 'edge', threadId: null }, // filed but never discussed
      { name: 'Wavelets', shelf: 'unknown', threadId: null },
    ]);

    // An older map never resurfaces: only the newest [CONCEPTS] block's
    // shelves reach the rail.
    const older = commitProfessorBlock(
      'An older catalogue.\n[CONCEPTS known:; edge:Fourier; unknown:]',
      [first],
    );
    const newest = buildDeskRail(latestConceptMap([older, catalogue]));
    expect(newest.map((e) => e.name)).toEqual(['Fourier', 'Parseval', 'Wavelets']);
  });
});
