/**
 * workbench-guards — the folded-2.5 penecho guards (d3 C2), enforced at
 * the commit seam in workbenchChat.ts. Pure-function idiom, matching
 * workbench-derivation.test.ts: blocks are built through
 * commitProfessorBlock itself, never hand-assembled where the seam matters.
 */
import { describe, expect, test } from 'vitest';
import {
  artifactBudgetSpent,
  clampConceptShelves,
  commitProfessorBlock,
  latestConceptMap,
  MAX_ARTIFACT_BLOCKS_PER_EXCHANGE,
  professorArtifactCount,
  type TranscriptBlock,
} from '@/app/reader/components/notebook/workbenchChat';

const USER: TranscriptBlock = {
  id: 'u1',
  author: 'user',
  content: 'Show me the steps.',
  at: '2026-09-15T10:00:00Z',
};

const folioRaw = (n: number) =>
  `[DERIVE title:Folio ${n}]\n$$x+${n}=5$$\nremove ${n} from both sides\n[STEP]`;

const FIGURE_RAW =
  '[DIAGRAM claim:The triangle closes]\n```svg\n' +
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><path d="M10,70 L50,10 L90,70 Z" /></svg>\n' +
  '```';

/** The well-formed figure fixture from diagram-svg.test.ts, copied so the
 *  suites stay independent (audit, test inventory note). */
const REAL_FIGURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" />
    </marker>
  </defs>
  <g stroke="black" fill="none" stroke-width="1.5">
    <path d="M20,100 L100,20 L180,100 Z" marker-end="url(#arrow)" />
    <line x1="20" y1="100" x2="180" y2="100" stroke-dasharray="4 3" />
  </g>
  <text x="100" y="14" text-anchor="middle" font-size="10">the claim</text>
</svg>`;

const realFigureRaw = `[DIAGRAM claim:A real figure]\n\`\`\`svg\n${REAL_FIGURE}\n\`\`\``;

describe('C2.i — the per-exchange artifact budget', () => {
  test('the 4th shape of an exchange is muted: payload dropped, prose kept, librarian note appended', () => {
    let blocks = [USER];
    for (let i = 1; i <= MAX_ARTIFACT_BLOCKS_PER_EXCHANGE; i++) {
      const folio = commitProfessorBlock(folioRaw(i), blocks);
      expect(folio.derivation).toBeDefined();
      blocks = [...blocks, folio];
    }
    expect(artifactBudgetSpent(blocks)).toBe(true);

    const fourth = commitProfessorBlock(folioRaw(4), blocks);
    expect(fourth.derivation).toBeUndefined();
    expect(fourth.diagram).toBeUndefined();
    expect(fourth.content).toContain('$$x+4=5$$'); // the raw math still reads as prose
    expect(fourth.content).not.toContain('[DERIVE'); // tags never reach the eye
    expect(fourth.content).toContain('one shape at a time');
    expect(fourth.artifactMuted).toBe(true);
  });

  test('folios and figures count together toward the budget; prose is free', () => {
    let blocks = [USER];
    const folio = commitProfessorBlock(folioRaw(1), blocks);
    const figure = commitProfessorBlock(FIGURE_RAW, [...blocks, folio]);
    const prose = commitProfessorBlock('A quiet prose interlude.', [...blocks, folio, figure]);
    blocks = [...blocks, folio, figure, prose];
    expect(professorArtifactCount(blocks)).toBe(2);

    // Two shapes in, one slot left — the third shape still commits, the
    // fourth is muted.
    const thirdFolio = commitProfessorBlock(folioRaw(2), blocks);
    expect(thirdFolio.derivation).toBeDefined();
    const fourth = commitProfessorBlock(folioRaw(3), [...blocks, thirdFolio]);
    expect(fourth.derivation).toBeUndefined();
    expect(fourth.content).toContain('one shape at a time');

    // Prose never consults the budget: three in a row, none muted.
    let proseRun: TranscriptBlock[] = [USER];
    for (let i = 0; i < 4; i++) {
      const p = commitProfessorBlock(`Plain prose number ${i}.`, proseRun);
      expect(p.artifactMuted).toBeUndefined();
      expect(p.content).not.toContain('one shape at a time');
      proseRun = [...proseRun, p];
    }
  });

  test('the budget reopens at the learner block: their word resets the count', () => {
    let blocks = [USER];
    for (let i = 1; i <= 3; i++) {
      blocks = [...blocks, commitProfessorBlock(folioRaw(i), blocks)];
    }
    expect(artifactBudgetSpent(blocks)).toBe(true);
    const askAgain: TranscriptBlock = {
      id: 'u2',
      author: 'user',
      content: 'And another one, please.',
      at: '2026-09-15T10:05:00Z',
    };
    const fresh = commitProfessorBlock(folioRaw(9), [...blocks, askAgain]);
    expect(fresh.derivation).toBeDefined();
    expect(fresh.derivation!.steps[0]).toMatchObject({ latex: 'x+9=5' });
  });
});

