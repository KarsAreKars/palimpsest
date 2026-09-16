# E4 — PENECHO Pivot: Integration Audit (binding rulings, writer order, gates)

Campaign: PENECHO PIVOT (`docs/PENECHO_PIVOT.md`). Audited 2026-09-16.
Specs read: `PENECHO_PIVOT.md`, `e1-ink-placement.md`, `e2-spatial-professor.md`, `e3-canvas-model.md`, plus verified anchors against `desk/deskGeometry.ts`, `desk/desk.css`, `DeskCanvas.tsx`, `workbenchChat.ts`.

## Rulings (binding on writer waves)

**R1 — User input surface (e1, binding).** Click-anywhere on `.desk-canvas` uses `isWritablePoint` (derived from `isTailPoint` + gap-between-blocks). The composer opens at `(x,y)`; `deskComposerReducer` unchanged; `clampComposerPosition` unchanged. `desk-tail` keeps `min-height: 45vh` (d2). A persistent muted `.desk-tail-hint` line gives the invitation. `isWritablePoint` lives in `deskGeometry.ts` (new pure function); `handleCanvasClick` updates in `DeskCanvas.tsx`. The click-into-interactive-guard (`button, a, input, textarea, select, [role="dialog"], math-field`) stays.

**R2 — Paper renders as opaque paper (e1, binding).** `.desk-sheet`: add `background: var(--paper, #F7F2E7);` before the color-mix; `.desk-scrim`: lower to `color-mix(paper, 79%, transparent)` (previous 82% → stronger ghost) and add `box-shadow: inset 0 1px 0 var(--ink)` to `.desk-sheet`. These are additive CSS lines (desk.css L9–35); no component change.

**R3 — Reader-key gate (e1, binding).** `useBookShortcuts.ts`: import `useDeskState` (existing `deskStore`); add `deskOpen = isDeskVisible`; suppress `t` (narration toggle) and arrow/page-turn bindings when `deskOpen` is true; `Esc` remains handled by `useShortcuts` in `DeskSheet.tsx` (unchanged). One import, one guard block. Tests added via `desk-canvas.test.ts` or `workbench-chat.test.ts` (one assertion: key suppressed when `deskStore.isDeskVisible` true).

**R4 — Cluster membership contract (e2, binding).** A cluster = professor blocks between user block U and next user block (or EOF); U is the anchor. The session-opening greeting from `startSession` is a greeting cluster (null anchor). Membership is render-time derived from document order, never persisted (audit confirms `TRANSCRIPT_VERSION` stays 1). `workbenchChat` does not change.

**R5 — Spatial layout v1 (e2/e3, binding).** Cluster artifacts (prose, figure, folio) render in a local region beside/below the anchor. The pure layout function (`desk/spatialLayout.ts` or in `deskGeometry.ts`) receives `{anchorPoint: {x,y}, clusterBlocks: BlockLayoutInfo[], viewport}` and returns non-overlapping placements within inner margins. Vertical clamping: no overlap between clusters (gap = 24px). The legacy column (`.desk-column`, 720px centered) is preserved for transcripts with no placement fields — additive mode unchanged (e3 R4). Mixed transcripts: placed blocks use placement; legacy blocks remain in the column flow below the last placed block or interleaved as document order demands; spec states the reconciliation explicitly in `e3-canvas-model.md` §2.

**R6 — The professor draws (e2, binding).** Diagrams/folio already produce SVG (`DiagramSlip.tsx`) and KaTeX (`DerivationSlip.tsx`). Placement fields (`workbenchChat.ts:129`) are written at commit (`handleSend` L347–355). The pen-down guard (`MAX_ARTIFACT_BLOCKS_PER_EXCHANGE = 3`) is counted **per cluster** (not globally) — `workbenchChat` tracks `artifactCount` per cluster; when budget spent, `artifactMuted` applies to that cluster's 4th artifact. The mute note (`The professor sets down his pen — one shape at a time.`) and claim-keeping (fixed by round-1) apply per cluster.

**R7 — Voice/replay/probes (e2, binding).** `useDeskVoice` (wave 2) handles playback; replay (`DerivationSlip`) uses focus-scoped keys (fixed by round-1 `stopPropagation`); voice focus law (`narration owns audio`, `voiceRef.stop()` first in `send()`) applies globally. Probes/teach-back (`workbenchChat.ts` seams) ride on the transcript; no protocol change.

**R8 — Document and persistence (e3, binding).** `TRANSCRIPT_VERSION` stays 1 (`workbenchChat.ts:147`). `sanitizePlacement` (added round 1) stays in `parseTranscript`. Placement fields (`x?/y?/width?`) are serialized by `serializeTranscript` with the same `additive` contract; no schema change. Load path: `useTranscriptPersistence` (wave 2) uses the same AppService file API, warn-not-throw.

