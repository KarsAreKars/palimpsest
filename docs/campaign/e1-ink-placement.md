# E1 — Click-Anywhere Ink + Folded Papercuts (PENECHO PIVOT)

Campaign: Desk → PENECHO PIVOT (`docs/PENECHO_PIVOT.md`, 108834e60)
Status: spec (queen writes; writer waves deferred until quota resets)
Scope: user input (click-anywhere placement + visible paper fix + reader-key gate)

## 1. Click-anywhere (replaces tail-only v1)

Current (`DeskCanvas.tsx` L294–320): `handleCanvasClick` — `isTailPoint(rects, scrollHeight, pointY)` with `lastBottom` of `.desk-tail`, only empty paper below last block. `dispatch({type:'PLACE', point})` creates `{kind:'placed', point}`; focus opens `FOCUS` → composing. The `deskGeometry.ts` reducer (`idle → placed → composing → sending → idle`) and `clampComposerPosition` (L45) are already pure and reusable.

Specification (additive):
- A click ANYWHERE on `.desk-canvas` (not only in `.desk-tail`) that lands on non-interactive space opens the composer at that (x, y), with `isTailPoint` replaced by `isWritablePoint` — true when `pointY >= contentTopOfLastBlock` OR when there is no `article[data-bid]` overlap at `pointY - caretHeight`. In plain terms: empty paper is always writable; gaps between clusters are writable; on-top of an existing block, the click is inert (protects reading). This is the position-scoped writer: placement fields (`x?/y?/width?`) from `workbenchChat.ts:129` are written at commit time (`handleSend` L347–355 already writes `{x, y, width}` from column width); with arbitrary placement, the width defaults to `column.offsetWidth` (the 720px column) unless the user resizes (v1 does not resize; v1.1 may add drag-to-resize).
- The floating plate (`desk-composer`) opens at the click point (`clampComposerPosition` with `.desk-canvas` inner box as viewport); the caret ghost (`.desk-caret`, `deskGeometry.ts:97`) sits at the click; `useReducer(deskComposerReducer, ...)` drives the state machine unchanged.
- The visible-tail invitation line (PENECHO PIVOT folded papercut) lives in `.desk-tail`: always shows a centered muted-text line `The lower paper is yours — click to write.` so the user knows the gesture. This is a `p` with class `.desk-tail-hint`, light muted (`--muted`), ≤1 line, hidden when `composer.kind !== 'idle'` (no clutter during composition).

File touch: `desk/deskGeometry.ts` (add `isWritablePoint`), `desk/DeskCanvas.tsx` (replace `isTailPoint` with `isWritablePoint` in `handleCanvasClick`), `desk/desk.css` (add `.desk-tail-hint` muted line). Tests: extend `desk-canvas.test.ts` cases: click between two placed blocks opens composer (new case 10); click ON a block returns inert; `isWritablePoint` pure tested in `desk-canvas.test.ts`.

## 2. Folded papercut: opaque paper (sheet reads as real paper)

Evidence from the live build: `.desk-sheet` (`desk.css:9`) has `background: transparent`; `.desk-scrim` (`desk.css:28`) does `color-mix(paper, 82%, transparent)` but the computed result is transparent due to an unverified `--paper` variable context or the root staying transparent. The fix: `.desk-sheet`: `background: var(--paper, #F7F2E7);` as explicit opaque fallback BEFORE the color-mix (so if `--paper` resolves fine the mix still renders opaque-enough; if `--paper` is missing the fallback provides the paper). The `.desk-scrim` remains but its opacity is lowered from 82% to 88% (fainter ghost) and it receives a 1px hairline at its top (`box-shadow: inset 0 1px 0 var(--ink)` — existing `--ink`) to read as a sheet edge over the page, matching the Antiquarian Catalogue design world. This is a single CSS block edit (`desk.css` lines 9–35), no component change.

## 3. Folded papercut: reader-shortcut gate

Evidence: `useBookShortcuts.ts` (reader hooks) binds keys `t` (narration toggle), arrow-left/right (page turn, or narration prev/next), `h`/`j` (not present in the snippet from earlier grep; verify: the user's complaint `h`/`j` = page navigation — check `useBookShortcuts.ts:109-138` for the arrow/page-turn bindings; if `h`/`j` are additional navigation keys they must be gated too). The gate: add `const deskOpen = useDeskState(s => s.isDeskVisible);` (or import `useDeskStore`); in the shortcut handler, when `deskOpen` is true, suppress `t` (narration) and all arrow/page-turn bindings EXCEPT `Esc` (already handled by `useShortcuts` in `DeskSheet.tsx`). The `useDeskStore` import is available (`deskStore.ts` already exports the zustand store). This is a 3-line gate addition in `useBookShortcuts.ts` plus the import; the `useShortcuts` hook (`useShortcuts.ts`) does not need changes because `DeskSheet`'s `onEscape` takes priority via its own listener (`DeskSheet.tsx:59`).

Verification gates: (a) click anywhere below last block opens composer at that point; click on block stays inert; (b) sheet renders with visible opaque paper + hairline edge; (c) `t` and arrow/page-turn keys suppressed when `.desk-sheet.desk-sheet-open` exists; `useBookShortcuts` test updated (extend `desk-store.test.ts` or `workbench-chat.test.ts` with a key-suppression assertion — one test is enough). No other files changed; no existing tests edited.

Risk / open questions for e4 (audit): does the cluster layout algorithm (e2) treat `isWritablePoint` as the placement trigger? Does the rail scroll-to visit the user anchor or the cluster head? (Recommendation: the cluster's anchor block's `scrollToBlock` visit uses the same block-id mechanism; no change.)
