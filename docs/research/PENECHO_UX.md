# Research: penecho interaction model — the canvas dig

**Date:** 2026-09-16 · **Method:** shallow clone of `github.com/penecho/penecho` (`main`, v1.3.2-era) to `/tmp/penecho-src`; close read of `src/client/app/*.js` (the client is dependency-free DOM + canvas JS: `core.js` 4890 lines, `canvas-runtime.js` 6211, `canvas-navigation.js` 419, `ui-bootstrap.js` 1836, `persistence.js` 3629, `canvas-agent-runtime.js` 5216) plus `public/index.html` for the layer structure. All `file:line` citations are against that clone.
**Scope:** interaction model only. Product strategy, agent budgets, and the widget plan contract are in `docs/research/PENECHO.md` — not repeated here. License remains AGPL-3.0-only: port mechanics, never code.
**Our side, for reference:** `apps/readest-app/src/app/reader/components/desk/DeskCanvas.tsx` (622 lines, `.desk-canvas` scroll container + click-to-place composer), `deskGeometry.ts` (152 lines, pure helpers + composer reducer), `deskLayout.ts` (pure cluster layout, `STAGE` constants). Stack: React DOM, no canvas element, blocks carry optional `x?/y?/width?`.

---

## 0. The one-paragraph mental model

penecho is a **fixed 20000×20000 "sheet of paper"** (`SIZE = 20000`, `core.js:13`) rendered through a single camera transform `{scale, panX, panY}` (`core.js:1792-1794`, initial scale `0.1`). Everything the user makes — ink, text, images, widgets — is stored in **world coordinates** inside that square; the camera never enters the data model. Input is one `pointerdown` handler on the `screen` canvas that dispatches by **active tool mode** (`pen | eraser | area-eraser | text | hand | select`) into a set of single-owner **gesture objects** (`state.drawing`, `state.panGesture`, `state.widgetGesture`, `state.imageGesture`, `state.selectionGesture`, `state.textTap`, `state.touchGesture`), each keyed by `pointerId`. There is no framework, no hit-test DOM for placed objects: hit-testing is geometric, in world space, z-ordered by array order. Text editing is the one place DOM overlays the canvas — a floating `<textarea>` card that becomes a rasterized canvas image on commit.

---

## 1. TEXT BOXES — click → committed text object

### The exact event chain

Text boxes are created only in **`text` tool mode** (toolbar button `#textToolBtn`, toured at `core.js:1982`). The chain for a mouse:

1. `screen` `pointerdown` → `handleCanvasPointerDown` (`ui-bootstrap.js:255`) → pointer capture (`ui-bootstrap.js:307`) → `beginCanvasPointerAction(e, point)` (`ui-bootstrap.js:360`), where `point` is already in **world coords** via `clientPoint(e)` = `(client - pan) / scale` (`canvas-runtime.js:5148-5153`).
2. Text branch, mouse/pen: `state.mode === "text"` → reject if outside the 20000² sheet (`setStatusKey("outsideCanvas")`), else **`createTextEditor(point)` immediately on pointerdown** (`ui-bootstrap.js:151-157`). No drag-to-size, no place-then-edit split.
3. Touch is the exception: pointerdown only records `state.textTap = { id, startX, startY, point }` (`ui-bootstrap.js:143-150`); if the finger moves > 8px the tap converts to a **pan** (`ui-bootstrap.js:464-470`); only a clean `pointerup` within 8px calls `createTextEditor(tap.point)` (`ui-bootstrap.js:573-576`). So touch = tap-to-place after release, mouse = editor on press.

### The editor object (typing starts immediately)

`createTextEditor(point, options)` (`canvas-runtime.js:5882-6039`) builds a DOM card — `<section class="text-editor">` with a header (title, `?`, mixed-mode toggle, accept ✓ / cancel ✕), a `<textarea rows=4 maxLength=2000>` (`canvas-runtime.js:5960-5964`), a hidden preview div, and **three resize handles** (`width`, `height`, `corner`) plus header-drag move (`canvas-runtime.js:5971-5983`). It appends to `#textEditorLayer` (`index.html:576`) and calls **`focusTextEditor(editor, true)`** synchronously (`canvas-runtime.js:6037`) — **single click = caret blinking, typing starts at once**. The editor is positioned in world coords (`editor.x = point.x`, `editor.y = point.y`) and projected to screen px through an injected per-instance CSS rule (`addTextEditorStyleRule`, `canvas-runtime.js:5472`; `positionTextEditors`, `canvas-runtime.js:5438`), so it rides the camera.

