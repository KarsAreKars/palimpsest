# d3 — Professor-in-place, Traffic-light rail, Folded 2.5 (wiggly replay + penecho guards)

**Campaign:** The Desk — workbench 3.0 (`docs/DESK_CAMPAIGN.md`, owner-approved 2026-09-15).
**Vision:** `docs/vision/THE_DESK.md`. **Research:** `docs/research/WIGGLYSTUFF.md` (Route C→B),
`docs/research/PENECHO.md` (M3/M4/M5 ports).
**Scout:** d3 · **Date:** 2026-09-16 · **Status:** spec for writer; audit arbitrates overlaps with d1/d2.

Binding context: campaign product defaults — (1) the sidebar Workbench tab is **removed** when the
Desk lands; (2) one endless sheet **per book**; (3) layout starts as a **single fluid column**
(`(x,y)` placement fields exist additively, freeform comes later). Standing law: librarian `_()`
voice, no mid-session buttons (a learner-invoked control is law-compliant), protocol tags never
displayed, light mode, additive-only prompts, old transcripts load unchanged.

Design world (The Antiquarian Catalogue): `--stamp: #8C3B22` (`apps/readest-app/src/styles/apothecary.css:46`)
is the **sole accent**; `--sage: #5b6b4f` (L47) is secondary state ink; light-first; corners ≤ 2px;
**unlayered CSS** (no stacked utilities, existing vars only); type = Special Elite (plates/labels)
over Newsreader (prose). All new markup reuses the existing `.wb-chip` composite face
(see `WorkbenchTab.css` §chips) the way `.wb-voice-btn` does.

Every file cited below was read in full; line anchors are to the current tree.

---

## A. PROFESSOR-IN-PLACE

**Goal:** the 2.x block renderers — `Prose`/`Slip`/`VerdictChip` (`wbShared.tsx`), `DerivationSlip`,
`DiagramSlip`, `VoiceControl`, `ProbeRow`, `ConceptMapSlip`, `ConsultMark`, page-cite chips — render
**unchanged** as objects on the Desk sheet, and the streaming ink-nib streams at the placed position.

### A.1 The renderers are pure presentational — import, don't fork

- `wbShared.tsx` exports `Prose: React.FC<{ text: string }>`, `Slip: React.FC<{ children; label? }>`,
  `VerdictChip: React.FC<{ verdict: CheckStepVerdict }>` — all self-contained, no tab imports.
- `DerivationSlip.tsx` default-exports `React.FC<{ block: TranscriptBlock; ordinalBase: number; check?: BlockCheck; compact?: boolean }>`.
  It renders `block.derivation.steps` (ids `${blockId}:${i}`), the `wb-step-justify` line, the
  `wb-goal-line`, and the goal chip — **no scroll, no store, no streaming imports**. It can mount
  anywhere, including the sheet.
- `DiagramSlip.tsx` sanitizes at render (`sanitizeDiagramSvg(d.svg)`, L24–27) and degrades honestly
  (`wb-figure-degraded`, L29–35). Self-contained.
- `VoiceControl`, `ProbeRow`, `ConceptMapSlip`, `ConsultMark`, `PageChip`, `BlockChips` live
  **inside `WorkbenchTab.tsx`** (L206–422) and take only props + `_()`. They are movable verbatim.

**Contract for the writer:** the Desk re-hosts the transcript by *extracting the block-body
composition* out of `WorkbenchTab.tsx` — not by copying it (campaign law 8: one surface, no split
brain).

### A.2 New file: `apps/readest-app/src/app/reader/components/notebook/blockBody.tsx`

A presentational component containing **exactly** the per-block JSX currently inline in
`WorkbenchTab.tsx` L1230–1316 (everything inside `<article …>`), plus the streaming placeholder
article (L1319–1343) as a second export. Signature:

```tsx
export const BlockBody: React.FC<{
  b: TranscriptBlock;
  blocks: TranscriptBlock[];              // for derivationOrdinal + learner compact folio
  check?: BlockCheck;
  resumeFirst: boolean;                   // i === 0 && !resumeNotice
  voice: VoiceControlProps;               // the 8 props VoiceControl takes today
  onOpenThread: (threadId: string) => void; // ConceptMapSlip
  onPickProbe: (blockId: string, stance: ProbeStance, message: string) => void;
  quoteForPage: (page: number) => string | null;
  onGoPage: (page: number) => void;
}> = …;

export const StreamingBody: React.FC<{
  partial: string;
  thinking: boolean;
  quoteForPage: (page: number) => string | null;
  onGoPage: (page: number) => void;
  // renderContent lives here, moved with it:
}> = …;
```

