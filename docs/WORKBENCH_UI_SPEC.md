# Workbench 2.1 — Block Transcript UI/UX Spec

**Status:** build-ready spec · owner: DESIGN lane · 2026-09-15
**Scope:** the notebook's Workbench tab becomes an Obsidian-style block
transcript. This document is the build contract for the dev lanes; it names
tokens, px values, strings, states, and behaviors. Zero production code here.
**Governing contracts:** `DESIGN.md` (The Antiquarian Catalogue),
`apps/readest-app/src/styles/apothecary.css` (tokens), `docs/MATH_WORKBENCH_PLAN.md` §7 + §6.2/§6.5.

---

## 0. Design intent

The workbench is not a chat and not a desk of buttons. It is a **sitting**:
a sheet of paper on which THE PROFESSOR writes a block, YOU write a block
underneath, and so on, top to bottom, read like a catalogue entry. Blocks
live directly on the paper — no bubbles, no cards, no rounded containers,
no buttons inside the transcript. The only chrome is the composer pinned at
the bottom and, in the never-used state only, one stamp button.

Three deletions define the surface (plan §7):

- The toolbar's three buttons (`ADD STEP` / `CHECK MY WORK` / `ASK REVIEW`) are gone.
- Bubble-like or card-like message containers are gone.
- Protocol tags (`[CONCEPT:…]`, `[QKIND:…]`) never reach the eye — they parse
  into the learner model; display is stripped before render.

The existing step-row desk UI is **not deleted** — it demotes to a future
"open as desk" zoom view and keeps its `workbenchStore` contract intact.

---

## 1. Surface & layout anatomy