### Anchoring

Anchored at the **exact click point — no snapping, no grid alignment**. Two clamps only: `keepTextEditorInsideCanvas` keeps the card inside [0, SIZE] (`canvas-runtime.js:5411-5416`), and `keepTextEditorVisible` keeps it inside the viewport with an 8px inset (`canvas-runtime.js:5418-5436`). Editing an existing box (`editTextBox`, `canvas-runtime.js:6041-6077`) reopens the same editor over the box; if the user neither moved nor resized the editor, commit **preserves the original world origin** exactly (`preserveSourceOrigin`, `canvas-runtime.js:5799-5803`).

### Defaults and auto-grow

Constants (`core.js:255-263`): default **320×168 CSS px**, min **170×96**, font **17 CSS px** (`TEXT_EDITOR_FONT_CSS`), max 2000 chars, family `ui-rounded, system-ui, sans-serif`. The card is clamped to viewport minus 24px (`canvas-runtime.js:5887-5889`). The editor does **not** auto-grow while typing — the textarea scrolls, and the user can drag the handles. **Auto-grow happens at commit**: `confirmTextEditor` (`canvas-runtime.js:5758`) converts CSS→world (`fontSize = fontCss / state.scale`, `canvas-runtime.js:5781`), rasterizes the text with wrapping at `maxWidth` (`fittedTextBoxContent`, `canvas-runtime.js:237-260` — with up to 3 shrink-to-fit passes if the render exceeds SIZE), and stores the **measured raster size** as the box: `{ id, x, y, w: width, h: height, maxWidth, fontSize, fontFamily, color, text, image }` (`canvas-runtime.js:5805-5816`). So the committed object's height is *whatever the text needed*; the 168px card height is only the editing chrome.

### Commit / cancel paths

- **Accept button** or **⌘/Ctrl+Enter** (`canvas-runtime.js:5921-5926`) → `confirmTextEditor`.
- **Focus loss** (pointerdown anywhere outside the editor, captured at document level: `ui-bootstrap.js:2` → `unselectTextEditorsOutside` → `unselectTextEditor`, `canvas-runtime.js:5723-5747`) → **implicit commit**. Unchanged-and-unmoved re-opens close without dirtying history (`canvas-runtime.js:5725-5730`); empty text cancels instead (`canvas-runtime.js:5764-5767`).
- **Cancel ✕** → `cancelTextEditor` (`canvas-runtime.js:5857`); when re-editing, cancel **deletes the source box** (`canvas-runtime.js:5860-5866`).
- After commit, the box is painted into `textContentLayer` as a raster image, and re-rasterized sharper when you zoom in (`refreshVisibleTextBoxQuality`, `canvas-runtime.js:157-201`; target ratio `dpr × scale` clamped [1,3], `canvas-runtime.js:108-110`).

**Takeaway:** place-and-edit are one gesture; the committed box is born with measured dimensions; commit-on-blur means there is no "unsaved text box" state.

---

## 2. DRAGGING — gestures, thresholds, hit-testing

### Gesture architecture

One entry point (`handleCanvasPointerDown`, `ui-bootstrap.js:255`), then a **mode dispatch** (`beginCanvasPointerAction`, `ui-bootstrap.js:129-200`) into per-pointer gesture records on `state`. Movement is routed in a single `pointermove` listener (`ui-bootstrap.js:389-480`) by checking each gesture's `id` against `event.pointerId` in priority order: drawing → reset-tap → widget → image → animation → area-erase → selection → textTap → pan/touch. Every gesture record has the same shape: `{ id: pointerId, startPoint (world), start (layout snapshot), changed: false }` (e.g. `beginImageGesture`, `canvas-runtime.js:1071-1083`; `beginWidgetGesture`, `canvas-runtime.js:2238-2258`).

