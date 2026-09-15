# S3 — Structured Derivations & Diagram Blocks (Workbench 2.x, owner items 3 & 4)

**Lane owner:** A (pedagogy+derivations+diagrams share one block model — one writer).
**Campaign law:** `docs/WORKBENCH_2_X_CAMPAIGN.md` is binding. Everything here is
**additive-only**: no existing exported signature, tag, CSS class, or prompt
paragraph changes meaning; every schema extension is optional on the block.
**Design world:** The Antiquarian Catalogue — librarian voice, stamp `#8C3B22`
(exposed as `var(--stamp)`) is the sole accent, light mode, unlayered CSS, no
machinery talk, no chat bubbles, no mid-session buttons, protocol tags never
displayed raw.

A derivation is entered in the ledger as a numbered **folio**; a diagram is
mounted as a **figure slip** with its claim printed beneath it. The desk's
rules below are written so a writer who has never seen this conversation can
build the feature cold.

---

## 0. Files touched (all owner A)

| File | Change |
|---|---|
| `apps/readest-app/src/services/professor/professorTags.ts` | Add `DERIVE`, `STEP`, `DIAGRAM` to the pass-1 protocol scan (additive). |
| `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` | `TranscriptBlock` extension, `BlockCheck` extension, `commitProfessorBlock` builds derivation/diagram metadata, `summarizeChecks` extension. |
| `apps/readest-app/src/services/professor/diagramSvg.ts` | **New.** SVG extraction from the display markdown + `sanitizeDiagramSvg` (DOMPurify allowlist). |
| `apps/readest-app/src/services/professor/prompt.ts` | Additive sections appended inside `PROFESSOR_WORKBENCH_ADDENDUM` only (see §5). |
| `apps/readest-app/src/app/reader/components/notebook/MathField.tsx` | Two additive props: `autoFocus?`, `compact?`. |
| `apps/readest-app/src/app/reader/components/notebook/DerivationSlip.tsx` | **New renderer.** The numbered folio + step chips + goal line. |
| `apps/readest-app/src/app/reader/components/notebook/DiagramSlip.tsx` | **New renderer.** The figure slip (sanitized SVG + claim caption). |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx` | Mount the two new renderers; silent check covers derivation blocks (professor's folios too); composer popover gains step/justify pair mode. |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.css` | New `wb-` classes only (§7). |
| `apps/readest-app/src/__tests__/notebook/workbench-derivation.test.ts` | **New** test file (§8.1). |
| `apps/readest-app/src/__tests__/services/diagram-svg.test.ts` | **New** test file (§8.2). |
| `apps/readest-app/src/__tests__/services/professor-tags.test.ts` | **Additive** describe-block only — existing cases untouched. |
| `apps/readest-app/src/__tests__/services/professor-prompt.test.ts` | **Additive** describe-block only — existing cases untouched. |

Writer gate: `npx tsc --noEmit` + focused vitest green + no new lint errors in
touched files (campaign verification gate 1).

---

## 1. Existing code this spec stands on (verified)

- `workbenchChat.ts` — `TranscriptBlock extends WorkbenchBlock` (line 30);
  `commitProfessorBlock(raw, existing)` (line ~150) consumes
  `parseProfessorTags(raw)` into metadata; `BlockCheck` union (line 39);
  `summarizeChecks(checks)` (line ~108) already numbers steps with a **global
  ordinal** (`stepNo` accumulator, line ~112); `extractMathSteps(content, idPrefix)`
  (line ~91) yields `{ id: \`${idPrefix}:${i}\`, latex }` capped at
  `MAX_STEPS_PER_CHECK = 8` (line 23); `serializeTranscript`/`parseTranscript`
  round-trip with `TRANSCRIPT_VERSION = 1`; `isBlock` validates only
  `id`/`author`/`content`/`at` — **kind and all new fields pass through
  unchecked**, which is what makes additive extension safe.
- `workbenchSession.ts` line 46 — `kind?: 'greeting' | 'question' | 'feedback'
  | 'derivation' | 'answer' | 'meta'` — the string `'derivation'` is already in
  the union; we hang structured data off a new optional field, not off `kind`.
- `mathCheck.ts` — `checkDerivation(steps, goalLatex?, opts?)` (line ~180) POSTs
  `{ steps: [{id, latex}], goal_latex? }` to the sidecar and returns
  `CheckDerivationResult { steps: CheckStepVerdict[], goal?: {reached, byStep},
  engine?, unavailable? }`. **The whole-derivation check already exists on the
  wire** — adjacent-step pairwise comparison plus an optional goal. The
  snake_case mapping (`prev_value`→`prevValue`, `by_step`→`byStep`,
  `elapsed_ms`→`elapsedMs`) is pinned by `mathcheck.test.ts`.
