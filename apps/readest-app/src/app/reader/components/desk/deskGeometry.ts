/**
 * deskGeometry — the pure geometry + state machine of the Desk sheet
 * (d2 §5.2, §6, §7.1, §9). No DOM, no React: every function here is
 * testable without a renderer, matching the pure-contract style of
 * workbenchChat.ts.
 *
 * The sheet is a single fluid column (constitution default 3) that the
 * PENECHO pivot (e4 R1) opens to click-anywhere: any empty paper — the
 * tail or a gap between blocks — accepts ink (isWritablePoint); clicking
 * ON a block stays inert.
 */

/** Follow distance: within this many px of the bottom the scroll stays
 *  pinned (the 24px precedent, workbench §8 → desk, d2 §6). */
export const DESK_PIN_THRESHOLD_PX = 24;

/** The empty tail below the conversation is at least this fraction of the
 *  viewport height — there is always clickable paper to write on (d2 §5). */
export const DESK_TAIL_MIN_VH = 0.45;

export interface SheetPoint {
  x: number; // px, viewport coordinates relative to the scroll box
  y: number;
}

export interface BlockRect {
  id: string;
  top: number; // px, content-box coordinates
  bottom: number;
  left?: number; // px, canvas-relative — 2D writable test (owner dogfood)
  right?: number;
}

/** True when the point lands on empty tail paper (below every block,
 *  inside the .desk-tail region). */
export function isTailPoint(
  rects: BlockRect[],
  contentExtent: number, // measured scrollHeight
  pointY: number,
): boolean {
  const lastBottom = rects.reduce((m, r) => Math.max(m, r.bottom), 0);
  return pointY >= lastBottom && pointY <= contentExtent;
}

/** PENECHO pivot (e4 R1): click-anywhere. True when the point lands on
 *  writable paper — the endless tail below the last block OR a vertical
 *  gap between blocks — and never ON a block rect. Supersedes isTailPoint
 *  as the click predicate; isTailPoint remains for the tail invariant. */
export function isWritablePoint(
  rects: BlockRect[],
  contentExtent: number, // measured scrollHeight
  pointY: number,
  pointX?: number, // when given, the test is 2D: beside a block is writable
): boolean {
  if (pointY < 0 || pointY > contentExtent) return false;
  return !rects.some((r) => {
    const vOverlap = pointY >= r.top && pointY <= r.bottom;
    if (!vOverlap) return false;
    if (pointX == null || r.left == null || r.right == null) return true; // Y-only fallback
    return pointX >= r.left && pointX <= r.right;
  });
}

/** Clamp the floating composer so it never leaves the visible sheet
 *  viewport horizontally and always has its input above the caret. */
export function clampComposerPosition(
  point: SheetPoint,
  viewport: { width: number; height: number },
  composer: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.min(Math.max(point.x, 8), Math.max(8, viewport.width - composer.width - 8));
  const top =
    point.y + composer.height + 16 <= viewport.height
      ? point.y + 16
      : Math.max(8, point.y - composer.height - 16);
  return { left, top };
}

/** Pure port of the pinned-follow predicate (atBottom, the retired tab L1031):
 *  within DESK_PIN_THRESHOLD_PX of the bottom the scroll follows; scrolling
 *  up un-pins immediately and permanently — no yank (d2 §6). */
export function shouldFollow(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  pinned: boolean,
): boolean {
  if (!pinned) return false; // unpinned stays unpinned
  return scrollHeight - scrollTop - clientHeight <= DESK_PIN_THRESHOLD_PX;
}

// ---------------------------------------------------------------------------
// The floating composer state machine (d2 §7.1) — a pure reducer so the
// transitions are testable without a DOM.
// ---------------------------------------------------------------------------

export type ComposerState =
  | { kind: 'idle' }
  | { kind: 'placed'; point: SheetPoint } // caret ghost shown
  | { kind: 'composing'; point: SheetPoint; text: string } // input focused, text may exist
  | { kind: 'sending'; point: SheetPoint; text: string };

export type ComposerEvent =
  | { type: 'PLACE'; point: SheetPoint }
  | { type: 'FOCUS' }
  | { type: 'CHANGE'; text: string }
  | { type: 'DISMISS' }
  | { type: 'SEND' }
  | { type: 'SENT' };

export const idleComposer: ComposerState = { kind: 'idle' };

/**
 * Transitions (d2 §7.1):
 *   PLACE   idle | placed → placed            (caret ghost moves)
 *           composing      → composing        (a nudge, not a discard: text kept)
 *   FOCUS   placed         → composing        (textarea takes focus)
 *   CHANGE  composing      → composing        (text edit)
 *   DISMISS placed | composing → idle         (clear text; focus back to the sheet)
 *   SEND    composing      → sending         (commit; composer unmounts)
 *           idle | placed  → unchanged       (nothing to send)
 *   SENT    sending        → idle            (stream settle)
 */
export function deskComposerReducer(state: ComposerState, event: ComposerEvent): ComposerState {
  switch (event.type) {
    case 'PLACE': {
      if (state.kind === 'idle') return { kind: 'placed', point: event.point };
      if (state.kind === 'placed') return { kind: 'placed', point: event.point };
      if (state.kind === 'composing') {
        // Move the composer; the text is preserved.
        return { kind: 'composing', point: event.point, text: state.text };
      }
      return state; // sending — the commit is in flight
    }
    case 'FOCUS':
      return state.kind === 'placed' ? { kind: 'composing', point: state.point, text: '' } : state;
    case 'CHANGE':
      return state.kind === 'composing'
        ? { kind: 'composing', point: state.point, text: event.text }
        : state;
    case 'DISMISS':
      return state.kind === 'placed' || state.kind === 'composing' ? idleComposer : state;
    case 'SEND':
      return state.kind === 'composing'
        ? { kind: 'sending', point: state.point, text: state.text }
        : state;
    case 'SENT':
      return state.kind === 'sending' ? idleComposer : state;
    default:
      return state;
  }
}