### Move mechanics — no drag threshold

There is **no distance threshold before an object drag starts**: grabbing an object in `hand`/`select` mode enters the gesture on pointerdown, and `updateWidgetGesturePoint` moves the object every frame — `widget.x = clamp(0, SIZE - w, start.x + Δworld)` (`canvas-runtime.js:2260-2270`). Click-vs-drag is resolved **retrospectively** by an epsilon: `changed = |Δx,Δy,Δw,Δh| > 0.01` world units (`canvas-runtime.js:2266`), and only `changed` gestures mark the edit dirty / push history (`finishWidgetGesture`, `canvas-runtime.js:2456`; `finishImageGesture`, `canvas-runtime.js:1093-1102`). Thresholds exist only for **tap disambiguation**: 6px for the hand-toolbar tap and widget activation tap (`ui-bootstrap.js:392-393`, `ui-bootstrap.js:496`), 8px for the widget-gesture reset tap (`HAND_WIDGET_GESTURE_RESET_TAP_PX`, `canvas-runtime.js:7`), 8px for text-tap→pan (`ui-bootstrap.js:467`).

### Click-to-place vs drag-existing vs select

Resolved by **tool mode + geometric hit-test**, not by timing:

- `beginCanvasObjectSelection` (`canvas-navigation.js:260-293`) runs when mode is `select`/`hand`. It hit-tests via `handObjectToolbarTargetAtPoint` (`canvas-runtime.js:773-790`), which checks text boxes, images, widgets **topmost-first by array order**, with an explicit front-kind priority (`state.frontCanvasObjectKind` / `frontPlacedCanvasObjectKind` — click-to-front order survives deselection, `canvas-runtime.js:406-416`).
- Hit a **text box** → straight to `editTextBox` (single click reopens the editor; `canvas-navigation.js:274`).
- Hit a **widget/image** → select + begin move gesture; if the object was already selected, the resize zones are armed (`widgetPointerHit` with `includeUnselected`, `canvas-runtime.js:2147-2169`).
- Hit **nothing** → hide toolbars, accept any open edit, fall through (in `pen` mode: start drawing; in `text` mode: new editor; `ui-bootstrap.js:143-157`).

### Resize zones

`widgetResizeHit` (`canvas-runtime.js:2106-2122`): edge band **14px screen** (44px touch) and corner square **32px screen** (56px touch), both **divided by `state.scale`** so handle size is constant on screen at any zoom. Returns `'resize' | 'width' | 'height'`; corner resize preserves aspect via min/max scale clamp (`resizeWidgetBox`, `canvas-runtime.js:2217-2236`; min 300×200 for widgets, 80×80 images). Hover cursor feedback via `syncWidgetResizeCursor` (`canvas-runtime.js:2178-2184`) → `nwse-resize`/`ew-resize`/`ns-resize`.

### Marquee selection

**There is no rectangular marquee.** Ink selection is a **freehand lasso** (`beginSelectionLasso`, `persistence.js:3543`; points appended with a 0.5/scale tolerance, `persistence.js:3590-3594`; `handleSelectionPointerDown`, `persistence.js:3608-3629`). Placed objects are **single-select only** — no multi-select, no rubber band, anywhere in the client.

---

## 3. THE INFINITE CANVAS — pan/zoom model

### Coordinates

Not infinite — a **bounded 20000×20000 world** (`SIZE`, `core.js:13`) with a visible paper edge (border stroke + darker outside fill, `renderCanvasBackground`, `canvas-runtime.js:3510-3536`). All objects store world coords; all pointer math converts through one pair of functions: `clientPoint = (client − pan)/scale` (`canvas-runtime.js:5148`) and its inverse wherever things are projected (`positionWidget`, `canvas-runtime.js:1714-1720`; `textEditorScreenPoint`). The camera is `{scale, panX, panY}` in screen px (`core.js:1792-1794`); `canvasClientPosition` additionally normalizes HiDPI/CSS-vs-layout skew via cached viewport metrics (`core.js:2072-2082`).