- `professorTags.ts` — two-pass scanner: pass 1 `PROTOCOL_TAG` (line ~48)
  captures `[CONCEPT|QKIND|WORKBENCH|POINT]` even inside `$$` shields; pass 2
  `TAG_PATTERN` (line ~44) strips unknown ALL-CAPS tags outside math. Contract:
  case-sensitive, malformed brackets pass through, math never mangled.
- `WorkbenchTab.tsx` — `runSilentCheck` (line ~410) filters
  `b.author === 'user'`; `contentHash` (line ~68) dedupes re-checks per block id;
  echo mode (`unavailable`) records **no hash** so the next turn retries;
  `CHECK_BUDGET_MS = 2500` caps how long the professor may be held.
- `MathField.tsx` — `onCommit` fires on blur + Enter (non-Shift); controlled
  `value`; hard rule: mounted only via `next/dynamic` `ssr: false` (kept).
- `sanitize.ts` — DOMPurify precedent (`dompurify@^3.4.0` is already a
  dependency of `apps/readest-app`, package.json line 171). Diagram sanitizer
  follows the same allowlist idiom but is a separate, stricter policy.

---

## 2. Tag grammar (additive to the professor protocol; never displayed raw)

Case-sensitive, own line each, parsed by `professorTags.ts` pass 1 (so they are
captured even inside an unterminated `$$` shield, exactly like the existing
four). The `display` string keeps the step math and the justification prose;
the tags themselves leave no trace.

### 2.1 Derivation open

```
[DERIVE title:The quadratic formula goal:x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}]
```

- `title:…` — optional; everything up to the *last* ` goal:` marker (or end of
  line) is the title. A title without a goal is `[DERIVE title:Why the series
  diverges]` or bare `[DERIVE]`.
- `goal:…` — optional; LaTeX, becomes `goal_latex` in the `/check` POST. May be
  absent (a derivation that argues rather than arrives).
- Parsed into `parsed.derive?: { title?: string; goal?: string }`.

### 2.2 Step marker

```
[STEP 3 /CHECKED ok]
```

- Emitted by the professor **after** the step's `$$…$$` display block and its
  justification line. The `/CHECKED ok|bad` tail is the professor's private
  self-report; it is captured but **never displayed** and never overrides the
  CAS.
- Parsed into per-step entries; **the desk ignores the professor's numeral and
  numbers steps itself** (global ordinal, §3.3) — a miscounted professor cannot
  corrupt the ledger.
- A plain `[STEP]` (no numeral) is legal and preferred; the captured ordinal is
  the desk's, not the tag's.

### 2.3 Diagram

```
[DIAGRAM claim:The three angles of a triangle sum to 180 degrees]
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">…</svg>
```
```

- `claim:…` — **required**; one sentence, phrased so it can sit verbatim under
  the figure as its caption (the learn-visual self-check, §6.2). Empty claim →
  the tag captures nothing and the block degrades to plain prose (§3.5).
- The SVG travels in a fenced code block labelled exactly ` ```svg `, fenced
  with triple backticks, immediately after the tag line. Extraction is done by
  `extractDiagramSvg` in `diagramSvg.ts` on the **parsed display string** — not
  by the tag scanner — so pass-2 math-shield rules are untouched.
- Parsed into `parsed.diagram?: { claim?: string }` (claim only; the SVG comes
  from the fence).

### 2.4 ParsedProfessorMessage extension (professorTags.ts)

```ts
export interface ParsedProfessorMessage {
  display: string;
  concept?: string;
  qkind?: string;
  end?: boolean;
  point?: string;
  /** [DERIVE title:.. goal:..] — a derivation folio opens in this block. */
  derive?: { title?: string; goal?: string };
  /** [STEP n /CHECKED ok|bad] — in display order; the desk renumbers. */
  stepMarks?: { professorChecked?: 'ok' | 'bad' }[];
  /** [DIAGRAM claim:..] — a figure slip; the SVG rides in a ```svg fence. */
  diagram?: { claim?: string };
}
```

Implementation notes (binding):
- Extend `PROTOCOL_TAG` to `/(DERIVE|STEP|DIAGRAM|CONCEPT|QKIND|WORKBENCH|POINT)(?::([^\]\n]*))?/`.
- `STEP` value parse: `/^\s*\d+\s*(?:\/CHECKED\s+(ok|bad))?\s*$/` →
  `{ professorChecked }`; any other value captures `{}` (the mark still
  consumes the tag). Unknown `/CHECKED` values capture `{}` too — degrade, never
  throw.
- `DERIVE` value parse: split on the **last** ` goal:`; the head loses its
  leading `title:` if present. `goal:` after an empty title is legal.
- `DIAGRAM` value: trimmed; empty → do not set `parsed.diagram` (tag consumed,
  nothing built — graceful prose).
- These names are ALL-CAPS and cannot legitimately appear in math, so the
  pass-1-everywhere rule (existing contract, professorTags.ts header) applies
  unchanged. `[0,1]`, `[A]`, matrix literals survive as today.

---

## 3. Block schema extensions (workbenchChat.ts — additive)

### 3.1 Types

```ts
export interface DerivationStep {
  /** Stable id: `${blockId}:${i}` — same convention as extractMathSteps. */
  id: string;
  latex: string;
  /** The prose line under the step, when the professor offered one. */
  justification?: string;
  /** The professor's private self-report from [STEP n /CHECKED ..]. */
  professorChecked?: 'ok' | 'bad';
}

