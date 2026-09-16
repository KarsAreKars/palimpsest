# Research — wigglystuff `FormulaAnimation` and animated formulas for Palimpsest

**Date:** 2026-09-16 · **Status:** research note for the workbench campaign · **Sources:** live GitHub (no access caveats — README, `pyproject.toml`, `demos/formula_animation.py`, `wigglystuff/formula_animation.py`, `wigglystuff/static/formula-animation.{js,css}` all fetched raw from `koaning/wigglystuff@main`; PyPI metadata cross-checked)

---

## 1. What wigglystuff is, and what `formula_animation.py` does

**wigglystuff** is Vincent D. Warmerdam's open-source collection of ~50 creative
**AnyWidgets** — interactive widgets for Python notebook environments (marimo,
Jupyter, VSCode, Colab, Shiny, Solara). It is *not* an animation studio, not
Manim, not a video tool. Per the README: *"A collection of creative AnyWidgets
for Python notebook environments."* Each widget is a Python `traitlets` class
(anywidget) whose synced traits drive a small hand-written ES-module front-end.

`demos/formula_animation.py` is a **marimo notebook** demo of one widget,
`FormulaAnimation` (added ~v0.5.30; repo now at 0.5.32). The demo animates the
**derivation of the quadratic formula** through seven LaTeX steps. Quoting the
demo's own step list:

```python
steps=[
    {"tex": r"ax^2 + bx + c = 0", "note": "A quadratic equation, with a ≠ 0."},
    {"tex": r"x^2 + \frac{b}{a}\,x + \frac{c}{a} = 0", "note": "Make the leading coefficient 1."},
    {"tex": r"x^2 + \frac{b}{a}\,x = -\frac{c}{a}", "note": "Get the x-terms alone."},
    {"tex": r"\left(x + \frac{b}{2a}\right)^2 = \frac{b^2}{4a^2} - \frac{c}{a}", "note": "Add (b/2a)² to both sides."},
    {"tex": r"\left(x + \frac{b}{2a}\right)^2 = \frac{b^2 - 4ac}{4a^2}", "note": "One fraction over 4a²."},
    {"tex": r"x + \frac{b}{2a} = \pm\frac{\sqrt{b^2 - 4ac}}{2a}", "note": "Both signs survive the root."},
    {"tex": r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}", "note": "The abc-formula."},
]
```

**Step by step, what the animation actually shows** (from the front-end source):

1. **Stage build.** Every step is rendered once into its own "slot" div via
   `katex.renderToString(tex, { displayMode: true })`; slots are stacked in one
   stage of fixed height (default 360px).
2. **Focus layout.** Only two slots are ever visible: the *current* line is
   centered at full scale and opacity; the *previous* line floats **104 px
   above** (`SLOT_OFFSET`), scaled to 0.9, dimmed to **0.35 opacity**. All
   other slots are opacity 0, parked off-stage by `translateY(i - focus) * 104px`.
3. **The move.** On `next`/`prev`, slots transition with
   `transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease` — the
   old line *glides upward and fades* (a departing ghost), the new line *rises
   into the center*. This is the entire motion vocabulary: one vertical slide
   plus a crossfade. Nothing morphs glyph-by-glyph.
4. **Caption.** A one-line note under the active line explains the move
   (`"Get the x-terms alone."`); it fades in only while its step is current.
5. **Spotlight finale.** With `spotlight=True` (default) one extra step exists:
   the last formula is framed alone — scale 1.15, a drawn frame around it,
   caption suppressed, counter reads `8 / 8`. The finished result gets a
   closing beat.
6. **Pacing & interaction.** Playback is **manual and scrubbed, never
   autoplayed**: ‹ / › buttons, ←/→ keys (opt-in — the controls are
   focusable, keyboard only fires once the widget is clicked, so notebook
   arrow keys are never stolen), Home/End, and externally the synced `step`
   trait (the demo drives it from a marimo slider — a second cell scrubs the
   same widget). A counter shows `n / total`.

## 2. The stack, and what it means for a webview

| Layer | wigglystuff reality |
|---|---|
| Python side | `anywidget>=0.11.0` + `traitlets` (synced `steps`, `step`, `title`, `spotlight`, `theme`, `height`, `error`); runtime deps are just `anywidget` and `drawdata`. |
| Front-end | A single ~250-line hand-written **ES module** (no framework, no build step) + one CSS file. |
| Math typesetting | **KaTeX 0.16.11**, loaded from the jsDelivr CDN (`katex.mjs` + `katex.min.css`) — `renderToString` → `innerHTML`, `throwOnError: false`. |
| Animation | Pure **CSS transitions** on `transform`/`opacity` of stacked divs. No canvas, no rAF, no SMIL, no Lottie, no WebGL. |
| Output format | **Live interactive DOM widget.** No video, no GIF, no exported frames, no animated SVG. |

