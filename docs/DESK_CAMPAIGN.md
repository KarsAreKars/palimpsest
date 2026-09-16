# Campaign: The Desk — workbench 3.0 (freeform thinking layer)

**Queen orchestration. Owner-approved 2026-09-15 (pivot decision).**
Vision: `docs/vision/THE_DESK.md` (read first). Research inputs:
`docs/research/PENECHO.md`, `docs/research/WIGGLYSTUFF.md`.

## Goal

Re-host the 2.x workbench from the notebook sidebar panel onto a **full-page
sheet that slides out from underneath the PDF**: endless vertical scroll,
click-anywhere text boxes (Enter sends), the professor answers in place
(prose, math, CAS-checked derivations, figures, voice), a green/yellow/red
concept rail on the margin, the book dimmed but still the source of truth.

## Sequencing decisions (owner)

- 2.5 polish (wiggly folio replay + penecho guards) **folds into this
  campaign** — no separate 2.5 release.
- Review loop runs **once, at the end, over 2.x + Desk together** (option: the
  owner's pivot choice), then `v0.3.0` tag (v0.2.0 is skipped as a release;
  v0.1.0 remains the public DMG until then).

## Product defaults (queen, owner-overridable at any review gate)

1. Sidebar Workbench tab is **removed** when the Desk lands (one surface).
2. One endless sheet **per book** (whole-subject mural).
3. Layout starts as **single fluid column** with generous measure
   (tiktok-scroll), not freeform x — `(x,y)` fields are specced additively so
   freeform can arrive later without migration.

## Non-negotiables (standing law + Desk additions)

1–6. Campaign law of 2.x stands: librarian voice `_()`, no mid-session
   buttons (a placed composer is user-invoked, law-compliant), protocol tags
   never displayed, light mode, additive-only prompts, old transcripts load.
7. **The book must visibly remain the source of truth**: sheet has a scrim
   that keeps the page ghost-visible behind it; page citations still jump
   the book.
8. **One surface, no split brain**: desk state, transcript, and voice obey a
   single focus owner (the Desk replaces the workbench tab entirely).

## Contracts carried from 2.x (unchanged)

Blocks, tags, silent CAS, teach-back, probes, voice player, tiered context,
persistence (`workbench-transcript.json` becomes the desk document; placement
fields optional — additive).

## New contracts to spec (scouts)

- Sheet host + header toggle + slide-underneath animation + focus/escape.
- Placement fields `(x?, y?, width?)` on `TranscriptBlock`; sheet layout +
  scroll-follow; click-to-place composer.
- Professor-in-place: block renderers as sheet objects; streaming ink-nib at
  the placed position.
- Traffic-light rail bound to `latestConceptMap` (green/sage, amber/muted,
  red/stamp).
- **Folded 2.5**: wiggly folio replay (step-through attention choreography
  per WIGGLYSTUFF.md recommendation, DerivationSlip-level, ~30-line v1) +
  penecho guards (per-turn professor block budget enforced in
  `workbenchChat.ts`; diagram self-check stop condition; concept shelves move
  at most one step per exchange).

## Verification gates

Writer gates (tsc + focused vitest + biome). Queen integration: full build →
install → smoke: open Desk from header → place a box → professor answers in
place → derivation folio replays step-by-step → figure speaks → rail shows
g/y/r → Esc returns to the book with page intact → old 2.x sidebar transcript
still loads (it becomes the sheet's document). Final review loop (3
reviewers, 2.x + Desk scope, ≤3 rounds) → owner dogfood → `v0.3.0`.
