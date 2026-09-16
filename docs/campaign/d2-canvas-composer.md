# D2 — Canvas Model + Composer + Persistence

**Campaign:** The Desk (workbench 3.0) — scout spec, 2026-09-16.
**Scope:** the desk sheet's *document model* (placement fields), its *canvas
renderer* (single fluid column, endless vertical scroll), the
*click-anywhere floating mini-composer*, and *persistence* of the desk
document. The sheet host chrome (slide-underneath animation, header toggle,
scrim, focus/escape shell) is **D1's contract** — this spec assumes a
`DeskSheet.tsx` shell exists and specs only what mounts inside it.
**Design world:** The Antiquarian Catalogue — librarian voice, stamp
`#8C3B22` as the sole accent, light mode, corners ≤ 2px, unlayered CSS.

---

## 1. Ground truth (read before writing a line)

| File | What it owns | Anchors |
|---|---|---|
| `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` | `TranscriptBlock`, zustand store, serialize/parse | `TranscriptBlock` L69; `WORKBENCH_TRANSCRIPT_FILENAME` L124; `TRANSCRIPT_VERSION = 1` L126; `newBlockId` L137; `commitProfessorBlock` L281; `associateLearnerStep` L355; `serializeTranscript` L417; `isBlock` L428; `parseTranscript` L440; store `appendBlock` L460–476 |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx` | composer, `send()`, scroll-follow, persistence effects | `PIN_THRESHOLD_PX = 24` L91; `respond` L783; `send` L822; `handleComposerKey` L872; load effect L974; save effect L1006; `scrollRef` L1025; `atBottom` L1031; `handleScroll` L1057; `scrollToBottomAndRepin` L1073; follow effect L1105; MathLive popover render L1415–1450; composer render L1456–1484 |
| `apps/readest-app/src/app/reader/components/notebook/MathField.tsx` | MathLive wrapper (HARD: `next/dynamic ssr:false` only) | `MathFieldProps` L43; `onCommit` L48; default export L123 |
| `apps/readest-app/src/services/professor/workbenchSession.ts` | the stateless professor seam | `WorkbenchBlock` L38; `SendWorkbenchTurnOptions` L73; `sendWorkbenchTurn` L480 |
| `apps/readest-app/src/app/reader/components/notebook/Notebook.tsx` | mount contract | `lazy(() => import('./WorkbenchTab'))` L48; `DeskErrorBoundary` L65, L507–511 |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.css` | palette + precedent class faces | `.wb-stage` L13; `.wb-transcript` L18; `.wb-nib` L238; `.wb-scroll-chip` L278/L305; `.wb-composer-wrap` L415; `.wb-composer` L420; `.wb-math-popover` L483; `math-field.workbench-math-field` L504 |
| `apps/readest-app/src/__tests__/notebook/workbench-chat.test.ts` | test precedent (pure-contract vitest style) | imports from `@/app/reader/components/notebook/workbenchChat` |