### Zoom

- `zoomCanvasAt(clientX, clientY, deltaY)` (`canvas-runtime.js:6143-6164`): `factor = exp(-clamp(deltaY, ±300) × 0.002)` — exponential, wheel-delta proportional; **clamp `[0.03, 2]`** (3%–200%); **cursor-anchored**: `panX = px − ((px − panX) × next)/scale`, so the world point under the cursor stays put.
- Triggers: **Ctrl/⌘+wheel** (or plain wheel if the `wheelZoom` setting is on, persisted `penecho-wheel-zoom`), otherwise **wheel = pan**, Shift+wheel = horizontal pan (`handleCanvasWheel`, `canvas-navigation.js:292-306`). Safari trackpad pinch via `gesturestart/change` (`beginCanvasTrackpadGesture`, `canvas-navigation.js:308-322`, same anchor math). Touch: two-finger pinch with center anchoring (`beginTouchGesture`/`updateTouchGesture`, `canvas-runtime.js:6088-6128`), and a second finger down mid-stroke **aborts the stroke and becomes a pinch** (`ui-bootstrap.js:334-345`).

### Pan

Four gestures, all ending in `moveCanvas(dx, dy)` (screen px, `canvas-runtime.js:6130-6142`): **hand tool drag** (`ui-bootstrap.js:136-142`), **middle-mouse or Alt+drag** (`isMousePan`, `ai-runtime.js:2878-2880`), **Space-drag** (window-level Space keydown/keyup toggles `state.spacePan`, `canvas-navigation.js:407-414` + `canvas-navigation.js:419`), and **single-finger touch** (`ui-bootstrap.js:175-180`). Cursors: `grab`/`grabbing` (`resetCanvasCursor`, `canvas-runtime.js:6083-6086`).

### Extras

- `fitCanvasContents` (`canvas-navigation.js:343-357`): zoom-to-fit the union of ink + image + text + animation + widget bounds with 64px padding, clamped to the same [0.03, 2]; the agent panel's rect is subtracted from the usable stage (`canvasFitViewportSize`, `canvas-navigation.js:329-341`). Empty canvas falls back to a 3000×2000 region around the center.
- `canvasAgentFrameRegion` (`canvas-agent-runtime.js:4543-4549`): after the agent creates a widget, the camera **auto-frames it** (padding 48, scale ≤ 1, avoiding panel occlusion via `canvasAgentFramePlan`, `canvas-agent-runtime.js:4531-4541`). This is why AI artifacts always "arrive" in view.
- During fast navigation, a preview mode (`canvas-navigation-previewing`) defers expensive re-renders and text re-rasterization until the camera settles (`canvas-runtime.js:161-164`).

---

## 4. WIDGETS — collision-aware placement (the `plannedWidget` algorithm)

The agent calls `canvas_inspect` with a `plannedWidget` arg (schema at `canvas-agent-runtime.js:3916`, response splice at `canvas-agent-runtime.js:4102`), which returns `canvasAgentPlanWidget(value)` (`canvas-agent-runtime.js:4230-4247`): defaults **1200×800** world units (min 300×200), plus a typography forecast and a `layoutProposal`. The core is `canvasAgentPlacementBox(width, height, placement, reserved)` (`canvas-agent-runtime.js:4183-4228`):

1. **Occupancy set** = every object's box + global ink bounds + animation bounds + in-flight `reserved` boxes from the same batch + the **agent panel's screen rect projected into world space** (`canvas-agent-runtime.js:4188-4194`).
2. **Clearance test**: a candidate is `clear` iff no occupied box intersects the candidate **inflated by `gap` on all sides**; `gap = clamp(24, 400, placement.gap || max(40, 24/scale))` — so clearance is roughly constant on screen (`canvas-agent-runtime.js:4189-4191`).
3. **Modes**: `absolute` (clamped, no scan); `relative` to an `anchorObjectId` with `relation ∈ {right, left, above, below}` and `align ∈ {start, center, end}` (`canvas-agent-runtime.js:4196-4203`).
4. **Auto, viewport-first**: seed candidates = the viewport's 4 corners + center, plus for **each occupied box** the six slots around it (right, left, below, above, right-mid, below-mid) — the classic "hug existing content" generator (`canvas-agent-runtime.js:4204-4211`). Ranked top-to-bottom, left-to-right (reading order; or distance-to-viewport-center if `align` given); first `clear` candidate wins.
5. **Fallback 1**: dense grid over up to 96×96 candidate coordinates derived from occupied-box edges (`canvas-agent-runtime.js:4213-4215`).
6. **Fallback 2 — whole canvas**: corners + center + edge slots around all content, ranked by distance to viewport center, flagged `offViewport` (`canvas-agent-runtime.js:4216-4224`).
7. **Fallback 3**: viewport center with `crowded: true` (`canvas-agent-runtime.js:4225`).