export interface DerivationData {
  title?: string;
  goalLatex?: string;
  steps: DerivationStep[];
  /** Filled by the silent check; absent until then. */
  goalReached?: boolean;
  goalByStep?: string;
}

export interface DiagramData {
  /** From [DIAGRAM claim:..]; also the figcaption and the aria-label. */
  claim: string;
  /** Raw SVG from the ```svg fence, sanitized at RENDER time only. */
  svg: string;
}
```

`TranscriptBlock` gains two optional fields (nothing else changes):

```ts
  /** [DERIVE ..] + $$ steps — a numbered folio. */
  derivation?: DerivationData;
  /** [DIAGRAM ..] + ```svg fence — a figure slip. */
  diagram?: DiagramData;
```

### 3.2 `commitProfessorBlock` — additive build logic

After the existing `parseProfessorTags` call, add (pure, in this order):

1. If `parsed.diagram?.claim`: `const { svg, display } = extractDiagramSvg(parsed.display)`;
   set `block.diagram = { claim: parsed.diagram.claim, svg }` and use `display`
   as the block content (the fence never reaches the eye; if no fence was
   found, `svg` is `''` and the renderer prints the claim as prose — §3.5).
2. If `parsed.derive` or any `$$…$$` display blocks exist in the display while a
   `derive` tag was seen: build `block.derivation` — every complete
   `$$…$$` segment becomes a `DerivationStep` in order (`id: ${block.id}:${i}`),
   the immediately-following non-tag prose line (if any, before the next `$$`
   or block end) becomes `justification`, and `parsed.stepMarks[i]` (when
   present) supplies `professorChecked`. `title`/`goalLatex` come from
   `parsed.derive`.
3. A block with a `derive` tag but zero `$$…$$` segments yields
   `derivation.steps = []`; the renderer shows the title as prose and an empty
   folio never renders (§3.5).
4. `kind: 'greeting'` rule and all existing metadata untouched.

`stripPartialTagTail` needs **no change** — its pattern
`/[ \t]*\[[A-Z][A-Z0-9_-]*(?::[^\]\n]*)?\]?(?=[ \t\n]*$)/` already matches
`[DERIVE …]`/`[STEP …]`/`[DIAGRAM …]` at the tail (names are
`[A-Z][A-Z0-9_-]*`).

**Streaming holdback for the svg fence:** in `WorkbenchTab.tsx` the streaming
branch currently renders
`parseProfessorTags(stripPartialTagTail(partial)).display`. Add: run the same
`extractDiagramSvg` on that display; when an svg fence is present mid-stream,
render a muted placeholder (`wb-figure-pending`, string table §9) in its place —
raw SVG never streams into the DOM uncommitted, and the paper never flickers
markup.

### 3.3 Global-ordinal numbering (pure helper, added to workbenchChat.ts)

```ts
/** Steps in derivation blocks are numbered with one running ordinal across
 *  the whole transcript — no two "step 1"s in the sitting. The ordinal is
 *  DERIVED from block order at render time, never stored (a stored ordinal
 *  would go stale when the learner appends a step). */
export function derivationOrdinal(
  blocks: TranscriptBlock[],
  blockId: string,
  stepIndex: number,
): number
```

Semantics: sum `derivation.steps.length` over every block **before** `blockId`
that carries `derivation`, plus `stepIndex + 1`. The folio header prints
`DERIVATION {{n}}` where `n` is the ordinal of its first step; each step row
prints its own ordinal. Ties are impossible — block ids are unique.

### 3.4 `BlockCheck` extension (additive union member)

```ts
export type BlockCheck =
  | { status: 'checking' }
  | { status: 'done'; verdicts: CheckStepVerdict[]; goal?: { reached: boolean; byStep?: string } }
  | { status: 'unavailable' };