```
┌─ Notebook panel (width = notebookWidthFrac × window, drag 0.15–0.85) ─────┐
│ paper-bg · border-left 1px rgba(38,34,27,.14)                              │
│                                                                            │
│  ┌─ transcript column ─────────────────────────────────────────────────┐  │
│  │ padding: 12px sides · blocks stacked, full column width            │  │
│  │                                                                     │  │
│  │  THE PROFESSOR            ← attribution (typed 9px, mutedink)       │  │
│  │  ┄ content (Streamdown + KaTeX) ┄                                   │  │
│  │  ────────────────────────────  hairline 1px ink/12%                 │  │
│  │                                                                     │  │
│  │  YOU                                                                   │  │
│  │  ┄ content + verdict chips ┄                                       │  │
│  │  ────────────────────────────                                      │  │
│  │  overflow-y: auto · scroll policy §8                                 │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│  ───────────────────────── composer hairline (1px ink/25%) ──────────────  │
│  ┌─ composer ──────────────────────────────────────────────────────────┐  │
│  │ padding 8px 12px (+ safe-area bottom / 2) · grows §9               │  │
│  │ [ƒx]  [ textarea…………………………………………… ]                                │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

- The transcript scroll container and the composer are **siblings in a flex
  column** (`flex min-h-0 flex-1 flex-col`, as today). Composer is
  `flex-shrink: 0`; the transcript owns the remaining height and scrolls
  independently.
- The transcript sits on `paper-bg` (the panel background). Blocks get **no
  background fill, no border box, no shadow** — only type and hairlines.
- The tab keeps its existing mount contract: `lazy` + `DeskErrorBoundary`
  (the 2026-09-06 crash scar). Streaming state is local to the workbench
  subtree; the fallback copy is unchanged.

---

## 2. Block anatomy & spacing scale

All spacing derives from the theme's existing 4px rhythm (the panel already
uses `px-3`, `mt-2`, `gap-1.5`).

| Token | Value | Where |
|---|---|---|
| `wb-space-1` | 4px | chip internal gaps; attribution label → content |
| `wb-space-2` | 8px | composer vertical padding; chip row top |
| `wb-space-3` | 12px | column side padding; empty-state ornament gaps |
| `wb-space-4` | 16px | content → chips; block → separator |
| `wb-space-5` | 20px | separator → next attribution (paragraph gap) |
| `wb-space-6` | 24px | scroll-at-bottom threshold; ƒx popover offset |

Per-block vertical rhythm (top → bottom):

```
attribution label      margin-bottom: 4px
content                (prose + math + derivation sub-block)
chip row               margin-top: 8px  (student blocks only; wraps)
hairline separator     margin-top: 16px · 1px solid color-mix(in srgb, var(--ink) 12%, transparent)
next block             margin-top: 20px
```

- First block of the transcript: `margin-top: 12px`. Last block keeps its
  separator — the composer hairline closes the page.
- **No separator between the chips and the block end**; the separator is
  always the block's final element.

### Attribution label

- Text: `THE PROFESSOR` / `YOU`.
- Class: `.typed text-mutedink text-[9px]` — Special Elite, uppercase,
  `letter-spacing: 0.12em` (the `plate-num` track; add a `wb-byline` class
  in `WorkbenchTab.css` carrying the track rather than inline styles).
- The professor's *content* is `--ink`; the professor's *accent* (streaming
  nib, error tails) is `--stamp`. DESIGN.md calls stamp "the Prof's ink" —
  it appears only where the professor acts, never as prose color, never as
  decoration on the byline. Both bylines stay mutedink so the reading order
  is content-first, labels second.
- RTL: the byline inherits the panel's `dir`; typed labels stay visually
  anchored to the start edge.

---

## 3. Typography

| Element | Face | Size / line-height | Color |
|---|---|---|---|
| Byline | Special Elite (`.typed`), uppercase, 0.12em track | 9px / 1 | `mutedink` |
| Block prose | Newsreader (panel inherits `font-sans`; transcript sets `font-family: 'Newsreader', Georgia, serif`) | 15px / 1.6 | `ink` |
| Block prose (max-width ≥ 0.85 panel) | same, measure capped | max-width 68ch | `ink` |
| KaTeX (inline & display) | KaTeX, `font-size: 1.02em` (existing `workbench-katex` recipe) | display margin 0.15em 0 | `ink` |
| Verdict chips | Special Elite | 8.5px / 1 | per chip §5 |
| Composer | Newsreader | 15px / 1.5 | `ink` |
| Composer placeholder | Special Elite, uppercase, 0.08em | 10px | `muted` |
| Microcopy (markers, errors, tooltips) | Special Elite | 9px / 1.4 | `mutedink` or `stamp` |
| Marker ornament | stamp ✳ 12px, `letter-spacing: 0.5em` (`.ornament` recipe) | 12px | `stamp` |

- Prose under ~68ch always; at wide panels the block content column caps at
  `68ch` and stays **left-aligned** (catalogue flush-left, never centered
  ragged-left for long prose).
- Math display blocks: `overflow-x: auto` as last resort only (§11).

---

## 4. Professor blocks

### 4.1 Content rendering

- Rendered with **Streamdown** + `@streamdown/math` (`remark`/`rehype`
  plugins), exactly as the current review-reply strip does. `$$ … $$`
  typesets via KaTeX; `$ … $` inline.
- **Protocol stripping before render:** the raw professor text is scanned
  for bracket tags — `[CONCEPT:id]`, `[QKIND:kind]`, and any future
  `[A-Z_]+:` protocol token. These are consumed (into the learner model /
  session meta) and removed from the displayed string. A tag is never
  split across a stream token boundary; the assembler buffers until a tag
  closes. If a tag never closes by end-of-stream, treat the remainder as
  plain text — no visible artifact, ever.
- KaTeX failures degrade to the raw source line in mutedink italic rather
  than an empty block (the desk's "error-tolerant" rule, upgraded from
  silent-empty: a sitting should never look erased).

### 4.2 Derivation sub-block

A professor derivation renders as a **numbered steps list inside the block**:

```
  1.  ⟨KaTeX display, step 1⟩                                    P. 87
  2.  ⟨KaTeX display, step 2⟩
  3.  ⟨KaTeX display, step 3⟩                                    P. 88
