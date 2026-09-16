/**
 * desk-canvas — contract tests for the Desk sheet's document model and
 * canvas geometry (d2 §9, pure-contract vitest style matching
 * workbench-chat.test.ts). Component-free: every case runs against the
 * pure functions of workbenchChat.ts (placement fields, sanitize,
 * buildUserBlock) and deskGeometry.ts (isTailPoint, the composer state
 * machine, clampComposerPosition, shouldFollow, the tail invariant).
 * Placement round-trip lives ONLY here (audit R9); workbench-chat.test.ts
 * is untouched this campaign.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildUserBlock,
  parseTranscript,
  serializeTranscript,
  type TranscriptBlock,
} from '@/app/reader/components/notebook/workbenchChat';
import {
  DESK_PIN_THRESHOLD_PX,
  DESK_TAIL_MIN_VH,
  clampComposerPosition,
  deskComposerReducer,
  idleComposer,
  isTailPoint,
  isWritablePoint,
  shouldFollow,
} from '@/app/reader/components/desk/deskGeometry';
import {
  STAGE,
  buildClusters,
  estimateHeight,
  isSpatialSheet,
  layoutCluster,
  layoutSheet,
} from '@/app/reader/components/desk/deskLayout';

const userBlock = (over: Partial<TranscriptBlock> = {}): TranscriptBlock => ({
  id: 'u1',
  author: 'user',
  content: 'I tried the substitution.',
  at: '2026-09-16T00:00:00.000Z',
  ...over,
});

const profBlock = (over: Partial<TranscriptBlock> = {}): TranscriptBlock => ({
  id: 'p1',
  author: 'professor',
  content: 'Good — let us look at it together.',
  at: '2026-09-16T00:00:01.000Z',
  ...over,
});

describe('placement round-trip (d2 §9 case 1)', () => {
  test('blocks carrying {x, y, width} serialize, parse byte-equal, and re-serialize stably', () => {
    const blocks: TranscriptBlock[] = [
      userBlock({ id: 'u1', x: 96, y: 1200, width: 720 }),
      userBlock({ id: 'u2', content: 'plain', x: 0, y: 24 }),
      userBlock({ id: 'u3', content: 'no placement' }),
    ];
    const json = serializeTranscript(blocks);
    const parsed = parseTranscript(json);
    expect(parsed).toEqual(blocks);
    // idempotent save: a second generation parses to the same document
    const reparsed = parseTranscript(serializeTranscript(parsed!));
    expect(reparsed).toEqual(blocks);
    expect(reparsed![0]).toMatchObject({ x: 96, y: 1200, width: 720 });
  });

  test('TRANSCRIPT_VERSION stays 1 — placement fields ride the v1 document', () => {
    const json = serializeTranscript([userBlock({ x: 1, y: 2, width: 3 })]);
    expect((JSON.parse(json) as { version: number }).version).toBe(1);
  });
});

describe('old transcript loads clean (d2 §9 case 2)', () => {
  test('a placement-less v1 document parses; every field is undefined', () => {
    const legacy = JSON.stringify({
      version: 1,
      savedAt: '2026-09-01T00:00:00.000Z',
      blocks: [
        { id: 'p1', author: 'professor', content: 'Greetings.', at: '2026-09-01T00:00:01.000Z' },
        { id: 'u1', author: 'user', content: 'Hello.', at: '2026-09-01T00:00:02.000Z' },
      ],
    });
    const parsed = parseTranscript(legacy);
    expect(parsed).toHaveLength(2);
    for (const b of parsed!) {
      expect(b.x).toBeUndefined();
      expect(b.y).toBeUndefined();
      expect(b.width).toBeUndefined();
    }
  });
});

describe('malformed placement is sanitized, not fatal (d2 §9 case 3)', () => {
  test('x: "left" / width: -4 / y: NaN are stripped; the document still loads', () => {
    const doc = JSON.stringify({
      version: 1,
      savedAt: '2026-09-01T00:00:00.000Z',
      blocks: [
        {
          id: 'b1',
          author: 'user',
          content: 'carries bad placement',
          at: '2026-09-01T00:00:00.000Z',
          x: 'left',
          y: NaN,
          width: -4,
        },
        { id: 'b2', author: 'user', content: 'clean', at: '2026-09-01T00:00:01.000Z' },
      ],
    });
    const parsed = parseTranscript(doc);
    expect(parsed).toHaveLength(2);
    expect(parsed![0]!.x).toBeUndefined();
    expect(parsed![0]!.y).toBeUndefined();
    expect(parsed![0]!.width).toBeUndefined();
    expect(parsed![0]!.content).toBe('carries bad placement'); // the ink survives
    expect(parsed![1]).toMatchObject({ id: 'b2' });
  });

  test('finite, positive placement survives the same sanitizer', () => {
    const doc = JSON.stringify({
      version: 1,
      savedAt: '2026-09-01T00:00:00.000Z',
      blocks: [
        {
          id: 'b1',
          author: 'user',
          content: 'good placement',
          at: '2026-09-01T00:00:00.000Z',
          x: 120,
          y: 480,
          width: 720,
        },
      ],
    });
    expect(parseTranscript(doc)![0]).toMatchObject({ x: 120, y: 480, width: 720 });
  });

  test('Risk 5(c): a torn transcript write parses as null — a fresh sheet, no throw', () => {
    expect(parseTranscript('{')).toBeNull();
    expect(parseTranscript('')).toBeNull();
  });
});

describe('buildUserBlock parity (d2 §9 case 4)', () => {
  test('answers the professor’s open teach-back ask', () => {
    const prior: TranscriptBlock[] = [
      {
        id: 'p1',
        author: 'professor',
        content: 'Restate the lemma.',
        at: '2026-09-01T00:00:00.000Z',
        teachbackAsk: 'Why may the constant leave the integral?',
      },
    ];
    const { block } = buildUserBlock(prior, { content: 'Because it does not depend on n.' });
    expect(block.teachbackAsk).toBe('Why may the constant leave the integral?');
  });

  test('marks the honest "I don\'t know" signal', () => {
    const { block } = buildUserBlock([], { content: "I'm stuck — I don't know" });
    expect(block.probeSignal).toBe(true);
  });

  test('detects a folio step-append and sets extendsDerivation', () => {
    const folio: TranscriptBlock = {
      id: 'p1',
      author: 'professor',
      content: 'A folio opens.',
      at: '2026-09-01T00:00:00.000Z',
      derivation: { steps: [{ id: 'p1:0', latex: 'a = b' }] },
    };
    const prior = [folio];
    const { block, associated } = buildUserBlock(prior, { content: '$$b = c$$\nby symmetry' });
    expect(block.extendsDerivation).toBe('p1');
    expect(associated).not.toBe(prior);
    expect(associated.find((b) => b.id === 'p1')!.derivation!.steps).toHaveLength(2);
  });

  test('placement fields copy onto the committed block', () => {
    const { block } = buildUserBlock([], { content: 'placed ink', x: 96, y: 1200, width: 720 });
    expect(block).toMatchObject({ x: 96, y: 1200, width: 720 });
    // absent placement stays absent (additive fields)
    const { block: plain } = buildUserBlock([], { content: 'flow ink' });
    expect(plain.x).toBeUndefined();
    expect(plain.y).toBeUndefined();
    expect(plain.width).toBeUndefined();
  });
});

describe('isTailPoint hit-testing (d2 §9 case 5)', () => {
  const rects = [
    { id: 'b1', top: 100, bottom: 300 },
    { id: 'b2', top: 320, bottom: 500 },
  ];
  const extent = 500 + 360; // blocks + 45vh tail at a 800px viewport

  test('a point below every block rect and within the extent is placeable', () => {
    expect(isTailPoint(rects, extent, 500)).toBe(true);
    expect(isTailPoint(rects, extent, 700)).toBe(true);
  });

  test('a point inside a block rect — even 1px above its bottom — is inert', () => {
    expect(isTailPoint(rects, extent, 499)).toBe(false);
    expect(isTailPoint(rects, extent, 320)).toBe(false);
  });

  test('a point below the content extent is inert', () => {
    expect(isTailPoint(rects, extent, extent + 1)).toBe(false);
  });

  test('an empty sheet places anywhere below y=0', () => {
    expect(isTailPoint([], 360, 0)).toBe(true);
    expect(isTailPoint([], 360, 359)).toBe(true);
    expect(isTailPoint([], 360, 361)).toBe(false);
    expect(isTailPoint([], 360, -1)).toBe(false);
  });
});

describe('composer state machine (d2 §9 case 6)', () => {
  const p1 = { x: 40, y: 300 };
  const p2 = { x: 80, y: 360 };

  test('PLACE → FOCUS → SEND → SENT → idle', () => {
    let s = idleComposer;
    s = deskComposerReducer(s, { type: 'PLACE', point: p1 });
    expect(s).toEqual({ kind: 'placed', point: p1 });
    s = deskComposerReducer(s, { type: 'FOCUS' });
    expect(s).toEqual({ kind: 'composing', point: p1, text: '' });
    s = deskComposerReducer(s, { type: 'CHANGE', text: 'a thought' });
    expect(s).toEqual({ kind: 'composing', point: p1, text: 'a thought' });
    s = deskComposerReducer(s, { type: 'SEND' });
    expect(s).toEqual({ kind: 'sending', point: p1, text: 'a thought' });
    s = deskComposerReducer(s, { type: 'SENT' });
    expect(s).toEqual(idleComposer);
  });

  test('DISMISS from composing returns to idle (and from placed too)', () => {
    let s = deskComposerReducer(idleComposer, { type: 'PLACE', point: p1 });
    s = deskComposerReducer(s, { type: 'FOCUS' });
    s = deskComposerReducer(s, { type: 'CHANGE', text: 'draft' });
    expect(deskComposerReducer(s, { type: 'DISMISS' })).toEqual(idleComposer);
    const placed = deskComposerReducer(idleComposer, { type: 'PLACE', point: p1 });
    expect(deskComposerReducer(placed, { type: 'DISMISS' })).toEqual(idleComposer);
  });

  test('PLACE while composing moves the point and KEEPS the text', () => {
    let s = deskComposerReducer(idleComposer, { type: 'PLACE', point: p1 });
    s = deskComposerReducer(s, { type: 'FOCUS' });
    s = deskComposerReducer(s, { type: 'CHANGE', text: 'kept' });
    s = deskComposerReducer(s, { type: 'PLACE', point: p2 });
    expect(s).toEqual({ kind: 'composing', point: p2, text: 'kept' });
  });

  test('SEND from idle/placed is a no-op', () => {
    expect(deskComposerReducer(idleComposer, { type: 'SEND' })).toEqual(idleComposer);
    const placed = deskComposerReducer(idleComposer, { type: 'PLACE', point: p1 });
    expect(deskComposerReducer(placed, { type: 'SEND' })).toEqual(placed);
  });
});

describe('clampComposerPosition (d2 §9 case 7)', () => {
  const viewport = { width: 800, height: 600 };
  const composer = { width: 420, height: 150 };

  test('near the right edge clamps leftward with an 8px gutter', () => {
    const { left } = clampComposerPosition({ x: 790, y: 100 }, viewport, composer);
    expect(left).toBe(800 - 420 - 8);
  });

  test('near the bottom viewport edge flips the composer above the caret', () => {
    const { top } = clampComposerPosition({ x: 100, y: 590 }, viewport, composer);
    expect(top).toBe(590 - 150 - 16);
    // room below: the plate rides under the caret
    expect(clampComposerPosition({ x: 100, y: 100 }, viewport, composer).top).toBe(116);
  });

  test('a viewport narrower than the plate still leaves the 8px gutter', () => {
    const narrow = { width: 300, height: 600 };
    const { left } = clampComposerPosition({ x: 200, y: 100 }, narrow, composer);
    expect(left).toBe(8);
  });
});

describe('follow boundary at 24px (d2 §9 case 8)', () => {
  const clientHeight = 800;

  test('distance ≤ 24 follows when pinned', () => {
    expect(DESK_PIN_THRESHOLD_PX).toBe(24);
    expect(shouldFollow(1176, 2000, clientHeight, true)).toBe(true); // exactly 24
    expect(shouldFollow(1180, 2000, clientHeight, true)).toBe(true); // 20
    expect(shouldFollow(0, 2000, clientHeight, true)).toBe(false); // far above
  });

  test('25px unpins', () => {
    expect(shouldFollow(1175, 2000, clientHeight, true)).toBe(false);
  });

  test('unpinned stays unpinned — no yank', () => {
    expect(shouldFollow(1200, 2000, clientHeight, false)).toBe(false); // AT the bottom
    expect(shouldFollow(0, 2000, clientHeight, false)).toBe(false);
  });
});

describe('sheet extent invariant (d2 §9 case 9)', () => {
  test('the tail guarantees ≥ DESK_TAIL_MIN_VH of clickable paper below the last block', () => {
    expect(DESK_TAIL_MIN_VH).toBe(0.45);
    // Model: extent = lastBlockBottom + max(natural tail, min-tail). The
    // min-tail dominates in v1 (the tail is empty paper), so:
    const clientHeight = 800;
    const lastBlockBottom = 1370; // a document of N blocks, measured
    const extent = lastBlockBottom + DESK_TAIL_MIN_VH * clientHeight;
    expect(extent).toBeGreaterThanOrEqual(lastBlockBottom + 0.45 * clientHeight);
    expect(extent - lastBlockBottom).toBeGreaterThanOrEqual(0.45 * clientHeight);
  });

  test('the CSS contract agrees with the constant (min-height: 45vh)', () => {
    const css = readFileSync('src/app/reader/components/desk/desk.css', 'utf8');
    expect(css).toMatch(/\.desk-tail\s*\{[^}]*min-height:\s*45vh/);
  });
});

// ---------------------------------------------------------------------------
// PENECHO PIVOT — click-anywhere + spatial clusters (e4 R1/R4/R5). Pure
// contracts against deskGeometry.isWritablePoint and the deskLayout engine;
// no existing case above is touched.
// ---------------------------------------------------------------------------

describe('isWritablePoint — click-anywhere (PENECHO R1)', () => {
  const rects = [
    { id: 'b1', top: 100, bottom: 300 },
    { id: 'b2', top: 320, bottom: 500 },
  ];
  const extent = 500 + 360; // blocks + 45vh tail at a 800px viewport

  test('the tail below every block is writable', () => {
    expect(isWritablePoint(rects, extent, 501)).toBe(true);
    expect(isWritablePoint(rects, extent, 700)).toBe(true);
  });

  test('a point ON a block is never writable — edges included', () => {
    expect(isWritablePoint(rects, extent, 100)).toBe(false); // top edge
    expect(isWritablePoint(rects, extent, 200)).toBe(false); // mid-block
    expect(isWritablePoint(rects, extent, 300)).toBe(false); // bottom edge
    expect(isWritablePoint(rects, extent, 320)).toBe(false);
    expect(isWritablePoint(rects, extent, 500)).toBe(false);
  });

  test('a vertical gap between blocks is writable', () => {
    expect(isWritablePoint(rects, extent, 301)).toBe(true);
    expect(isWritablePoint(rects, extent, 310)).toBe(true);
    expect(isWritablePoint(rects, extent, 319)).toBe(true);
    expect(isWritablePoint(rects, extent, 0)).toBe(true); // above the first block
  });

  test('outside the content extent is inert', () => {
    expect(isWritablePoint(rects, extent, extent + 1)).toBe(false);
    expect(isWritablePoint(rects, extent, -1)).toBe(false);
    expect(isWritablePoint([], 360, 359)).toBe(true); // empty sheet: anywhere
    expect(isWritablePoint([], 360, 361)).toBe(false);
  });
});

describe('buildClusters — the cluster grouping (e2 §1, e4 R4)', () => {
  test('professor artifacts attach to the PRECEDING user block; order preserved', () => {
    const blocks = [
      userBlock({ id: 'u1' }),
      profBlock({ id: 'p1' }),
      profBlock({ id: 'p2' }),
      profBlock({ id: 'p3' }),
      userBlock({ id: 'u2' }),
      profBlock({ id: 'p4' }),
    ];
    const clusters = buildClusters(blocks);
    expect(clusters.map((c) => c.anchor?.id ?? null)).toEqual(['u1', 'u2']);
    expect(clusters[0]!.artifacts.map((b) => b.id)).toEqual(['p1', 'p2', 'p3']);
    expect(clusters[1]!.artifacts.map((b) => b.id)).toEqual(['p4']);
  });

  test('the session greeting is a cluster with a NULL anchor', () => {
    const blocks = [profBlock({ id: 'p0' }), userBlock({ id: 'u1' }), profBlock({ id: 'p1' })];
    const clusters = buildClusters(blocks);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.anchor).toBeNull();
    expect(clusters[0]!.artifacts.map((b) => b.id)).toEqual(['p0']);
    expect(clusters[1]!.anchor?.id).toBe('u1');
    // A transcript starting with a user block has no greeting run.
    expect(buildClusters([userBlock({ id: 'u1' })])[0]!.anchor?.id).toBe('u1');
    expect(buildClusters([])).toEqual([]);
  });
});

describe('layoutCluster — spatial layout pure cases (e2 §2, e4 R5)', () => {
  test('beside the anchor when the stage is wide enough', () => {
    const anchor = userBlock({ id: 'u1', x: 60, y: 100 });
    const artifact = profBlock({ id: 'p1' });
    const layout = layoutCluster({ anchor, artifacts: [artifact] }, 1000, 0);
    expect(layout.mode).toBe('beside');
    // The anchor keeps its stored point at the anchor-box width.
    expect(layout.anchor).toEqual({ x: 60, y: 100, width: STAGE.anchorWidth });
    // The artifact sits to the anchor's right, LEVEL with it (y = anchor.y).
    expect(layout.artifacts[0]).toEqual({
      x: 60 + STAGE.anchorWidth + STAGE.clusterGap,
      y: 100,
      width: STAGE.artifactWidth,
    });
  });

  test('stacked BELOW the anchor when the stage is narrow', () => {
    const anchor = userBlock({ id: 'u1', x: 60, y: 100 });
    const artifact = profBlock({ id: 'p1' });
    // 60 + 380 + 24 + 380 + 32 = 876 > 600 — no beside room.
    const layout = layoutCluster({ anchor, artifacts: [artifact] }, 600, 0);
    expect(layout.mode).toBe('below');
    expect(layout.artifacts[0]!.x).toBe(60); // the anchor's own x
    expect(layout.artifacts[0]!.y).toBe(100 + estimateHeight(anchor) + STAGE.clusterGap);
    expect(layout.artifacts[0]!.width).toBe(STAGE.anchorWidth);
    // never overlapping the anchor box
    expect(layout.artifacts[0]!.y).toBeGreaterThanOrEqual(100 + estimateHeight(anchor));
  });

  test('an unplaced anchor is a COLUMN cluster — the legacy measure at flowY', () => {
    const anchor = userBlock({ id: 'u1' }); // no placement
    const artifact = profBlock({ id: 'p1' });
    const layout = layoutCluster({ anchor, artifacts: [artifact] }, 1000, 240);
    expect(layout.mode).toBe('column');
    expect(layout.anchor).toEqual({ x: (1000 - STAGE.columnWidth) / 2, y: 240, width: 720 });
    expect(layout.artifacts[0]!.x).toBe((1000 - STAGE.columnWidth) / 2);
    expect(layout.artifacts[0]!.width).toBe(STAGE.columnWidth);
    expect(layout.artifacts[0]!.y).toBe(240 + estimateHeight(anchor) + STAGE.clusterGap);
  });

  test('the greeting cluster (null anchor) flows in the column at flowY', () => {
    const layout = layoutCluster({ anchor: null, artifacts: [profBlock({ id: 'p0' })] }, 1000, 0);
    expect(layout.mode).toBe('column');
    expect(layout.anchor).toBeNull();
    expect(layout.artifacts[0]).toEqual({ x: 140, y: 0, width: STAGE.columnWidth });
  });
});

describe('layoutSheet — mixed-transcript reconciliation (e3 §2)', () => {
  test('a legacy-only sheet reconciles to the centered column in document order', () => {
    const blocks = [profBlock({ id: 'p0' }), userBlock({ id: 'u1' }), profBlock({ id: 'p1' })];
    expect(isSpatialSheet(blocks)).toBe(false);
    const layout = layoutSheet(blocks, 1000);
    for (const b of blocks) {
      const slot = layout.placements.get(b.id)!;
      expect(slot.x).toBe(140);
      expect(slot.width).toBe(STAGE.columnWidth);
    }
    // document order flows downward
    const ys = blocks.map((b) => layout.placements.get(b.id)!.y);
    expect(ys[0]).toBe(0);
    expect(ys[1]!).toBeGreaterThan(ys[0]!);
    expect(ys[2]!).toBeGreaterThan(ys[1]!);
    expect(layout.extent).toBeGreaterThan(ys[2]!);
  });

  test('mixed sheet: placed cluster at its point, legacy content flows below it', () => {
    const placed = userBlock({ id: 'u1', x: 60, y: 800 });
    const blocks = [
      profBlock({ id: 'p0' }), // greeting, column
      placed,
      profBlock({ id: 'p1' }), // u1's artifact
      userBlock({ id: 'u2' }), // legacy anchor (probe pick: no placement)
      profBlock({ id: 'p2' }),
    ];
    expect(isSpatialSheet(blocks)).toBe(true);
    const layout = layoutSheet(blocks, 1000);
    // The placed anchor keeps its stored point; the artifact rides beside.
    expect(layout.placements.get('u1')).toEqual({ x: 60, y: 800, width: STAGE.anchorWidth });
    expect(layout.placements.get('p1')!.x).toBe(60 + STAGE.anchorWidth + STAGE.clusterGap);
    expect(layout.placements.get('p1')!.y).toBe(800);
    // The legacy cluster flows in the column, BELOW the placed cluster's
    // reserved extent — order preserved, no overlap.
    const u2 = layout.placements.get('u2')!;
    expect(u2.x).toBe(140);
    expect(u2.width).toBe(STAGE.columnWidth);
    expect(u2.y).toBeGreaterThanOrEqual(800 + estimateHeight(placed));
    expect(layout.placements.get('p2')!.y).toBeGreaterThan(u2.y);
    expect(layout.extent).toBeGreaterThan(layout.placements.get('p2')!.y);
  });

  test('hand-placed points are respected verbatim (owner ruling 2026-09-16: no clamp)', () => {
    const blocks = [
      profBlock({ id: 'p0' }), // greeting occupies the head
      userBlock({ id: 'u1', x: 60, y: 10 }), // stored y collides with the greeting
    ];
    const layout = layoutSheet(blocks, 1000);
    const anchor = layout.placements.get('u1')!;
    expect(anchor.x).toBe(60);
    expect(anchor.y).toBe(10); // the user's ink stays where the user put it
  });

  test('the layout pass never mutates the document', () => {
    const blocks = [
      profBlock({ id: 'p0' }),
      userBlock({ id: 'u1', x: 60, y: 800 }),
      profBlock({ id: 'p1' }),
    ];
    const before = serializeTranscript(blocks);
    layoutSheet(blocks, 1000);
    layoutSheet(blocks, 400); // a narrow pass too
    expect(serializeTranscript(blocks)).toBe(before);
  });

  test('streamSlot: the in-flight reply mounts at the open cluster’s next slot', () => {
    const blocks = [userBlock({ id: 'u1', x: 60, y: 800 }), profBlock({ id: 'p1' })];
    const layout = layoutSheet(blocks, 1000);
    // beside the anchor, directly under the first artifact
    expect(layout.streamSlot).toEqual({
      x: 60 + STAGE.anchorWidth + STAGE.clusterGap,
      y: 800 + estimateHeight(blocks[1]!) + STAGE.clusterGap,
      width: STAGE.artifactWidth,
    });
    // a column (unplaced) active cluster streams in the legacy measure
    const columnLayout = layoutSheet([userBlock({ id: 'u9' })], 1000);
    expect(columnLayout.streamSlot).toEqual({
      x: 140,
      y: estimateHeight(userBlock({ id: 'u9' })) + STAGE.clusterGap,
      width: STAGE.columnWidth,
    });
    // an empty sheet has no slot
    expect(layoutSheet([], 1000).streamSlot).toBeNull();
  });
});

describe('spatial render smoke (PENECHO R4/R5)', () => {
  test('a placed user block renders at its stored point', () => {
    const blocks = [userBlock({ id: 'u1', x: 96, y: 1200, width: 720 })];
    expect(isSpatialSheet(blocks)).toBe(true);
    const slot = layoutSheet(blocks, 1000).placements.get('u1')!;
    // DeskCanvas binds this slot to the absolute .desk-cluster-item style.
    expect(slot.x).toBe(96);
    expect(slot.y).toBe(1200);
  });

  test('the CSS contract: the spatial stage and cluster item classes exist', () => {
    const css = readFileSync('src/app/reader/components/desk/desk.css', 'utf8');
    expect(css).toMatch(/\.desk-spatial\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.desk-cluster-item\s*\{[^}]*position:\s*absolute/);
  });
});

describe('reader-key gate while the Desk is open (e4 R3)', () => {
  test('useBookShortcuts subscribes isDeskVisible and early-returns the gated keys', () => {
    const src = readFileSync('src/app/reader/hooks/useBookShortcuts.ts', 'utf8');
    expect(src).toContain('useDeskStore((s) => s.isDeskVisible)');
    for (const fn of [
      'goLeft',
      'goRight',
      'goUp',
      'goDown',
      'toggleTTS',
      'ttsPlayPause',
      'ttsGoNextSentence',
      'ttsGoPreviousSentence',
      'ttsGoNextParagraph',
      'ttsGoPreviousParagraph',
      'ttsHighlightSentence',
    ]) {
      expect(src).toMatch(new RegExp(`const ${fn} = [^=]*=> \\{\\s*if \\(isDeskVisible\\) return`));
    }
  });
});