```

Existing two members are byte-identical; renderers treat the absent `goal` as
"no goal was set."

### 3.5 Graceful degradation (campaign non-negotiable 5)

- Unknown `kind` from an old/new transcript → renders as plain prose today
  (`isBlock` ignores `kind`) — unchanged, add a regression test.
- Derivation block, sidecar away → echo mode as today: `unavailable`, no marks,
  no hash recorded, folio still fully readable.
- Diagram block with `svg: ''` (fence missing/garbled) → `DiagramSlip` renders
  the claim as a `Prose` paragraph with a `wb-figure-missing` hairline note
  (string table §9) — never an empty box, never a crash.
- Sanitizer output that ends up empty → same missing-figure path.
- A 2.1 transcript (`version: 1`, no derivation/diagram fields) loads, saves,
  and renders exactly as today.

---

## 4. CAS checking — per step AND as a whole unit

**One POST per stale derivation block, not two.** `checkDerivation` already
compares adjacent steps pairwise and checks the goal in a single call.

### 4.1 `runSilentCheck` change (WorkbenchTab.tsx)

Additive widening of the candidate filter (currently
`b.author === 'user' && extractMathSteps(b.content, b.id).length > 0`):

- A block with `block.derivation` whose `steps.length > 0` is a candidate
  **regardless of author** — the professor's folios are marked too; the desk
  does not grade only the learner's paper.
- For such a block: `extractMathSteps` is bypassed; steps submitted are
  `block.derivation.steps.map(s => ({ id: s.id, latex: s.latex }))`, sliced to
  `MAX_STEPS_PER_CHECK = 8` (existing cap, unchanged) with **the same
  prefix-slice rule** (first 8 in order — document it in the folio: step 9+
  simply wears no chip).
- `checkDerivation(steps, block.derivation.goalLatex)` — `goal_latex` rides the
  same POST (wire shape pinned by mathcheck.test.ts).
- Result mapping: `setCheck(bookKey, block.id, { status: 'done', verdicts: <in
  submission order, by id>, goal: result.goal })`; `unavailable` →
  `{ status: 'unavailable' }` and **no hash** (quiet retry next turn). The
  existing `byId` fallback `?? { id, status: 'ok' }` (WorkbenchTab.tsx line
  ~455) is preserved verbatim.
- Store `goalReached`/`goalByStep` back onto the block's `derivation` field at
  check time so a resumed sitting keeps the verdicts (transcript is persisted
  on every `blocks` change — the existing save effect covers it).

### 4.2 `summarizeChecks` extension (additive)

After the existing loop, if any `done` check carries `goal`, append
`` `; goal ${goal.reached ? 'reached' : 'not reached'}${goal.byStep ? ` by ${goal.byStep}` : ''}` ``
to the summary line. Existing summaries without goals are byte-identical
(guarded by the current tests). The professor reads e.g.
`checker: step 1 equivalent; step 2 not_equivalent, counterexample x=0 gives 3
vs 2; goal reached by blk_…:2`.

### 4.3 Verdict chips on the folio

`DerivationSlip` reuses the existing `VerdictChip` component verbatim (it is
exported from `WorkbenchTab.tsx` or moved — see open question §10 — but its
props `{ verdict: CheckStepVerdict }` and tone classes `wb-chip-sage` /
`wb-chip-stamp` / `wb-chip-muted` stay byte-identical). Whole-derivation result
renders as one goal chip after the last step row:

- reached → `wb-chip wb-chip-sage`, glyph `✓`, label `_('Reaches the goal')`
- not reached → `wb-chip wb-chip-stamp`, glyph `✗`, label `_('Does not reach the goal')`
- no goal → no chip.

---

## 5. Prompt addendum text (additive-only; librarian voice)

Append the following sections to `PROFESSOR_WORKBENCH_ADDENDUM` in
`apps/readest-app/src/services/professor/prompt.ts`, after the existing
"Citations:" paragraph. Nothing above changes; `professor-prompt.test.ts`
guards the original text — add only new assertions (§8.4). This text teaches
**when to derive vs explain** and **the diagram self-check**:

```
STRUCTURED DERIVATIONS — when a chain of equalities is the lesson, do not bury it in prose. Open a folio:

[DERIVE title:What the substitution buys us goal:x = 2]
$$x + 3 = 5$$
both sides keep their balance when the same number leaves each
[STEP /CHECKED ok]
$$x = 2$$
the goal, restated plain
[STEP /CHECKED ok]

Rules of the ledger. Derive — do not merely explain — when the reader must SEE a chain of transformations: a calculation, an estimate, a proof no longer than a page. For definitions, stories, and one-line answers, stay in prose; a folio for a sentence is clutter. Every step is a $$ display block on its own; under it, one short line saying WHY the step is permitted — name the rule, the identity, the inequality that allows it; "algebra" is not a justification. The goal: field is the line you are steering toward, in LaTeX; omit it when the argument, not a destination, is the point. Mark your own work honestly with [STEP n /CHECKED ok|bad] — the desk renumbers and checks every step regardless, and a step the engine cannot read is called a parse error, never wrong. If the engine is away, no marks appear and no one is blamed. When the reader appends a step to your folio, judge it against the book's standards and answer in words, not by editing their step.

FIGURES — draw only what words cannot say. When a picture carries the claim — a triangle, a contour, a commutative diagram, the shape of a function — open a figure slip:

[DIAGRAM claim:The three angles of a triangle sum to 180 degrees]
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">…</svg>
```

The self-check, before you send: the picture must SHOW the claim. Read the claim aloud, then look at the drawing — if the claim cannot be seen in it, redraw or stay in prose. The claim is printed under the figure as its caption, so phrase it as one plain sentence a reader could verify against the drawing. Draw in black ink; one accent (a single marked angle, one dashed auxiliary line) may carry the argument. Keep the viewBox tight and the drawing uncluttered — a textbook figure, not a poster. Text inside the SVG is set small and only as labels. Never put prose in place of a drawing, and never draw when the page's own figure already says it — point at the page instead.
```