```

- `<ol>` semantics; typed 9px mutedink numerals, `margin-right: 8px`, baseline
  aligned to the math block's first line.
- Each step may carry a **page-anchor chip** (§5.3).
- Prose *between* steps (announcements) renders as normal Streamdown
  paragraphs in the same block; the list never breaks the block.

### 4.3 Greeting & provenance flavor

The session-opening block (state 1) is a professor block whose content the
professor composes from book context (plan §7): it greets from the book —
one grounding sentence with a page-anchor chip — then asks the first
question. Provenance ("where it came from, why it mattered") arrives inside
ordinary professor blocks as story paragraphs; they are set in the same
Newsreader prose, no special styling — stories must read as stories, and the
UI must not conflate them with the book's claims by giving them a distinct
visual register.

---

## 5. Student blocks & the chip system

A student block renders **what you typed** — prose via Streamdown, math via
KaTeX inline/display. The block's math is checked **silently and
automatically** (plan §7: "no check button — it just happens"); results
appear as chips inside the block, after the content.

### 5.1 Chip — base recipe

Every chip shares one shape (the catalogue's specimen-label grammar):

```
border-radius: 2px (≤2px rule)
border: 1px solid <chip-color>
background: var(--paper-light)
padding: 2px 6px 1px
font: Special Elite 8.5px / 1, letter-spacing 0.08em, uppercase
```

Chips wrap (`flex flex-wrap gap-1` on the chip row); on a 0.15-width panel
they stack vertically without breaking words.

### 5.2 Verdict chips

| Verdict | Glyph | Text ink + border | Tooltip (§5.4) | aria-label |
|---|---|---|---|---|
| Equivalent (final) | ✓ | `--sage` | `This line checks out.` | `Checks out` |
| One-directional | ✓ | `--sage` | `This line holds in one direction.` | `Holds in one direction` |
| Not equivalent | ✗ | `--stamp` | counterexample, librarian-voiced (§5.4) | `Does not follow` |
| Unknown | ◌ | `--mutedink` | `The professor will take a moment.` | `Unmarked` |
| Parse error | ◌ (dotted underline) | `--mutedink` | `Could not read this line as math.` | `Parse error` |
| Checking (transient) | … | `--mutedink`, animated | none | `Checking` |

- The `✗` chip is the only stamp-colored chip: stamp marks where the ink
  went wrong, never where it went right. Sage marks the green-pencil
  corrections of the cataloguer (success), used sparingly per DESIGN.md.
- The **parse-error** variant keeps the existing grammar: a muted dotted
  underline on the offending source span inside the block + the ◌ chip.
- **Checking state:** when a student block contains math and no verdict yet,
  a transient chip renders as `CHECKING` with a three-dot ellipsis that
  pulses at 1.2s ease-in-out (dots fade 40% → 100% staggered). It resolves
  in place into one of the verdict chips — no layout jump wider than the
  chip itself (fixed-height row, chips swap, no rewrap beyond the row).

### 5.3 Page-anchor chips

- Shape: same chip recipe, Special Elite 8.5px, text `P. {{page}}`
  (existing `_()` interpolation), color `--mutedink`, border
  `color-mix(in srgb, var(--ink) 25%, transparent)`.
- Placement: inline at the end of a derivation step or a cited professor
  paragraph; floats to the block's end edge on wide panels
  (`margin-inline-start: auto`), wraps inline at 0.15.
- **Hover reveals the quote** (§5.4). Click does nothing (anchors are
  evidence, not navigation — the plan reserves navigation for later).

### 5.4 Tooltip — the paper slip

Native `title` is not used for anything but the simplest aria fallbacks.
The counterexample and page-quote tooltips render as a custom **paper slip**:

```
background: var(--paper-light)
border: 1px solid color-mix(in srgb, var(--ink) 25%, transparent)
border-radius: 2px
box-shadow: var(--lift-shadow)      ← eink: none, border inkens
padding: 6px 8px
max-width: 280px
font: Newsreader italic 12px / 1.5, color: var(--ink)
label line: typed 8.5px mutedink above the quote (page chips only)
delay: 300ms in · 0ms out · fade 120ms
position: above the chip, flipped below within 8px of the container top
```

- Counterexample copy (replaces the machinery-flavored
  `counterexampleText` joiner — librarian voice, concrete numbers kept):
  `For k = 2, the left side reads 4 while this line reads 6.`
  Template: `For {{assigns}}, the left side reads {{prev}} while this line reads {{step}}.`
  When there are no assignments: `The left side reads {{prev}} while this line reads {{step}}.`
- Page-quote tooltip: typed label `FROM THE PAGE` (or `P. {{page}}` when
  the label would duplicate) above the quoted text in Newsreader italic,
  clamped to 4 lines with a trailing …
- Tooltips are hover-only on pointer devices; on focus (chip is not
  focusable by default — it is `role="img"` with `aria-label`, no tab stop)
  the same text is available via the aria-label. Keep chips non-interactive:
  no buttons mid-session.

### 5.5 What the student typed stays typed

The block shows the student's own text, typeset — never a normalized
rewrite. If the professor later proposes a correction, it arrives in a
*professor* block below as a quoted suggestion (the existing
`suggest.accept/reject` machinery remains store-level); the transcript
itself carries no per-block action buttons.

---

## 6. Composer

Pinned at the bottom, full column width, closed at the top by a 1px hairline
(`color-mix(in srgb, var(--ink) 25%, transparent)` — the only heavy rule on
the page; everything below it is the working edge).

```
┌────────────────────────────────────────────────────────────┐
│ ƒx   Answer the professor…                            ⏎    │  ← 38px min
│      (grows to 5 lines, then scrolls internally)           │
└────────────────────────────────────────────────────────────┘
```

- **Field:** a plain `<textarea>` (not MathLive — MathLive stays inside the
  ƒx popover). Newsreader 15px / 1.5, `color: var(--ink)`, transparent
  background, **no border box** (the hairline above frames the zone).
  - `min-height: 38px`; grows with content to 5 lines (~110px); beyond that
    the textarea scrolls internally.
  - Placeholder: Special Elite 10px uppercase mutedink, the typed-paper
    register of `.paper-field::placeholder` without the pill.
- **Keys:** `Enter` sends; `Shift+Enter` inserts a newline; `⌘/Ctrl+Enter`
    also sends (discoverable, forgiving). Empty/whitespace-only sends are
    ignored (no disabled state, no error — a quiet no-op).
- **During the professor's turn the composer stays enabled.** A sitting is
  a conversation; the owner explicitly wants no gates. (The tutoring
  engine's own patience rules — never speak within 20s of a keystroke,
  plan §6.3 — are engine policy, not composer policy.)
- **Sending (optimistic):** the student block appends instantly with its
  checking chip; the textarea clears and keeps focus; a professor block
  placeholder (§7) mounts below only once the request is in flight (>400ms
  before first token, to avoid flicker on fast replies).
- **Safe area:** `padding-bottom: safeAreaInsets.bottom / 2` as the panel
  already does for the tab navigation.

### 6.1 The ƒx affordance

- A 24px circular ghost button at the composer's start edge: transparent,
  hairline ink/25 border, Special Elite `ƒx` 10px in `mutedink`; hover
  → text and border `stamp` (its one accent moment). Border-radius: fully
  circular (the DESIGN.md icon-button exception).
- `aria-label: _('Insert math')`, keyboard focusable, global stamp focus ring.
- Opens a **MathLive popover** above the composer (anchored to the ƒx
  button, 8px gap):

```
┌──────────────────────────────────────────────┐  ← plate-modal recipe:
│  ⟨math-field, full width, workbench-math-field│     paper bg, 1px ink,
│   theming — stamp caret, Newsreader text⟩    │     2px radius,
│                                              │     --lift-shadow
│              [ ADD TO PAGE ]                 │     (eink: flat)
└──────────────────────────────────────────────┘
  Enter = ADD TO PAGE · Esc = close