**R9 — Tests inventory (binding gate).** Existing 121 campaign tests must remain green. New tests (per scout specs): `desk-canvas`: 9 cases (d2 §9); `workbench-guards`: budget/count/self-check; `desk-rail`: rail/intersection; `workbench-replay`: replay steps/reduced-motion/arrows; `workbench-pedagogy`: probe/teach-back; `professor-tags`: stripper variants (position rule + existing cases untouched). Plus the spatial-layout pure-function tests (`deskCanvasLayout` or in `desk-canvas.test.ts`). The round-2 re-review gate is a SUBSET: 3 questions (stripper/claim/replay) + regression sweep; after writer waves complete, a FULL audit re-review (all 11+ suites) is required before owner dogfood.

**R10 — Wave order (e4, binding).** After the audit: writer wave A (folded papercuts + placement-field activation + `isWritablePoint`) → B (spatial-professor clusters + layout pure function) → C (ink layer + composer placement-at-point; if v1 skips freehand, only placed-text-anywhere). The audit (this file) closes; the queen launches writers with this plan. If the 7-day quota reset hasn't arrived, the queen implements A herself (papercuts are surgical: opaque sheet + shortcut gate + `isWritablePoint`); B/C are writer waves.

## Overlap resolution (resolved by R1–R9)

- e1 (user input) owns `deskGeometry.ts`, `DeskCanvas.tsx`, `useBookShortcuts.ts`.
- e2 (spatial professor) owns `workbenchChat.ts` (cluster tracking, layout call site, budget per cluster), `desk/spatialLayout.ts` (new pure file), `DerivationSlip.tsx` (cluster placement), `DeskCanvas.tsx` (render loop update).
- e3 (canvas model) owns `desk/deskGeometry.ts` updates (new pure functions), `.desk-canvas` scroll model, `useDeskStreaming` (placement option propagation to `sendTurn` L411–424), `DeskComposer` (already handles arbitrary point; no change beyond anchor logic), `desk.css` (sheet edge, column width pairing with rail `min-width: 560px`).
- No overlap: e2's `buildUserBlock` (workbenchChat) writes placement onto the user block; e3's `useDeskStreaming` reads it and passes it to `streaming.sendTurn`. The audit records this single handoff.

## Open questions (with recommendations for queen decision)

1. **Freehand drawing mode (v1 or v1.1).** The owner's vision (penecho) includes drawing; v1 pivot = placed text boxes + professor-drawn figures (SVG, no stylus/freehand layer). Recommendation: v1 = placed-text + spatial clusters (this campaign); v1.1 = freehand stroke capture (pen-echo proper) — add a `desk/freehand.ts` stroke-capture mode (pointer events, SVG path) with its own writer wave after v0.3.0 — but the user said pivot-now, not later. Since v1's `isWritablePoint` already supports click-anywhere and the column handles text/composer at any (x,y), v1 IS the spatial pivot for text; draw-mode is an additive v1.1 feature that does not block the core pivot.

2. **Cluster overlap with legacy blocks.** Recommendation: mixed transcripts (some placed, some legacy) render legacy blocks as today's centered column but positioned sequentially after the LAST placed cluster's bottom, preserving document order. This is what e3 §2 specifies; no conflict.

3. **Rail in spatial mode.** The rail (`desk-rail-*` class, hidden <560px via container query) stays fixed beside the scroll. Its `onOpenThread` scroll target is the cluster's anchor block id (same `scrollToBlock` mechanism). No change.

4. **Voice when clusters overlap vertically.** The voice focus law (narration owns audio) is unchanged; replay is per derivation, not per cluster. No change.

5. **Penecho guards adoption (from research PENECHO.md).** The bounded refinement loop (3-artifact budget, self-check stop, ±1 shelf clamp) was adopted in wave 2. No additional guard work needed for the pivot; the same limits apply per cluster. No change.

## Verification gates (binding before writer launch)

Before writer waves start:
- The folded papercuts (R2 + R3, surgical, no writer needed) pass: `desk.css` shows the opaque fallback; `useBookShortcuts` shows the gate; `isWritablePoint` exists in `deskGeometry`.
- The 12-suite regression sweep passes (`desk-canvas`, `desk-store`, `desk-sheet`, `desk-rail`, `workbench-chat`, `workbench-pedagogy`, `workbench-derivation`, `workbench-replay`, `workbench-guards`, `professor-tags`, `workbench-voice`, `professor-bridge`).
- tsc clean; biome clean; `grep -r 'WorkbenchTab' src/` = 0.

After writer waves complete (before owner dogfood):
- Full 12-suite sweep + any new pivot tests (`desk-canvas` expanded cases, spatial layout pure tests).
- Build (`build_palimpsest.sh --bundle`) produces a clean `.dmg`; install + smoke checklist (`docs/campaign/INTEGRATION_SMOKE.md`) passes interactively (owner runs the 12-point tour updated for the spatial surface).
- Only then: `v0.3.0` tag + CI DMG.