(The ``` inside the addendum text is a literal triple backtick in the template
string — write it as-is; the prompt is a JS template literal so no escaping is
needed beyond the existing backtick-delimited string: **wrap the addendum in
backticks? No.** `PROFESSOR_WORKBENCH_ADDENDUM` is itself a template literal —
a literal ``` sequence inside it would terminate the string. Use the escape:
write the fence as `` \`\`\`svg `` inside the template literal so the emitted
prompt contains ```svg. This is the one place the writer must be careful.)

---

## 6. Diagram sanitization policy & the self-check protocol

### 6.1 `diagramSvg.ts` — new module, `apps/readest-app/src/services/professor/diagramSvg.ts`

```ts
/** Pull the ```svg fence out of the parsed display string. The fence never
 *  reaches the eye — only the sanitized render. No fence → svg: ''. */
export function extractDiagramSvg(display: string): { svg: string; display: string };

/** The desk's mounting policy: a figure slip accepts drawing markup only.
 *  Allowlist tags and attributes, nothing executable, nothing external.
 *  Output is safe for dangerouslySetInnerHTML (still: sanitize → render, in
 *  that order, every render). */
export function sanitizeDiagramSvg(svg: string): string;
```

`extractDiagramSvg`: match `/```svg\s*\n([\s\S]*?)```/` (first fence only; a
second fence is left in the display as prose). Returned `display` is the input
with the whole fence replaced by a single blank line, then `.trim()`-normalized
the way the existing strip pass normalizes (no double spaces, no trailing
whitespace before newlines — reuse the same two regexes from `professorTags.ts`
`stripSegment`).

`sanitizeDiagramSvg` — DOMPurify (import from `'dompurify'`, client-only like
`sanitize.ts`; DiagramSlip is client-only anyway) with **exactly** this policy:

```ts
DOMPurify.sanitize(svg, {
  ALLOWED_TAGS: [
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
    'polygon', 'text', 'tspan', 'defs', 'marker', 'title', 'desc',
    'clipPath', 'linearGradient', 'radialGradient', 'stop',
  ],
  ALLOWED_ATTR: [
    'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
    'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke',
    'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
    'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'text-anchor',
    'font-size', 'font-family', 'font-style', 'marker-start', 'marker-end',
    'marker-mid', 'offset', 'stop-color', 'stop-opacity', 'clip-path',
  ],
  FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'style', 'a', 'use'],
  FORBID_ATTR: ['src', 'href', 'xlink:href', 'style', 'srcset'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
});
```

Binding notes:
- **No `use`** (external/fragment reference vector — dropped from the allowlist
  on purpose), **no `a`/`href` of any spelling** (nothing in a figure
  navigates), **no `style` attribute or `<style>` element** (no CSS injection),
  **no `foreignObject`** (no HTML in the figure), **no event handlers**
  (DOMPurify strips `on*` by default; pinned by a test), **no `data:` URIs**
  (`ALLOW_DATA_ATTR: false`; add `ALLOWED_URI_REGEXP:
  /^(?:https?:|mailto:)/i`? **No** — with no `href`/`src` allowed at all, no URI
  can be expressed; do not add the regexp).
- `id`/`class` are NOT allowed (no shadow-DOM or stylesheet hooks; the desk
  restyles figures itself via `.wb-figure-svg` descendants).
- Round-trip invariant: `sanitizeDiagramSvg(sanitizeDiagramSvg(x)) ===
  sanitizeDiagramSvg(x)` (idempotent — pinned by a test).

### 6.2 The learn-visual self-check protocol (desk-side enforcement)

The campaign discipline — *the picture must SHOW the claim* — is enforced
three ways, all additive:

1. **Caption = claim.** `DiagramSlip` renders `<figcaption>` with the claim
   verbatim (no separate caption field exists; the professor is taught in §5 to
   phrase the claim as the caption sentence). The desk never invents caption
   text.
2. **Alt text names the claim.** The rendered `<figure>` carries
   `role='img'` + `aria-label={claim}`; the sanitized `<svg>` gets
   `aria-hidden='true'` (the claim lives on the figure, not duplicated inside
   the drawing).
3. **Missing drawing is honest paper.** No fence / empty sanitize → claim shown
   as prose with the `_('The figure could not be mounted.')` note (§9). The
   professor's own addendum rule (§5) is the first gate; the desk's are the
   second and third.

---

## 7. Renderers & CSS

### 7.1 `DerivationSlip.tsx` (new)

Props: `{ block: TranscriptBlock; ordinalBase: number; check?: BlockCheck }`.

Layout (top to bottom):
- Folio header: `<p className='wb-derive-title'>` — `{{title}}` when present,
  prefixed by `DERIVATION {{n}} · ` (the ordinal of its first step, §3.3); when
  no title, just `DERIVATION {{n}}`. Typewriter face, uppercase, tracked —
  sibling styling of `.wb-byline`.
- Step rows: for each step, `<div className='wb-step-row'>` containing
  `<span className='wb-step-no'>` (the global ordinal, right-aligned, min-width
  2ch), the step LaTeX typeset through the **existing** `$$…$$` + Streamdown
  path (wrap `$$${latex}$$` and reuse the `Prose` component from WorkbenchTab
  — move `Prose`, `Slip`, `VerdictChip` into the new files or a shared
  `wbShared.tsx`; see open question §10), the step's `VerdictChip` (from the
  block's check, matched by `v.id === step.id`), and the justification in
  `<span className='wb-step-justify'>` (italic, muted; omitted when absent).
- Goal line: when `derivation.goalLatex` exists, a display-math line
  `<div className='wb-goal-line'>` labelled `GOAL` via `.wb-step-no`-style
  marker, rendered after the last step.
- Goal chip (§4.3) inside the existing `.wb-chip-row` under the folio.

The learner-appended step (§7.3) renders identically — a learner step is a step.

### 7.2 `DiagramSlip.tsx` (new)

Props: `{ block: TranscriptBlock }`. Renders:

```tsx
<figure className='wb-figure' role='img' aria-label={block.diagram!.claim}>
  <div
    className='wb-figure-svg'
    // eslint-disable-next-line react/no-danger -- sanitized by sanitizeDiagramSvg (§6.1), allowlist-only
    dangerouslySetInnerHTML={{ __html: sanitizeDiagramSvg(block.diagram!.svg) }}
  />
  <figcaption className='wb-figure-caption'>{block.diagram!.claim}</figcaption>