```

  - The MathField wrapper (`MathField.tsx`) is reused verbatim — it already
    obeys the hard `next/dynamic ssr:false` rule; the popover mounts it
    lazily on first open.
  - `ADD TO PAGE` is an `ink-btn`. On insert, the LaTeX is dropped into the
    textarea at the caret wrapped in `$…$` (or `$$…$$` if the field holds a
    display-sized expression — decided by whether the MathLive value
    contains `\displaystyle` or a multi-line environment), focus returns to
    the textarea, the popover closes.
  - Click-outside and `Esc` close without inserting. The popover never
    reopens with stale content.

---

## 7. Streaming & the professor's nib

No spinners (never daisy `loading`), no bouncing dots. The professor's
presence is a **nib resting on the paper**:

- **Awaiting first token:** a 2px-wide, 1em-high stamp caret
  (`display: inline-block; background: var(--stamp); width: 2px`) at the
  block's start, blinking at 1.1s `steps(1)` — the cursor of an unseen
  pen. After 3s without tokens, a typed mutedink line fades in beneath:
  `The professor is writing.` (patience, not anxiety).
- **Streaming:** tokens render into the block via Streamdown exactly as
  they arrive; the caret rides at the end of the partial content until
  `onDone`, then disappears. Re-parsing per token is the existing
  review-strip pattern; keep it local to the workbench subtree.
- **Done:** the block is ordinary paper — the caret leaves no artifact.
- aria: the transcript container is a `role="log" aria-live="polite"
  aria-relevant="additions"` region; the visual nib is `aria-hidden`.

---

## 8. Scroll policy

- Container: the transcript column (`overflow-y: auto`, `overscroll-behavior:
  contain`). The composer never scrolls with it.
- **Pinned follow:** the container tracks `atBottom = distanceFromBottom ≤
  24px`. While pinned, new content (blocks, chips, stream tokens) keeps the
  bottom in view — instant follow during streaming (smooth scrolling lags
  the tokens), one `scroll-behavior: smooth` glide for whole new blocks.
- **User scrolls up → never yank:** any upward scroll farther than 24px
  from the bottom unpins immediately and permanently until the user returns
  to the bottom manually. Streaming continues off-screen; the user is left
  alone to read.
- **Return affordance:** when unpinned AND content has grown since the
  unpin, a single quiet chip appears at the container's bottom edge —
  `paper-light`, 2px corners, hairline ink/25, typed 8.5px mutedink:
  `New writing below ↓` — which scrolls smoothly to the bottom and repins.
  It is navigation chrome, not an action button; it never appears while
  pinned, and it disappears the moment the user scrolls to the bottom by
  any means. This is the only floating element the transcript may carry.
- On mount/resume with an existing transcript: scroll to bottom, pinned.

---

## 9. Session states

### State 0 — never used (empty state)

The toolbar row exists **only here**. Centered vertically in the transcript
column (flex center), quiet stamp grammar:

```
                        ✳            ← ornament, stamp, 12px

        Sit down with the professor. Work the page
        line by line; your work is marked as you go.
                    ← typed 9px mutedink, max-width 32ch, centered

              ┌──────────────────────┐
              │   START A SESSION    │   ← stamp-btn, the ONLY button
              └──────────────────────┘