**Webview meaning:** the "asset" being admired is already a web technology.
There is nothing Python-specific in the visual at all — Python only ferries the
`steps` list into the browser. A Tauri webview (React + KaTeX) can host the
identical effect natively. KaTeX is already a dependency of the readest app
(`katex@^0.16.45`), and the campaign's derivation blocks already carry
structured `steps[{id, latex, justification}]` — the exact input the widget
consumes. The only caveat in the source: the widget pulls KaTeX from a CDN at
runtime, which Palimpsest would not copy (we already bundle KaTeX locally, and
the app is offline-first).

## 3. Why it's delightful — the actual mechanic

Be precise, because the temptation is to over-describe it: **this is not
formula morphing.** No term interpolates into another term; no glyph travels.
The delight comes from four cheap, deliberate choices:

1. **Temporal disclosure (the core principle).** A derivation is a sequence of
   *transformations*, but a printed page shows all of them at once — the eye
   skims to the result and the *reason each line exists* is lost. The widget
   re-imposes the one-thing-at-a-time order of a good lecturer: each line
   appears only when you're ready, with its justification in a caption
   *under the line it explains*. The math itself never moves; **attention**
   is what moves. (Call it *attention choreography*: the animation is a
   spotlight, not a morph.)
2. **The dimmed ghost.** Keeping the previous line visible — faded, small,
   pushed up — preserves continuity (you can still see where you came from)
   without competing for attention. It fights change-blindness: the delta
   between ghost and current line *is* the transformation, and your eye finds
   it for free.
3. **Manual pacing with scrub.** The learner controls tempo (buttons, keys, an
   external slider). No autoplay, no waiting, no re-winding a video to check
   step 3. Agency is a big part of why it feels like a tool, not a clip.
4. **The spotlight finale.** One closing beat isolates the finished formula —
   a small reward/closure event, the "Q.E.D." gesture. It marks *arrival*.

Aesthetic restraint is built in: 420 ms, a gentle ease-out, two opacity levels,
one translate. It reads as calm, not flashy — very close to the ink-like
restraint the Antiquarian Catalogue asks for.

## 4. Integration routes for Palimpsest

### Route A — sidecar pre-renders animation assets (Lottie / animated SVG / MP4)

**Verdict: reject as primary route.** There is nothing for the sidecar to
pre-render: the effect is live CSS on live DOM. Every raster/video stand-in
(MP4, GIF) trades away the properties that make it good — selectable text,
KaTeX crispness at reader zoom, manual scrub, theme-matched ink, and transcript
size (seconds of video per derivation vs. the steps already in the JSON).
Lottie would mean a new renderer, a new authoring path in Python, and a
sanitize-policy expansion — to reproduce a 250-line CSS trick. If a future
**diagram** (not derivation) ever needs true motion the professor can't draw
(e.g. a curve sweeping out), *then* a pre-rendered asset question becomes real;
for formulas it is a solution in search of a problem. Cost: high; fit: poor.

### Route B — pure-frontend port: a "folio replay" mode on DerivationSlip

Port the widget's layout/transition logic (~100 lines of it) into a React
component that consumes the **existing** `block.derivation` payload — no new
protocol, no sidecar work, no new persistence.

- **Files touched:** `DerivationSlip.tsx` (additive "replay" affordance on the
  folio, or a sibling `DerivationReplay.tsx` mounted from `WorkbenchTab.tsx`);
  `WorkbenchTab.css` (new `wb-replay-*` classes only); **not**
  `diagramSvg.ts` (this is React-owned DOM, not sanitized author SVG — the
  allowlist question doesn't arise; KaTeX here renders through the existing
  vetted Streamdown/KaTeX path); **not** `mathCheck.ts` (CAS verdicts attach
  by step id exactly as they do now; chips can ride the replay steps).
- **Build shape:** none new — bundled JS + CSS. Offline by construction.
- **Latency:** zero (local render; steps already in the transcript).
- **Transcript persistence:** nothing new — replay is ephemeral UI state over
  the persisted folio. Backward compat (campaign non-negotiable 5) is trivially
  preserved: old transcripts gain a replay button; new ones need no schema.
- **Design fit:** direct — 420 ms ease-out, ghost at reduced opacity, stamp
  accent reserved for the spotlight frame. Honors "no mid-session buttons"
  by being learner-invoked, and light mode only.