</figure>
```

When `svg === ''` or the sanitize output is empty: render `<Prose
text={claim}/>` + `<p className='wb-figure-missing'>_('The figure could not be
mounted.')</p>` (no `<figure>`).

### 7.3 Composer upgrade — step/justify pair mode (MathField.tsx + WorkbenchTab.tsx)

The ƒx popover (`.wb-math-popover`, WorkbenchTab.tsx line ~780) gains a pair
mode so the learner can **append a step to an open folio**:

- **MathField.tsx (additive)**: two new optional props —
  `autoFocus?: boolean` (focus the field on mount — the popover is keyboard-first
  already) and `compact?: boolean` (renders `min-height: 1.4rem` via an added
  class `workbench-math-field-compact`; used in the pair mode where the field
  sits beside a text input). No behavior change when omitted; the `onCommit`
  (blur/Enter) contract is untouched.
- **WorkbenchTab.tsx**: when the transcript's last professor block carries an
  open `derivation` (no `[WORKBENCH:END]`-style closing — a folio is open until
  the professor's next prose block), the popover shows the pair layout instead
  of the single field:
  - `MathField compact autoFocus` for the step,
  - a one-line `<input>` (`.wb-justify-input`, string table §9) for the
    justification, placeholder `_('Why is this step allowed?…')`,
  - the existing `Add to page` button commits both: `$$${latex}$$\n${justification}`
    is spliced into the textarea at the caret (same splice code as `insertMath`,
    WorkbenchTab.tsx line ~330 — extract it into `spliceAtCaret(text)` and call
    from both paths).
  - Enter inside the MathField commits the pair (existing
    `handleMathPopoverKey` path); Enter in the justify input commits too;
    Escape closes (existing).
- The learner's appended steps land in their user block; on send,
  `commitProfessorBlock` is not involved (user blocks are built verbatim in
  `send`, line ~495) — **so the derivation must be re-associated client-side**:
  when the last professor block has an open derivation and the user's new block
  consists solely of `$$…$$` segments + justification lines, tag the *professor*
  block by appending the new steps into `block.derivation.steps` (new step ids
  `${professorBlockId}:${n}` continuing the count) and mark the user block with
  a new optional field `extendsDerivation?: string` (the folio's block id) so
  the transcript still shows the learner's paper as their own block, styled by
  `DerivationSlip` in compact form. This association is the one genuinely new
  state move; keep it a pure helper in workbenchChat.ts:
  `associateLearnerStep(blocks: TranscriptBlock[], userBlock: TranscriptBlock):
  TranscriptBlock[]` — pure, unit-tested, called from `send` before
  `appendBlock`. **Additive-only note:** if the learner's block does not parse
  as steps (prose, questions), `associateLearnerStep` returns blocks unchanged.

### 7.4 CSS (WorkbenchTab.css — additive, unlayered, light-first)

New classes only; every color comes from existing vars (`--ink`, `--muted`,
`--stamp`, `--sage`, `--paper`, `--paper-light`, `--lift-shadow`); corners ≤
2px; eink guards mirror the existing `[data-eink='true']` pattern.

```css
/* ----- derivation folio ----- */
.wb-derive-title { /* typewriter plate-label: uppercase, 9px, tracked, muted;
                     margin-bottom 6px; user-select none */ }
.wb-step-row { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
.wb-step-no { /* 'Special Elite' 9px muted, min-width 3ch, text-align end,
                  flex-shrink 0; the ledger's plate number */ }
.wb-step-justify { /* Newsreader italic 12px var(--muted); sits under the math,
                       flex: 1, min-width 0 */ }
.wb-goal-line { margin-top: 8px; padding-top: 6px;
                border-top: 1px dotted color-mix(in srgb, var(--ink) 25%, transparent); }
/* ----- figure slip ----- */
.wb-figure { margin: 8px 0 0; }
.wb-figure-svg { /* paper-light background, 1px hairline border
                   color-mix(in srgb, var(--ink) 25%, transparent), radius 2px,
                   padding 10px; svg { display:block; width:100%; height:auto; } */ }
.wb-figure-svg svg text { font-family: 'Newsreader', Georgia, serif; }
.wb-figure-caption { /* Newsreader italic 12px var(--muted); margin-top 4px;
                         the claim, printed beneath — the self-check made visible */ }
.wb-figure-missing { /* 'Special Elite' 9px var(--muted), italic; the honest-paper note */ }
.wb-figure-pending { /* muted ornament line shown mid-stream while the
                         drawing arrives; reuses .wb-thinking fade-in */ }
/* ----- composer pair mode ----- */
.wb-step-pair { display: flex; flex-direction: column; gap: 6px; }
.wb-justify-input { /* transparent bg, hairline bottom border, Newsreader 13px;
                        focus: border-bottom-color var(--stamp); matches
                        math-field.workbench-math-field treatment */ }
math-field.workbench-math-field-compact { min-height: 1.4rem; }
```

No class above may set a color other than via the listed vars (sole-accent law).

---

## 8. Tests (12 cases across two new files + two additive blocks)

### 8.1 `apps/readest-app/src/__tests__/notebook/workbench-derivation.test.ts` (new)

Mock `fetch` exactly as `mathcheck.test.ts` does (`vi.stubGlobal`,
`HEALTHY` health body, `jsonResponse` helper) — the derivation lane reuses the
real `checkDerivation`, no sidecar needed.

1. **Tag parse**: a full professor message with `[DERIVE title:.. goal:..]`,
   two `$$…$$` steps with justification lines and `[STEP /CHECKED ok]` /
   `[STEP /CHECKED bad]` markers → `parseProfessorTags` captures
   `derive.title`, `derive.goal`, two `stepMarks` (`professorChecked: 'ok'`,
   `'bad'`), display keeps the math and justifications, no raw tag survives.
2. **Commit builds the folio**: `commitProfessorBlock` on that raw →
   `block.derivation.steps` has ids `${block.id}:0`/`:1`, justifications
   attached, `goalLatex` set; `[STEP]` mark with no `/CHECKED` yields
   `professorChecked: undefined`.
3. **Global ordinal across the transcript**: three blocks — derivation A with 2
   steps, plain prose, derivation B with 1 step → `derivationOrdinal` returns
   1,2 for A's steps and 3 for B's (the numbering never restarts).
4. **Professor's numeral is ignored**: `[STEP 9 /CHECKED ok]` on the first step
   still renders as ordinal 1 (desk-side numbering).
5. **Whole-unit CAS mapping**: fetch mocked healthy; derivation block with a
   goal → one POST `/check` whose body is
   `{ steps: [{id, latex}…], goal_latex: '…' }` (asserted byte-for-byte);
   response `{ steps: […], goal: { reached: true, by_step: '…' } }` maps to
   `BlockCheck.done` with per-step verdicts **in submission order** and
   `goal: { reached: true, byStep }` (snake_case→camelCase pinned).
6. **Per-step verdicts land on the right steps**: response with a
   `not_equivalent` on step 2 (counterexample `prev_value`/`step_value`) → the
   chip data for `step.id === block.id:1` carries the counterexample with
   `prevValue`/`stepValue` populated (the empty-chip regression class).
7. **Goal summary line is additive**: `summarizeChecks` with a goal-bearing
   check appends `goal reached by …`; without goals the output is byte-identical
   to today's (existing tests keep passing untouched).
8. **Echo mode**: `/health` rejects → the folio's check is `unavailable`, no
   verdicts, no crash; a second turn re-checks (no hash was recorded).

### 8.2 `apps/readest-app/src/__tests__/services/diagram-svg.test.ts` (new)

No DOM mocks needed beyond DOMPurify's default (jsdom/happy-dom environment
already used by the suite's other DOMPurify tests, e.g. sanitizer paths).

9. **Extraction**: display string containing prose + one ` ```svg ` fence →
   `{ svg }` holds the inner markup, `display` has no backticks and no double
   spaces; no fence → `svg: ''`, display unchanged.
10. **Allowlist keeps a real figure**: an `<svg>` with `g/path/text/marker/
    defs` + `viewBox`, `d`, `marker-end`, `stroke-dasharray` survives
    sanitization attribute-for-attribute; `sanitize` is idempotent.
11. **XSS attempts** (one test, table-driven): `<script>alert(1)</script>`;
    `<svg onload=alert(1)>`; `<foreignObject><iframe src=x>`; `<a
    xlink:href="javascript:alert(1)">`; `<use href="data:image/svg+xml,…">`;
    `<style>*{fill:red}</style>` and a `style="…"` attribute; `<set
    attributeName=onmouseover to=alert(1)>` (SMIL) — every one is absent from
    the output; the surrounding drawing markup survives.
12. **Diagram block degrade + round-trip back-compat**:
    `commitProfessorBlock` with `[DIAGRAM claim:…]` but no fence →
    `block.diagram.svg === ''`, claim preserved; and a 2.1-style transcript
    (blocks with no new fields, plus one block with an **unknown** `kind:
    'mystery'`) round-trips through `serializeTranscript`/`parseTranscript`
    unchanged — the compat proof for campaign non-negotiable 5.

### 8.3 `professor-tags.test.ts` — additive describe-block

`describe('workbench 2.x protocol tags')`: `[DERIVE title:.. goal:..]` inside an
unterminated `$$` shield is still captured (pass-1 everywhere rule); `[STEP 3
/CHECKED ok]` captures and strips, `[STEP]` legal; `[DIAGRAM claim:…]` with an
empty claim captures nothing but consumes the tag; `[0,1]` and `[A]` inside
`$$…$$` still survive (existing contract unbroken); unknown ALL-CAPS tags still
stripped without capture.

### 8.4 `professor-prompt.test.ts` — additive describe-block

`describe('workbench 2.x addendum')`: `PROFESSOR_WORKBENCH_ADDENDUM` contains
`STRUCTURED DERIVATIONS`, `FIGURES`, the literal `[DERIVE title:`, `[STEP`,
`[DIAGRAM claim:`, the self-check sentence `the picture must SHOW the claim`,
and the emitted fence text ``` ` ```svg ` ``` (assert the *emitted* string
contains '```svg'); the original addendum text (Citations paragraph) is
unchanged (assert one existing sentence still present — do not duplicate the
whole file's assertions).

---

## 9. `_()` string table (every new user-facing string)

| Context | Key string (en) |
|---|---|
| Folio header, titled | `DERIVATION {{n}} · {{title}}` |
| Folio header, untitled | `DERIVATION {{n}}` |
| Goal line marker | `GOAL` |
| Goal chip reached | `Reaches the goal` / tip `The chain arrives where it set out to.` |
| Goal chip missed | `Does not reach the goal` / tip `The chain does not arrive at the goal.` |
| Missing figure | `The figure could not be mounted.` |
| Pending figure (streaming) | `The professor is drawing.` |
| Justify input placeholder | `Why is this step allowed?…` |
| Popover aria-label (pair mode reuses existing) | `Compose math` (existing — reuse, do not duplicate) |
| Justify input aria-label | `Justify the step` |

All via `useTranslation()` `_()` in the component, following the existing
`VerdictChip`/`PageChip` pattern (WorkbenchTab.tsx). No raw tag, verdict enum,
engine name, or provider detail may appear in any string (campaign law 1 —
error kinds, never machinery).

---

## 10. Open questions for the queen

1. **Shared presentational pieces.** `Prose`, `Slip`, and `VerdictChip` live
   inside `WorkbenchTab.tsx` today. For the new renderers they must be
   importable. Preference: extract them unchanged into
   `apps/readest-app/src/app/reader/components/notebook/wbShared.tsx` and
   re-import in `WorkbenchTab.tsx` (pure move, no edits — git blame stays
   readable). Owner A decides; either way their props/CSS are byte-identical.
2. **Composer pair-mode trigger.** Spec keys "open folio" off *the last
   professor block carries `derivation` and no later professor prose block
   superseded it*. If lane B's page-lookup blocks interleave, they don't
   close a folio (only a professor prose block does). Confirm this is the
   intended pedagogy or name a closer tag (e.g. `[DERIVE:END]`) — the spec
   ships without one.
3. **Learner-step association** (§7.3) mutates the professor's block in the
   store on the learner's send. It is additive and pure, but it is the first
   write to a professor block after commit — flag for the review loop as a
   P1-watch item.
4. **Step cap**: `MAX_STEPS_PER_CHECK = 8` is applied to folios too (step 9+
   wears no chip). Confirm, or bump the cap for derivation blocks only (the
   sidecar cost argument lives in mathCheck.ts's comment).
5. **DOMPurify in vitest**: `diagram-svg.test.ts` assumes a DOM environment;
   the repo's existing DOMPurify tests (sanitizer paths) run fine, so no new
   setup is expected — writer verifies with the focused run.
