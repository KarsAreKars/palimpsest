# The Desk — a freeform thinking layer over the book

**Vision (owner, 2026-09-15, after penecho research):** penecho's spatial
canvas, re-imagined for Palimpsest — typed (not handwritten), book-grounded,
with a visual, speaking professor. *"An endless scrolling notebook page
overlaid on top of the PDF reader… you can create a text box anywhere like in
Word and type, and when you press Enter it sends it over to the MCP and the
prof can draw something to help you do stuff."*

The soul: **all the teaching, the book as source of truth, a traffic-light log
of where you are in the subject (green/yellow/red), and a teacher that is
visual and can speak about what it is doing.**

## What it is

A full-page surface that **slides out from underneath the PDF** (same
dimensions as the page area — the book dims, the desk takes the stage), opened
by a **header button next to the notebook toggler**. On the desk:

- **Endless vertical scroll** — one continuous sheet, "like tiktok": no
  pages, no fixed height, content grows downward forever.
- **Place-anywhere text boxes** — click anywhere on the sheet, type (Word-like),
  **Enter sends** the box's text to the professor as a turn.
- **The professor answers in place** — prose slips, rendered math, CAS-checked
  derivations, [DIAGRAM] figures, animated folios (wigglystuff replay) all
  land ON the canvas where the conversation is, not in a side panel.
- **Visual + voiced teacher** — every professor artifact can speak (voice
  answers, already built); the professor can also "draw to help" — diagrams
  and figures as first-class canvas objects.
- **The traffic-light spine** — the concept map (known/edge/unknown) becomes a
  visible margin rail on the desk: green/yellow/red chips per concept,
  updated as exchanges land, each chip clickable to jump to its thread.
- **Book stays the source of truth** — tiered context (T0–T4), page-lookup
  consults, page citations: all carry over unchanged.

## Relationship to today's workbench

The Desk **re-hosts** the 2.x block transcript rather than replacing its
machinery: blocks, protocol tags, silent CAS checking, teach-back, probes,
voice — all survive; their *surface* moves from the notebook sidebar panel to
the full-page sheet. The sidebar Workbench tab either (a) is removed entirely
once the Desk lands, or (b) remains as a compact "recent sittings" log
(owner decision, below). Nothing in the 2.x campaign is wasted: the Desk is a
renderer + composer change, not a protocol change (same tags, same blocks,
same persistence shape — `workbench-transcript.json` becomes the desk's
document).

## Architecture sketch (for the build campaign)

- **Sheet host**: a new top-level overlay in the reader (`DeskSheet.tsx`),
  sliding from beneath the book (transform translateY over the reader stage,
  book dims via a scrim — the "underneath" feel), dismissed by the same
  header toggle. Not a sidebar: it owns the page area.
- **Canvas model**: the existing `TranscriptBlock[]` **plus** optional
  `(x, y)` placement + `width` per block (additive fields — old transcripts
  render in the single-column stream; new ones place freely). "Endless" =
  virtualized vertical list keyed by block order, sheet height derived from
  content extent.
- **Composer**: click-to-place caret → floating mini-composer (MathLive
  already exists) → Enter commits a positioned `user` block and sends.
- **Professor in place**: block renderers (prose/math/derivation/diagram/
  voice) become absolutely-positioned canvas objects; new blocks flow BELOW
  the current viewport bottom (scroll-follow, like the transcript today).
- **Traffic-light rail**: `latestConceptMap` (already maintained per session)
  rendered as a fixed left-margin column of green/sage · yellow/stamp-tint ·
  red/stamp chips; click → scrolls to thread + (later) scrolls the book.
- **Header chrome**: one Desk toggle button beside the notebook toggler
  (icon: a desktop/desk lamp or layered-sheet glyph — ≤2px corners, stamp
  accent on active).
- **What does NOT change**: prompt addendum, tags, CAS sidecar, voice player,
  context tiers, persistence, sanitization policy.

## Sequencing (recommended)

1. Finish 2.x: review loop → polish (wiggly replay + adopted penecho guards
   as 2.5) → owner dogfood → `v0.2.0`.
2. **The Desk = next campaign** ("Workbench 3.0 — The Desk"), specced with the
   same scout-audit-writer protocol as 2.x.

## Open decisions (owner)

1. Sidebar Workbench tab after the Desk lands: **remove entirely** vs keep as
   compact sittings log. (Recommendation: remove — one surface, no split brain.)
2. Canvas anchoring: **one endless sheet per book** (whole-subject mural) vs
   one sheet per chapter/section. (Recommendation: per book — matches the
   concept-map-across-the-session design.)
3. Placement: freeform `(x,y)` anywhere (true penecho) vs single fluid column
   with generous measure (simpler, keeps reading rhythm). (Recommendation:
   start single-column fluid — "endless tiktok scroll" — add freeform x in a
   later point release if dogfood asks.)
