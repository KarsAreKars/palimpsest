# D4 — Integration Audit: the queen's merge plan (The Desk)

**Campaign:** The Desk — workbench 3.0 (`docs/DESK_CAMPAIGN.md`, owner-approved 2026-09-15).
**Vision:** `docs/vision/THE_DESK.md`.
**Lanes audited:** `d1-sheet-host.md` (sheet host + chrome), `d2-canvas-composer.md` (canvas model + composer + persistence), `d3-inplace-rail-25.md` (professor-in-place + traffic-light rail + folded 2.5).
**Method:** every claim below was re-verified against the tree this sitting (2026-09-16). Line numbers were measured, not trusted — where a lane spec's anchor drifted, the corrected anchor is given in §1. This document is the binding merge plan: rulings are written to be applied verbatim.

---

## 0. Headline rulings (read these first)

1. **WorkbenchTab.tsx is not renamed and not kept — it is *harvested, then deleted*.** D1's plan to lazy-mount it inside DeskSheet is the wave-1 interim only; d3's `blockBody.tsx` extraction and d2's `DeskCanvas` supplant it, and wave 3 deletes `WorkbenchTab.tsx` outright (R1, R16).
2. **There is exactly one desk stylesheet** — `apps/readest-app/src/app/reader/components/desk/desk.css` — and exactly one desk module directory — `components/desk/`. D2's `notebook/desk/DeskSheet.css` and d3's `DeskRail.css` fold into it (R7).
3. **D3 §A.4's "blocks with placement fields render absolutely at (x,y)" is void.** Constitution product default 3 + d2 §4 rule: v1 stores the fields and ignores them in layout (R2).
4. **Two whole code regions have no owner in any of the three specs** — the voice-player wiring (`WorkbenchTab.tsx:427–505`) and the start-session/bridge-seed/empty-state block (`WorkbenchTab.tsx:622–662` + empty state). The audit assigns both (R5, R6). A spec gap, not a nice-to-have: deleting WorkbenchTab without them loses the professor's voice and the bridge handoff.
5. **workbenchChat.ts has two writers, in strict order** — d2's placement fields first is *not* required; the guards (d3) and the fields (d2) are disjoint, and the chosen wave order (d3 → d2) is legal because the only cross-dependency (d3's test case 10 on placement fields) is deleted as redundant (R8, R9).

---

## 1. FILE-TOUCH AUDIT

### 1.1 Files d1 names

| File | Exists | Verified current state (measured anchors) | Importers | Audit verdict |
|---|---|---|---|---|
| `apps/readest-app/src/store/deskStore.ts` | ✗ new | — | DeskSheet, DeskToggler | **New, writer D1, wave 1.** Source printed in d1 §2 is adopted verbatim. |
| `apps/readest-app/src/app/reader/components/DeskToggler.tsx` | ✗ new | — | HeaderBar | **New, writer D1, wave 1.** `LuLampDesk` verified exported from the installed `react-icons/lu` (package.json pins `^5.4.0`, not the "5.6.0" d1 §3 claims — harmless). |
| `apps/readest-app/src/app/reader/components/HeaderBar.tsx` (357 lines) | ✓ | `<NotebookToggler bookKey={bookKey} />` at **HeaderBar.tsx:315** inside `.header-tools-end` (**L314**); `HeaderBarProps` carries `bookKey` (L36-45) ✓ | ReaderContent | **Writer D1, wave 1.** One-line insertion before L315, exactly as d1 §3. |
| `apps/readest-app/src/app/reader/components/desk/DeskSheet.tsx` | ✗ new | — | BooksGrid | **New, writer D1, wave 1; edited by writer D2, wave 3** (stage mount swap, stage overflow, rail mount, Esc interceptor — R1, R3, R12). Sequential two-writer, legal per s6 precedent. |
| `apps/readest-app/src/app/reader/components/desk/desk.css` | ✗ new | — | DeskSheet | **New, writer D1, wave 1; appended by D2 (wave 3) and D3 (wave 2)** — canvas/composer/rail/replay blocks. Appends only. |
| `apps/readest-app/src/app/reader/components/BooksGrid.tsx` (388 lines) | ✓ | gridcell at L148; `slideRef` wrapper opens **L177**, closes ~L262; `<BookmarkPullDown …/>` at **L263** (d1 says 266 — drift 3); `sideBarBookKey` consumed at L296 | ReaderContent | **Writer D1, wave 1.** Mount after the slideRef wrapper's closing `</div>`, before BookmarkPullDown; `{bookKey === sideBarBookKey && <DeskSheet …/>}` — `sideBarBookKey` already in scope via `useSidebarStore` at L296 ✓. |
| `apps/readest-app/src/store/notebookStore.ts` (67 lines) | ✓ | `export type NotebookTab = 'spine' \| 'notes' \| 'study' \| 'workbench'` at **L5** (d1 says L4 — drift 1); `setNotebookActiveTab` L57 | Notebook, NotebookTabNavigation | **Writer D1, wave 1.** Union loses `'workbench'`; nothing else changes (verified: no workbench-specific state in the store). |
| `apps/readest-app/src/app/reader/components/notebook/NotebookTabNavigation.tsx` (124 lines) | ✓ | `const tabs: NotebookTab[] = ['spine','notes','study','workbench']` at **L26** (d1 says 25 — drift 1); `case 'workbench'` arms at L36 (label) and L51 (icon) | Notebook | **Writer D1, wave 1.** Delete both arms + tab entry; append the history clause to the L24 comment. |
| `apps/readest-app/src/app/reader/components/notebook/Notebook.tsx` (607 lines) | ✓ | `lazy(() => import('./WorkbenchTab'))` **L48** ✓; `WorkbenchFallback` L50-62 ✓; `DeskErrorBoundary` L65-84 ✓; render branch **L505-511** ✓; persisted-tab restore **L150-152** ✓ | ReaderContent | **Writer D1, wave 1.** Delete L48, L50-62, L65-84, branch L505-511; apply the three-tab guard at L150-152 exactly as d1 §7.3. |
| `apps/readest-app/src/__tests__/reader/desk-store.test.ts` | ✗ new | — | — | **New, writer D1, wave 1** (d1 §10.1 verbatim). |
| `apps/readest-app/src/__tests__/reader/desk-sheet.test.ts` | ✗ new | — | — | **New, writer D1, wave 1** (d1 §10.2; stub `../notebook/WorkbenchTab` — in wave 1 that import is the *real* desk body, so the stub mocks the lazy import path as specced). |