The proposal comes back with `{box, createPlacement:{mode:"absolute", x, y}, placement, crowded, offViewport, overlappingObjectIds}` so the model pins the spot in the subsequent create (`canvas-agent-runtime.js:4237`). Batch creates thread `reserved` through so siblings never collide (`canvasAgentPrepareCreateItems`, `canvas-agent-runtime.js:4262-4263`). Receipts echo placement metadata, and a single-widget create auto-frames the camera (§3).

---

## 5. FEEL — why it reads as a canvas, not a chat

### Rendering tech — hybrid layers, not one canvas

`public/index.html:545-576`, in paint order: `canvas#screen` (paper + background) → `canvas#animationLayer` → `div#widgetLayer` (DOM) → `div#imageMaterialLayer` → `canvas#placedContentLayer` → `canvas#summonLayer` → `canvas#inkLayer` → `canvas#textContentLayer` → `canvas#liveInkLayer` (stroke in progress) → `canvas#interactionLayer` (all chrome) → `div#textEditorLayer` (DOM). Ink lives in **512px tiles** (`TILE`, `core.js:14`; `tile()`, `canvas-runtime.js:38-48`). Text boxes are **rasterized images** drawn into `textContentLayer` — this is why text zooms like ink and never reflows. Widgets are **sandboxed iframes in DOM shells**, positioned by `translate3d(x,y,0) scale(sx,sy)` written into per-widget injected CSS rules (`addWidgetStyleRule`/`positionWidget`, `canvas-runtime.js:1664-1738`), with a separate `contentW/contentH` coordinate space so the iframe's layout px are independent of display size. Off-screen widgets get `widget-offscreen` and stop receiving init (`updateWidgetRenderVisibility`, `canvas-runtime.js:1693-1708`).

### Object chrome

All chrome is **painted on `interactionLayer`**, not DOM: selection outlines in `rgba(38,121,184,.42)` (`drawHandObjectToolbarOutlines`, `canvas-runtime.js:3607-3626`), dashed vs solid widget refine outlines (`strokeWidgetRefineOutline`, `canvas-runtime.js:3629-3643`, `#007aff`), and — the most "canvas" detail — **draft action buttons drawn as circles floating above the box**: ✕ cancel at the top-left, ✓ accept top-right (`draftActionPoints`, `ai-runtime.js:1645-1657`; drawn with accent colors `#fb7185`/`#4ade80`, `ai-runtime.js:1664-1680`). Pending AI widgets render with a dashed outline + accept/cancel chrome and don't commit until accepted (`beginWidgetGesture` routes `hit === 'accept'/'cancel'`, `canvas-runtime.js:2239-2242`). The hand/select object toolbar **auto-expires after 10s** and fades over 220ms (`HAND_OBJECT_TOOLBAR_VISIBLE_MS`/`FADE_MS`, `canvas-runtime.js:5-6`), so chrome never accumulates. Hover state: resize cursors only (§2) plus a transient focus lift — selection raises the object above ink temporarily, but **click-to-front order persists after deselection** (`canvas-runtime.js:404-407`).

### Text editing

A **`<textarea>` overlay card**, never contenteditable (`canvas-runtime.js:5960`). It has its own chrome (header drag, 3 resize handles, ✓/✕) so while editing it feels like a floating sticky you're still arranging; commit dissolves it into the painted layer. A "mixed mode" toggle live-previews markdown/math into a rendered preview pane beside the textarea.

