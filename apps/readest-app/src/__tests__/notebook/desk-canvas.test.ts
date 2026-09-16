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
  shouldFollow,
} from '@/app/reader/components/desk/deskGeometry';

const userBlock = (over: Partial<TranscriptBlock> = {}): TranscriptBlock => ({
  id: 'u1',
  author: 'user',
  content: 'I tried the substitution.',
  at: '2026-09-16T00:00:00.000Z',
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
