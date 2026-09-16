# Review Charter — the one big review (2.x + Desk)

**When**: after Desk wave 3 + queen integration (build/install/smoke green).
**Protocol** (owner's, standing): 3 fresh-context reviewers per round, one
writer at a time, evidence-only findings with file:line, P0/P1/P2 labels,
merge verdicts (PASS / FIX / REJECT), max 3 rounds, targeted 3-question
re-reviews, parent synthesizes and decides; P2s deferred only with reasons.

## Reviewer lanes (round 1)

1. **Correctness & protocol** — professorTags scanner under the full W2.x+Desk
   grammar; streaming tag leaks; transcript parse/serialize + placement
   sanitize; guards (budget/self-check/shelf clamp) exactness; CAS mapping.
2. **Desk architecture** — sheet lifecycle (mount/unmount, focus trap, Esc,
   z-order), scroll ownership, blockBody byte-identical drift, voice handoff,
   the WorkbenchTab retirement (no dead imports/orphans), BooksGrid mount
   correctness per book.
3. **Law & design world** — `_()` coverage of new strings, no machinery talk,
   no mid-session buttons, stamp sole accent, light mode, ≤2px corners,
   reduced-motion paths, keyboard accessibility of composer/rail/replay,
   old 2.x transcripts + a wave-0 2.1 transcript load clean.

## Gates to hand reviewers

- `npx tsc --noEmit` clean; the 12 campaign suites green
  (desk-store, desk-sheet, desk-canvas, desk-rail, workbench-chat,
  workbench-pedagogy, workbench-derivation, workbench-replay,
  workbench-guards, diagram-svg, workbench-voice, professor-page-lookup).
- Pre-existing-failure ledger (NOT review scope): professor-voice CAPTION
  (2), and the ~169 legacy upstream failures.

## Verdict bar

P0 = data loss, crash, protocol leak to the reader, law breach (tag shown,
machinery talk, dark styling). P1 = wrong behavior in a shipped feature,
missing _(), focus/keyboard break. P2 = polish/deferred — record reason.
No P0 + no P1-worth-doing after a round → merge and hand to owner dogfood.