```

- No iconography beyond the ornament. No card, no plate frame — the paper
  itself is the state.
- If no LLM key is configured, the stamp button row is replaced by the
  no-key guidance block (state 4a) — do not render a button that is only
  going to fail.

### State 1 — session greeting

First professor block, from book context (plan §7): greeting sentence +
page-anchor chip, provenance flavor, first question. Then the composer
placeholder reads `Answer the professor…`. Wireframe in §10.

### State 2 — in session

Blocks accumulate per §2. Composer enabled throughout. No end-of-turn UI
(no "continue" buttons); the professor's next turn begins when you send,
or when the tutoring engine (§6.2 triggers) writes a block — either way it
is just the next block on the page.

### State 3 — professor thinking / streaming

Professor-block placeholder + nib caret per §7. The student block above it
shows its checking chip resolving. Nothing else changes; no chrome, no
badges, no progress bars.

### State 4 — error states (never a dead end)

**4a. No LLM key configured** — replaces the empty-state button row (and, if
discovered mid-session, renders as a quiet guidance block at the transcript
tail):

```
        ┌───────────────────────────────────────────┐
        │  The professor needs a connection before  │  ← typed 9px mutedink,
        │  he can sit down.                         │    centered in a .plate
        │                                           │    frame (double hairline)
        │           OPEN INTEGRATIONS               │  ← stamp-btn → Settings →
        └───────────────────────────────────────────┘    Integrations
```

Microcopy string: `The professor needs a connection before he can sit
down.` Button: `Open integrations`. (The task names Settings → Integrations;
the string stays free of machinery words.)

**4b. Professor unreachable / LLM error mid-session** — the partially
streamed block remains (nothing is erased; a sitting is honest paper), and
a **tail** attaches to it, hairline-separated:

```
  ─────────────────────────────
  The professor could not be reached. Nothing was lost.
  [ TRY AGAIN ]                      ← ink-btn, retries the same turn
