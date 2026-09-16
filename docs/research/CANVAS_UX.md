# Research: canvas-class UX — excalidraw / tldraw / echarts / vega dig

**Date:** 2026-09-16 · **Method:** shallow clones (carried over from the interrupted run, still valid): `/tmp/excalidraw-src` @ `c0ad61c`, `/tmp/tldraw-src` @ `2c9900d` (packages: editor + tldraw only), `/tmp/echarts-src` @ `984bf46` (apache/echarts v6.1.0, sparse: tooltip/legend/dataZoom/toolbox/brush components). The echarts option docs site is a JS SPA, so all echarts citations are against the source repo. Bundle sizes measured from the published unpkg min builds (cross-checked against bundlephobia where it wasn't rate-limited). Vega-family facts cite docs URLs + the npm registry.
**Scope note:** `docs/research/PENECHO_UX.md` already covered text-box commit flow, the drag gesture model, camera/pan/zoom, and collision-aware placement. None of that is repeated here. This doc is about **selection chrome, keyboard manipulation, text-shape editing, chart artifacts, and micro-feel**.
**Our side, as of today:** `apps/readest-app/src/app/reader/components/desk/DeskCanvas.tsx` (769 lines) already has drag-to-move + edge-resize via pointer events (`startDrag` :415-468, live preview `liveSlot` :471-487, `.desk-cluster-item` :619-664) and per-block edit ✎ / remove × buttons (`deleteBlock` :116-125, `editBlock` :127-140, `desk-block-tools` :634-655). It has **no selection state, no keyboard object manipulation, no hover chrome spec, no chart block kind**. `deskLayout.ts` (233 lines) honors stored `x/y/width` verbatim ("owner ruling: no clamp", :172-177). `deskGeometry.ts` (152 lines) is the pure, DOM-free testable layer.

---

## 0. TL;DR — the six findings in one breath

1. **Selection is a small, pruned, ephemeral-aware record** — selected ids + hovered id, hover never in history, dangling ids auto-pruned (excalidraw appState.ts:99-103; tldraw Editor.ts:536-554, 2935-2945).
2. **Chrome ladder: idle = nothing, hover = thin outline (tldraw) or cursor (excalidraw), selected = box + handles; handles are constant screen-size** (transformHandles.ts:143-147; SnapManager.ts:60-62). Chrome is gated on gesture state, not just selection (SelectionForegroundOverlayUtil.ts:92-113).
3. **Floating toolbars are tldraw's edit-session chrome**: above the selection, gap 8, clamped 16 to the viewport, hidden off-screen, debounced ≥16px moves (TldrawUiContextualToolbar.tsx:21-23, 190-238). excalidraw uses a fixed top-left island instead (LayerUI.tsx:301-330).
4. **The keyboard floor for object tools**: Del/Backspace, arrows nudge 1px / Shift 10px (chorded diagonals, ephemeral repeat), Enter edits, ⌘/Ctrl+D duplicates, ⌘/Ctrl+G groups — all behind an input-focused guard (Idle.ts:762-812; shortcuts.ts:60-120).
5. **Text editing is double-click/Enter in, everything-is-a-commit out** (Esc, blur, ⌘Enter all commit — textWysiwyg.tsx:682-697, 926), with the shape re-measuring and re-anchoring around the text on every update (TextShapeUtil.tsx:275-335).
6. **Feel = zero inertia + 1:1 pointer tracking + imperative transform writes outside React + 8px screen-space snapping with modifier-inversion** (Shape.tsx:83-90; Translating.ts:610-616; snapping.ts:41-51,162-189). Charts: vega-lite (~274 kB gzip lazy) beats echarts on spec-as-artifact, theming-in-spec, and LLM-friendliness; excalidraw's `labels + series[]` input contract (charts.types.ts:5-14) is what the professor should emit.

---

## 1. SELECTION + DIRECT MANIPULATION

### 1a. How selection state is structured

**excalidraw** — plain appState maps, single store:

```ts
// packages/excalidraw/appState.ts:99-103
selectedElementIds: {},     // Record<id, true>
hoveredElementIds: {},      // Record<id, true>
selectedGroupIds: {},
selectionElement: null,     // transient selection rect
```

Persistence annotations right below (`appState.ts:252-260`) show a design rule worth stealing: `selectedElementIds` is `{ browser: true }` (survives local save) but **`hoveredElementIds` is `{ browser: false, export: false, server: false }`** — hover is pure ephemera, never serialized, never collaborative.

**tldraw** — selection lives in the reactive document store, on the **per-page instance state record**: `selectedShapeIds` (Editor.ts:536-541), `hoveredShapeId` (Editor.ts:552-554), `hintingShapeIds`, `editingShapeId`. Three important subtleties:

1. `setHoveredShape` runs with `{ history: 'ignore' }` (`packages/editor/src/lib/editor/Editor.ts:2935-2945`) — **hover never creates an undo step**.
2. Store invariants prune dangling references automatically: when a shape leaves the page, `selectedShapeIds` and `hoveredShapeId` are filtered (Editor.ts:536-554). Selection can never point at a ghost.
3. `isChangingStyle` instance flag hides the selection overlay during nudges and style edits so chrome doesn't flicker mid-gesture (used in the nudge path, `packages/tldraw/src/lib/tools/SelectTool/childStates/Idle.ts:790`).

The deeper architectural point: in tldraw, selection is **data in the store**, so every overlay is a derivation (`@computed`) off it and collaborators get it for free. excalidraw keeps it in React appState, one level up from the scene. For our desk — no collab, tiny element counts — a single `selectedId: string | null` in component state is the honest port; the parts to keep from tldraw are the *invariants* (hover ephemeral, selection pruned on delete), not the store.

### 1b. What shows on hover vs selected vs idle

First, the state machines themselves, because the chrome is downstream of them. tldraw's select tool is an explicit **state tree** — `packages/tldraw/src/lib/tools/SelectTool/childStates/`: `Idle`, `PointingShape`, `PointingSelection`, `PointingCanvas`, `Brushing`, `Translating`, `Resizing`, `Rotating`, `DraggingHandle`, `EditingShape`, `Crop/*`, `ScribbleBrushing`. Chrome utils gate on that tree: the selection foreground is only active in idle-ish and pointing/resizing states (`SelectionForegroundOverlayUtil.ts:92-113` — note `select.brushing` keeps the box visible while you marquee). excalidraw does the same gating informally: selection borders skip rendering while dragging or while a linear element is being point-edited (`interactiveScene.ts:1850-1853`). Rule: **chrome is a function of gesture state, not just selection state.**

| State | tldraw | excalidraw |
|---|---|---|
| **Idle, pointer over empty canvas** | nothing | nothing |
| **Hover over shape** | full outline in the theme selection color, painted as a "shape indicator" (`packages/tldraw/src/lib/overlays/ShapeIndicatorOverlayUtil.ts:84-86` — hovered id is appended to the indicator batch; lineWidth 1.5, `zIndex: 50`) | **cursor change only** (`cursor: move`, App.tsx:8340-8364). `hoveredElementIds` is only painted for the element-link selector dialog (App.tsx:8372-8399). No hover outline at all. |
| **Selected** | indicator + **selection foreground**: bounding box, 4 corner resize handles + 4 edge handles, rotate handles at corners (cursor map `nwse-rotate` etc.), a mobile rotate handle on coarse pointers (`SelectionForegroundOverlayUtil.ts:21-36`, active-state list :92-113). Handles scale-adjusted so they're constant on screen. | Per-element selection border(s) — local user, remote collaborators (each their color), and **group bounds drawn as separate dashed boxes** (`renderer/interactiveScene.ts:1887-1960`, `renderSelectionBorder` :1012) + transform handles sized `size / zoom` (`packages/element/src/transformHandles.ts:143-147`, rotation handle gap `/ zoom` :207). Locked elements get a gray dashed border (:1874-1876). |
| **Selected + editing text** | selection foreground hidden; contextual (floating) toolbar appears | editing element excluded from hover; the top-left island shows text properties |

Both converge on: **handles exist only on selection; hover is a thin affordance (outline or cursor); chrome never shows for idle content.** tldraw's hover outline is the more generous of the two and is the better model for a desk of cards, where affordance discoverability is weak.

excalidraw has one more selection surface tldraw matches in spirit: the **marquee**. Dragging on empty canvas in the selection tool draws `selectionElement` (appState.ts:103) and selects everything intersecting; tldraw's `Brushing` state + `BrushOverlayUtil` do the same. Neither is worth porting to a desk of ~dozens of blocks — single-select plus ⌘/Ctrl+A covers us — but both define the same contract for *empty-canvas pointerdown in selection mode*: it starts a marquee, not a deselect-then-nothing. Our equivalent gesture (click empty paper) is already claimed by the composer (DeskCanvas.tsx:364-402), which is the right call for a writing surface.

Handle hit-testing is deliberately forgiving in both: tldraw grows the interactive hit target beyond the visual handle square and widens it further on coarse pointers (`SelectionForegroundOverlayUtil.ts:60-70`, `hitTargetSize`/`isCoarsePointer` in the selection state); excalidraw computes handle hit zones in screen space at `size / zoom` (`transformHandles.ts:143-147`) so handles are the same physical size at every zoom. Our desk has no zoom, which collapses all of this to: pick a fixed px size (excalidraw's ~8px square / tldraw's comparable), and give it a larger invisible hit area on touch.

### 1c. Toolbars above a selection — the big architectural divergence



**excalidraw has no floating selection toolbar.** Selected-shape properties render in a **fixed top-left "island"** (`LayerUI.tsx:301-330`, gated by `showSelectedShapeActions`, `packages/element/src/showSelectedShapeActions.ts:6-22` — shown while editing text, while a non-selection tool is active, or whenever anything is selected). Contextual, but spatially decoupled from the object.

**tldraw has true contextual floating toolbars**, via the shared primitive `TldrawUiContextualToolbar` (`packages/tldraw/src/lib/ui/components/primitives/TldrawUiContextualToolbar.tsx`). Its geometry contract (:190-238):

- hidden if the selection's midpoint is off-screen (:201-209);
- centered horizontally on the selection bounds, placed **above** it: `y = selectionBounds.y − toolbarHeight − TOOLBAR_GAP` with `TOOLBAR_GAP = 8` (:21-23, :227-229);
- **clamped to the viewport** with `SCREEN_MARGIN = 16` (:230-231);
- a **visibility state machine** (`hidden → showing → shown → hiding`, :244+) with show/hide timeouts, and repositioning debounced behind `MIN_DISTANCE_TO_REPOSITION_SQUARED = 16²` (:21) so the toolbar doesn't chase a dragging selection;
- only interactive when fully `shown` (:247-248).

It powers the rich-text toolbar (only while a text edit session is live — `DefaultRichTextToolbar.tsx:25-29` returns `null` unless `editor.getRichTextEditor()` exists), the image toolbar, and the video toolbar (`ui/components/Toolbar/`). So in tldraw, **floating toolbars are edit-session chrome, not selection chrome**: select an image and the toolbar appears because images define an edit affordance; select a rect and you get the style panel instead.

**Desk translation:** we are a DOM world with no style panel. The right hybrid is tldraw's *geometry* (above the block, centered, gap 8, clamp 16, hidden when off-screen, debounced follow) carrying excalidraw's *contents* (a few property actions), rendered only for the selected block.

One more tldraw nicety worth naming: the toolbar repositions only when the selection moved ≥16px (`MIN_DISTANCE_TO_REPOSITION_SQUARED = 16 ** 2`, TldrawUiContextualToolbar.tsx:21) and it flips between `showing/shown/hiding` with timeouts (:244+) — so a toolbar never flickers when you tap between two adjacent blocks, and never trails a fast drag. Cheap to copy, large felt payoff.

---

## 2. KEYBOARD — the object-manipulation shortcut maps

### excalidraw (`packages/excalidraw/actions/shortcuts.ts:60-120`, plus App.tsx key handling)

excalidraw's map is one declarative `shortcutMap` record keyed by action name — every entry platform-resolved once via `getShortcutKey("CtrlOrCmd+...")` (shortcuts.ts:60-120), with per-platform branches only where the conventions genuinely differ (z-order to-front/back, :81-88). That single-table shape is exactly what our (much smaller) map should look like.

| Action | Keys | Source |
|---|---|---|
| Delete selection | `Delete` (Backspace also handled, App.tsx:5995) | shortcuts.ts:74 |
| Duplicate | `⌘/Ctrl+D`, or **Alt+drag** | shortcuts.ts:75-78 |
| Arrow nudge | arrows = 1px, **Shift+arrows = 5px**; with grid mode on, arrows = grid size (20px) and Shift = 1px — the modifier *inverts* granularity | App.tsx:5845-5852; `ELEMENT_TRANSLATE_AMOUNT = 1`, `ELEMENT_SHIFT_TRANSLATE_AMOUNT = 5`, `DEFAULT_GRID_SIZE = 20` (`packages/common/src/constants.ts:24-25,281`) |
| Send backward / bring forward | `⌘/Ctrl+[` / `⌘/Ctrl+]` | shortcuts.ts:79-80 |
| Send to back / bring to front | `⌘/Ctrl+Alt+[` / `⌘/Ctrl+Alt+]` (macOS), `⌘/Ctrl+Shift+[` / `]` (Windows) | shortcuts.ts:81-88 |
| Group / ungroup | `⌘/Ctrl+G` / `⌘/Ctrl+Shift+G` | shortcuts.ts:90-91 |
| Edit selected text | **`Enter` on a selected text element opens the editor** | App.tsx:5889-5919 |
| Grid mode / object snap | `⌘/Ctrl+'` / `Alt+S` | shortcuts.ts:92-93 |
| Select all | `⌘/Ctrl+A` | shortcuts.ts:73 |

### tldraw (`packages/tldraw/src/lib/ui/context/actions.tsx`, kbd fields; dispatch in `ui/hooks/useKeyboardShortcuts.ts:36-84`)

| Action | Keys | Source |
|---|---|---|
| Delete | `⌫` or `del`, marks a history stopping point, then `editor.deleteShapes(selected)` | actions.tsx:1099-1107 |
| Duplicate | `⌘/Ctrl+D` | actions.tsx:532 |
| Group / ungroup | `⌘/Ctrl+G` / `⌘/Ctrl+Shift+G` | actions.tsx:594, 580 |
| Bring to front / send to back | `]` / `[` (bare!) | actions.tsx:937-945, 978-984 |
| Bring forward / send backward | `Alt+]` / `Alt+[` | actions.tsx:954, 968 |
| Nudge | arrows = 1, **Shift+arrows = 10** (`MAJOR_NUDGE_FACTOR`/`MINOR_NUDGE_FACTOR`, Idle.ts:810-811); grid mode: arrows = gridSize, Shift = gridSize × 5 (`GRID_INCREMENT = 5`, Idle.ts:795-802, 812). Nudge marks one history stop, hides the overlay via `isChangingStyle`, and supports **chorded arrows** (reads the live key set, so ↑+→ moves diagonally) | Idle.ts:762-808 |
| Nudge repeat | key-repeat handled separately and marked *ephemeral* — holding an arrow doesn't flood undo | Idle.ts:633-652 (`nudgeSelectedShapes(info, true)`) |
| Edit selected shape | **Enter** starts editing if the single selection is editable | Idle.ts:657-682 |
| Spatial select | `⌘/Ctrl+arrows` select the *adjacent shape in that direction*; `⌘/Ctrl+Shift+↑/↓` = select parent / first child (group navigation) | Idle.ts:579-599 |
| Cycle selection | `Tab` / `Shift+Tab` through shapes | Idle.ts:644-651 |
| Rotate | `Shift+.` / `Shift+,` (15°; +Alt for fine) | actions.tsx:1114, 1134 |

Also note the plumbing: tldraw's hook ports hotkeys-js's `shouldSkipEvent` form-input filter (useKeyboardShortcuts.ts:1-11) — shortcuts never fire while typing in an input/textarea/contenteditable, and each action declares `readonlyOk`.

### Worth porting to a desk of text/math blocks

Port, in this order: **Delete/Backspace**, **arrow nudge 1/10px**, **Enter-to-edit**, **⌘/Ctrl+D duplicate**. Skip: rotate, group/ungroup, z-order (we have no overlap-driven z battles yet — `layoutSheet` honors stored points verbatim, `deskLayout.ts:172-177`), flip, frames. The chorded-diagonal nudge and the ephemeral key-repeat (no undo flood) are the two pro touches worth copying exactly; our `updateBlock` commit point is `DeskCanvas.tsx:440-455` (same place drag commits), so nudge = `updateBlock(id, {x: x+dx, y: y+dy})` guarded by "desk focused, not typing in a field".

Two guardrails both tools share that we must copy verbatim:

1. **Never fire object shortcuts while typing.** tldraw ports hotkeys-js's `shouldSkipEvent` — a filter over input/textarea/contenteditable targets plus a list of non-text input types (useKeyboardShortcuts.ts:1-11); excalidraw's action `keyTest`s run only after the same class of guard. Our desk has a floating composer with a live textarea (`DeskComposer`), so the desk-level keydown handler must bail on `e.target.closest('input, textarea, [contenteditable], math-field')` — the same exclusion list the click-to-place handler already uses (DeskCanvas.tsx:368-375).
2. **Modifier-free letter/digit shortcuts stay off-limits for us.** tldraw can afford bare `]`/`[` for z-order and single letters for tools because its canvas owns the whole window's focus model. Our desk sits inside a reader with its own keys; restrict our map to Delete/Backspace, arrows (+Shift), Enter, Esc, and ⌘/Ctrl-chords — all safe inside the existing focus boundary.

---

## 3. EDITING TEXT OBJECTS

### excalidraw — double-click + Enter, DOM textarea WYSIWYG

- **Entry:** double-click on the canvas or an element (`handleCanvasDoubleClick`, App.tsx:7218+; wired at :2747) creates a new text element at that scene point or re-opens the existing one; **Enter on a selected text element** also opens the editor (App.tsx:5889-5919). Double-click is selection-tool-only (:7244-7250).
- **Editor:** a real DOM `<textarea>` created imperatively (`packages/excalidraw/wysiwyg/textWysiwyg.tsx:452`), positioned over the element and visually fused to the canvas via a CSS transform that bakes in zoom and rotation: `` `translate(...) scale(${zoom.value}) rotate(...)` `` (:80-97). It is styled to exactly match the rendered text (same font string, line-height), so commit is visually lossless.
- **Measure/grow:** on every `oninput`, unbound auto-resize texts re-wrap and the textarea's width is set from canvas-2d measurement: `wrapText` → `width = min(getTextWidth(wrappedText, font), maxWidth)` (:634-645). Measurement is `measureText` (`packages/element/src/textMeasurements.ts:12-27`) — canvas 2D `measureText` per line, with the classic trick of substituting a space for empty lines so they count toward height (:17-20). The element itself re-derives `width`/`height` from the text whenever `autoResize` is set (`packages/element/src/textElement.ts:90-108`).
- Text inside shapes is a **bound text element**: the wysiwyg commit path rebinds/unbinds the text to its container and calls `redrawTextBoundingBox` so the container grows around the text (textWysiwyg.tsx:841-866) — the shape owns geometry, the text owns content.
- **Exit:** blur commits (`editable.onblur = handleSubmit`, :926), **Esc commits** (:682-685), **⌘/Ctrl+Enter commits** (:691-697), window blur/beforeunload commit (:943, :1054). There is no cancel-that-restores — *every exit is a commit*; empty text deletes the element at the app layer.
- **While editing, canvas shortcuts keep working where safe**: zoom in/out/reset and font-size up/down are explicitly re-dispatched from the textarea's keydown (:662-679) so the user's muscle memory survives the edit session; Tab and bracket chords are swallowed (:698-704). IME composition is respected — ⌘/Ctrl+Enter checks `event.isComposing || keyCode === 229` before committing (:692-696). Both details matter for our math-heavy composer, where the math-field is an editing surface inside a block.

### tldraw — same entries, DOM-measured growth with anchor-aware re-centering

- **Entry:** double-click on a shape (or on its selection handles) → `startEditingShape` (`Idle.ts:263-347`); double-click on empty canvas creates a text shape (`handleDoubleClickOnCanvas`, :340-344); **Enter** on the single selected editable shape (`Idle.ts:657-682`). Editing is its own select-tool child state (`EditingShape.ts`) — while editing, the selection foreground and indicators stand down and pointer events belong to the text surface.
- **Measure/grow:** the text shape auto-grows in `onBeforeUpdate` (`packages/tldraw/src/lib/shapes/text/TextShapeUtil.tsx:275-335`): re-measure via `getTextSize` (:364-390 — `maxWidth: null` when `autoSize`, else fixed `w`), then **re-anchor `x/y` by textAlign** so the text grows from its alignment point: centered text shifts `x` by `-Δw/2`, end-aligned by `-Δw` (:301-318). Default props are `w: 8, autoSize: true` (:104-107); dragging a resize edge flips `autoSize: false` (:259-260), after which the shape has a fixed width and the text wraps inside it.
- **Measurement engine:** `TextManager` (`packages/editor/src/lib/editor/managers/TextManager/TextManager.ts`) measures with **pooled hidden DOM divs** appended to the editor container (:109-214), not canvas 2D — DOM measurement matches DOM rendering exactly. One hard-won detail: line-height is resolved to **whole pixels** (`resolveLineHeightPx`, :17-20) because WebKit and Blink round fractional line boxes differently and multi-line text drifts between measurement and render otherwise.
- tldraw's edit surface for rich text is a tiptap editor inside the shape; plain labels use a `<textarea>` overlay (`shapes/text/PlainTextArea.tsx`).
- **Measurement correctness details worth copying by name:** pooled measurement divs are reused and trimmed per batch (:194-214) so measurement doesn't thrash the DOM; `normalizeTextForDom` substitutes a space for empty lines (:23-30) — the same trick as excalidraw, independently arrived at; and the whole-pixel line-height rule (:17-20) exists because of a real cross-engine drift bug (tldraw/tldraw#8970, linked in the source comment). Our desk measures rendered blocks with `getBoundingClientRect` (DeskCanvas.tsx `contentTop`, :99-100), which sidesteps the entire measurement-consistency problem — one of the few places being DOM-native is strictly easier than canvas.

**Desk translation:** our blocks are already DOM that measures itself — no TextManager needed. The two mechanics to steal: **(a)** Enter/double-click to edit (our `editBlock`, DeskCanvas.tsx:127-140, already re-opens the composer at the block's stored point — it just needs the key/dblclick wiring), and **(b)** excalidraw's "every exit commits" discipline applied to re-editing (today `editBlock` deletes the block *before* the new send lands — a cancel path loses the original; excalidraw avoids this by keeping the element until submit).

The anchor-aware growth (tldraw TextShapeUtil.tsx:301-318) has a direct desk analog when C6/C10 land: if a block's width is resized or its text re-measured, decide whether it grows right-down from its stored `x/y` (current behavior, fine for left-aligned prose) or re-centers — for a desk, growing right-down is correct, but the *rule being explicit in `deskLayout.ts`* is the port, not the default.

---

## 4. CHARTS AS ARTIFACTS

### What excalidraw does (instructive, and a warning)

excalidraw doesn't embed a chart library at all: pasting a spreadsheet offers "chart" and `renderSpreadsheet` **compiles the data into native excalidraw elements** — bars are `newElement({ type: 'rectangle' })` (`packages/excalidraw/charts/index.ts:27-41`, `charts.bar.ts:59-62`; line/radar likewise). The input contract is tiny — `Spreadsheet = { title, labels, series: { title, values }[] }` (`charts.types.ts:5-14`) — and parsing is forgiving (`tryParseCells`/`tryParseSpreadsheet`, `charts.parse.ts`). Charts become ink.

Beautiful fit for a drawing tool; wrong for us. The professor's chart is a *live artifact* he may regenerate mid-conversation, we want tooltips and legend toggles, and our blocks are React DOM where a real chart component is cheap. But steal the **input contract**: `labels + series[]` is exactly the shape an LLM produces reliably; the desk should accept that minimal table and wrap it in a full vega-lite spec ourselves, rather than asking the professor to emit raw vega-lite (which invites schema drift).

### Smallest declarative spec: vega-lite

A complete interactive bar chart is ~15 lines of JSON:

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "data": {"values": [{"a": "ch.1", "b": 12}, {"a": "ch.2", "b": 19}]},
  "mark": {"type": "bar", "tooltip": true},
  "encoding": {
    "x": {"field": "a", "type": "nominal"},
    "y": {"field": "b", "type": "quantitative"}
  }
}
```

Interaction minimums, all declarative (docs: `https://vega.github.io/vega-lite/docs/spec.html`, `.../docs/tooltip.html`, `.../docs/parameter.html`, `.../docs/bind.html`):

- **Tooltip:** free — `"tooltip": true` on the mark, or an explicit `tooltip` encoding channel for formatted values.
- **Legend toggle (click legend → hide/show series):** one param: `params: [{"name": "s", "select": {"type": "point", "fields": ["series"]}, "bind": "legend"}]` + `"opacity": {"condition": {"param": "s", "value": 1}, "value": 0.2}`.
- **Pan/zoom:** `params: [{"name": "grid", "select": "interval", "bind": "scales"}]` — one line, wheel-zoom + drag-pan on both axes.
- Rendering is one call: `vegaEmbed(el, spec, {actions: false})` (`https://github.com/vega/vega-embed`).

### Embedding cost (measured 2026-09-16, unpkg min builds; bundlephobia cross-check)

| Package | min kB | gzip kB | Source |
|---|---|---|---|
| echarts 6.1.0 (full) | 1096 | 361 | `dist_echarts.min.js` measurement; bundlephobia agrees (1088.7/359.3) |
| echarts-for-react 3.0.6 (wrapper only) | 10 | 3.5 | bundlephobia |
| vega 6.4.0 | 512 | 176 | `/tmp/build_vega.min.js` |
| vega-lite 6.4.3 | 248 | 78 | `/tmp/build_vega-lite.min.js` |
| vega-embed 7.2.0 | 60 | 20 | `/tmp/build_vega-embed.min.js` |
| **vega stack total** | **~820** | **~274** | vega-lite compiles *to* vega; all three are needed |
| echarts core + line/bar + tooltip + legend (tree-shaken) | ~300-400 min (est.) | ~100-130 (est.) | `import * as echarts from 'echarts/core'` + `use([...])` — `src/extension.ts:101`, `src/echarts.ts:23-30`; `package.json:31-42` lists side-effectful entries so bundlers can shake the rest |

Tree-shaken echarts is the *smaller* runtime for a narrow chart diet; full echarts (what most people ship) is the largest. vega-lite's cost is fixed regardless of chart count.

**SSR constraints:** `DeskCanvas.tsx` is already `'use client'` (:29), so neither library can render in the RSC payload — both mount in effects. Concretely for our Next.js app: `next/dynamic(..., { ssr: false })` around the chart component, or a `useEffect` + lazy `import('vega-embed')` inside the block component; the latter also keeps the ~820 kB out of the reader bundle until a chart actually exists. Beyond that: vega can prerender a **static SVG string in Node** (view → `toSVG()`, `https://vega.github.io/vega/usage/#node`), which means a chart artifact could ship as inline SVG in the persisted transcript and hydrate interaction lazily. echarts has an SSR mode (`init(el, theme, {ssr: true, renderer: 'svg'})`, echarts handbook "Server-side rendering") producing SVG + a client `hydrate`-style reconnect, but the SSR SVG carries no tooltip until the client runtime boots.

**echarts interaction minimums** (from the source repo, since the docs site is a SPA): tooltip defaults `trigger: 'item'`, `triggerOn: 'mousemove|click|mousewheel'` (`src/component/tooltip/TooltipModel.ts:53,106,109`); legend series toggling is built-in via `selectedMode` (`src/component/legend/LegendModel.ts:201`, single-select behavior :300-301); pan/zoom is the `dataZoom` *inside* component (`moveOnMouseMove: true` default, `zoomLock` option — `src/component/dataZoom/InsideZoomModel.ts:33-64`). So parity with the vega-lite minimums is: `{tooltip: {}, legend: {}, dataZoom: [{type: 'inside'}]}`.

**Theming to paper/ink:** vega-lite themes are *part of the spec* — a top-level `config` block (fonts, axis color, grid on/off, background) travels with the artifact, and `vega-themes` ships with vega-embed (registry dep list, vega-embed 7.2.0). One desk-wide `config` factory = every professor chart automatically in our serif/paper world, and the artifact stays self-describing JSON. echarts theming is `echarts.registerTheme(name, themeObject)` + `init(el, name)` — imperative, global, and *outside* the option object; doable but the artifact stops being self-contained.

**Recommendation:** **vega-lite + vega-embed**, lazy-`import()`ed on first chart block. Declarative JSON is a better LLM target than echarts' nested option API, spec-embedded theming matches the paper world, and the interaction minimums are 3 lines of params. Cost accepted: ~274 kB gzip loaded on demand. (Escape hatch if bundle pain: tree-shaken echarts/core at roughly half the size, trading away spec portability.)

Decision matrix, honestly:

| Criterion | vega-lite + vega-embed | echarts (+echarts-for-react) |
|---|---|---|
| Spec shape the professor emits | one flat JSON document, schema-validatable, theming embedded via `config` | nested imperative option tree; theme lives outside via `registerTheme` |
| Interaction minimums | tooltip free; legend toggle = 1 param; pan/zoom = `bind: 'scales'` | `tooltip: {}` on by default (TooltipModel.ts:106); legend toggle built-in (LegendModel.ts:201); pan/zoom = `dataZoom: [{type:'inside'}]` (InsideZoomModel.ts:33-64) |
| Full-bundle cost (min/gzip) | ~820 / ~274 kB | 1096 / 361 kB |
| Tree-shaken floor | vega-lite always drags full vega (it compiles down to it) | ~300-400 kB min with `echarts/core` + `use()` (extension.ts:101) |
| SSR | static SVG from Node (`view.toSVG()`) — artifact can persist as inline SVG and hydrate later | SSR mode exists (svg renderer + ssr flag) but inert until client boot |
| Theming to paper/ink | `config` in-spec; `vega-themes` ships with vega-embed | `registerTheme` global registry, heavier custom JSON |
| Risk | vega-lite schema errors surface as console warnings; validate before mount | bigger API surface for an LLM to get subtly wrong |

---

## 5. THE FEEL — what actually makes these tools feel expensive

1. **No inertia. Anywhere.** Zero hits for "inertia" in both repos. Object drag is strictly 1:1 pointer tracking. The "buttery" impression comes from *removing latency*, not adding physics. Don't add momentum to block drags.
2. **Imperative transform writes during drag.** tldraw positions every shape's DOM wrapper by writing `style.transform` (a matrix string) **outside the React render path** in a signal reactor, diffing against the last written value (`packages/editor/src/lib/components/Shape.tsx:66-101` — `Mat.toCssString(pageTransform)` → `setStyleProperty`, only when changed :87-90). excalidraw's equivalent is a rAF-driven canvas repaint (`components/canvases/InteractiveCanvas.tsx:79-90` — an AnimationController loop re-rendering the interactive scene). **Our desk currently re-renders React state on every pointermove** (`setDrag` → `liveSlot`, DeskCanvas.tsx:436-438, 471-487) — the cheapest feel upgrade we have.
3. **Snap thresholds are screen-space constants.** excalidraw: `SNAP_DISTANCE = 8` px, divided by zoom (`snapping.ts:41,48-51`). tldraw: `snapThreshold / zoomLevel` (`SnapManager.ts:60-62`). Handles likewise (`transformHandles.ts:143-147`). Constant-screen-size chrome is a universal rule.
4. **Snap disengages while you fling.** tldraw only computes shape snaps when `pointerVelocity < 0.5` (`Translating.ts:610-616`) — fast moves are snap-free, slow moves stick. Cmd/Ctrl inverts snap mode (:610); **Shift flattens the drag to the dominant axis** (:593-604). Grid mode snaps the translated point when no shape-snap indicators fired (:655-657).
5. **Alignment guides = edge/corner points + equal-gap distribution.** excalidraw's snappers produce point-snaps (corners/centers) and **gap-snaps** (equal-spacing guides, `snapping.ts:692+`, `GapSnap` types :84-102), painted by `renderer/renderSnaps.ts:16`. Gap-snapping — the guide that says "these three cards are evenly spaced" — is the single most "pro" visual on any canvas.
6. **Grid snapping is a separate channel from object snapping**, and they resolve in sequence: tldraw applies shape-snaps first, then grid-snaps the result only if no snap indicators fired (`Translating.ts:655-657` — "we don't want to snap to the grid if ... we're showing snapping indicators"); excalidraw's drag offset goes through `calculateOffset(..., snapOffset, gridSize)` with grid rounding via `getGridPoint` (`packages/element/src/dragElements.ts:98-130`). One modifier rule governs both in both tools: ⌘/Ctrl **inverts** whatever the current snap mode is (`snapping.ts:162-189`, `Translating.ts:610`).
7. **Chrome hides during manipulation.** tldraw sets `isChangingStyle` during nudges (Idle.ts:790) so the selection box doesn't repaint-chase the shape; excalidraw skips handle rendering while dragging (`interactiveScene.ts:1850-1853`).
8. **Click-vs-drag is a threshold, retrospective.** excalidraw `DRAGGING_THRESHOLD = 10`px (`common/src/constants.ts:21`); penecho used 6px; **our desk uses 4px Manhattan distance** (DeskCanvas.tsx:442). Ours is touchy — a 6-10px threshold with `|dx|+|dy|` is cheap insurance against accidental moves on click.

9. **History hygiene is part of feel.** tldraw marks history stopping points at gesture boundaries (`markHistoryStoppingPoint('nudge shapes')`, Idle.ts:789) and treats key-repeat nudges as ephemeral (:633-643) — one undo step per gesture, not per event. excalidraw similarly batches via `captureUpdate` flags on actions. We don't have undo on the desk yet; when it arrives, the stopping-point model is the one to copy, and the drag/nudge commit points in DeskCanvas.tsx (:440-455) are where the stops belong.

---

## 6. PORT LIST — for our desk, ranked by effort

Current baseline: drag + resize exist (`DeskCanvas.tsx:415-468`); edit/delete buttons exist (:634-655); no selection, no keyboard, no snap, no charts. Blocks carry `x?/y?/width?` and `layoutSheet` honors them verbatim (`deskLayout.ts:110-177`). Pure helpers belong in `deskGeometry.ts` to stay testable.

Suggested sequencing: C1+C3+C4 are one sitting's work and unlock everything keyboard-shaped (they define what "the selection" is); C2 and C5 fall out of that same keydown handler; C7 is the felt-quality jump and is safest after C1 exists (the imperative drag writes need to know selection to skip ring repaints); C6 and C8 are the visible "canvas polish" the owner is asking for; C9 anywhere; C10 is its own campaign (block schema, professor prompt contract, lazy bundle).

| # | Item | Effort | Mechanics + evidence |
|---|---|---|---|
| C1 | **Selected block + Del/Backspace delete** | **S** | One `selectedId` state in DeskCanvas; click block (non-drag, ≤4px release) selects; `Delete`/`Backspace` → existing `deleteBlock` (:116-125). Guard with the hotkeys-js input filter so typing never triggers it (tldraw useKeyboardShortcuts.ts:1-11; delete action at actions.tsx:1099-1107). Esc clears selection (tldraw `onCancel` → `selectNone`, Idle.ts:563-574). |
| C2 | **Arrow-key nudge (1px / Shift=10px, chorded diagonals, ephemeral repeat)** | **S** | Keydown on the desk container when `selectedId` set: read the live pressed-keys set so ↑+→ works (tldraw Idle.ts:774-784); step 1, Shift 10 (`MAJOR/MINOR_NUDGE_FACTOR`, Idle.ts:810-811; excalidraw 1/5, constants.ts:24-25). Commit via `updateBlock` like the drag drop (:440-455); key-repeat updates without extra history noise (tldraw's ephemeral flag, Idle.ts:633-643). |
| C3 | **Hover outline + selected ring (CSS only)** | **S** | `.desk-cluster-item:hover` → 1px outline in a warm accent; selected → ring + keep. This is the tldraw hover-indicator model (ShapeIndicatorOverlayUtil.ts:84-86) done in CSS; hover is pure ephemera, never persisted (excalidraw appState.ts:253 rule). |
| C4 | **Raise drag threshold 4px → 8px** | **S** | One constant at DeskCanvas.tsx:442; excalidraw uses 10 (`common/src/constants.ts:21`). Prevents accidental moves when clicking to select (required companion to C1). |
| C5 | **Double-click + Enter to edit a text block** | **S** | Wire `onDoubleClick` on `.desk-cluster-item` and Enter-when-selected to the existing `editBlock` (:127-140). Entry parity with both tools (App.tsx:7218+, Idle.ts:263-347, 657-682). Fix the cancel-loses-original hole while here: keep the old block until the composer sends (excalidraw's every-exit-commits, textWysiwyg.tsx:818-870). |
| C6 | **Edge-snap + alignment guides during drag** | **M** | Pure `computeSnap(draggedRect, otherRects, threshold=8)` in `deskGeometry.ts`: snap left/right/top/bottom edges + centers of other blocks (excalidraw SNAP_DISTANCE=8, snapping.ts:41; point-snaps from corners/centers). During drag, apply the nudge to the live preview and paint 1px guide lines as absolutely-positioned divs. Skip velocity-gating and gap-snaps in v1 (tldraw Translating.ts:610-616 and excalidraw gap-snaps are the v2 polish). |
| C7 | **Imperative transform during drag** | **M** | Replace `setDrag`-per-pointermove (DeskCanvas.tsx:436-438) with `element.style.transform = translate(dx,dy)` writes in the move handler + a single state commit on pointerup (tldraw Shape.tsx:83-90 pattern). Kills full-stage React re-render per frame; the felt difference between "app" and "canvas". |
| C8 | **Selection floating toolbar** | **M** | Reuse `desk-block-tools` (:634-655) but mount it floating above the selected block using tldraw's geometry: centered on block midX, `y = block.top − toolbarHeight − 8`, clamp 16px to the scroll viewport, hidden when the block is off-screen (TldrawUiContextualToolbar.tsx:21-23, 190-238). Contents: edit ✎, duplicate, delete ×, width presets. |
| C9 | **Duplicate ⌘/Ctrl+D** | **S** | Clone block with new id, offset +12/+12 (the universal duplicate offset), select the clone. Both tools: shortcuts.ts:75-78, actions.tsx:532. |
| C10 | **Vega-lite chart artifact block kind** | **L** | New block variant: `chart: {spec}` on `TranscriptBlock`; render via lazy `vega-embed` (~274 kB gzip on demand, §4); desk-wide `config` theme factory for paper/ink; interactions = tooltip + legend-toggle param + `bind: "scales"` pan/zoom; `estimateHeight` already treats `diagram` as 300 (`deskLayout.ts:83-85`) — chart blocks join that branch; artifact width from `STAGE.artifactWidth` (:48). Professor emits the spec JSON; validate against a minimal schema before mounting. |

**Deliberately not ported:** marquee/multi-select (single selection covers a desk; both tools' complexity lives in multi-select), rotation, group/ungroup and z-order (no overlapping battles yet — verbatim placement, deskLayout.ts:172-177), excalidraw's rasterize-charts-to-shapes (§4), tldraw's velocity-gated snapping (nice-to-have behind C6), full context menus (right-click is free real estate but our toolbar covers the same actions), and any camera/zoom model (PENECHO_UX.md's verdict stands).

---

## Appendix: evidence map

| Question | Primary evidence |
|---|---|
| Selection state | excalidraw `appState.ts:99-103,252-260`; tldraw `Editor.ts:536-554` (page-state pruning), `:2909-2945` (hover, `history:'ignore'`) |
| Chrome hover/selected | tldraw `ShapeIndicatorOverlayUtil.ts:60-130`; `SelectionForegroundOverlayUtil.ts:21-36,85-113`; excalidraw `interactiveScene.ts:1012,1850-1960`; `transformHandles.ts:143-147,207`; cursor-only hover `App.tsx:8340-8364` |
| Floating toolbar | tldraw `TldrawUiContextualToolbar.tsx:21-23,190-238,244-300`; `DefaultRichTextToolbar.tsx:25-29`; excalidraw fixed island `LayerUI.tsx:301-330`, gate `showSelectedShapeActions.ts:6-22` |
| Keyboard | excalidraw `actions/shortcuts.ts:60-120`; nudge `App.tsx:5845-5852` + `common/src/constants.ts:21,24-25,281`; Enter-edit `App.tsx:5889-5919`. tldraw `ui/context/actions.tsx` (kbd fields :532,:580,:594,:937-984,:1099,:1114-1134); nudge/Enter/Tab `SelectTool/childStates/Idle.ts:563-652,657-682,762-812` |
| Text editing | excalidraw `wysiwyg/textWysiwyg.tsx:80-97,452,634-645,682-697,818-870,926`; `element/src/textMeasurements.ts:12-27`; `textElement.ts:90-108`. tldraw `TextShapeUtil.tsx:104-107,259-260,275-335,364-390`; `TextManager.ts:17-20,109-214` |
| Charts | excalidraw `charts/index.ts:27-41`, `charts.bar.ts:59-62`; echarts `TooltipModel.ts:53,106,109`, `LegendModel.ts:201,300-301`, `dataZoom/InsideZoomModel.ts:33-64`, `extension.ts:101`, `package.json:31-42`; bundle sizes measured from unpkg min builds (`/tmp/build_vega*.min.js`, `/tmp/dist_echarts.min.js`), bundlephobia for echarts/echarts-for-react; vega-lite docs `vega.github.io/vega-lite/docs/{spec,tooltip,parameter,bind}.html` |
| Feel | tldraw `Shape.tsx:66-101`; `Translating.ts:585-660`; `SnapManager.ts:60-62`; excalidraw `snapping.ts:41-51,162-189`; `renderSnaps.ts:16`; `InteractiveCanvas.tsx:79-90`; "inertia" grep: 0 hits both repos |

## Appendix B: reproducing the numbers

```sh
# clones (as left in /tmp by this dig)
git clone --depth 1 https://github.com/excalidraw/excalidraw.git /tmp/excalidraw-src
git clone --depth 1 --filter=blob:none --sparse https://github.com/tldraw/tldraw.git /tmp/tldraw-src
git clone --depth 1 --filter=blob:none --sparse https://github.com/apache/echarts.git /tmp/echarts-src

# bundle measurements (standalone min builds, 2026-09-16)
for u in \
  "https://unpkg.com/vega@latest/build/vega.min.js" \
  "https://unpkg.com/vega-lite@latest/build/vega-lite.min.js" \
  "https://unpkg.com/vega-embed@latest/build/vega-embed.min.js" \
  "https://unpkg.com/echarts@latest/dist/echarts.min.js"; do
  f=$(basename $u); curl -sL -o /tmp/$f "$u"
  echo "$f: $(wc -c < /tmp/$f) bytes, gzip $(gzip -c /tmp/$f | wc -c)"
done
# versions at measurement: vega 6.4.0, vega-lite 6.4.3, vega-embed 7.2.0, echarts 6.1.0
```

Caveats: unpkg min builds are UMD standalone bundles; a bundler may share some internals, but vega-lite's output *is* vega API calls, so the stack sum is the right mental model. The tree-shaken echarts figure is an estimate range, not a measurement — verify with an actual webpack build before committing to the escape hatch. The echarts clone is a sparse checkout (tooltip/legend/dataZoom/toolbox/brush); for `init`/SSR/theme internals, widen the sparse list to `src/core` and `src/api` first.
