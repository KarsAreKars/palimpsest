# PENECHO PIVOT — Desk constitution amendment (owner decision, 2026-09-16)

**Decision**: the Desk pivots from chat-on-a-sheet to the penecho paradigm,
effective immediately. v0.3.0 tag is ON HOLD until the pivot lands. The
paradigm: the user writes **anywhere** on the sheet; the professor works
**spatially** — drawing diagrams, writing, annotating beside the user's ink —
"instead of it just feeling like a normal ChatGPT chat" (owner).

## What carries over (do not rebuild)

- The sheet host (DeskSheet, scrim, lamp toggle, Esc/focus, z-order) — wave 1.
- All renderers (blockBody: prose/slips/folio/diagram/concept-map), the rail,
  voice playback, the guards, folio replay — waves 2–3 + review fixes.
- The protocol tag layer and prompt law — the professor still parses and
  emits the same tags; HOW the reply lands on the sheet changes, not WHAT he
  can say.
- Placement fields (`x?/y?/width?`) already on TranscriptBlock — the pivot
  finally *uses* them.
- Pedagogy machinery (probes, teach-back, grounding, shelf rail) — penecho
  has none of this; we keep ours and give it a spatial surface.

## The paradigm shift

- **User input**: click anywhere → the composer opens THERE (not only at the
  tail). Freehand ink (draw/write with pointer) is a v1.1 candidate; v1 pivot
  = placed text boxes anywhere + the existing tail behavior as fallback.
- **Professor output**: a reply is a **cluster** anchored to the user's box —
  his prose, figures, and folio render in a local region beside/below the
  anchor instead of appending to the bottom of a global column. Legacy
  transcripts (no placement) render as today's single column — no migration.
- **Sheet layout**: vertical endless scroll is kept (owner's original spec);
  horizontal placement is free within the sheet's inner margins. Overlap
  policy: v1 clamps clusters apart vertically (audit to spec the rule).
- **"He draws"**: the professor's drawings are SVG artifacts (diagram blocks,
  KaTeX) placed inside the cluster — the pen-down guard (max shapes per
  exchange) stays, counted per cluster.
- The chat transcript model stays as the document (TRANSCRIPT_VERSION stays
  1; placement already additive) — order remains for threading/voice/replay;
  rendering becomes spatial. Pure document-layout change.

## Folded papercuts (queue from dogfood, subsumed by the pivot)

1. Sheet must render as real opaque paper (scrim computed transparent in the
   live build — fix with an explicit opaque fallback under the color-mix).
2. Reader shortcuts (t/h/j) must not fire while the Desk is open.
3. Composer discoverability: click-anywhere (this IS the pivot's user input).

## Campaign shape

Same queen protocol: 3 scouts (e1 ink/placement-anywhere + papercuts, e2
spatial professor clusters + protocol/rendering, e3 canvas layout + legacy
fallback + document model) → integration audit (e4) → writer waves → queen
integration (build/install/smoke) → targeted review → owner dogfood → v0.3.0.

## Gates

tsc clean; all campaign suites green + new pivot suites; biome; the
INSTEGRATION smoke checklist updated for spatial mode; old 2.1/2.x/chat
transcripts render as the legacy column; no test weakened; the review-loop
protocol (REVIEW_CHARTER.md) governs the pivot's review.