```

Strings: body `The professor could not be reached. Nothing was lost.`;
button `Try again`; retry is one click, idempotent, and aborts any prior
in-flight request first. If the transcript was empty when the error hit,
the tail attaches to a professor placeholder that reads `The professor
could not be reached. Nothing was lost.` with the same retry — i.e. the
empty state never degrades into a blank page.

**4c. Transcript persistence failure** — silent `console.warn` only (the
existing contract); the sitting continues in memory. No user copy.

### State 5 — closed / resumed later

- There is **no explicit "close session" control** (no buttons). Closing
  the notebook or quitting the app *is* leaving the sitting; the transcript
  is a per-book document (plan §7) and is simply there when you return.
- **Resume marker:** on loading a persisted transcript with ≥1 block when
  no live session is open, the first rendered element is a quiet marker —
  ornament line, centered, no block chrome:

```
        ✳ ✳ ✳
        RESUMED YOUR SITTING WITH {{book}}
        ✳ ✳ ✳
```

  (`{{book}}` = book title; typed 9px mutedink; ornaments stamp 12px.) It
  renders once per mount of a restored transcript, is not persisted, and is
  never re-shown on in-mount re-renders.
- The professor may resume with a fresh re-test (plan §7: "last time we
  were deriving X — here's a fresh re-test"); that arrives as an ordinary
  professor block after the marker — the marker itself never carries
  content or actions.

---

## 10. Wireframes

### 10.1 Empty state (0.35 width)

```
│                                                                            │
│                              ✳                                             │
│                                                                            │
│           Sit down with the professor. Work the page line by               │
│           line; your work is marked as you go.                             │
│                                                                            │
│                  ┌────────────────────────┐                                │
│                  │    START A SESSION     │                                │
│                  └────────────────────────┘                                │
│ ─────────────────────────────────────────────────────────────────────────  │
│ ƒx  Answer the professor…                                                  │
```

### 10.2 Greeting (state 1)

```
│ THE PROFESSOR                                                              │
│ Welcome back to *Fourier Analysis*. You were reading about the heat        │
│ equation as we left it — let us take it from the page itself.              │
│                                                                            │
│ Begin here: justify why the coefficients must fall off faster than         │
│ 1/n for the series to converge uniformly.                                 │
│                                                          ┌──────┐          │
│                                                          │ P. 87│ ← quote  │
│                                                          └──────┘  on hover│
│ ─────────────────────────────────────────────────────────────────────────  │
│                                                                            │
│ YOU                                                                        │
│ I think it is because otherwise the terms do not go to zero uniformly…    │
│                                              ┌──────────────┐              │
│                                              │ CHECKING…    │              │
│                                              └──────────────┘              │
│ ─────────────────────────────────────────────────────────────────────────  │
│ ƒx  Answer the professor…                                                  │
```

### 10.3 Mid-session: derivation block + chips (0.35 width)

```
│ THE PROFESSOR                                                              │
│ Good — the boundary terms vanish. Watch the middle term now; it is the    │
│ one that carries the whole argument.                                       │
│                                                                            │
│   1.  ∫₋π^π f(x) sin(nx) dx = πbₙ                         ┌──────┐         │
│                                                             │ P. 87│       │
│   2.  |bₙ| ≤ (1/π)∫|f(x)| dx                              └──────┘       │
│                                                                            │
│   3.  bₙ → 0 as n → ∞  (Riemann–Lebesgue)               ┌──────┐          │
│                                                           │ P. 88│         │
│ ──────────────────────────────────────────────────────────────────         │
│                                                           └──────┘         │
│ YOU                                                                        │
│ So then the coefficients of f′ are nbₙ, and those must go to zero too:    │
│                                                                            │
│        b′ₙ = n·bₙ → 0                                                      │
│                                          ┌─────────────────────────────┐   │
│                                          │ ✗ For n = 2, the left side  │   │
│                                          │   reads 0 while this line   │   │
│                                          │   reads 2b₂ …  (hover slip) │   │
│                                          └─────────────────────────────┘   │
│                                          ┌────┐ ┌───────┐                  │
│                                          │ ✗  │ │ UNMARK│ ◌ variant        │
│                                          └────┘ └───────┘                  │
│ ─────────────────────────────────────────────────────────────────────────  │
│ ƒx  Continue the argument…                                                 │
```

### 10.4 Narrow width (0.15 panel, ~216px)

```
│ THE PROFESSOR                                                              │
│ Good — the boundary terms vanish. Watch the middle term now.               │
│                                                                            │
│   1.  ∫₋π^π f(x) sin(nx) dx  ══════════════▶  (math scrolls,             │
│                                   = πbₙ        fade mask on the            │
│                                                overflow edge)              │
│                                          ┌──────┐                          │
│                                          │ P. 87│                          │
│                                          └──────┘                          │
│ ─────────────────────────────────────────────────────────────────────────  │
│ YOU                                                                        │
│ So the coefficients of f′ are nbₙ, and                                    │
│ those must go to zero:                                                    │
│                                                                            │
│   b′ₙ = n·bₙ → 0  ════════════▶                                           │
│          ┌────┐                                                           │
│          │ ✗  │  ← chips wrap full-width,                                 │
│          └────┘    one per line                                           │
│ ─────────────────────────────────────────────────────────────────────────  │
│ ƒx  Answer the professor…                                                  │
```

At 0.15 nothing breaks: bylines still 9px, prose reflows at ~190px measure,
page chips drop to their own line, math scrolls horizontally **only as the
last resort** (§11), the composer keeps its single growing line (ƒx and
textarea share the row; the ƒx button never shrinks below 24px).

---

## 11. Width resilience (0.15 / 0.35 / 0.85)

The panel drags 0.15–0.85 (`Notebook.tsx`, `MIN/MAX_NOTEBOOK_WIDTH`).
Breakpoints are **content-width based** (`container queries` on the
transcript column, ~content widths below), not viewport based:

| Content width | Behavior |
|---|---|
| < 240px (panel ≈0.15) | Prose reflows freely. Derivation step number stacks above its math (numeral its own line, math indented 0). Page chips drop below their step/paragraph. Math display: horizontal scroll inside the step, 1px `faint` fade mask on the trailing edge, `scrollbar-width: none`. Chips stack one per line. Composer: ƒx + textarea share one row, textarea min-width 0. |
| 240–560px (panel ≈0.2–0.45) | Default grammar: numeral + math side by side, chips wrap. |
| > 560px (panel ≈0.5–0.85) | Prose measure caps at 68ch, flush-left. Page chips pin to the block's end edge (`margin-inline-start: auto`). Derivation list may breathe: `gap: 4px` between steps → 8px. Math never stretches beyond the 68ch cap; centered display equations within that measure. |

- Math horizontal scroll is the **last resort**: first allow KaTeX to break
  (KaTeX won't), then shrink to `min-width` fit with the fade mask, then
  scroll. Never reflow-prohibit prose to accommodate math.
- Dragging the panel re-flows live; no re-mount, no scroll position loss
  (the scroll container keeps its `scrollTop` proportion via the pinned
  policy — if unpinned and reading, the block the user is reading stays
  anchored: preserve the first fully-visible block's offset from top).
- Eink variant: fade masks off, hairlines thicken per the existing
  `[data-eink]` recipes; nothing else changes.

---

## 12. Accessibility

- The one global focus rule applies everywhere (2px stamp outline, offset
  2px): ƒx button, composer, retry `ink-btn`, `START A SESSION`,
  `OPEN INTEGRATIONS`, resume chip, page chips (non-focusable by design —
  their info is in aria-labels on the chip glyphs).
- Transcript region: `role="log" aria-live="polite" aria-relevant="additions"`.
- Byline glyphs: every ✓/✗/◌ chip carries `aria-label` per §5.2.
- The nib caret is `aria-hidden`; thinking state is conveyed by the live
  region additions.
- Full keyboard path: Tab to ƒx or composer → type or open MathLive popover
  (Enter inserts, Esc closes) → Enter sends. No mouse-only step anywhere.
- Contrast: mutedink on paper is 5.1:1 (DESIGN.md floor); sage `--sage` on
  `--paper-light` ≈ 5.5:1; stamp ≈ 7:1. Chips use text+hairline only, no
  filled washes, so the AA floor holds in dark and eink flips too.
- Respect `prefers-reduced-motion`: the nib blink, ellipsis pulse, and
  smooth-scroll glides all collapse to static/instant (content is never
  hidden by the reduction).

---

## 13. i18n string table (every `_()` string)

Librarian register: no exclamation marks, no machinery words (sidecar, LLM,
pipeline, tokens), no emoji. Interpolation uses the existing `{{var}}`
pattern. Uppercase strings are typed labels; sentence case is Newsreader.

| Key context | String |
|---|---|
| Empty-state ornament label (aria) | `The workbench` |
| Empty-state microcopy | `Sit down with the professor. Work the page line by line; your work is marked as you go.` |
| Empty-state button | `Start a session` |
| Byline | `THE PROFESSOR` |
| Byline | `YOU` |
| Composer placeholder (no live session yet) | `Answer the professor…` |
| Composer placeholder (session active) | `Continue the argument…` |
| Composer aria-label | `Write to the professor` |
| ƒx button aria-label + tooltip | `Insert math` |
| MathLive popover title (aria) | `Compose math` |
| MathLive popover insert button | `Add to page` |
| Thinking (after 3s) | `The professor is writing.` |
| Resume marker | `Resumed your sitting with {{book}}` |
| Scroll chip | `New writing below` (glyph ↓ is an SVG caret, not a string) |
| Verdict chip labels/tooltips | `Checks out` / `This line checks out.` |
| | `Holds in one direction` / `This line holds in one direction.` |
| | `Does not follow` / `For {{assigns}}, the left side reads {{prev}} while this line reads {{step}}.` · fallback `The left side reads {{prev}} while this line reads {{step}}.` |
| | `Unmarked` / `The professor will take a moment.` |
| | `Parse error` / `Could not read this line as math.` |
| | `Checking` (aria; visible chip is `CHECKING…` typed) |
| Page chip | `P. {{page}}` |
| Tooltip quote label | `From the page` |
| No-key guidance body | `The professor needs a connection before he can sit down.` |
| No-key guidance hint | `Connect one in Settings → Integrations.` |
| No-key button | `Open integrations` |
| Unreachable body | `The professor could not be reached. Nothing was lost.` |
| Unreachable button | `Try again` |
| Derivation list label (aria, optional announce) | `The professor's derivation` |

