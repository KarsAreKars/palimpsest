# Workbench 2.x Campaign — "The Living Desk"

**Queen orchestration, full W2.x scope. Owner-approved 2026-09-15.**
Quality bar (owner): *"until the workbench works like nothing you have ever seen before."*

## Goal

Take the block-transcript workbench (2.1, shipped `a2b02e751`) to the full W2.x
vision in one campaign: the desk that probes before teaching, grounds every claim
in the book, derives with structure, draws what words can't say, **speaks**, and
remembers who is sitting at it.

## Scope (owner: full W2.x)

| # | Feature | Essence |
|---|---------|---------|
| 1 | Probe chips + concept map | "I don't know" as a first-class signal; known/edge/unknown map maintained across the session (Alvar probe-first) |
| 2 | Page-lookup tool | Professor can pull exact pages on demand (~60 lines over `manifest.alignment`); "I will look" becomes real |
| 3 | Structured derivations | Auto-numbered derivation blocks (step/justification), CAS-checked as units, MathLive composer upgrade |
| 4 | Diagram blocks | Professor-drawn SVGs with the learn-visual self-check discipline (the picture must show the claim) |
| 5 | Voice answers | Asymmetric voice: professor turns spoken via the existing sidecar `/tts` + Kokoro/Qwen; playback controls in the transcript |
| 6 | Teach-back | Learner explains in their own words; professor evaluates against the book, not against vibes |
| 7 | Chat-bridge | "It's time to workbench" — professor routes deep dives from chat into the desk |
| 8 | Learn-profile (W2.4) | Gentle personalization: pace, voice of instruction, concepts already owned — stored locally per reader |

**Out of scope (owner):** footer/notebook collision and other papercuts, iOS,
Apple signing/notarization, in-app Whisper (TypeWhisper stands), local LLM swaps.

## Non-negotiables (standing law)

1. Librarian voice: every new user-facing string via `_()`; no machinery talk; error kinds, never raw provider detail.
2. No chat bubbles; no mid-session buttons; protocol tags never displayed.
3. Light mode only; design world "The Antiquarian Catalogue" (stamp `#8C3B22` sole accent; unlayered CSS).
4. Tiered context (T0–T4) preserved; new prompt material is **additive-only** to `PROFESSOR_WORKBENCH_ADDENDUM`.
5. **Backward compatibility:** every `workbench-transcript.json` written by 2.1 must load cleanly. Block schema extensions are additive; unknown block kinds render as plain prose (graceful), never crash.
6. One writer per file set at a time (Karpathy). Writers verify: `npx tsc --noEmit` + focused vitest green + no new lint errors in touched files.

## File ownership (binding)

| File set | Owner wave |
|---|---|
| `workbenchChat.ts` (block model, tags), `professorTags.ts`, `prompt.ts` (addendum), `WorkbenchTab.tsx/.css` (block rendering), new block renderers | **A** (pedagogy+derivations+diagrams share one block model — one writer) |
| `AIAssistant.tsx` (bridge), `learnerProfile.ts` (new), settings touch | **D** — parallel with A (disjoint) |
| Page-lookup: new `pageLookup.ts` over `manifest.alignment`, `workbenchSession.ts` plumbing, "consulting the book" indicator block | **B** — after A (prompt/tags coupling) |
| Voice answers: new `workbenchVoice.ts` (player over sidecar `/tts`), voice playback UI in `WorkbenchTab.tsx`, session resume of audio refs | **C** — after A+B merged (WorkbenchTab coupling) |

**Waves:** `A ∥ D` → `B` → `C` → integration (queen). Review loop after integration,
then after each major fix batch; max 3 review rounds per the owner's protocol.

## Contracts between lanes

- **Block kinds** (add to the transcript model): `probe` (chip row), `concept-map`,
  `derivation` (numbered steps[], CAS verdict per step + whole), `diagram` (svg +
  caption + self-check note), `teachback` (learner text + evaluation), `voice`
  (audio ref + duration + voice id; transcript stores metadata only — audio is
  re-synthesized on replay or cached under the book's dir).
- **Tag vocabulary** (additive to the professor protocol; parsed in
  `professorTags.ts` two-pass scanner, never displayed raw):
  `[PROBE]`, `[CONCEPTS known:.. edge:.. unknown:..]`, `[LOOK page:N …]`,
  `[DERIVE title:..]`, `[STEP n /CHECKED ok|bad]`, `[DIAGRAM claim:..]`,
  `[TEACHBACK ask:..]`, `[EVALUATION]`, `[VOICE]`.
- **Page-lookup:** professor emits `[LOOK page:N]`; the desk fetches spans from
  the manifest, injects as an ephemeral context block (not persisted as prose),
  professor's next turn cites it. Whitelist honesty preserved: cites only
  `pages_included` + looked-up pages.
- **Voice:** reuse sidecar `/tts` (proven 2026-09-15); voice id from narration
  settings; playback controls: play/pause/replay, speed; a speaking indicator on
  the active professor block. No new sidecar endpoints.
- **Learn-profile:** `learnerProfile.ts` reads/writes a local JSON per reader;
  prompt personalization injects 3–5 lines max at T3 (session state), never
  rewrites the addendum.

## Verification gates

1. Writer gate: tsc + focused vitest + lint on touched files.
2. Integration gate (queen): full build (`build_palimpsest.sh --bundle`), install,
   launch, smoke: new session with probe, derivation with CAS chips, diagram block,
   voice answer playback, resume of an old 2.1 transcript (compat proof).
3. Review loop: 3 fresh-context reviewers, evidence-only, P0/P1/P2; fix workers;
   targeted 3-question re-reviews; stop at no-P0/no-P1-worth-doing.
4. Owner dogfood; then commit + push; `v0.2.0` tag → CI DMG.

## Sequencing reality

Writers are mostly sequential (shared files). Parallelism lives in: the scout
swarm (specs), review rounds, and the A∥D wave. Estimated: specs < 1 session;
writers 3 waves; review 2–3 rounds. Ship when the owner says the bar is met.