### Background / orientation

Paper fill + border + darker outside (the canvas has an *edge* — you can see the world end), optional **line grid every 500 world units**, hairline `1/scale` width, themed `--paper-grid #c8ae7155` (`drawCanvasLineGrid`, `canvas-runtime.js:3485-3505`; toggle persisted `penecho-grid`, `ui-bootstrap.js:1362-1364`; default on, `core.js:4685`). A status line shows live world coordinates during gestures (`requestCoordinatesUpdate`). **No minimap** (verified: zero hits for minimap/overview-canvas across `src/client/`); `studio-navigator.js` is a document-list sidebar, not a map. Orientation comes from the grid + coordinates + fit-contents instead.

### Why it works

The canvas feeling is the sum of: one camera over world coords; chrome that lives *on* the canvas and vanishes; commit-on-blur so nothing is ever half-open; accept/cancel circles on drafts; and the cursor vocabulary (`crosshair` when you could place, `grab` when you could pan, resize cursors at edges).

---

## 6. PORT LIST — smallest, highest-leverage mechanics for the Desk

Ordered by leverage/effort. Our assets: `.desk-canvas` scroll container with click-to-place (`DeskCanvas.tsx:364-396`), pure helpers + composer reducer (`deskGeometry.ts`), pure cluster layout with `STAGE.columnWidth/clusterGap/anchorWidth` (`deskLayout.ts:41-60`), blocks already carrying `x?/y?/width?` and `layoutSheet` producing absolute slots (`DeskCanvas.tsx:437-468`).

| # | Mechanic | penecho evidence | What we'd do | Effort |
|---|----------|------------------|--------------|--------|
| P1 | **Commit-time measurement (auto-grow)** | Editor is fixed 320×168 chrome; committed box stores the *measured* raster size (`canvas-runtime.js:5788-5816`); constants `core.js:255-263` | On `SEND`, measure the mounted block's real height (`getBoundingClientRect`, we already do this for `contentTop`) and store `height` in placement; `layoutSheet` consumes measured heights instead of estimates, eliminating overlap drift on reload | **S** |
| P2 | **Collision-aware slot finder (viewport-first, gap-inflated)** | `canvasAgentPlacementBox` (`canvas-agent-runtime.js:4183-4228`): occupied set, gap inflation, hug-content candidates, ranked reading-order, fallbacks | New pure `findFreeSlot(placedRects, viewportRect, size, {gap=24})` in `deskGeometry.ts`: candidates = beside-anchor (right at `clusterGap`, below — matches `deskLayout` beside/below), then viewport corners, then edges of occupied rects; first non-intersecting wins; return `{x, y, crowded}`. Reuse for professor artifacts *and* user-placed notes | **M** |
| P3 | **Drag-to-move blocks with retrospective threshold** | Gesture starts on pointerdown, moves every frame, `changed` only if Δ>0.01 (`canvas-runtime.js:2238-2270`); 6px tap threshold (`ui-bootstrap.js:392`, `:496`); clamp to world bounds | Pointer capture on placed blocks in spatial mode: >6px screen = drag, live-move via transform, drop commits `x/y` (fields exist); ≤6px stays a click. Pure delta math can live in `deskGeometry.ts` for tests | **M** |
| P4 | **Commit-on-blur / Esc-cancel editor discipline** | Document-level capture listener commits on outside pointerdown (`ui-bootstrap.js:2` → `canvas-runtime.js:5723-5747`); ⌘/Ctrl+Enter commits (`canvas-runtime.js:5921-5926`); empty cancels | DeskComposer: outside click on empty paper already re-places (reducer `PLACE` keeps text, `deskGeometry.ts:126-131`) — extend: click *outside the sheet entirely* = send-if-nonempty else dismiss; Esc = dismiss; unchanged-open = clean close with no history entry | **S** |
| P5 | **Selection chrome: hover outline + right-edge width handle** | Edge/corner hit zones constant on screen (`widgetResizeHit`, `canvas-runtime.js:2106-2122`); hover cursor sync (`canvas-runtime.js:2178-2184`); 10s auto-fade toolbar (`canvas-runtime.js:5-6`) | On placed blocks: 1px hover outline (CSS), right-edge 14px grab strip → `ew-resize` width drag committing `width` (field exists); chrome via CSS + auto-hide, no canvas layer needed in our DOM world | **M** |
| P6 | **Frame-on-arrival** | After agent creates a widget, camera auto-frames it with padding and panel occlusion (`canvasAgentFrameRegion`, `canvas-agent-runtime.js:4543-4549`; fit variant `canvas-navigation.js:343-357`) | When a professor artifact lands in spatial mode off-viewport, glide the scroll container so the new cluster is centered (we have `scrollToBlock`, `DeskCanvas.tsx:338-345` — call it on cluster commit, not just chip click); optionally lift unanchored new placements toward the current viewport via P2's viewport-first ranking | **S** |
| P7 | **Paper texture: faint grid + edge** | 500-unit line grid, hairline, 55-alpha warm gray (`canvas-runtime.js:3485-3505`, `core.js:4587`); visible paper edge | Pure CSS on `.desk-canvas`: `background-image` linear-gradients at ~96px spacing, very low alpha, plus a hairline stage boundary in spatial mode. Zero logic; biggest single "this is a canvas" read for the owner | **S** |
| P8 | **Draft accept/keep circles on pending artifacts** | ✓/✕ circles floating above the box (`ai-runtime.js:1645-1657`, drawn `:1664-1680`); pending widgets don't commit until accepted (`canvas-runtime.js:2239-2242`) | Professor artifact blocks land with a transient keep/dismiss pair anchored above the box (DOM is fine — we don't need penecho's painted chrome); timeout to auto-keep. (This is the interaction half of PENECHO.md's draft lifecycle finding) | **M** |