(A `{{book}}` value is the book's title as it appears in the library; all
strings flow through the existing `_()` hook, pluralization not required.)

---

## 14. Hard rules for the build lanes

1. **No buttons inside the transcript.** The only interactive elements in
   the block stack are: chips-as-information (non-focusable), the page-chip
   hover slip, the unpinned scroll chip, and error tails' `Try again`. The
   `START A SESSION` / `OPEN INTEGRATIONS` stamps render only in state 0/4a.
   Once a session exists, the toolbar row unmounts entirely.
2. **No bubble or card containers for blocks.** Blocks are type + hairline
   on `paper-bg`. The only framed surfaces allowed are the plate-framed
   guidance block (4a) and the MathLive popover (plate-modal recipe).
3. **Stamp never decorates.** It appears on: streaming nib, ✗ chips and
   their slips, `START A SESSION`, ornament markers, ƒx hover, focus rings
   (global). Sage only on ✓ verdicts. Everything else is ink or mutedink.
4. **No daisyUI tokens, no `shadow-*` utilities** — `--lift-shadow` via the
   plate recipes only. Corners ≤ 2px (ƒx's circle and MathLive internals
   excepted by DESIGN.md).
5. **Every string via `_()`**, from the §13 table; no concatenation that
   breaks RTL or interpolation.