Palette vars already in the codebase (use, never redefine): `--paper`,
`--paper-light`, `--ink`, `--muted`, `--stamp` (#8C3B22), `--lift-shadow`.
Typefaces: prose `'Newsreader', Georgia, serif`; plate track `'Special Elite',
'Courier New', monospace`.

---

## 2. The sheet document model — placement fields, additive

**Decision: `workbench-transcript.json` becomes the desk document unchanged
in shape.** It stays `{ version, savedAt, blocks }`; `version` stays
**1** — the new fields are all-optional, old files parse as placement-less
blocks, new files are valid v1 documents to any 2.x reader (unknown keys are
ignored by `isBlock`). No migration, no version bump, per campaign
non-negotiable "old transcripts load" and carried contract "placement fields
optional — additive".

### 2.1 `TranscriptBlock` gains three optional fields

In `workbenchChat.ts`, extend the interface at L69 (immediately after
`voice`, keeping the additive-field doc convention):

```ts
export interface TranscriptBlock extends WorkbenchBlock {
  // … every existing field unchanged …
  /** Desk placement, sheet-content coordinates in px (top-left of the
   *  block, relative to the column box's padding box). All optional, all
   *  additive: absent means "flow in the single column" — a 2.x block
   *  lacks them and renders exactly as today. Written by the desk
   *  composer on the blocks it commits; read by no 2.x code path. */
  x?: number;
  y?: number;
  width?: number;
}
```

Field semantics:

- `y?: number` — the sheet-space top edge at commit time. **v1 stores it and
  uses it only as the insertion hint** (§5.2); the renderer derives layout
  from document order, never from `y` directly.
- `x?: number` — reserved for freeform. **v1 stores it, the v1 renderer
  ignores it** (§4).
- `width?: number` — block width in px. **v1 stores it, the v1 renderer
  ignores it** (column measure is fixed, §4).

### 2.2 Parse contract — sanitize, never reject

`isBlock` (L428) currently checks `id`/`author`/`content`/`at`. Extend it
additively: a block whose placement fields are *malformed* (present but not
finite numbers, or `width` ≤ 0) must **still load** — the fields are
stripped, the block survives. Rejecting the whole document because one block
carries `x: "oops"` would violate the grace of the existing contract.

Add to `workbenchChat.ts`:

```ts
/** Placement fields survive the file round-trip only when finite numbers;
 *  width must be positive. Anything else is stripped (the block still
 *  loads — honest paper, never an erased-looking block). */
export const sanitizePlacement = (b: TranscriptBlock): TranscriptBlock => {
  const { x, y, width, ...rest } = b;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return {
    ...rest,
    ...(num(x) ? { x } : {}),
    ...(num(y) ? { y } : {}),
    ...(num(width) && width > 0 ? { width } : {}),
  };
};
```

Wire it into `parseTranscript` (L440): map each parsed block through
`sanitizePlacement` before returning. `serializeTranscript` (L417) needs **no
change** — placement fields ride the blocks array as ordinary JSON.

---

## 3. The send pipeline — reuse, not rewrite

**Decision: `sendWorkbenchTurn` (`workbenchSession.ts` L480) is UNCHANGED.**
It is stateless and render-blind: it takes `history`, `userContent`, and an
optional `checkerSummary`. Placement is *surface metadata* — it never enters
the prompt, the history summary, or the professor's context. Same tags, same
blocks, same persistence shape; the Desk is a renderer + composer change,
not a protocol change (`THE_DESK.md`, "Relationship to today's workbench").

What changes is the **UI-level commit logic**, today inlined in
`WorkbenchTab.tsx` `send()` (L822–870): voice stop-on-new-turn,
`commitPartialIfAny`, teach-back ask carry, probe-signal marking,
`associateLearnerStep`, `appendBlock`, then `respond`. The Desk's floating
composer must run the identical sequence. Extract it into `workbenchChat.ts`
as a pure, store-agnostic function both surfaces call:

```ts
export interface UserTurnInit {
  content: string;
  /** Desk placement (optional, additive — §2.1). */
  x?: number;
  y?: number;
  width?: number;
}

/**
 * Build the learner's block for a turn, applying the same metadata rules
 * as the 2.x composer: answers the professor's open teach-back ask, marks
 * the honest "I don't know" signal, and detects a folio step-append.
 * Pure — the caller owns store writes and the network turn.
 */
export function buildUserBlock(
  priorBlocks: TranscriptBlock[],
  init: UserTurnInit,
): { block: TranscriptBlock; associated: TranscriptBlock[] } {
  const block: TranscriptBlock = {
    id: newBlockId(),
    author: 'user',
    content: init.content,
    at: new Date().toISOString(),
    ...(init.x !== undefined ? { x: init.x } : {}),
    ...(init.y !== undefined ? { y: init.y } : {}),
    ...(init.width !== undefined ? { width: init.width } : {}),
  };
  const prior = priorBlocks[priorBlocks.length - 1];
  if (prior?.author === 'professor' && prior.teachbackAsk && !prior.teachbackOf) {
    block.teachbackAsk = prior.teachbackAsk;
  }
  if (isProbeSignal(block.content)) block.probeSignal = true;
  const associated = associateLearnerStep(priorBlocks, block);
  if (associated !== priorBlocks) {
    const changed = associated.find((b, i) => b !== priorBlocks[i]);
    if (changed) block.extendsDerivation = changed.id;
  }
  return { block, associated };
}
```

Then `WorkbenchTab.send()` (L822) refactors to:

```ts
const { block, associated } = buildUserBlock(priorBlocks, { content: text });
if (associated !== priorBlocks) setBlocks(bookKey, associated);
appendBlock(bookKey, block);
// …unchanged: setValue(''), focus, respond(history, block.content)
```

and the Desk composer calls the same two store actions + `respond`. The
streaming machinery (`beginStream`, `streamCallbacks`, `respond`, silent
check, `commitPartialIfAny`) moves into the Desk as a shared hook
(§7) — it is copied verbatim, not redesigned; the 2026-09-06 crash-scar
rule stands (streaming state stays component-local inside the desk subtree).

---

## 4. Layout — single fluid column (constitution default 3)

**Decision: v1 renders one fluid column, centered, generous measure; `x` and
`width` are ignored by the renderer.** Justification:

1. Constitution product default 3 is binding: "Layout starts as single
   fluid column with generous measure (tiktok-scroll), not freeform x."
2. Reading rhythm: the transcript's meaning is *order* (alternating
   professor/you, `derivationOrdinal` at `workbenchChat.ts` L261 derives
   step numbering from document order "never stored"). A freeform-x canvas
   breaks that ordinal and the concept-thread `scrollToBlock` model for
   zero pedagogic gain at v1.