**Deliberately not ported:** the lasso (we have no ink — `persistence.js:3543`), iframe widget hosts + `contentW/contentH` double coordinate space (off-world), text rasterization pipeline (our text stays DOM — strictly better for a11y/selection), pinch/trackpad gesture plumbing (no zoom model to feed), the tiled ink engine, and zoom itself (see below).

**The zoom question, answered honestly:** penecho's `[0.03, 2]` camera (`canvas-runtime.js:6143-6164`) is what makes it feel unbounded, but porting scale to a React DOM sheet means transform-scale on `.desk-spatial` with anchor math, font-scaling artifacts, and a fight with the pinned-follow scroll policy (`deskGeometry.ts:78-86`). P1–P8 deliver ~90% of the "cool ass" feel — placement intelligence, drag, chrome, paper texture — while keeping our scroll-container model. Zoom is the **L-sized** follow-up only if dogfood still asks for it after P2+P3+P7 land.

---

## Appendix: quick map of the evidence

| Question | Primary files |
|---|---|
| Text boxes | `canvas-runtime.js:5882-6039` (editor), `:5758-5856` (commit), `:6041-6077` (re-edit); `ui-bootstrap.js:129-200`, `:573-576`; `core.js:255-263` |
| Dragging | `ui-bootstrap.js:255-362` (pointerdown), `:389-480` (pointermove); `canvas-runtime.js:2238-2270` (widget gesture), `:1061-1102` (image gesture), `:2106-2122` (resize hit), `:773-790` (hit-test order); `canvas-navigation.js:260-293` |
| Canvas/camera | `canvas-runtime.js:5148-5153` (clientPoint), `:6130-6164` (move/zoom), `:6088-6128` (pinch); `canvas-navigation.js:292-322`, `:343-357`, `:407-419`; `core.js:13`, `:1792-1794`, `:2072-2082` |
| Placement | `canvas-agent-runtime.js:4183-4228` (algorithm), `:4230-4247` (plannedWidget), `:4531-4549` (framing), `:4262-4263` (batch reserve) |
| Feel | `public/index.html:545-576` (layers); `canvas-runtime.js:38-48` (tiles), `:1664-1738` (widget DOM), `:3485-3536` (grid/paper), `:3607-3680` (chrome); `ai-runtime.js:1645-1680` (draft circles) |