`renderContent` (WorkbenchTab.tsx L1187–1196, the `[Page N]` split → `PageChip`s + `Prose`) moves
into `blockBody.tsx` as a module-local function used by both exports. `WorkbenchTab.tsx` then
renders `<BlockBody …>` inside its existing `<article className='wb-block' data-bid={b.id}>` loop
(L1228) — **byte-identical output DOM**: same `wb-block`, `wb-byline` (`THE PROFESSOR` / `YOU`),
`wb-content`, `wb-voice`, `wb-map`, `wb-consult`, `wb-probe-row`, `wb-figure`, `wb-derive`,
`wb-teachback-caption`, `wb-idk`, `wb-chip-row`, `wb-sep` classes, same `data-bid` attribute
(already the scroll anchor: `scrollToBlock` queries `article[data-bid="${id}"]`, L1179–1185).

`DeskSheet.tsx` (d1-owned) imports `BlockBody`/`StreamingBody` and wraps each in the same
`<article data-bid={b.id}>` shell on the sheet. d3 owns `blockBody.tsx`; DeskSheet mounting is d1's.

### A.3 Streaming ink-nib at the placed position

The streaming machinery is **component-local today and stays component-local** (the 2026-09-06
crash-scar rule in `workbenchChat.ts`'s header: streaming partial text never enters the zustand
store). The Desk's sheet host (d1) owns its own instance, moved verbatim from `WorkbenchTab.tsx`:

- `beginStream` (L527), `streamCallbacks` (L549), `partialRef`, `phaseRef`, `genRef`,
  `abortRef`, `delayTimersRef`, constants `PLACEHOLDER_DELAY_MS = 400` / `THINKING_DELAY_MS = 3000`
  (L91–95) — same timers, same placeholder-after-400ms behaviour.
- The nib: `<span className='wb-nib' aria-hidden='true' />` (L1340) rides the token tail inside
  `.wb-prose.wb-streaming`; the mid-stream diagram guard — a complete ```svg fence mid-stream renders
  the muted `wb-figure-pending` line `_('The professor is drawing.')`, never raw SVG
  (`extractDiagramSvg(disp)`, L1322–1338) — moves with `StreamingBody` unchanged.
- **Placed position:** the streaming article mounts at the composer's anchor point on the sheet —
  i.e. immediately after the last committed block at the point where the learner's Enter landed.
  In the default fluid column (product default 3) that is simply the tail of the column; the
  existing **pinned follow** semantics apply verbatim: within `PIN_THRESHOLD_PX = 24` (L88) of the
  bottom the scroll stays pinned; new whole blocks get one smooth glide, token/chip updates are
  instant (`WorkbenchTab.tsx` L1259–1280 block-growth effect, `prefersReducedMotion()` →
  `behavior: 'auto'`, L109–112). Unpinned + growth → the `wb-scroll-chip` `_('New writing below')`
  offers the way back (L1355–1360). No yank, ever.
- `commitPartialIfAny` (L599–614) and the onError honest-paper commit (L577–584) move with the
  sheet host's copy of the machinery; both call `commitProfessorBlock(written, existing)` —
  the seam where the C2 guards fire.

### A.4 Placement fields (consumed, not owned)

`TranscriptBlock` gains `x?: number; y?: number; width?: number` additively (d2's spec; campaign
canvas model). d3's consumption contract: a block **without** the fields renders in the fluid
column; a block **with** them renders absolutely at `(x, y)` with the given `width`. Old
transcripts lack the fields → whole-subject mural renders as one column (law: old transcripts load).

---

## B. TRAFFIC-LIGHT RAIL

**Goal:** a fixed left-margin column on the Desk sheet, bound to `latestConceptMap` — green/sage =
known, amber/muted = edge, red/stamp = unknown — every chip a jump to its thread.

### B.1 Data seam (already built)

`latestConceptMap(blocks)` (`workbenchChat.ts` L236–237) returns the newest `ConceptMapData`
(`{ known, edge, unknown }` of `ConceptMapEntry { name; threadId }`, L26–36) carried by any block,
or null. `resolveConceptThreads` (L241–256) already maps each name to the most recent professor
block carrying `[CONCEPT:name]`, null for names not yet discussed. **The rail renders exclusively
from `latestConceptMap(useWorkbenchChatStore(s => s.blocks[bookKey]) ?? [])`.** It does not parse
tags, does not write state. The in-transcript `ConceptMapSlip` (WorkbenchTab.tsx L240–282) stays
exactly as it is; the rail is a second, fixed view over the same data.

### B.2 New pure helper in `workbenchChat.ts`

```ts
export type DeskShelf = 'known' | 'edge' | 'unknown';
export interface DeskRailEntry {
  name: string;
  shelf: DeskShelf;
  /** Transcript block id to scroll to; null → inert chip. */
  threadId: string | null;
}
/** The rail's row model: shelves in catalogue order (known, edge, unknown),
 *  names in shelf order, threadId carried through. null map → []. */