3. What freeform-x would need later (spec now, build later): per-block
   absolute positioning with overlap/collision policy, a per-block width
   measure (KaTeX overflow inside narrow boxes), hit-region ownership
   between blocks and the click-to-place caret, rail-margin x-offsets, and
   a re-anchor rule for the width-drag ResizeObserver precedent
   (WorkbenchTab.tsx L1085). None of that exists in v1; storing `x`/`width`
   now means the later release is renderer-only, no migration.

Column spec:

- Measure: `max-width: 720px` (generous; ~66–72 chars of Newsreader at
  15px/1.6), centered with `margin-inline: auto` inside the scroll content
  box, `padding-inline: 24px`.
- Blocks flow in document order with the existing `.wb-block` rhythm
  (20px top margin, hairline `.wb-sep`) — **reuse the block renderers as-is**
  (Prose, DerivationSlip, DiagramSlip, ConceptMapSlip, chips): they are the
  professor-in-place surface and render identically on the sheet.
- Streaming professor answers flow **below** the current viewport bottom and
  the scroll stays pinned when the reader is at the tail (§6).

## 5. Scroll container + extent measurement (virtualization: NO)

**Decision: not virtualized in v1.** Measure-and-decide reasoning:

- The document is one book's sitting. The prompt path already caps what the
  model reads (`HISTORY_BLOCK_LIMIT = 12`, `workbenchSession.ts` L96), and
  long sittings are visually scrolled, not re-read. Expected steady-state is
  tens to a few hundred blocks.
- Cost check: a block is a `article` + type + hairline; the expensive node is
  KaTeX, which virtualization does not eliminate (it re-typesets on mount).
  Virtualizing a variable-height flow column also breaks two working
  precedents for free: the pinned-follow math (`atBottom`, L1031) and the
  width-drag anchor re-anchor (L1085), both of which rely on real layout.
- **Revisit gate (write it into the code comment):** when a measured
  `scrollHeight > 200_000px` *or* `blocks.length > 500`, file the
  virtualization follow-up. Until then: plain flow.

Extent model:

- The scroll container is the only positioned ancestor: `.desk-canvas`
  (`overflow-y: auto; overscroll-behavior: contain; height: 100%` — same
  contract as `.wb-transcript`, CSS L18).