describe('C2.ii — the commit-time diagram self-check', () => {
  test('a figure whose fence holds script instead of a drawing drops the payload, keeps the claim as prose, and consumes the slot', () => {
    // The same vetted predicate DiagramSlip renders by: a fence that
    // sanitizes to nothing would have degraded at render time — at commit
    // time it never becomes a figure at all.
    const badFigureRaw =
      '[DIAGRAM claim:The triangle closes]\n```svg\n' + '<script>alert(1)</script>\n' + '```';
    const failed = commitProfessorBlock(badFigureRaw, [USER]);
    expect(failed.diagram).toBeUndefined();
    expect(failed.content).toContain('The triangle closes');
    expect(failed.content).toContain('would not hold its ink');
    expect(failed.content).not.toContain('<script>');
    expect(failed.artifactMuted).toBe(true);

    // The slot was consumed: two more shapes in the same exchange are one
    // shape earlier over the budget.
    const existing = [USER, commitProfessorBlock(folioRaw(1), [USER])];
    const failedInExchange = commitProfessorBlock(badFigureRaw, existing);
    expect(professorArtifactCount([...existing, failedInExchange])).toBe(2);
    const folioAfter = commitProfessorBlock(folioRaw(2), [...existing, failedInExchange]);
    expect(folioAfter.derivation).toBeDefined(); // 2 of 3 — still room
    const oneMore = commitProfessorBlock(folioRaw(3), [...existing, failedInExchange, folioAfter]);
    expect(oneMore.derivation).toBeUndefined();
    expect(oneMore.content).toContain('one shape at a time');
  });

  test('a well-formed figure passes the self-check and commits with its svg intact', () => {
    const block = commitProfessorBlock(realFigureRaw, [USER]);
    expect(block.diagram).toBeDefined();
    expect(block.diagram!.claim).toBe('A real figure');
    expect(block.diagram!.svg).toContain('viewBox="0 0 200 120"');
    expect(block.diagram!.svg).toContain('marker-end="url(#arrow)"');
    expect(block.content).not.toContain('would not hold its ink');
  });

  test('a missing fence is an authoring slip, not a failed drawing: it keeps the plain degrade path and costs no slot', () => {
    const noFence = commitProfessorBlock('[DIAGRAM claim:No drawing came]\nSome words.', [USER]);
    expect(noFence.diagram).toEqual({ claim: 'No drawing came', svg: '' });
    expect(noFence.artifactMuted).toBeUndefined();
    expect(professorArtifactCount([USER, noFence])).toBe(1); // counts as the figure it is
  });
});

describe('C2.iii — concept shelves move at most one step per commit', () => {
  const prevMap = {
    known: [
      { name: 'limits', threadId: null },
      { name: 'series', threadId: null },
    ],
    edge: [{ name: 'convergence', threadId: null }],
    unknown: [{ name: 'parseval', threadId: null }],
  };

  test('one step moves freely; a two-shelf jump lands one step along', () => {
    const next = clampConceptShelves(prevMap, {
      known: [],
      edge: ['limits', 'convergence'],
      unknown: ['parseval', 'series'],
    });
    expect(next.known).toEqual([]);
    expect(next.edge).toEqual(['limits', 'convergence', 'series']); // series: known → unknown requested, one step granted
    expect(next.unknown).toEqual(['parseval']); // filed where it already was
  });

  test('a brand-new name files freely on any shelf; a name absent from the map stays absent', () => {
    const next = clampConceptShelves(prevMap, {
      known: ['limits', 'wavelets'],
      edge: [],
      unknown: ['residues'],
    });
    expect(next.known).toEqual(['limits', 'wavelets']); // first filing is not a move
    expect(next.unknown).toEqual(['residues']);
    const all = [...next.known, ...next.edge, ...next.unknown].join(' ');
    expect(all).not.toContain('convergence'); // not re-filed, stays off the map
    expect(all).not.toContain('parseval');
  });

  test('null prev files everything as emitted; the clamp also holds through commitProfessorBlock', () => {
    const fresh = clampConceptShelves(null, { known: ['a'], edge: ['b'], unknown: ['c'] });
    expect(fresh).toEqual({ known: ['a'], edge: ['b'], unknown: ['c'] });

    // All concepts filed known; the professor now files 'limits' unknown —
    // one step down is all the ledger allows.
    const first = commitProfessorBlock(
      'The catalogue so far.\n[CONCEPTS known:limits; edge:; unknown:]',
      [],
    );
    const second = commitProfessorBlock('A revision.\n[CONCEPTS known:; edge:; unknown:limits]', [
      first,
    ]);
    expect(latestConceptMap([first, second])).toEqual(second.conceptMap);
    expect(second.conceptMap!.known).toEqual([]);
    expect(second.conceptMap!.edge.map((e) => e.name)).toEqual(['limits']);
    expect(second.conceptMap!.unknown).toEqual([]);
  });
});