export function buildDeskRail(map: ConceptMapData | null): DeskRailEntry[];
```

Pure, side-effect free, testable without DOM.

### B.3 New component: `apps/readest-app/src/app/reader/components/notebook/DeskRail.tsx`

```tsx
const DeskRail: React.FC<{
  map: ConceptMapData | null;
  onOpenThread: (threadId: string) => void;
}> = ({ map, onOpenThread }) => {
  const _ = useTranslation();
  const entries = buildDeskRail(map);
  // render: <nav className='desk-rail' aria-label={_('The catalogue so far')}>
  //   per shelf: <p className='desk-rail-head'>{_(shelf head)}</p> then entries…
  //   threadId ? <button className='wb-chip desk-rail-chip desk-rail-{shelf}' … onClick>
  //            : <span className='wb-chip desk-rail-chip desk-rail-{shelf} desk-rail-dim'>
```

- Shelf heads **reuse the existing strings** `KNOWN` / `EDGE` / `UNKNOWN` (already in the `ConceptMapSlip` table).
- Clickable chip aria-label reuses the existing string `Open the thread on {{concept}}`.
- Empty shelf reuses `Nothing filed here yet`. Rail with `map === null` renders an empty frame
  (heads + `Nothing filed here yet`), matching the slip's never-empty posture.
- Tones: `desk-rail-known` → `--sage`; `desk-rail-edge` → `--muted` (the design world has no amber;
  "amber/muted" in the campaign contract is realised as muted — flag for audit); `desk-rail-unknown`
  → `--stamp`.
- Mount: inside d1's `DeskSheet` stage (absolute, left margin), passed
  `map={latestConceptMap(blocks)}` and `onOpenThread` (B.4). DeskRail.tsx/css are d3-owned;
  the DeskSheet mount line is d1's.

### B.4 The click-to-scroll contract (exact)

`DeskSheet` (d1) provides `onOpenThread`, mirroring `WorkbenchTab.scrollToBlock` (L1179–1185)
byte-for-byte in behaviour:

```ts
const scrollToBlock = useCallback((id: string) => {
  const target = sheetScrollRef.current?.querySelector(`article[data-bid="${id}"]`);
  target?.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth', // the WorkbenchTab helper, L109–112
    block: 'center',
  });
  // A jump unpins the follow exactly like a manual scroll (no yank back).
}, []);
```

- The query root is the **sheet's** scroll element, never `document` (the book underneath must not
  scroll — law 7).
- Stale threadId (block gone) → `querySelector` returns null → no-op. The chip is evidence, not a
  gate (same spirit as `goToPage`'s try/catch, L1169–1184).
- After the glide the sheet is unpinned; if growth later occurs, the `wb-scroll-chip` way-back
  appears — identical contract to the transcript today.
- Reduced motion → instant jump. No global shortcuts are added; the chips are real buttons in the
  Tab order (law: no mid-session buttons — these are the sanctioned, user-invoked navigation the
  `ConceptMapSlip` chips already are).

### B.5 New CSS: `apps/readest-app/src/app/reader/components/notebook/DeskRail.css`

Unlayered, existing vars only, corners ≤ 2px. (d1 may fold this block into `DeskSheet.css`; the
class names are fixed here either way.)

```css
/* DeskRail.css — the traffic-light spine (d3). Fixed left margin of the sheet;
 * a second view over latestConceptMap. Tones: sage = known, muted = edge,
 * stamp = unknown. */