**Verified d1 read-only citations:** Reader.tsx z-index guide L30-46 ✓ (exact); `useShortcuts` input guard (`INPUT`/`TEXTAREA`/contentEditable skip) at useShortcuts.ts:41-51 ✓; Notebook.tsx:133 `useShortcuts({ onEscape })` ✓; `useTranslation` interpolation — **confirmed**: `TranslationFunc = (key: string, options?: Record<string, number | string>) => string` (useTranslation.ts:6), i18next `{{var}}` interpolation — d1 open question 5 is **closed: ` _('Page {{page}}', { page })` works, no fallback needed**. `parseTranscript` ignores unknown keys structurally ✓. No `deskStore`/`DeskSheet`/`DeskToggler` exists anywhere yet (grep-verified).

### 1.2 Files d2 names

| File | Exists | Verified current state | Importers | Audit verdict |
|---|---|---|---|---|
| `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` (511 lines) | ✓ | **Every d2 anchor exact:** `TranscriptBlock` L69 ✓; `WORKBENCH_TRANSCRIPT_FILENAME` L124 ✓; `TRANSCRIPT_VERSION = 1` L126 ✓; `newBlockId` L137 ✓; `latestConceptMap` L236 ✓; `resolveConceptThreads` L241 ✓; `derivationOrdinal` L264 ✓; `commitProfessorBlock` L281 ✓; diagram branch L309-315; derive branch L316-349; `associateLearnerStep` L355 ✓; `serializeTranscript` L417 ✓; `isBlock` L428 (**not exported** — d2 needs no export ✓); `parseTranscript` L440 ✓; store `appendBlock` L460-476 ✓; `isProbeSignal` L224 ✓ | WorkbenchTab.tsx; `__tests__/notebook/workbench-chat.test.ts` | **Writer D2, wave 3** (placement fields + `sanitizePlacement` + `buildUserBlock`) — see R8. |
| `apps/readest-app/src/app/reader/components/notebook/desk/deskGeometry.ts` | ✗ new | — | — | **New, writer D2, wave 3 — path amended to `components/desk/deskGeometry.ts`** (R7). |
| `…/notebook/desk/useDeskStreaming.ts` | ✗ new | — | — | **New, writer D2, wave 3 — path amended to `components/desk/useDeskStreaming.ts`; extraction range amended to L622-820 + bridge seed** (R6). |
| `…/notebook/desk/useTranscriptPersistence.ts` | ✗ new | — | — | **New, writer D2, wave 3 — path amended to `components/desk/useTranscriptPersistence.ts`** (R7). Port of load effect L974-1004 / save effect L1006-1023 ✓ (verified verbatim above). |
| `…/notebook/desk/DeskCanvas.tsx` | ✗ new | — | DeskSheet (wave 3) | **New, writer D2, wave 3 — path amended to `components/desk/DeskCanvas.tsx`** (R7). |
| `…/notebook/desk/DeskComposer.tsx` | ✗ new | — | DeskCanvas | **New, writer D2, wave 3 — path amended to `components/desk/DeskComposer.tsx`** (R7). |
| `…/notebook/desk/DeskSheet.css` | ✗ new | — | — | **Void — folded into `components/desk/desk.css`** (R7). |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx` (1490 lines) | ✓ | see §1.4 | Notebook.tsx (lazy) | **Writer D3, wave 2 (BlockBody swap; byte-identical DOM); writer D2, wave 3 (deletion).** Sequential, legal. |
| `apps/readest-app/src/__tests__/notebook/desk-canvas.test.ts` | ✗ new | — | — | **New, writer D2, wave 3** (d2 §9 cases 1-9). |

**Verified d2 read-only citations (all measured):** `PIN_THRESHOLD_PX = 24` L91 ✓; `PLACEHOLDER_DELAY_MS = 400` L94, `THINKING_DELAY_MS = 3000` L96 ✓; `prefersReducedMotion()` L104 ✓; `beginStream` L527, `streamCallbacks` L549, `commitPartialIfAny` L600 ✓; `respond` L783 ✓; `send` L822 ✓; `handleComposerKey` L872 ✓; `spliceAtCaret` L907 ✓; `folioOpen` L901 ✓; `handleMathPopoverKey` L947 ✓; load effect L974 ✓; save effect L1006 ✓; `scrollRef` L1025, `pinned` L1028, `atBottom` L1031, `handleScroll` L1057, `scrollToBottomAndRepin` L1073, width-drag ResizeObserver L1085, follow effect L1105 ✓; `quoteForPage` L1136, `goToPage` L1161, `scrollToBlock` L1179-1185 ✓; `renderContent` L1187 ✓; math popover render **L1418-1461** (d2 says 1415-1450 — drift); `.wb-composer-wrap` **L1417**, `.wb-composer` **L1463-1484** (d2 says composer 1456-1484 — drift 7). MathLive popover markup and composer markup confirmed identical to d2's quotes. `HISTORY_BLOCK_LIMIT = 12` workbenchSession.ts:90 ✓ (d2's no-virtualization cost argument stands). `sendWorkbenchTurn` workbenchSession.ts:480 ✓ — d2's "unchanged" ruling confirmed compatible.

### 1.3 Files d3 names

| File | Exists | Verified current state | Importers | Audit verdict |
|---|---|---|---|---|
| `apps/readest-app/src/app/reader/components/notebook/blockBody.tsx` | ✗ new | — | WorkbenchTab (wave 2), DeskCanvas (wave 3) | **New, writer D3, wave 2.** Path kept as d3's (`notebook/`, beside the slips it composes). Gains `VoiceControl` + `VoiceControlProps` export (R5, R11). |
| `apps/readest-app/src/app/reader/components/notebook/DeskRail.tsx` | ✗ new | — | DeskSheet (mounted wave 3) | **New, writer D3, wave 2; mount line written by D2, wave 3** (R3). |
| `apps/readest-app/src/app/reader/components/notebook/DeskRail.css` | ✗ new | — | — | **Void as a separate file — folded into `components/desk/desk.css`** (R7); class names fixed by d3 §B.5 stand. |
| `apps/readest-app/src/app/reader/components/notebook/DerivationSlip.tsx` (90 lines) | ✓ | default export `{ block, ordinalBase, check?, compact? }` ✓; steps map L52-70 ✓; `wb-step-row`/`wb-goal-line` ✓; no scroll/store/streaming imports ✓ | WorkbenchTab.tsx | **Writer D3, wave 2** (replay, ~30 additive lines). |
| `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` | ✓ | see §1.2 | — | **Writer D3, wave 2** (`buildDeskRail` + types; `MAX_ARTIFACT_BLOCKS_PER_EXCHANGE`, `professorArtifactCount`, `artifactBudgetSpent`; C2.ii commit-time sanitize branch; `clampConceptShelves` + wire-in at **L297-299** ✓). Then writer D2, wave 3 (placement fields) — see R8. |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.css` (607 lines) | ✓ | `.wb-stage` L13, `.wb-transcript` L18, `.wb-nib` L238 + `@keyframes wb-nib-blink` L248, `.wb-scroll-chip` L278/L305, `.wb-composer-wrap` L415, `.wb-composer` L420, `.wb-math-popover` L483, `@container (max-width: 239px)` L539, reduced-motion L583 ✓ | WorkbenchTab.tsx | **Writer D3, wave 2** (append `.wb-replay-*` block). **Wave 3: renamed, not deleted** (R16). |
| `apps/readest-app/src/services/professor/prompt.ts` (158 lines) | ✓ | addendum + `PROFESSOR_WORKBENCH_SYSTEM_PROMPT` | workbenchSession.ts | **Writer D3, wave 2** — two additive sentences (C2.i, C2.iii). |
| `apps/readest-app/src/__tests__/notebook/workbench-guards.test.ts` | ✗ new | — | — | **New, writer D3, wave 2** (cases 1-5). |
| `apps/readest-app/src/__tests__/notebook/desk-rail.test.ts` | ✗ new | — | — | **New, writer D3, wave 2** (cases 6-7). |
| `apps/readest-app/src/__tests__/notebook/workbench-replay.test.ts` | ✗ new | — | — | **New, writer D3, wave 2** (cases 8-9). |