- **Gaps vs the demo:** per-step *captions* (the demo's `note`) map naturally
  to the step `justification` the schema already stores — one prompt-addendum
  sentence can encourage short, move-explaining justifications, fully
  additive to `PROFESSOR_WORKBENCH_ADDENDUM`.
- **Optional later protocol step:** an `[ANIMATE]` tag or a `spotlight` block
  field — *not needed for v1*; the folio already contains everything.

**This is the recommended route** (see §5).

### Route C — smaller-still: in-place step reveal on the existing folio

Even before a staged component: number the steps but reveal them one at a time
as the learner clicks/scrolls the folio (opacity/height transitions on the
existing `.wb-step-row`s), ghosting the previous row. Same input, no stage, no
spotlight. A genuinely tiny first slice of B, and a fair fallback if B's stage
layout fights the desk's reading rhythm. Cost: ~1 CSS block + ~30 lines of
state in the slip.

### Route D — true term-level morphing (KaTeX glyph interpolation)

For completeness: the *other* delight people associate with "animated math"
(Manim-style, 3Blue1Brown-style) is glyphs actually traveling between lines.
KaTeX does not support this; MathJax v3's SVG output + custom tweening does,
at the cost of swapping renderers and writing a token-matcher between
arbitrary LaTeX ASTs — months, fragile, and it would fight the CAS-verified
step model (we'd be animating lines the desk hasn't checked as a unit).
Post-2.x curiosity only; do not let it block B.

### Fit vs the campaign

B and C are **post-2.x polish** unless the owner elevates them: the 2.x
campaign (derivations, diagrams, voice, teach-back) is already full, and law 4
limits prompt changes to additive addendum text. Nothing in B/C touches lane
boundaries or transcript versioning, so either can slot into the integration
wave or a 2.x-point release without disturbing writers A–D.

## 5. Recommendation

**Build Route C first, then B.** The owner loved a *step-through spotlight*,
not a morph — so don't build a morph. The smallest lovable version: a
learner-invoked "step through" on the derivation folio that reveals the desk's
own numbered steps one at a time with the previous step dimmed above, the
justification riding under the active step, and a final beat that frames the
goal line. If the staged treatment earns its place, promote to B's full
FormulaAnimation-style stage (buttons, arrow keys, scrub) reusing
`block.derivation` verbatim. No sidecar work, no protocol tag, no sanitize
policy change, no persistence change; offline; additive-only by construction.

## 6. Verdict (one paragraph)

Ship the attention, not the morph. wigglystuff's `FormulaAnimation` is a
250-line hand-written anywidget whose entire magic is: stack KaTeX-rendered
steps, keep only the current line lit with the previous line dimmed above it,
caption each move, and end on a framed spotlight — 420 ms CSS transitions,
manual pacing, zero video. Because Palimpsest's workbench already persists
derivations as numbered steps with justifications and CAS verdicts, the same
delight can be reimplemented natively in the existing React + KaTeX stack in a
few hundred lines, with no new assets, no protocol change, and no threat to
the Antiquarian Catalogue's restraint. First build: a per-folio "step through"
reveal (Route C); promote to the full staged replay (Route B) if the owner
wants the scrub slider and spotlight finale. Term-level morphing (Route D) is
a different, expensive genre — explicitly out of scope for this delight.

---

### Appendix — evidence anchors

- Demo: `demos/formula_animation.py@main` (marimo app, 7-step abc-formula,
  theme dropdown, external slider driving `anim.step`).
- Widget Python: `wigglystuff/formula_animation.py@main` — traitlets
  `steps/title/spotlight/step/height/theme/error`; `_normalize_steps` requires
  `{tex, note?}`.
- Widget JS: `wigglystuff/static/formula-animation.js@main` — KaTeX 0.16.11 via
  jsDelivr; `SLOT_OFFSET = 104`; scales {1, 0.9, 1.15-spotlight}; opacities
  {1, 0.35, 0}; focus-scoped ←/→ keys; `change:step` → `applyLayout`.
- Widget CSS: `transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
  opacity 420ms ease`.
- Packaging: `pyproject.toml@main` — `anywidget>=0.11.0`, `drawdata`;
  PyPI wigglystuff 0.5.32, MIT, requires-python ≥3.11.
- Palimpsest: `docs/WORKBENCH_2_X_CAMPAIGN.md` (non-negotiables 1–6),
  `docs/campaign/s3-structure.md` (tags, folio/figure-slip model),
  `DerivationSlip.tsx` (steps + justifications + verdict chips by step id),
  `DiagramSlip.tsx` / `diagramSvg.ts` (render-time allowlist sanitize;
  irrelevant to DOM-native replay), `mathCheck.ts` (`/check` contract
  unchanged), `package.json` (`katex@^0.16.45`, `dompurify@^3.4.0`).