- "Endless": the content box has **no fixed height**; extent is whatever
  `scrollHeight` measures after each blocks/checks/partial change (the same
  effect dependency list as the follow effect, WorkbenchTab.tsx L1105–1130).
- **The tail**: below the last block the sheet renders a minimum
  `45vh` of empty paper (`.desk-tail`) so there is always clickable sheet
  beneath the conversation — the "endless scroll" affordance is literal
  empty space you can write on.

## 5.2 Click-to-place: hit-testing and the insertion rule

New pure module `apps/readest-app/src/app/reader/components/notebook/desk/deskGeometry.ts`:

```ts
export interface SheetPoint {
  x: number; // px, relative to the scroll content box
  y: number;
}

export interface BlockRect {
  id: string;
  top: number;    // px, content-box coordinates
  bottom: number;
}

/** True when the point lands on empty tail paper (below every block,
 *  inside the .desk-tail region) — the only v1 placement surface. */
export function isTailPoint(
  rects: BlockRect[],
  contentExtent: number, // measured scrollHeight
  pointY: number,
): boolean {
  const lastBottom = rects.reduce((m, r) => Math.max(m, r.bottom), 0);
  return pointY >= lastBottom && pointY <= contentExtent;
}

/** Clamp the floating composer so it never leaves the visible sheet
 *  viewport horizontally and always has its input above the caret. */
export function clampComposerPosition(
  point: SheetPoint,
  viewport: { width: number; height: number },
  composer: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.min(
    Math.max(point.x, 8),
    Math.max(8, viewport.width - composer.width - 8),
  );
  const top = point.y + composer.height + 16 <= viewport.height
    ? point.y + 16
    : Math.max(8, point.y - composer.height - 16);
  return { left, top };
}
```

**v1 insertion rule: commits always append to document end.** A tail click
opens the composer exactly where the block will land, so the feel is
place-anywhere while the invariant (history is append-only, alternating)
stays intact for `associateLearnerStep`, `derivationOrdinal`, and
`sendWorkbenchTurn`. Clicking on or above an existing block is **inert** —
no caret (mid-paper insertion is a freeform-x-era feature; see §4.3). The
caret ghost renders at the click point; on Enter the block appears at the
tail, which *is* the click point because the reader is pinned at the tail
during conversation (§6).

## 6. Scroll-follow (streaming) — the 24px precedent, verbatim

The desk re-hosts the scroll policy unchanged (WorkbenchTab.tsx L1025–1130):

- `PIN_THRESHOLD_PX = 24` — within 24px of the bottom the scroll stays
  pinned; a new committed block glides (`behavior: 'smooth'`, collapsing to
  `'auto'` under `prefers-reduced-motion`); streaming tokens and resolving
  chips follow **instantly** (`el.scrollTop = el.scrollHeight`).
- Scrolling up un-pins immediately and permanently ("no yank"); growth while
  unpinned raises the one quiet stamp chip — reuse `.wb-scroll-chip`
  ("New writing below", L1409) for the way back.
- Width-drag re-anchoring (first fully-visible block keeps its viewport
  offset across a resize, L1085) ports unchanged.
- Mount/resume rests at the bottom, pinned (L1105 effect).

## 7. The floating mini-composer

New file `apps/readest-app/src/app/reader/components/notebook/desk/DeskComposer.tsx`.

### 7.1 State machine

```ts
export type ComposerState =
  | { kind: 'idle' }
  | { kind: 'placed'; point: SheetPoint }   // caret ghost shown
  | { kind: 'composing'; point: SheetPoint } // input focused, text may exist
  | { kind: 'sending' };
```

Transitions (pure reducer `deskComposerReducer` in `deskGeometry.ts`,
testable without DOM):

| Event | From | To | Effect |
|---|---|---|---|
| `PLACE(p)` | idle, placed | placed | render caret ghost at `clampComposerPosition(p)` |
| `FOCUS` | placed | composing | focus textarea |
| `DISMISS` | placed, composing | idle | clear text; focus returns to the sheet container |
| `SEND` | composing | sending | commit user block (§3), composer unmounts |
| `SENT` / stream settle | sending | idle | — |
| `PLACE(p)` | composing | composing(text kept) | move the composer; text is preserved (a nudge, not a discard) |