**Verified d3 read-only citations:** `VoiceControl` at **L305-425** (d3 says L206-422 — L206 is `ProbeRow`; drift); `ProbeRow` L206, `ConceptMapSlip` L240, `ConsultMark` L286, `PageChip` L178, `BlockChips` L142, `splitPageCites` L125 — all inside WorkbenchTab.tsx, all props+`_()` only ✓ (A.1's "movable verbatim" verified); block-body JSX L1230-1316 ✓; streaming article L1319-1343 ✓; rail reuse strings all exist: `KNOWN`/`EDGE`/`UNKNOWN` L246-248, `The catalogue so far` L252, `Nothing filed here yet` L258, `Open the thread on {{concept}}` L266 ✓. Voice player wiring **L427-505** (`voiceRef` L427, `getVoicePlayer` L435, `handleVoiceSpeak` L466, `handleVoiceReplay` L476) — **ownerless in all three specs; assigned by R5**. Bridge seed effect **L641-662** (`WORKBENCH_BRIDGE_EVENT` listener, `seedAndStart`) and `startSession` **L622-636** + empty state (`.wb-empty`, `Start a session` button, L1368-1384) — **ownerless; assigned by R6**.

### 1.4 WorkbenchTab.tsx — the god file's fate (arbitrated)

Verified landmarks (measured this sitting): constants L91-96; shared components L125-425; voice wiring L427-505; streaming/turn machinery L505-817; composer + math popover state L819-972; persistence effects L974-1023; scroll policy L1025-1134; page cite + block scroll L1136-1185; render loop L1187-1386; math popover + composer render L1417-1484.

**Ruling (verbatim):** `WorkbenchTab.tsx` is harvested in two passes and **deleted in wave 3**. Wave 2 (D3) extracts the per-block body into `blockBody.tsx` (`BlockBody`, `StreamingBody`, `renderContent`, and — per R5 — `VoiceControl` + `VoiceControlProps`) and refactors the tab's render loop to `<BlockBody …>`/`<StreamingBody …>` with byte-identical output DOM (same `wb-block`, `data-bid`, bylines, sep). Wave 3 (D2) extracts `useDeskStreaming` (extended range per R6), `useTranscriptPersistence`, `useDeskVoice` (R5), `buildUserBlock` (workbenchChat), deletes `WorkbenchTab.tsx`, and points DeskSheet's stage at `DeskCanvas`. **The file is not renamed, not kept as a sittings log, and no new "Desk component" supersedes it wholesale — its extracted pieces are the Desk.** This resolves the d1-vs-d2/d3 overlap: d1 §4.1's `<WorkbenchTab>` mount is wave-1 scaffolding; d1 §7.4's "WorkbenchTab.tsx untouched" is amended by this ruling (untouched through wave 1 only).

### 1.5 Files nobody may touch (all three specs agree; confirmed load-bearing)

`workbenchSession.ts` (`sendWorkbenchTurn` L480 stateless/render-blind), `MathField.tsx` (`next/dynamic ssr:false` hard rule), `professorTags.ts` (R2 regex from the 2.x audit stands — the Desk adds no tag), `diagramSvg.ts`, `wbShared.tsx`, `mathCheck.ts`, `DiagramSlip.tsx` (render-time sanitize stands; C2.ii is commit-time, additive), `workbench-transcript.json` shape (`version` stays **1** — verified L126).

---

## 2. CONTRACT CONFLICTS — and the ruling for each

### R1. What DeskSheet's stage mounts — WorkbenchTab (d1) vs DeskCanvas (d2/d3)

**Conflict:** d1 §4.1 lazy-mounts `WorkbenchTab` inside DeskSheet and calls it the permanent re-host; d2 §4-7 builds `DeskCanvas` with its own scroll container, tail, click-to-place, and floating composer (WorkbenchTab's pinned composer would be dead weight inside it); d3 §A.2 says DeskSheet mounts `BlockBody`/`StreamingBody` directly. Three incompatible pictures of the same `<div>`.
**Ruling (verbatim):** **Three states, one trajectory.** Wave 1: DeskSheet's stage lazy-mounts `WorkbenchTab` exactly as d1 §4.1 prints (the Desk works on day one; the error boundary + `_('This desk is being restored.')` move with it verbatim). Wave 2: WorkbenchTab's body is extracted to `blockBody.tsx`; DeskSheet still mounts WorkbenchTab — invisible change. Wave 3: DeskSheet's stage mounts `<DeskCanvas bookKey={bookKey} />` (inside the same `DeskErrorBoundary`/Suspense shell, which stays in DeskSheet), DeskRail is mounted beside it (R3), and `WorkbenchTab.tsx` is deleted. Writer D2 edits DeskSheet.tsx in wave 3; the lazy `WorkbenchTab` import is replaced by a static import of DeskCanvas (static is safe — DeskCanvas is code-split by nothing and its heavy leaves, KaTeX/Streamdown, arrive via `blockBody` exactly as they did via WorkbenchTab).

### R2. Placement-field consumption — d3 §A.4 contradicts the constitution

**Conflict:** d3 §A.4: "a block **with** [the fields] renders absolutely at `(x, y)` with the given `width`." d2 §2.1/§4: v1 stores `x`/`width` and ignores them; `y` is an insertion hint only. Constitution product default 3 is binding ("single fluid column v1 — `(x,y)` fields are specced additively so freeform can arrive later").
**Ruling (verbatim):** **d2/constitution wins; d3 §A.4 is amended to:** "a block without the fields renders in the fluid column; a block with them *also* renders in the fluid column in v1 — the fields persist (`x`, `width` ignored; `y` retained as the commit-time insertion hint per d2 §2.1) so the freeform release is renderer-only, no migration." D3's writer applies this amendment to §A.4 when writing wave 2; no code in wave 2 consumes the fields.

### R3. Scroll-follow and rail anchoring — who owns the scroll element

**Conflict:** d1 §4.1 gives `.desk-stage` `overflow-y-auto` (it scrolls); d2 §5 makes `.desk-canvas` the scroll container with the pinned-follow machinery; d3 §B.4 has DeskSheet providing `onOpenThread` that queries "the sheet's scroll element"; d2 §13 Q1 leaves the rail/column offset open.
**Ruling (verbatim):** **`.desk-canvas` (DeskCanvas) is the single scroll owner.** (a) d1's `.desk-stage` loses `overflow-y-auto` in wave 3 — it becomes `overflow: hidden` flex filler; the class remains the positioning context for the rail. (b) DeskCanvas owns: `scrollRef`, `pinned`/`growth` state, `shouldFollow`, the 24px pin, the smooth-glide/instant-token policy, the width-drag re-anchor, mount/rest-at-bottom, `scrollToBlock`, and the `wb-scroll-chip`. (c) `DeskRail` mounts inside DeskSheet's stage, absolutely positioned (d3 §B.5 verbatim), and receives `onOpenThread` **wired to DeskCanvas's `scrollToBlock`** — DeskCanvas exposes it via `useImperativeHandle` on a forwarded ref typed `DeskCanvasHandle { scrollToBlock: (id: string) => void }`; DeskSheet holds the ref and passes the callback to the rail. The rail mount line lands in wave 3 (writer D2), not wave 2 — in wave 2 there is no reachable scroll root (WorkbenchTab owns its `scrollRef` privately at L1025). DeskRail.tsx + `buildDeskRail` + tests still land in wave 2, shipped unmounted. (d) Column offset: `.desk-sheet { container-type: inline-size; }` (added to desk.css, wave 1), `.desk-canvas { padding-inline-start: 120px; }` inside `@container (min-width: 560px)` — the rail's `@container (max-width: 559px) { .desk-rail { display: none } }` (d3 §B.5) and this padding are two halves of one gate and must use the same 560px breakpoint. The 720px measure is unaffected (`.desk-column { margin-inline: auto }` centers in the remaining space). RTL: `inset-inline-start`/`padding-inline-start` flip automatically — no extra rule.

### R4. Who owns `send()` — d2's extraction vs d3's "sheet host's copy"

**Conflict:** d2 §3 extracts `buildUserBlock` and §7.4 extracts `useDeskStreaming`, while saying "WorkbenchTab keeps its own inline copies (this campaign does not regress the sidebar path before the tab is removed)"; d3 §A.3 says the streaming machinery "moves with the sheet host's copy … copied verbatim." One machinery, two homes, plus a duplicate to protect a sidebar that d1 deletes in wave 1.
**Ruling (verbatim):** **One extraction, no copies.** `useDeskStreaming.ts` (d2 §7.4) is the single home of `beginStream`/`streamCallbacks`/`respond`/`runSilentCheck`/`commitPartialIfAny` (verbatim port, L527-817); `buildUserBlock` (d2 §3) is the single commit path, called by DeskComposer only. d2 §7.4's "WorkbenchTab keeps its own inline copies" is **void** — the sidebar path is removed in wave 1 (constitution default 1), so there is nothing to regress; d3 §A.3's "sheet host's own instance" reads as "DeskCanvas instantiates `useDeskStreaming(bookKey)` once" — the component-local rule (streaming state never in the zustand store, workbenchChat.ts header) is preserved by the hook returning everything from `useState`/`useRef` inside the desk subtree.

### R5. GAP — the voice player has no owner

**Conflict (vacuum):** `WorkbenchVoicePlayer` wiring (`WorkbenchTab.tsx:427-505`: `voiceRef`, `getVoicePlayer`, `voiceState`, `voiceActiveId`, `voiceNotice`, `handleVoiceSpeak`, `handleVoiceReplay`) is named by no file-touch list. D3's `BlockBody` takes `voice: VoiceControlProps` — props that someone must build. D2's `useDeskStreaming` range (L640-820) excludes voice. Delete WorkbenchTab without this and the professor goes silent.
**Ruling (verbatim):** **New file `apps/readest-app/src/app/reader/components/desk/useDeskVoice.ts`, writer D2, wave 3.** A hook `useDeskVoice(bookKey): { voicePropsFor: (b: TranscriptBlock) => VoiceControlProps; stop: () => void }` — a verbatim port of L427-505, lazily constructing the `WorkbenchVoicePlayer` per desk mount (the s4 precedence law is unchanged: `voice-busy` refusal, `unit-change` instant yield, stop-on-new-turn). DeskCanvas calls `voicePropsFor(b)` per block and `stop()` as the first statement of its send path. **R11 amends d3 §A.2:** `VoiceControl` moves into `blockBody.tsx` as a named export with `export interface VoiceControlProps { block; playerState; notice; speaking; onSpeak; onPause; onResume; onReplay; onDismissNotice }` — **nine props** (d3 says "the 8 props"; the count is wrong — `block, playerState, notice, speaking, onSpeak, onPause, onResume, onReplay, onDismissNotice`, WorkbenchTab.tsx:305-316). WorkbenchTab re-imports it until wave 3.

### R6. GAP — startSession, bridge seed, and the empty state have no owner

**Conflict (vacuum):** `startSession` (L622-636), the bridge-seed effect (L641-662, the 2.x audit R7b hook listening for `WORKBENCH_BRIDGE_EVENT`), `NoKeyGuidance`, and the `.wb-empty` start-session UI (L1368-1384) are named by no spec. D2's `useDeskStreaming` range starts at L640, excluding `startSession`; d3 open question 5 *notices* the empty state but assigns it to no writer.
**Ruling (verbatim):** **Writer D2, wave 3, extends the extraction.** `useDeskStreaming`'s port range becomes **L622-817** (adding `startSession` and the bridge-seed effect verbatim, retry ref and all), and DeskCanvas renders the empty-sheet state: `.wb-empty` markup, `stamp-btn` `_('Start a session')`, `NoKeyGuidance`, and the resume notice (moved from the transcript head to the canvas head, same classes). The professor's "take it to the desk" plate therefore keeps working end-to-end after WorkbenchTab is gone — this is a campaign verification gate (header toggle → place a box → professor answers), and the seed hook is its front door.

### R7. One stylesheet, one directory

**Conflict:** three new CSS files in two trees — d1 `components/desk/desk.css`, d2 `components/notebook/desk/DeskSheet.css`, d3 `components/notebook/DeskRail.css`; and two module trees (`components/desk/` vs `components/notebook/desk/`).
**Ruling (verbatim):** **One desk stylesheet:** `apps/readest-app/src/app/reader/components/desk/desk.css` (d1's path, unlayered, `desk-` prefix). Wave 1 writes the sheet/scrim/chrome/focus/reduced-motion blocks (d1 §5.3 verbatim). Wave 2 appends the `.wb-replay-*` block to `WorkbenchTab.css` (its correct home — DerivationSlip survives the campaign; see R16). Wave 3 appends d2 §12 (`.desk-canvas`, `.desk-column`, `.desk-tail`, `.desk-caret`, `.desk-composer*`) and d3 §B.5 (`.desk-rail*`, with the R3(d) breakpoint pairing) into `desk.css`. **One desk module directory:** `components/desk/` holds DeskSheet.tsx, desk.css, DeskCanvas.tsx, DeskComposer.tsx, deskGeometry.ts, useDeskStreaming.ts, useTranscriptPersistence.ts, useDeskVoice.ts. Exceptions: `blockBody.tsx` and `DeskRail.tsx` stay at d3's `notebook/` paths (they import the slips/`wbShared` siblings). All d2 path mentions of `notebook/desk/` are amended accordingly; d2's file `DeskSheet.css` is void.

### R8. workbenchChat.ts — two writers, ordered

**Conflict:** d2 (placement fields on `TranscriptBlock`, `sanitizePlacement`, `buildUserBlock`) and d3 (`buildDeskRail` + `DeskShelf`/`DeskRailEntry`, C2 guards, `clampConceptShelves`) both edit `workbenchChat.ts`.
**Ruling (verbatim):** **Legal, sequenced, disjoint.** Writer D3 edits the file in **wave 2** (all additions below the store section or inside `commitProfessorBlock`'s body — L281-353 — and the interface only if a doc comment is needed; no field changes), writer D2 edits it in **wave 3** (appending `x?/y?/width?` to the `TranscriptBlock` interface immediately after `voice`, ~L122, plus `sanitizePlacement` beside `isBlock` and `buildUserBlock` beside `associateLearnerStep`). The hunks do not overlap; the s6 precedent (two writers, one file, A→C) applies. The wave order is D3→D2 (not d2-first): nothing in wave 2 consumes placement fields, and the only d2-before-d3 test dependency (d3's case 10) is removed by R9.

### R9. Duplicate placement round-trip test

**Conflict:** d3 test case 10 (placement round-trip + old-file loads) duplicates d2 §9 cases 1-2 nearly verbatim, but places half of it in `workbench-chat.test.ts` — a suite s6 explicitly kept un-extended.
**Ruling (verbatim):** **Placement round-trip lives only in `desk-canvas.test.ts` (d2 §9 cases 1-2). `workbench-chat.test.ts` is NOT extended this campaign** — no case 10. D3's writer drops case 10 from the wave-2 brief.

### R10. Desk Esc vs composer Esc

**Conflict:** d1 §6.1: Escape anywhere (except inputs) dismisses the whole desk. d2 §7.2: Escape dismisses the composer. The `useShortcuts` input guard (verified useShortcuts.ts:41-51) covers the textarea only — the composer's ƒx and commit buttons are `BUTTON`s, so with composer open and focus on a button, d1's ruling would nuke the desk (and the typed text) instead of closing the composer.
**Ruling (verbatim):** **DeskComposer's root `onKeyDown` handles Escape whenever the composer is not `idle`, and calls `event.stopPropagation()`.** Keydown bubbles target→window, so the stop prevents DeskSheet's `useShortcuts` window listener from firing; the desk stays open, the composer closes per d2 §7.1's DISMISS contract. DeskSheet's Esc path is reachable only when the composer is `idle`. Accepted edge: composer open with text + focus moved outside the composer (e.g. a rail chip) + Esc → the desk dismisses and the text is lost (d2's DISMISS clears text). Carried as open question 3; v1 accepts it.

### R11. VoiceControl prop count

**Ruling (verbatim):** **Nine props** — d3 §A.2's "the 8 props" is corrected; `VoiceControlProps` is the nine-member interface in R5. Everything else in d3 §A.2 stands (the `BlockBody` signature verbatim, `resumeFirst: i === 0 && !resumeNotice`, `data-bid` preserved as the scroll anchor — verified `scrollToBlock` queries `article[data-bid="${id}"]` at L1179-1185).

### R12. Rail aria/strings and "amber"

**Ruling (verbatim):** All four rail strings are **reuse**, verified present (WorkbenchTab.tsx:246-266) — d3 §B.6 stands; zero new rail strings. The edge shelf tone is **`--muted`** (d3's recommendation); the campaign's "amber/muted" resolves to muted because the Antiquarian Catalogue has no amber and stamp is the sole accent (`apothecary.css:46`, `--sage` L47 secondary) — flagged for the owner at the review gate, not a blocker.

### R13. D1 open questions — audit disposition

1. Exit animation (instant unmount): **confirmed for v1** (d1's own ruling stands; add `isClosing` later if dogfood asks).
2. Scrim 82%: **confirmed**, single token, review gate tunes within 78-86%.
3. Notebook-over-desk: **confirmed** (pinned notebook above the desk is a feature; transcript lives only on the desk).
4. Mobile full-area: **confirmed v1**.
5. `{{page}}` interpolation: **closed — supported** (useTranslation.ts:6; see §1.1).

### R14. D2 open questions — audit disposition

1. Rail/column offset: **closed by R3(d)** (120px padding, 560px container gate).
2. Folio pair mode in the floating composer: **confirmed reachable** — `folioOpen` derives from `blocks` + `mathValue` (L901), both available to DeskComposer via the same store read; the step/justify pair markup ports verbatim from L1431-1448.
3. Resume resting position: **keep 2.x behavior** (rest pinned at bottom); flag at dogfood.
4. Placement units px: **confirmed**.

### R15. D3 open questions — audit disposition

1. Edge tone muted: **confirmed** (R12).
2. Rail below 560px hidden: **confirmed** (matches R3(d) breakpoint).
3. Budget = 3: **confirmed** (1-2 blocks/exchange today per `commitPartialIfAny` L600 + onDone; 3 keeps honest-paper commits).
4. Failed figure consumes budget: **confirmed** (penecho-faithful; the mute note `_('The figure would not hold its ink; the claim stands as words.')` is the librarian-voice escape hatch).
5. Tab removal timing: **closed by this audit** — removal is wave 1 (D1); the empty state moves in wave 3 (R6).

### R16. WorkbenchTab.css survives as `wb.css`

**Conflict:** d1 §7.4 says "WorkbenchTab.css stays where it is (imported by WorkbenchTab)" — but R1 deletes WorkbenchTab.tsx in wave 3, and the file carries every surviving `wb-` face (`wb-block`, `wb-chip`, `wb-derive`, `wb-step-row`, `wb-voice`, `wb-map`, the replay block from wave 2, …).
**Ruling (verbatim):** **Wave 3 renames `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.css` → `apps/readest-app/src/app/reader/components/notebook/wb.css`, content byte-identical, and `blockBody.tsx` gains `import './wb.css';`.** Zero class renames; the `wb-` grammar the desk reuses (d2 §4's "do not fork their faces") lives on. `WorkbenchTab.tsx` is the only deletion. The 2.x audit's god-file watch ends here: `wb.css` is frozen after the rename — new desk surface styles are `desk-` classes in `desk.css` only.

---

## 3. TOP 5 RISKS — with mitigations

**Risk 1 — The god file dies messily (extraction drift).**
`WorkbenchTab.tsx` is 1490 lines and four extraction targets (`blockBody`, `useDeskStreaming`+R6 range, `useTranscriptPersistence`, `useDeskVoice`) must port logic *verbatim* while the file is simultaneously refactored (wave 2) and deleted (wave 3). A one-line drift in `commitPartialIfAny` or the bridge seed breaks resume or the professor's front door silently.
*Mitigation:* extraction-before-deletion is the ordering law (R1); wave 2's byte-identical-DOM requirement is testable — the existing `workbench-chat.test.ts`/`workbench-pedagogy.test.ts`/`workbench-derivation.test.ts` suites are the tripwire (any behavior change in the tab's remaining path fails them); wave 3 deletes only after DeskCanvas's own suite (`desk-canvas.test.ts`) is green against the same store fixtures. Queen integration smoke explicitly exercises: resume an old sitting → send a turn → hear a voice block → bridge seed from the chat surface.

**Risk 2 — Scroll/jank on huge transcripts (the no-virtualization bet).**
D2 §5's measured decision (no virtualization; revisit at `scrollHeight > 200_000px` or `> 500` blocks) leaves v1 exposed on whole-subject murals: hundreds of KaTeX typeset blocks in one flow column. Virtualization wouldn't remove KaTeX cost, but layout/paint on a very tall flow is real.
*Mitigation:* (a) the revisit gate is written into `desk.css`/DeskCanvas as a code comment with the exact thresholds (d2 §5) — not a vague TODO; (b) a cheap, spec-legal middle step is available **additively** if dogfood shows jank: `.desk-block { content-visibility: auto; contain-intrinsic-size: auto 120px; }` (unlayered CSS, no markup change — queen may apply it during integration without a spec amendment, flagged to reviewers); (c) the follow/pin math (`shouldFollow`, 24px threshold) is pure and stays correct regardless. Do **not** virtualize in this campaign.

**Risk 3 — Focus contention: sheet vs book vs composer vs replay.**
Four focus claims meet on one surface: DeskSheet's Tab-cycle trap (d1 §6.2), DeskComposer's dialog (d2 §7.3), the folio replay's arrow-key scope (d3 C1.1), and the always-live book header (DeskToggler must stay reachable). Failure mode: the trap swallows Tab into the rail before the composer, or the desk dismisses while the composer holds text.
*Mitigation:* single owner law stands (campaign non-negotiable 8 — `deskStore.isDeskVisible` is the only visibility boolean; verified d1 §2 adds nothing else). R10 closes the Esc hole. Replay keys are focus-scoped by construction (d3 C1.1 — the `wb-replay` div owns ←/→; no global shortcuts anywhere). The trap's focusable collection (d1 §6.2) must query *within `sheetRef` only* — the book's chrome buttons above the sheet (z-10) are outside the sheet root and stay reachable without trap interference; queen verifies Tab from the rail's last chip cycles into the composer/sheet, never out into the header (header is a separate stacking context above the modal — acceptable: Esc returns focus to the toggle per d1 §6.2).

**Risk 4 — Voice player handoff (the unowned seam).**
The `WorkbenchVoicePlayer` instance is component-local today (L427). R5 re-homes it in `useDeskVoice`, but the s4 precedence law has a desk-specific gap: today narration-vs-workbench arbitration was tested with the tab mounted; on the desk the same arbitration must hold while the book ghost-sits beneath the scrim, and **stop-on-new-turn must fire on desk sends** or two voices speak at once.
*Mitigation:* R5 makes `stop()` the first statement of DeskCanvas's send path (same position `send()` has today, L826-829: `voiceRef.current?.stop()` then `commitPartialIfAny`). The narration side is untouched (`controller.ts` unit-change yield, s6 Risk 5) — it does not care which surface owns the workbench voice. Queen smoke: start narration → open desk → play a `[VOICE]` block → expect `voice-busy` refusal copy; then stop narration → play → send a new turn → expect audio cut. A regression here is P0 (campaign gate "figure speaks").

**Risk 5 — Migration of in-flight 2.x sessions.**
Three real in-flight states: (a) persisted `settings.globalReadSettings.notebookActiveTab: 'workbench'` from older builds — lands in the now-three-tab union (d1 §7.3 guard, verbatim); (b) `workbench-transcript.json` documents — version stays 1, placement fields additive, malformed placement stripped-not-rejected (d2 §2.2 — `sanitizePlacement` wired into `parseTranscript` L440); (c) a *torn* transcript write (crash mid-`writeFile`) — today's save is a full-file overwrite with `console.warn` on failure (L1006-1023), unchanged; a torn file parses as `null` → fresh sitting (existing behavior, honest paper, no data-loss regression introduced by the Desk).
*Mitigation:* all three are covered by existing d1/d2 spec text — the audit adds only the enforcement: `desk-canvas.test.ts` cases 2-3 pin (b); `desk-sheet.test.ts` mounts with a stubbed `notebookActiveTab: 'workbench'` settings fixture to pin (a) at the component boundary; (c) needs no new code but gets one assertion in `desk-canvas.test.ts` (`parseTranscript('{')` → `null` → desk renders the empty sheet). Campaign gate 8 ("old 2.x sidebar transcript still loads — it becomes the sheet's document") is the integration smoke for all of the above.

---

## 4. TEST INVENTORY

**New files (6):**

| # | Path | Wave | Owner | Contents |
|---|---|---|---|---|
| 1 | `apps/readest-app/src/__tests__/reader/desk-store.test.ts` | 1 | D1 | d1 §10.1 verbatim (closed/open/idempotent toggle; toggleElement registry). |
| 2 | `apps/readest-app/src/__tests__/reader/desk-sheet.test.ts` | 1 | D1 | d1 §10.2 verbatim: closed→null; store-driven open with title/page; single mount under double-open; Esc dismiss + focus return to registered toggle; Esc-in-textarea does not dismiss; Tab cycle trap; close button path. |
| 3 | `apps/readest-app/src/__tests__/notebook/workbench-replay.test.ts` | 2 | D3 | d3 cases 8-9: `replayRowState` ghost/active/hidden; `replayFramesGoal` + `REPLAY_GOAL_CLASS` ('wb-replay-goal') finale predicate. |
| 4 | `apps/readest-app/src/__tests__/notebook/workbench-guards.test.ts` | 2 | D3 | d3 cases 1-5: 4th-shape mute (folio+figure counted, prose free), budget reopen at learner block, figure stop condition (bad SVG → muted + budget consumed; real fixture passes), one-step shelf clamp (direct + through `commitProfessorBlock`). |
| 5 | `apps/readest-app/src/__tests__/notebook/desk-rail.test.ts` | 2 | D3 | d3 cases 6-7: `buildDeskRail` catalogue order + inert nulls + `null → []`; round-trip through `latestConceptMap` resolving latest block ids. |
| 6 | `apps/readest-app/src/__tests__/notebook/desk-canvas.test.ts` | 3 | D2 | d2 §9 cases 1-9: placement round-trip + idempotent re-serialize (**sole home — R9**); old transcript loads placement-less; malformed placement stripped; `buildUserBlock` parity (teach-back carry, probe signal, `extendsDerivation`, placement copy); `isTailPoint` hit-testing (inert inside block, below extent, empty sheet); composer reducer machine; `clampComposerPosition`; 24px `shouldFollow` boundary; tail-extent invariant vs `DESK_TAIL_MIN_VH = 0.45`. Plus the Risk 5(c) torn-file assertion. |

**Existing suites: NONE extended** (R9 deletes d3's case 10; s6's "workbench-chat.test.ts stays untouched" law carries).

**Suites that must stay green untouched (writer gates, all waves):** `workbench-chat.test.ts`, `workbench-derivation.test.ts`, `workbench-pedagogy.test.ts`, `services/professor-*.test.ts`, `mathcheck.test.ts`, `diagram-svg.test.ts` (d3 C2.ii case 4 reuses its REAL_FIGURE fixture by import or copy — copy, to keep suites independent).

**`_()` string tables (consolidated — new keys only; everything else verified as reuse):**

| Wave | New strings | Notes |
|---|---|---|
| 1 (D1) | `Open the Desk` · `Close the Desk` · `The Desk` · `Page {{page}}` | interpolation confirmed (R13.5). **Removed:** `Workbench` (tab label, with locale-table hygiene per d1 §7.5). |
| 2 (D3) | `Step through this folio` · `Back one step` · `Ahead one step` · `Frame the goal` · `Step {{n}} of {{total}}` · `Close the replay` · `The professor sets down his pen — one shape at a time.` · `The figure would not hold its ink; the claim stands as words.` | Replay + C2 guards. Rail: zero new (R12). |
| 3 (D2) | `Write on the sheet` · `Place your writing…` | `Write to the professor`, `Continue the argument…`, `Insert math`, `Compose math`, `Write an expression…`, `Why is this step allowed?…`, `Add to page`, `New writing below`, `Resumed your sitting with {{book}}`, `THE PROFESSOR`/`YOU` all verified existing. |

**CSS class contract (fixed names across waves):** `desk-sheet`, `desk-sheet-open`, `desk-scrim`, `desk-head`, `desk-stage`, `desk-canvas`, `desk-column`, `desk-tail`, `desk-caret`, `desk-composer`, `desk-composer-row`, `desk-rail`, `desk-rail-head`, `desk-rail-chip`, `desk-rail-known`, `desk-rail-edge`, `desk-rail-unknown`, `desk-rail-dim`; `wb-replay`, `wb-replay-btn`, `wb-replay-count`, `wb-replay-ghost`, `wb-replay-active`, `wb-replay-hidden`, `wb-replay-goal` (the `wb-` set frozen at rename — R16). No `@layer` anywhere; stamp `#8C3B22` sole accent; corners ≤ 2px; light-first with the existing `var(--*)` dark/eink flip.

---

## 5. SEQUENCING VERDICT — exact writer waves

The natural d1→d2→d3 numeric order is **rejected**: d2's DeskCanvas depends on d3's `blockBody` (it imports `BlockBody`/`StreamingBody`), and d2's mount swap depends on nothing d3 ships later. The correct order is **d1 → d3 → d2 → integration**.

**Wave 1 — Writer D1 (sheet host + chrome + tab removal).**
New: `deskStore.ts`, `DeskToggler.tsx`, `desk/DeskSheet.tsx`, `desk/desk.css`, `__tests__/reader/desk-store.test.ts`, `__tests__/reader/desk-sheet.test.ts`. Edits: `HeaderBar.tsx` (L315 insertion), `BooksGrid.tsx` (DeskSheet mount, L263 boundary), `notebookStore.ts` (union), `NotebookTabNavigation.tsx` (L26/36/51 deletions), `Notebook.tsx` (L48/50-62/65-84/505-511 deletions + L150-152 guard). DeskSheet's stage lazy-mounts **WorkbenchTab** (interim — R1). Add `container-type: inline-size` to `.desk-sheet` (R3(d)).
*Gate:* tsc + `pnpm vitest run src/__tests__/reader/desk-` + biome. *Rationale:* the Desk exists end-to-end from this wave (old workbench UI on the new sheet); the tab is gone immediately per constitution default 1, so no wave ever maintains two surfaces; every later wave has a live integration target.

**Wave 2 — Writer D3 (professor-in-place extraction + rail model + folded 2.5).**
New: `notebook/blockBody.tsx` (with `VoiceControl`/`VoiceControlProps` — R5/R11), `notebook/DeskRail.tsx` (shipped unmounted — R3(c)), `__tests__/notebook/workbench-replay.test.ts`, `workbench-guards.test.ts`, `desk-rail.test.ts`. Edits: `WorkbenchTab.tsx` (render loop → `BlockBody`/`StreamingBody`, byte-identical DOM), `DerivationSlip.tsx` (replay + 2 exported predicates), `workbenchChat.ts` (rail helper + guards + clamp), `WorkbenchTab.css` (append `.wb-replay-*`), `prompt.ts` (two additive sentences).
*Gate:* tsc + the three new suites + existing `workbench-*` suites green (byte-identical-DOM tripwire — Risk 1). *Rationale:* extraction must precede the canvas (DeskCanvas imports `blockBody`); guards/replay are self-contained and dogfood-able behind the wave-1 desk; the rail's data seam (`buildDeskRail`) is testable without a mount.

**Wave 3 — Writer D2 (canvas model + composer + persistence + the harvest).**
New: `desk/deskGeometry.ts`, `desk/useDeskStreaming.ts` (range L622-817 + bridge seed — R6), `desk/useTranscriptPersistence.ts`, `desk/useDeskVoice.ts` (R5), `desk/DeskCanvas.tsx`, `desk/DeskComposer.tsx`, `__tests__/notebook/desk-canvas.test.ts`. Edits: `workbenchChat.ts` (placement fields + `sanitizePlacement` + `buildUserBlock` — R8), `desk.css` (canvas/composer/rail appends — R7), `DeskSheet.tsx` (stage mounts `DeskCanvas` + `DeskRail`; `.desk-stage` overflow fix; `DeskCanvasHandle` ref wiring — R1/R3), `Notebook.tsx`-adjacent nothing. **Deletions: `WorkbenchTab.tsx`; rename `WorkbenchTab.css` → `notebook/wb.css` with `blockBody.tsx` importing it (R16).**
*Gate:* tsc + `desk-canvas.test.ts` + all surviving suites green. *Rationale:* every extracted piece now has a consumer; deletion happens only after the replacement is green against the same fixtures; one writer performs harvest+swap+delete in a single coherent diff, so the tree never holds a half-migrated desk.

**Integration — the queen.** Full build → install → the campaign's smoke sequence verbatim: open Desk from header → place a box (click-to-place, Enter sends) → professor answers in place (streaming nib at the tail) → derivation folio replays step-by-step (`Step through this folio`) → figure speaks (Risk 4 arbitration sequence) → rail shows g/y/r and a chip jumps its thread → Esc returns to the book, page intact, focus on the toggle → old 2.x sidebar transcript loads as the sheet's document → bridge seed from the chat surface starts a sitting on the desk. Then the review loop (3 reviewers, Desk + folded 2.5 scope, ≤3 rounds) → owner dogfood → `v0.3.0`.

---

## 6. Open questions left for the queen (none blocking)

1. Composer text loss on stray Esc (R10 edge): composer open + focus outside it + Esc drops typed text with the desk. *Audit: v1 accepts; if dogfood complains, the fix is a `beforeunload`-style confirm or keeping text on unmount — one line in DeskComposer.*
2. `content-visibility` jank mitigation (Risk 2b): pre-authorized for queen application during integration if dogfood shows scroll jank; flag in review notes either way.
3. Rail edge tone muted vs a one-off amber (R12): owner call at the review gate. Recommend muted.
4. Resume resting position (R14.3): rest pinned at bottom (2.x behavior) vs first un-graded turn for the mural — dogfood.
5. D2's desk-composer z-41 vs the professor overlay (z-40 scrim / z-50 bubbles, ProfOverlay.tsx:103/106/173): the composer floats above the professor scrim but below bubbles — verified consistent with d1 §6.3's layering; if the composer ever needs to sit above bubbles, that is a review-gate z decision, not a wave decision.
6. Multi-book splits: DeskSheet mounts only for `bookKey === sideBarBookKey` (d1 §4.2) — switching books while the desk is open re-mounts the desk for the new book via DeskToggler's focus-first branch (d1 §3). Behavior on a mid-desk book switch via the sidebar (not the toggle) is unexamined by all three specs; v1 accepts whatever the remount does (per-book transcript keying makes it lossless). Queen notes it in the smoke.