6. **Dark and eink must survive:** use the vars only; no hardcoded light
   hexes outside `apothecary.css`. The workbench is light-first but the
   var-flip is non-negotiable.
7. **Streaming state stays local to the workbench subtree** (plan §7 safety);
   the desk keeps its `DeskErrorBoundary`; no assistant-ui runtime.
8. **The store contract is untouched** — `workbenchStore` op-log stays the
   source of truth; blocks derive from it (architect lane owns the schema;
   this spec only names the block projection).

---

## 15. Acceptance checklist (visual QA for the polish pass)

- [ ] At 0.15 width, nothing overflows, no text is clipped, math scrolls
      with a fade mask, chips stack.
- [ ] At 0.85 width, prose caps at 68ch and stays flush-left.
- [ ] Scroll up mid-stream: no yank; `New writing below` appears once, and
      only while unpinned with fresh content.
- [ ] Kill the network mid-reply: partial block + `Try again` tail; retry
      succeeds; nothing erased.
- [ ] Restart the app with a persisted transcript: resume marker appears
      exactly once, scroll rests at the bottom, pinned.
- [ ] No `[CONCEPT:` / `[QKIND:` text reachable in any render path.
- [ ] Keyboard-only: open tab → start session → ƒx insert math → send →
      read professor block. Zero pointer use.
- [ ] Theme flip to dark and eink: full pass, zero hardcoded-hex leakage.