### 7.2 Anatomy (reuses the existing machinery)

- A positioned plate (`role='dialog'`, `aria-label={_('Write on the sheet')}`)
  floating at the caret: textarea (Newsreader 15px/1.5, transparent, no
  border — the paper shows through; underline hairline on `:focus-within`
  turning stamp) + the ƒx MathLive affordance + an "Add to page"-style
  commit affordance. Face matches `.wb-math-popover` (CSS L483: paper bg,
  1px ink border, 2px radius, `--lift-shadow`).
- **MathLive reuse:** `const MathField = dynamic(() => import('../MathField'), { ssr: false })`
  — the hard loading rule in `MathField.tsx`'s header doc is absolute. The
  ƒx popover inside the floating composer is the *same* popover markup as
  WorkbenchTab L1415–1450 (`.wb-popover-overlay` + `.wb-math-popover` +
  `MathField` + step/justify pair when a folio is open), re-anchored to the
  floating composer instead of the pinned bar. Math commit splices LaTeX
  into the floating textarea exactly as `spliceAtCaret` (L902) does.
- **Enter sends; Shift+Enter inserts a newline; ⌘/Ctrl+Enter also sends**
  — the exact contract of `handleComposerKey` (L872). **Escape dismisses**
  (the exact contract of `handleMathPopoverKey`'s Escape arm) and returns
  focus to the sheet container.

### 7.3 Accessibility

- The sheet container carries `role='log' aria-live='polite'
  aria-relevant='additions'` (the `.wb-transcript` precedent, L1192–1195).
- The caret ghost is `aria-hidden`; the composer dialog is reached by Tab
  like every other control — no global shortcuts (no-mid-session-buttons
  law; a placed composer is user-invoked, constitution non-negotiable 6).
- Focus order on open: textarea → ƒx → commit. On Escape/dismiss: focus
  returns to `.desk-canvas` (tabIndex 0).

### 7.4 Streaming hook

Extract `useDeskStreaming(bookKey)` — `beginStream`/`streamCallbacks`/
`respond`/`runSilentCheck`/`commitPartialIfAny` moved from WorkbenchTab
verbatim (L640–820) into
`apps/readest-app/src/app/reader/components/notebook/desk/useDeskStreaming.ts`,
returning `{ phase, partial, showPlaceholder, thinking, error, sendTurn,
retry }`. `DeskComposer` calls `sendTurn(history, content, placement)`;
`WorkbenchTab` keeps its own inline copies (this campaign does not regress
the sidebar path before the tab is removed).

## 8. Persistence — one document, one owner

Extract the two effects (load L974–1004, save L1006–1023) into
`apps/readest-app/src/app/reader/components/notebook/desk/useTranscriptPersistence.ts`:

```ts
export function useTranscriptPersistence(bookKey: string): {
  loaded: boolean;           // gate: never save before first load
  resumeNotice: string | null;
}
```

- Same path, same API: `${getDir(book)}/${WORKBENCH_TRANSCRIPT_FILENAME}`
  (`workbenchChat.ts` L124), `appService.readFile/writeFile`, scope
  `'Books'`, failure = `console.warn`, never a throw.
- Save fires on every `blocks` change **after** `loaded`; `parseTranscript`
  (now placement-sanitizing, §2.2) is the only loader. The desk and the
  2.x tab therefore read and write the *same* document — opening the Desk
  on an old sitting renders it as the sheet (verification gate: "old 2.x
  sidebar transcript still loads — it becomes the sheet's document").
- No new files, no rename, no schema registry entry.

## 9. Tests

One new file: **`apps/readest-app/src/__tests__/notebook/desk-canvas.test.ts`**
(pure-contract vitest style, matching `workbench-chat.test.ts` precedent).
Component-free: every case runs against the pure functions above.

1. **placement round-trip** — `serializeTranscript` on blocks carrying
   `{x, y, width}` → `parseTranscript` returns them byte-equal; a
   re-serialize is stable (idempotent save).
2. **old transcript loads clean** — a v1 document with zero placement fields
   parses; every block's `x`/`y`/`width` are `undefined` (2.x transcripts
   become the sheet's document).
3. **malformed placement is sanitized, not fatal** — `x: 'left'` /
   `width: -4` / `y: NaN` are stripped; the block and the rest of the
   document still load.
4. **`buildUserBlock` parity** — teach-back ask carry (open professor ask →
   block `teachbackAsk`), probe-signal marking ("I don't know"),
   `extendsDerivation` set when the content is a step-append
   (`$$…$$\nwhy` after an open folio) — same expectations as today's
   `send()` behavior, plus placement fields copied onto the block.
5. **`isTailPoint` hit-testing** — a point below every block rect and within
   extent is placeable; a point inside a block rect (even 1px above its
   bottom) is inert; a point below `contentExtent` is inert; an empty sheet
   (no blocks) places anywhere below y=0.
6. **composer state machine** — `PLACE → FOCUS → SEND → idle`; `DISMISS`
   from `composing` returns to `idle`; `PLACE` while `composing` moves the
   point and keeps text; `SEND` from `idle`/`placed` is a no-op.
7. **`clampComposerPosition`** — near the right edge clamps leftward with an
   8px gutter; near the bottom viewport edge flips the composer above the
   caret.
8. **follow boundary at 24px** — a pure `shouldFollow(scrollTop, scrollHeight,
   clientHeight, pinned)` port of `atBottom` (L1031): `distance ≤ 24`
   follows, `25px` unpins, unpinned stays unpinned.
9. **sheet extent invariant** — document of N blocks plus `.desk-tail`
   minimum yields `scrollHeight ≥ lastBlockBottom + 0.45 * clientHeight`
   (asserted against the exported `DESK_TAIL_MIN_VH = 0.45` constant).

## 10. File-touch list

| Path | Change |
|---|---|
| `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` | Add `x?/y?/width?` to `TranscriptBlock` (after `voice`, ~L122); `sanitizePlacement`; `parseTranscript` maps through it; new `buildUserBlock` + `UserTurnInit` |
| `apps/readest-app/src/app/reader/components/notebook/desk/deskGeometry.ts` | **New.** `SheetPoint`, `BlockRect`, `isTailPoint`, `clampComposerPosition`, `shouldFollow`, `deskComposerReducer`, `ComposerState`, `DESK_TAIL_MIN_VH` |
| `apps/readest-app/src/app/reader/components/notebook/desk/useDeskStreaming.ts` | **New.** Verbatim port of the streaming/turn machinery (L640–820) |
| `apps/readest-app/src/app/reader/components/notebook/desk/useTranscriptPersistence.ts` | **New.** Verbatim port of load/save effects (L974–1023) |
| `apps/readest-app/src/app/reader/components/notebook/desk/DeskCanvas.tsx` | **New.** Scroll container, tail region, block list (reusing 2.x block renderers), click-to-place, scroll-follow, composer mount |
| `apps/readest-app/src/app/reader/components/notebook/desk/DeskComposer.tsx` | **New.** Floating mini-composer (§7) |
| `apps/readest-app/src/app/reader/components/notebook/desk/DeskSheet.css` | **New.** `desk-` classes (§12), unlayered |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx` | `send()` refactored onto `buildUserBlock` (L822–870); persistence effects swapped for `useTranscriptPersistence` |
| `apps/readest-app/src/__tests__/notebook/desk-canvas.test.ts` | **New.** §9 cases |

Not touched (deliberately): `workbenchSession.ts` (`sendWorkbenchTurn`
unchanged), `MathField.tsx`, `professorTags.ts`, `mathCheck.ts`,
`Notebook.tsx` (tab removal is a later campaign gate, default 1).

## 11. `_()` string table (librarian voice; all via `useTranslation()`)

| Key string | Where |
|---|---|
| `Write on the sheet` | composer dialog `aria-label` |
| `Write to the professor` | textarea `aria-label` |
| `Place your writing…` | textarea placeholder (idle sheet) |
| `Continue the argument…` | textarea placeholder (session active — reuses existing key) |
| `Insert math` | ƒx `aria-label`/`title` (reuses existing key) |
| `Compose math` | ƒx popover `aria-label` (reuses existing key) |
| `Write an expression…` | MathField placeholder (reuses existing key) |
| `Why is this step allowed?…` | justify input placeholder (reuses existing key) |
| `Add to page` | math popover commit (reuses existing key) |
| `New writing below` | scroll chip (reuses existing key) |
| `Resumed your sitting with {{book}}` | resume notice (reuses existing key) |
| `THE PROFESSOR` / `YOU` | block bylines (reuses existing keys) |

Only the four new strings need translation entries; everything else reuses
existing `_()` keys so the tab and the desk never diverge in voice.

## 12. CSS (new file `desk/DeskSheet.css` — unlayered, light-first)

Palette/typography per the existing header contract (`WorkbenchTab.css`
L1–11). Skeleton the writer fleshes out:

```css
/* ---------- the sheet canvas ---------- */
.desk-canvas { position: relative; height: 100%; overflow-y: auto;
  overscroll-behavior: contain; padding: 24px; outline: none; }
.desk-canvas:focus-visible { box-shadow: inset 0 0 0 1px var(--stamp); }

/* ---------- the fluid column (constitution default 3) ---------- */
.desk-column { max-width: 720px; margin-inline: auto; }
/* Blocks inside reuse .wb-block/.wb-byline/.wb-content/.wb-sep — do not
   fork their faces. */

/* ---------- the endless tail ---------- */
.desk-tail { min-height: 45vh; cursor: text; }

/* ---------- the placed caret ghost ---------- */
.desk-caret { position: absolute; width: 2px; height: 1.1em;
  background: var(--stamp); animation: wb-nib-blink 1.1s steps(1) infinite; }
/* reuse the existing @keyframes wb-nib-blink (WorkbenchTab.css L248) */

/* ---------- the floating composer ---------- */
.desk-composer { position: absolute; z-index: 41; width: min(420px, 90%);
  background: var(--paper); border: 1px solid var(--ink); border-radius: 2px;
  box-shadow: var(--lift-shadow); padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px; }
.desk-composer textarea { background: transparent; border: none; resize: none;
  outline: none; font-family: 'Newsreader', Georgia, serif; font-size: 15px;
  line-height: 1.5; color: var(--ink); min-height: 38px; }
.desk-composer:focus-within { border-color: var(--stamp); }
.desk-composer-row { display: flex; align-items: center; gap: 8px;
  justify-content: flex-end; }

[data-eink='true'] .desk-composer { box-shadow: none; }
```

Rules: corners ≤ 2px everywhere; stamp `#8C3B22` sole accent (caret ghost,
`:focus-within` ring); no cards/bubbles for blocks; no `@layer`; honor the
`var(--*)` flip for dark/eink exactly as `WorkbenchTab.css` does.

---

## 13. Open questions

1. **D1 boundary:** does `DeskCanvas` own the traffic-light rail margin
   offset (rail narrows the column) or does the sheet host? Deferred to the
   D1/D5 specs — this spec's column is rail-agnostic.
2. **Folio-open pair mode** in the floating composer: confirm the step/
   justify pair (s3 §7.3) is reachable from a placed composer, not just the
   pinned bar — assumed yes (same `folioOpen` derivation, WorkbenchTab
   L932).
3. **Resume resting position on the Desk:** 2.x rests pinned at the bottom
   on mount. For a whole-subject mural, an owner might prefer resting at the
   *first un-graded turn* instead. v1 keeps the 2.x behavior; flag for
   dogfood.
4. **Placement units:** px (sheet-content coordinates) chosen for
   simplicity across zoom/reflow; if the freeform release wants
   %-of-column, that is a renderer concern — stored px stays valid.