.desk-rail {
  position: absolute;
  inset-inline-start: 0;
  top: 0;
  bottom: 0;
  width: 96px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-inline-end: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.desk-rail-head {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 8.5px;
  line-height: 1;
  letter-spacing: 0.08em;
  color: var(--muted);
  user-select: none;
  margin-top: 8px;
}

.desk-rail-head:first-child {
  margin-top: 0;
}

/* Chips composite the existing .wb-chip face (see .wb-voice-btn for the pattern). */
.desk-rail-chip {
  border-color: color-mix(in srgb, var(--ink) 25%, transparent);
  text-transform: none;
  letter-spacing: normal;
  font-size: 9.5px;
  padding: 2px 6px 1px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button.desk-rail-chip:hover {
  color: var(--stamp);
  border-color: var(--stamp);
}

.desk-rail-known {
  color: var(--sage);
  border-color: var(--sage);
}

.desk-rail-edge {
  color: var(--muted);
  border-color: var(--muted);
}

.desk-rail-unknown {
  color: var(--stamp);
  border-color: var(--stamp);
}

.desk-rail-dim {
  opacity: 0.7;
}

/* The sheet's fluid column keeps the measure; the rail steps aside on narrow sheets. */
@container (max-width: 559px) {
  .desk-rail {
    display: none;
  }
}
```

The rail has no animation of its own; the only motion is the scroll glide, already governed by
`prefersReducedMotion()` in JS.

### B.6 `_()` string table (rail)

| String | Status | Used in |
|---|---|---|
| `KNOWN` / `EDGE` / `UNKNOWN` | **reuse** (ConceptMapSlip table) | shelf heads |
| `The catalogue so far` | **reuse** | `aria-label` of the rail `<nav>` |
| `Open the thread on {{concept}}` | **reuse** | clickable chip aria-label |
| `Nothing filed here yet` | **reuse** | empty shelf |

No new rail strings — the rail speaks in the catalogue's existing vocabulary.

---

## C1. WIGGLY FOLIO REPLAY (folded 2.5)

**Goal (WIGGLYSTUFF.md §5, Route C — smallest lovable v1):** a learner-invoked, manually paced
step-through **on the existing folio** in `DerivationSlip.tsx`. Reveal rows one at a time; the prior
step stays dimmed up as a ghost at reduced opacity; the justification rides under the active step
(it already does — `wb-step-justify` renders per step); the GOAL line is framed at the end. One
transition: `transform+opacity, 420ms cubic-bezier(0.22, 1, 0.36, 1)`. Buttons + focus-scoped arrow
keys; reduced-motion fallback. Target: **~30 lines of state/logic in `DerivationSlip.tsx` + one CSS
block in `WorkbenchTab.css`.** No new protocol tag, no persistence, no new component file (Route C
explicitly; promote to Route B's staged widget only if dogfood asks).

### C1.1 Exact edits — `DerivationSlip.tsx`

Additive, inside the existing component (default export unchanged, all current props honoured):

```tsx
// Replay is ephemeral UI state over the persisted folio — never written back.
const [replayStep, setReplayStep] = useState<number | null>(null); // null = full folio shown
const total = d.steps.length;
const replaying = replayStep !== null;
// Focus scope for the arrow keys (wigglystuff's opt-in: ←/→ fire only once the
// controls hold focus, so reader keys are never stolen).
const replayKeysRef = useRef<HTMLDivElement | null>(null);
```

- **Invocation.** Under the folio title (non-compact only), one text button:
  `className='wb-chip wb-replay-btn'`, label `_('Step through this folio')`, `onClick` →
  `setReplayStep(0)` + `replayKeysRef.current?.focus()`. Hidden when `compact` (learner rows are
  a continuation, not a lecture) and when `total < 2`.
- **Row visibility** — pure helper exported for tests:

```tsx
export type ReplayRowState = 'ghost' | 'active' | 'hidden';
export const replayRowState = (index: number, active: number): ReplayRowState =>
  index < active ? 'ghost' : index === active ? 'active' : 'hidden';
```

  In the existing `d.steps.map` (L52–70), when `replaying`, each `wb-step-row` gets
  `wb-replay-ghost` / `wb-replay-active` / `wb-replay-hidden` per `replayRowState(i, replayStep)`.
  `hidden` rows render `display: none` (the folio keeps its natural height; see CSS note). The
  verdict chip stays attached to its step (CAS chips ride the replay, exactly as WIGGLYSTUFF §4
  Route B anticipated; Route C gets this for free since chips live in the row).
- **Pacing controls** (rendered only while `replaying`), a `<div className='wb-replay'
  ref={replayKeysRef} tabIndex={-1} onKeyDown={…}>`:

```tsx
const stepReplay = (next: number) =>
  setReplayStep(Math.min(Math.max(next, 0), total)); // total = the framed GOAL beat
```

  - `‹` `_('Back one step')` → `stepReplay(replayStep - 1)` (at 0 → closes: `setReplayStep(null)`).
  - `›` `_('Ahead one step')` → `stepReplay(replayStep + 1)`; on the last step the label switches
    to `_('Frame the goal')`.
  - Counter `_('Step {{n}} of {{total}}', { n: Math.min(replayStep + 1, total), total })`.
  - `_('Close the replay')` text button → `setReplayStep(null)`.
  - Keys (on the focus-scoped div only): `ArrowLeft` / `ArrowRight` = back/ahead, `Home` = first,
    `End` = goal beat, `Escape` = close. `preventDefault` only on these keys. **No global
    shortcuts** (law: no mid-session buttons/global keys; this is the sanctioned learner-invoked
    control).
- **Goal framing (the spotlight finale).** When `replayStep === total`:
  - with `d.goalLatex`: the existing `wb-goal-line` (L72–77) renders with an added
    `wb-replay-goal` class (stamp frame — the design world's one accent, per WIGGLYSTUFF §3.4);
    the step rows all ghost at 0.35 so the chain is visible but the goal owns the eye.
  - without `goalLatex`: the last `wb-step-row` itself wears `wb-replay-goal`.
  - Counter reads `{{total}} / {{total}}`; the justification caption is suppressed on this beat
    (the widget's finale suppresses the caption — same restraint).
- **Reduced motion:** no JS branch needed — the CSS transition is disabled under
  `prefers-reduced-motion: reduce` (same pattern as `WorkbenchTab.css` §12); reveals become
  instant. All pacing still works.

### C1.2 Exact edits — `WorkbenchTab.css` (one block)

```css
/* ---------- folio replay (d3, wigglystuff Route C) ---------- */
/* The single motion: 420ms ease-out on transform+opacity. Hidden rows are
 * display:none, so the transition is the ghost↔active crossfade — calm, not
 * flashy. Stamp appears only on the framed goal (the Q.E.D. gesture). */
.wb-replay {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.wb-replay-btn:focus-visible {
  border-color: var(--stamp);
  box-shadow: 0 0 0 1px var(--stamp);
}

.wb-replay-count {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 8.5px;
  letter-spacing: 0.08em;
  color: var(--muted);
  user-select: none;
}

.wb-step-row.wb-replay-ghost {
  opacity: 0.35;
  transform: translateY(-1px);
}

.wb-step-row.wb-replay-hidden {
  display: none;
}

.wb-step-row.wb-replay-ghost,
.wb-step-row.wb-replay-active {
  transition:
    opacity 420ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.wb-goal-line.wb-replay-goal,
.wb-step-row.wb-replay-goal {
  border: 1px solid var(--stamp);
  border-radius: 2px;
  padding: 6px 8px;
}

@media (prefers-reduced-motion: reduce) {
  .wb-step-row.wb-replay-ghost,
  .wb-step-row.wb-replay-active {
    transition: none;
  }
}
```

(Also inside the existing `@container (max-width: 239px)` rule: `.wb-replay { flex-direction: column; align-items: flex-start; }` — one line, matching the probe-row treatment.)

### C1.3 `_()` string table (replay)

| String | Where |
|---|---|
| `Step through this folio` | invocation button |
| `Back one step` | ‹ button |
| `Ahead one step` | › button (mid-replay) |
| `Frame the goal` | › button on the last step |
| `Step {{n}} of {{total}}` | counter |
| `Close the replay` | close button |

---

## C2. PENECHO GUARDS (folded 2.5)

All three are **pure-function guards in `workbenchChat.ts`** (enforced outside the model, porting
penecho M4/M3/M5 — "model tool calls cannot reset it") + at most one additive addendum sentence in
`services/professor/professorTags.ts`'s sibling `services/professor/prompt.ts`. None changes
`TranscriptBlock['kind']`, the tag vocabulary, or the transcript version.

### C2.i Per-turn professor artifact budget — **three shapes per exchange**

**Decision:** the cap is **3** professor artifact blocks per exchange — a folio (`derivation`) or a
figure (`diagram`) each count as one shape; prose blocks are uncapped. Chosen because one exchange
today commits 1–2 professor blocks (`commitPartialIfAny` L599 + onDone L633), so 3 leaves headroom
for the honest-paper partial commit while making "the professor wallpapered the sheet" impossible;
penecho's own stop policy is similarly small and hard.

**Seam — `commitProfessorBlock` (workbenchChat.ts L281) already receives `existing`.** Add:

```ts
/** Penecho M4 port: at most this many folio/figure (artifact) blocks per
 *  exchange. The exchange boundary is the most recent learner block. */
export const MAX_ARTIFACT_BLOCKS_PER_EXCHANGE = 3;

/** Artifact blocks (carrying a derivation or a diagram) since the last user
 *  block — the exchange's running shape count. */
export function professorArtifactCount(blocks: TranscriptBlock[]): number;

/** True when the budget is spent: another artifact this exchange must be
 *  muted. Prose never consults this. */
export const artifactBudgetSpent = (blocks: TranscriptBlock[]): boolean =>
  professorArtifactCount(blocks) >= MAX_ARTIFACT_BLOCKS_PER_EXCHANGE;
```

Inside `commitProfessorBlock`, gate the two payload branches (the `parsed.diagram` branch L316–322
and the `parsed.derive` branch L324–349): if `artifactBudgetSpent(existing)`, the payload is
**muted** — `block.derivation` / `block.diagram` is NOT set (the raw math/fence text was already
stripped from display by the tag parse, so the block lands as clean prose) — and the block content
gains a muted librarian note line:

```
_('The professor sets down his pen — one shape at a time.')
```

appended to `parsed.display` before assigning `block.content` (it prints as ordinary prose on
paper; no new tag, no new field). The budget reopens at the next learner block automatically
(`professorArtifactCount` counts only since the last `author: 'user'` block). **One additive
addendum sentence** in `prompt.ts`: *"Commit at most one folio or figure in an answer; after the
third shape of an exchange the desk sets down the pen."* (additive-only, librarian voice, pinned by
test 10 below.)

### C2.ii Diagram self-check stop condition (currently honor-system)

Today a `[DIAGRAM]` whose fence is missing or whose SVG fails the allowlist still commits a
`diagram` block and relies on `DiagramSlip`'s render-time degrade (`wb-figure-degraded`,
`The figure could not be mounted.`). The professor is trusted not to keep drawing — nothing stops
the figure stream. **Spec:** check the figure at **commit time** inside `commitProfessorBlock`'s
diagram branch, using the same vetted sanitizer (`sanitizeDiagramSvg`, `diagramSvg.ts`) — sanitize
→ decide, in that order, in addition to the existing render-time sanitize → render (policy
unchanged):

```ts
const extracted = extractDiagramSvg(parsed.display);
const clean = sanitizeDiagramSvg(extracted.svg);
if (!clean) {
  // The figure would not hold its ink. The claim stands as words (the
  // degrade copy already exists at render time); the turn's figure slot is
  // consumed, so the professor cannot retry the figure inside this exchange.
  block.content = `${extracted.display}\n\n${_("The figure would not hold its ink; the claim stands as words.")}`;
} else {
  block.diagram = { claim: parsed.diagram.claim, svg: extracted.svg };
  block.content = extracted.display;
}
```

- A failed figure **counts against the C2.i budget** (the exchange's shape count increments — the
  guard is "figure slot consumed", enforced by having `professorArtifactCount` count the attempt;
  the cleanest implementation: increment the count for muted attempts too, per the test below).
  The retry reopens on the next learner message — exactly penecho's "a later explicit user message
  opens a fresh bounded budget."
- Empty `extracted.svg` (no fence) takes the existing path untouched: `diagram: { claim, svg: '' }`
  degrades at render as today — a missing fence is an authoring slip, not a failed drawing, and
  does not consume the stop.
- The mid-stream placeholder (`wb-figure-pending`, WorkbenchTab.tsx L1326–1336) is unaffected: it
  renders only while `phase !== 'idle'`; a committed-and-muted figure leaves no placeholder
  residue because the placeholder lives in the streaming article, not the committed block.

### C2.iii Concept shelves move at most one step per exchange

**Seam:** `resolveConceptThreads` (workbenchChat.ts L241) is called from `commitProfessorBlock`
(L297–299) with the shelves just parsed. Insert a clamp between parse and resolve:

```ts
/** Shelf order for the one-step rule. */
const SHELF_ORDER: Record<DeskShelf, number> = { known: 0, edge: 1, unknown: 2 };
/** Inverse: the shelf one step toward `target`. */
const stepShelf = (from: DeskShelf, toward: DeskShelf): DeskShelf =>
  Math.abs(SHELF_ORDER[toward] - SHELF_ORDER[from]) <= 1
    ? toward
    : SHELF_ORDER[toward] > SHELF_ORDER[from]
      ? 'edge' === from && toward === 'unknown' ? 'unknown' : ((Object.keys(SHELF_ORDER) as DeskShelf[]).find((s) => SHELF_ORDER[s] === SHELF_ORDER[from] + Math.sign(SHELF_ORDER[toward] - SHELF_ORDER[from]))!)
      : toward; // (writer: implement as a plain if/else over the 3×3 cases — keep it readable)

/** Penecho M5 port (the evaluation cursor): relative to the shelves the
 *  latest concept map filed, a concept may move at most ONE shelf per
 *  professor commit. Names new to the map file where the professor puts
 *  them (first filing is not a move). Pure. */
export function clampConceptShelves(
  prev: ConceptMapData | null,
  next: ConceptMapShelves,
): ConceptMapShelves;
```

Wire-in at L297:

```ts
if (parsed.conceptMap) {
  const shelves = clampConceptShelves(latestConceptMap(existing), parsed.conceptMap);
  block.conceptMap = resolveConceptThreads(existing, shelves);
}
```

(`ConceptMapShelves` is already imported at workbenchChat.ts L19; `latestConceptMap` is in the same
file.) One additive addendum sentence in `prompt.ts`: *"File a concept at most one shelf from where
the catalogue last held it."*

---

## Test plan — 10 vitest cases (pure-function idiom, matching `workbench-derivation.test.ts`)

Repo idiom is pure-function contract tests (fetch stubbed where needed); no component rendering
required for these seams.

**New `apps/readest-app/src/__tests__/notebook/workbench-guards.test.ts`** (C2 — 5 cases):

1. **Budget mutes the 4th shape.** Build `existing` = user block + 3 professor blocks each carrying
   a `derivation` (via `commitProfessorBlock` on `[DERIVE …]` raws). A 4th
   `commitProfessorBlock('[DERIVE title:…]\n$$a=b$$', existing)` returns a block with
   `derivation === undefined`, prose content intact, and content containing
   `one shape at a time`.
2. **Budget counts folios and figures together; prose is free.** existing = user + folio + figure +
   prose professor blocks; a second folio in the same exchange is muted; committing three prose
   blocks in a row never mutes anything.
3. **Budget reopens at the learner's word.** existing ends with a `author: 'user'` block → the next
   folio commits with its `derivation` intact.
4. **Figure stop condition.** `commitProfessorBlock` on a `[DIAGRAM claim:…]` raw whose fence holds
   `<script>…` (fails `sanitizeDiagramSvg`): `block.diagram === undefined`, the claim text remains
   in `block.content`, the content carries `would not hold its ink`, and the exchange's artifact
   count incremented (a further folio in the same exchange is muted one shape earlier). Control: a
   well-formed REAL_FIGURE (reuse the fixture from `diagram-svg.test.ts`) commits `diagram` with the
   svg intact.
5. **One-step shelf clamp.** `latestConceptMap` = all concepts `known`; a new `[CONCEPTS]` block
   filing one concept as `unknown` lands it on `edge` (one step down). New name files freely on any
   shelf. A concept absent from the map stays absent. (`clampConceptShelves` called both directly
   and through `commitProfessorBlock`.)

**New `apps/readest-app/src/__tests__/notebook/desk-rail.test.ts`** (B — 2 cases):

6. **buildDeskRail flattens in catalogue order.** A `ConceptMapData` with entries in all three
   shelves (mix of `threadId` set/null) → entries ordered known→edge→unknown, shelf tones
   attached, null `threadId` preserved as inert; `buildDeskRail(null)` → `[]`.
7. **Round-trip through latestConceptMap.** Blocks built by `commitProfessorBlock` from
   `[CONCEPTS known:… edge:… unknown:…]` + `[CONCEPT:name]` raws → `buildDeskRail(latestConceptMap(blocks))`
   resolves each name to the **latest** professor block id (mirrors the existing
   `workbench-pedagogy.test.ts` L145 thread-resolution case, now through the rail model).

**New `apps/readest-app/src/__tests__/notebook/workbench-replay.test.ts`** (C1 — 2 cases):

8. **replayRowState.** `replayRowState(0, 0) === 'active'`; `replayRowState(0, 2) === 'ghost'`;
   `replayRowState(2, 1) === 'hidden'` (imported from `DerivationSlip.tsx`).
9. **The goal beat.** With the replay exported constant `REPLAY_GOAL = Number.POSITIVE_INFINITY`? —
   no: assert via a tiny exported predicate instead: `replayFramesGoal(active: number, total: number): boolean`
   (`active === total`) is true only on the final beat, and the frame class it selects is
   `wb-replay-goal` (string constant export `REPLAY_GOAL_CLASS`). Keeps the finale logic testable
   without DOM.

**Extend `apps/readest-app/src/__tests__/notebook/workbench-chat.test.ts`** (A — 1 case):

10. **Placement fields round-trip.** A block with `x: 120, y: 480, width: 320` survives
    `serializeTranscript` → `parseTranscript` unchanged (additive-field persistence guarantee the
    Desk sheet relies on; parses as `{}`-safe on old files — `parseTranscript` already ignores
    unknown fields by structural typing, assert an old-version file without the fields still loads).

---

## File-touch lists

**New files (d3-owned):**
- `apps/readest-app/src/app/reader/components/notebook/blockBody.tsx` (A.2)
- `apps/readest-app/src/app/reader/components/notebook/DeskRail.tsx` (B.3)
- `apps/readest-app/src/app/reader/components/notebook/DeskRail.css` (B.5)
- `apps/readest-app/src/__tests__/notebook/workbench-guards.test.ts`
- `apps/readest-app/src/__tests__/notebook/desk-rail.test.ts`
- `apps/readest-app/src/__tests__/notebook/workbench-replay.test.ts`

**Edited files:**
- `apps/readest-app/src/app/reader/components/notebook/DerivationSlip.tsx` — replay state + 2
  exported test helpers (~30 lines additive; default-export props unchanged).
- `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` — `buildDeskRail` +
  types; `MAX_ARTIFACT_BLOCKS_PER_EXCHANGE`, `professorArtifactCount`, `artifactBudgetSpent`;
  commit-time diagram sanitize branch; `clampConceptShelves` + wire-in at L297.
- `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx` — swap the inline
  block-body JSX for `<BlockBody>` / `<StreamingBody>` imports (output DOM byte-identical).
- `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.css` — one `wb-replay-*` block
  + one line in the 239px container query.
- `apps/readest-app/src/services/professor/prompt.ts` — two additive addendum sentences (C2.i, C2.iii).
- `apps/readest-app/src/__tests__/notebook/workbench-chat.test.ts` — add case 10.
- d1's `DeskSheet.tsx` (+ its css) — mount `BlockBody` loop, `StreamingBody`, and `<DeskRail>`;
  d1 writes these lines, this spec fixes the contracts they must satisfy.

**Explicitly untouched:** `DiagramSlip.tsx` (render-time sanitize policy stands; C2.ii lives at
commit time), `diagramSvg.ts`, `wbShared.tsx`, `mathCheck.ts`, `professorTags.ts`,
`workbenchSession.ts`, the persistence round-trip (TRANSCRIPT_VERSION stays 1 — all fields additive).

## Overlap register (for the audit)

| File | d3 touches | Likely d1 owner | Likely d2 owner |
|---|---|---|---|
| `DeskSheet.tsx` / `DeskSheet.css` | consumes BlockBody/StreamingBody/DeskRail; mounts rail | **owns** (sheet host, toggle, slide, composer, scroll-follow) | — |
| `blockBody.tsx` | **owns** | consumer | consumer |
| `workbenchChat.ts` | guards + rail helper + clamp | — | **owns** (placement fields `(x,y,width)`, transcript versioning) |
| `WorkbenchTab.tsx` | re-exports via BlockBody | — | **owns** (sidebar removal, product default 1) |
| `WorkbenchTab.css` | one replay block | — | touched by removal wave |
| `DerivationSlip.tsx` | replay | — | — |
| `prompt.ts` | two addendum sentences | — | — (lane A heritage) |

## Open questions

1. **Edge-shelf tone.** Campaign says "amber/muted"; the Antiquarian Catalogue has no amber and
   stamp is the sole accent. Spec'd muted — does the owner want a one-off amber, or is muted the
   ruling? (Recommend muted; flag for review gate.)
2. **Rail below 560px.** Spec'd: rail hidden (the in-transcript `ConceptMapSlip` remains the
   narrow-view fallback). Alternative: collapsible rail drawer. Owner call at dogfood.
3. **Budget number 3.** One exchange commits 1–2 professor blocks today; 3 caps the Desk-era
   multi-block professor without touching honest-paper partial commits. Owner may prefer 2.
4. **Failed figure consumes budget** (C2.ii) — penecho-faithful ("repeated issue ends the loop") but
   stricter than the campaign note's plain "stop the figure stream." Confirm at review.
5. **Workbench tab removal timing** (d2): BlockBody extraction lands first; removal is d2's wave.
   The empty-state/start-session UI moves to the Desk with it — d1/d2 must sequence before
   campaign verification gate 8 (old sidebar transcript still loads).
