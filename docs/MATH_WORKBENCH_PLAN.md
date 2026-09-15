# Palimpsest — Notebook Math Workbench (Plan)

Status: research complete (4 lanes, 2026-09-14). Awaiting build approval.
Product owner vision: a professor over your shoulder while reading. When you don't
understand something (e.g. Newton's 2nd law), the professor opens a **blank page**,
derives it step by step grounded in *the book you're holding*, hands it to you —
*"now you"* — watches you work, and tells you exactly where you went wrong.
Voice never leaves: derivation, handoff, and corrections are spoken by the same
narrator. **Textbook is the source of truth.**

---

## 1. Convergent architecture (all 4 lanes agree)

| Layer | Decision | Evidence |
|---|---|---|
| Professor rendering | **KaTeX via streamdown + `@streamdown/math`** — both already in deps (`katex@0.16.45`, `streamdown@1.6.10`). streamdown's parser handles incomplete `$$` mid-stream. Offline: bundle CSS + woff2 fonts (~630 KB once). | Lane 1 |
| User math input | **MathLive** (`<math-field>`, MIT, active) — the ONE new dependency. Dynamic-imported into the workbench tab only (~850 KB min, never in reader chunk). Emits LaTeX + MathJSON + spoken text (TTS synergy). Fallback: textarea + KaTeX preview (20 lines, build day one). | Lanes 1+4 |
| Document model | **Structured steps + linear op-log**. No CRDT (Yjs solves multi-human realtime — we have 1 user + 1 LLM, turn-based). No BlockNote/ProseMirror (9 MB + theme war for freeform editing we don't need). Step = `{stepId, latex, plain, author, state, anchor?, noteIds[]}`. | Lanes 1+2+4 |
| Edit-stream to LLM | Debounced (400–800 ms) op-log batches: `snapshot + recentOps (hesitation signal) + compactHistory + focusStepId`. Intent hints: `typed / filled-gap / corrected-prof-step / deleted-own-step`. | Lane 2 |
| Step checking | **sympy + latex2sympy2 in the EXISTING Python sidecar** — new `POST /check` next to `/tts` on 127.0.0.1:8737. sympy is the only grader-grade OSS CAS. mathjs/nerdamer/algebrite explicitly rejected as primary. | Lane 3 |
| Verdict schema | **Three-valued, never binary**: `equivalent` / `implied_forward|backward` (squaring both sides is valid!) / `not_equivalent` (only with counterexample) / `unknown` (sympy None → LLM adjudicates; professor may NEVER call a step wrong on `unknown`) / `parse_error` (not wrong math). Vocabulary transplanted from STACK's equivalence-reasoning input. | Lane 3 |
| Verdict authority | **CAS decides correctness; LLM diagnoses and teaches.** Verdicts injected into the professor context pack as evidence; the disclosure ladder already in prompt.ts picks the rung. Offline sidecar → `unavailable` → professor proceeds on judgment (echo-tutor honesty pattern). | Lane 3 |
| Grounding anchors | Each professor step carries `{page, mdSpan, quote}` resolved via existing `manifest.alignment` (same code path as `getChapterText`); verified at render by re-slicing content.md. Anchors ride every edit-batch so the model quotes the textbook verbatim. | Lane 2 |
| Persistence | `workbench.json` per book via existing AppService file API (same pattern as `learner.json`). Undo = compensating ops; checkpoints at session boundaries. turso table optional later. | Lane 2 |
| Notebook fit | 4th tab: `spine · notes · study · workbench` — extend `NotebookTab` union + nav + switch. | Lanes 2+4 |
| Isolation (HARD requirement) | The assistant-ui chat tab crashed the notebook on 2026-09-06 and was deleted. Workbench mounts behind `React.lazy` + error boundary; streaming state NOT in global zustand root; a model failure must unmount only the workbench subtree. | Lane 4 |
| Ideas to steal | **marimo** cell-DAG: edit step k → invalidate + re-check downstream (zustand `dependsOn` edges, few hundred lines). jupyter-ai chat→cell protocol. | Lane 4 |
| Anti-goals | tldraw (license phones home + production key), MathQuill (dead 2016, MPL), novel (stale), BlockNote (MPL + ProseMirror + theme war), anything GPL/AGPL outside our own fork, Pyodide-as-primary (2s WASM init; fine as future pure-web fallback behind same `/check` contract). | Lane 4 |

## 2. Professor behavior (the handoff loop)

States: `derive → handoff → watch → review`. One writer at a time by design.
Professor corrections arrive as **tracked suggestions** (`state: proposed`, stamp
ink, accept/reject) — never silent overwrites. User's fresh op to a step
auto-rejects a stale professor suggestion on that step. Last-writer-wins per step
otherwise. `prevLatexHash` gates professor ops against stale content.

## 2. Professor behavior (the handoff loop)

States: `derive → handoff → watch → review`. One writer at a time by design.
Professor corrections arrive as **tracked suggestions** (`state: proposed`, stamp
ink, accept/reject) — never silent overwrites. User's fresh op to a step
auto-rejects a stale professor suggestion on that step. Last-writer-wins per step
otherwise. `prevLatexHash` gates professor ops against stale content.

**Owner decisions (2026-09-14):**
- **Patient by default** (marks appear as you work; full review at "done");
  strict mode is a future toggle. Escalation trigger independent of mode:
  "stuck twice on the same step".
- **Correction ladder (owner spec):** on a wrong step, the professor (1)
  explains HOW the student got there — reconstructs the faulty reasoning path;
  (2) gives CLUES (where you might be tripping up / what you could do) instead
  of the answer; (3) only if truly stuck, reveals the answer, then holds an
  in-depth discussion of what went wrong. Extends the existing four-rung
  disclosure ladder in `prompt.ts`.
- **Math first.** The workbench proves the pattern on math (CAS-checkable),
  then generalizes to other subjects.
- Pedagogy spine: ZPD (work the edge of the circle), Feynman technique
  (verified by DOING, not claiming), System 1/2 fluency illusion — easy,
  intuitive practice deceives; slow, effortful retrieval builds mastery.

## 3. Milestones

- **M0 — voice server fortification** (small, independent): ownership token —
  server writes a token file on spawn; app verifies responder is its own child,
  else evict foreign pids + respawn (generalizes the `restart_voice_server` fix).
  Also: crash-restart wrapper on the held child.
- **M1 — Workbench skeleton** (no LLM): 4th tab, step list rendering hardcoded
  derivation via streamdown/KaTeX; MathLive input per step; zustand op-log store;
  workbench.json persistence; textarea fallback. Tests: reducer + round-trip.
- **M2 — `/check` endpoint**: math_server route in sidecar (4-rung verdict ladder:
  simplify → equals → solution-set implication probes → unknown), per-pair 2s
  timeout, counterexample extraction; TS `verifyDerivation` helper with echo-mode
  fallback; three-valued UI marks (✓ / ◌ "the professor will look" / ✗ with counterexample).
- **M3 — Professor integration**: workbench-mode prompt contract (`$$` blocks only,
  no `$` in prose, one equation per step); derive → handoff → watch loop;
  edit_batch streaming; tracked suggestions + margin notes via existing
  annotation bus; grounding anchors; marimo-style downstream invalidation.
- **M4 — Voice + polish**: professor speaks each step while it highlights
  (reuse narration highlight pipeline); strict/patient toggle; StudyTab review
  queue "work it" hookup for stuck concepts; e2e typing test of MathLive in
  the built app (focus/IME/no virtual keyboard).

**One-day prototype slice = M1 + M2-core**: you fill a gap in a 3-step derivation;
the sidecar marks it; `workbench.json` round-trips; offline.

## 4. Biggest risks (carried from lanes)

1. False negatives on creative-but-valid steps → three-valued UI + professor never
   condemns `unknown`. Trust is the product.
2. Consequence-vs-equivalence confusion (valid one-way steps flagged wrong) →
   implication probes + tests from STACK's own reject-list examples.
3. MathLive weight + shadow DOM inside our specific WKWebView → dynamic import,
   fallback editor, one hands-on typing test in the built app.
4. Op-log context bloat → snapshot only active neighborhood, compact old history,
   session checkpoints.
5. Chat-runtime crash recurrence → lazy + error boundary + store isolation (M1 rule).

## 5. Source lane reports

- Lane 1 (rendering/input): ~/.pi/agent/sessions/--Users-krishsheladiya-Documents-kimi-workspace-readest-src--/subagent-artifacts/outputs/b09d2ed6-8ef3-4d0f-bd7b-f680e5fa49fe/research.md
- Lane 2 (shared-doc architecture): .../aca9a08e-a8e9-4b48-8f45-d43f5bf364c5/research.md
- Lane 3 (deterministic checking): .../2574d81f-d976-4ab2-89fe-eb99a0b51ad0/research.md
- Lane 4 (OSS sweep): .../39093ac6-23ad-48ea-935c-5a7d1f3fab8e/research.md
- Lane 5 (learning science): .../25855211-82d7-4e9f-a41a-954002b14cbb/research.md
- Lane 6 (tutoring state machine): .../565c1aaf-b3c9-4f1d-af40-76270d8a4ea9/research.md

---

## 6. Pedagogy engine (lanes 5+6) — M3's full spec

### 6.1 Design principles (evidence-strength in lane 5 report)
Verify by generation, never self-report (STRONG). Retrieval before re-exposure
(STRONG). Space at ~10-20% of target interval (STRONG verbal / heuristic for
math). Interleave after 2 consecutive correct (MODERATE-STRONG). Worked examples
for novices, faded on ~2-3 consecutive successes — expertise reversal is real
(STRONG). Clues before answers, escalating rungs (STRONG components). Errors are
productive; **high-confidence errors are the highest-value correction targets —
ask "how sure are you?" BEFORE revealing verdicts** (hypercorrection, STRONG).
Teach-back = diagnostic probe, not magic (components MODERATE, branded technique
unstudied). Feedback at process level, feed-up/back/forward structure, never
person-level (STRONG). Immediate marks + deferred discussion (patient split,
MODERATE). Mastery-gate at P(mastery)≈0.9 with corrective loops (STRONG).
DEBUNKED, do not build: learning styles, massed re-reading/highlighting,
fluency-as-mastery, premature answers, trait praise. Honest ceiling: best
software ~0.2 SD, human tutoring ~0.3-0.4 — voice/patience/grounding carry the rest.

### 6.2 Tutoring state machine (owner philosophy, evidence-backed)

```
WATCHING ─▶ HINTED(rung 0..2) ─▶ REVEALED ─▶ DISCUSSING ─▶ RE-TESTING(scheduled) ─▶ WATCHING
   ▲             │▲                │             │ (fail → HINTED rung 1)
   └─────────────┴─────────────────┴── declare-done / abandon / silence
```

- **WATCHING:** professor silent; CAS marks render silently (✓/✗+counterexample
  on hover / ◌ unknown / parse-error never spoken). Voice only on triggers.
- **HINTED(k):** rung 0 conceptual → rung 1 strategic → rung 2 worked-example.
  **Climb rule: one rung per committed student attempt — never two hints without
  an attempt between** (hint abuse costs ~1/3 of learning; Baker LAK lineage).
  Each rung is preceded by fault-path reconstruction targeting a NAMED misconception.
- **REVEALED:** rung 3 bottom-out answer, once, plainly + immediate mandatory
  re-derivation by the student (generation effect, .40 meta-analytic) — no credit
  until the corrected step is committed and CAS-verified.
- **DISCUSSING:** teach-back probes from the misconception library, ≤3 rounds;
  check-me verdicts reuse existing pass/retry.
- **RE-TESTING:** spaced concept re-tests (NOT procedure re-drills — spacing
  evidence is weak for math procedures): +24h → ×3 on pass, reset on fail, retire
  after 2 passes. One re-test prompt max per app session, highest priority.
- Release gates (existing Bloom-keyed ladder) fed by concrete events: stuck
  signals = same-step STEP_BAD retries + explicit reveal requests.
- Strict mode = future `tutor.strict` flag: gates one signal tighter, cooldown halved.

### 6.3 CAS verdict → machine events (two-channel policy)
Marks immediate & unlimited; professor voice delayed & budgeted.
`STEP_OK` silent ✓ · `STEP_BAD(k)` silent ✗ + counterexample; after 2 failures on
one step → one pause-based availability offer ("Want a pointer, or keep going?" —
ask-first beats unrequested help) · `ASK_HELP` served immediately, unbudgeted ·
`DECLARE_DONE` = guaranteed full review slot · `ASK_REVEAL` honored, counts as
stuck signal. Never speak within 20s of last keystroke. T_pause=60s (patient) / 30s (strict).

### 6.4 Noise budget (hard rule)
Unsolicited voice ≤1 per 10 min active work per book, ≤3 per problem session.
Budget exhausted → professor says once, warmly: "I'll stay quiet unless you ask —
the marks are still keeping score." Silent marks never budgeted.

### 6.5 Misconception library (per book, `misconceptions.json`, app-seeded)
Schema: id, name, domain, pattern (normalized sympy-srepr templates), root_cause,
clue_template, reveal_template, teachback_probe, provenance, confidence_prior.
Match pipeline (MiRAGE-style): (1) deterministic template retrieval ≤5 candidates
ranked by shape + learner's bug history; (2) one LLM call picks + confidence +
plain-language reconstruction in repair-theory terms ("reached for the one
rule you know..."). confidence<0.5 → ad-hoc "observed" entry (BUGGY-style: the
learner's own mal-rule enters the library). CAS = constraint authority (that/where);
library+LLM = why. 10 seeds: alg.exp_over_sum, alg.distrib_over_power,
alg.sign_of_negative, alg.cancel_terms, alg.cross_multiply_always,
alg.frac_add_numerator, alg.move_term_no_flip, alg.equals_operator,
calc.chain_rule_omitted, calc.power_rule_product (provenance: mathmistakes.org,
Nix the Tricks, validated calculus-misconception taxonomy).

### 6.6 New state/stores (all additive; professor-prompt.test.ts guards existing ladder text)
`learner.json` += `retest_queue`, `gaming_signals` (hint_velocity), `problem_sessions`
(per-problem state machine snapshot). ConceptState += `misconception_ids`.
New: `misconceptions.json`; `applyTutorEvent(session, event)` pure transition fn
(mirrors applyExchange — contract-testable); `diagnoseFaultPath()` next to
distillNote() (non-streaming; null diagnosis → generic rung phrasing, never fabricated).

## 7. Workbench 2.1 — the block transcript (owner feedback, 2026-09-15, final shape)

Owner verdict after dogfooding: **no buttons, no bubbles.** The workbench is an
Obsidian-style stack of blocks — THE PROFESSOR writes a block, YOU write a block
underneath, Enter sends, the professor answers below that, and so on. The three
buttons (ADD STEP / CHECK MY WORK / ASK REVIEW) are deleted. The step-row UI
demotes to a future "open as desk" zoom view, not deleted.

**Session start is conversational — and there's a button too.** The student
says "it's time to workbench" (or similar) to the professor — in the existing
professor chat — and the professor reviews the conversation history (all Q&A so
far), the learner model's concept states, and the current page, then opens a
session: the workbench tab slides open with the professor's first question.
Equally, the workbench tab itself carries one quiet stamp button — "Start a
session" — that does the same from inside. Two doors, one room.

**The holistic professor (new prompt layer — Provenance).** Teach each concept
three ways: what it is (book-grounded, source of truth), where it came from
(history, people, stories), and why it mattered (consequences, applications).
Owner's exemplar: the Fourier transform taught alongside the Cold War
seismometer story — superpowers monitoring each other's ground frequencies to
verify the test-ban, giving both sides reliable verification. That register:
math as part of human history, not a 1-dimensional formula. Book remains the
authority for the material itself; stories are enrichment and must be told as
stories, never conflated with the book's claims.

**Context = tiered assembly (CONTEXT_ARCHITECTURE.md, post-review).** NOT
whole-book stuffing (owner's second thoughts were right: lost-in-the-middle
citation decay, $5 vs $0.61/session, and the 600k cap silently fell back for
the biggest books — Game Theory is ~314k tokens). Every turn ships T0 current
page + T1 chapter window ≤30k chars + T2 top-3 concept-struggle pages + T3
session state + T4 whole book only ≤80k chars; local/ollama mode hard-caps at
60k chars and drops tiers. The pack rebuilds EVERY turn (turn-2+ grounding
fix) in byte-stable order for prompt caching. The professor cites only pages
in the pack whitelist, else says "I will look". A page-lookup tool is W2.2+
(~60 lines over manifest.alignment).

**Blocks, not bubbles.** Full-column blocks with small-caps attribution (THE
PROFESSOR / YOU), hairline rules, KaTeX everywhere (`$$` renders typeset; no raw
`[CONCEPT:]/[QKIND:]` tags in display — they parse into the learner model).
Professor derivation = a numbered steps block with book anchors, cited. Enter
to send, Shift+Enter for newline. Composer accepts text + `$...$` (ƒx button
opens MathLive popover). Silent checker: math in a student block is checked
automatically; verdict chip renders INSIDE the block (✓ sage / ✗ stamp +
counterexample on hover / ◌ mutedink). No check button — it just happens.

**Persistence.** The transcript is a per-book document (blocks + op-log) —
survives restarts, reloads in future sessions, sessions resumable ("last time we
were deriving X — here's a fresh re-test"). workbenchStore already models the
op-log; blocks derive from it.

**Safety (2026-09-06 crash scar):** plain message array + existing tutor.ts
askProfessor — no assistant-ui runtime. Streaming state local to the workbench
subtree; lazy + error boundary unchanged.

**Build order:** W2.1a block transcript UI + Enter composer + persistence +
KaTeX/tag-stripping render · W2.1b session bootstrap (chat command → workbench
opens; conversation history + learner concepts + whole-book context pack) ·
W2.1c Provenance prompt layer + workbench LaTeX contract · W2.1d silent check
chips · W2.1e MathLive composer popover · W2.1f tutor ladder wiring (hints in
chat, shadow-mode first).

### 6.7 M3 build order (professor integration — machinery, largely landed)

## 8. Pedagogical protocols (owner's Alvar skill suite — design input)

The owner's `teach`/`probe`/`learn-visual`/`learn-profile`/`learn-verify` skills
map onto the workbench as spec, not runtime code:

- **Edge-of-understanding + one teacher/one mind (teach/philosophy):** the
  professor is the single trusted interface over many sources (the book first).
  `known`/`edge`/`unknown` concept map → learner.json concept_states should
  carry a tristate alongside bloom_level; sessions target `edge` only — never
  reteach `known`, never dump `unknown` with no ramp.
- **Probe-first session start (probe):** startWorkbenchSession opens with a
  2–3 question probe on the chosen topic, not a lecture. Quiz shape per the
  skill: 1–3 questions, 3 content choices + **"I don't know"** (no-guessing
  signal), no answer-leaking order. W2.2: probe blocks render as selectable
  paper chips (never A/B/C/D letters in text — the prompt contract forbids
  lettered options; probes may use a structured marker the UI renders as
  chips). W2.1: free-text answers in the composer.
- **One reasoning step per turn, lock-in before advancing (teach):** the
  workbench addendum states it: each professor block advances ONE step and
  checks it before moving on (matches the hint ladder; shadow-mode first).
- **Struggle stays in the material (teach/philosophy):** the system absorbs
  logistics — silent checking, context assembly, spacing, verification. Never
  remove difficulty; maximize struggle in the math itself.
- **learn-visual → diagram blocks (W2.3):** professor-issued SVG/mermaid blocks
  rendered in-thread; protocol: the professor does not send a diagram until it
  actually shows the claim (self-check), iterating on its own draft.
- **learn-verify → provenance calibration (in W2.1c addendum):** history
  stories are told as stories with calibrated confidence — uncertain history
  is hedged or omitted, never stated as fact. Book claims remain page-cited.
- **learn-profile → W2.4:** learner.json gains a profile section (pace, voice,
  how they want to struggle) read at every session start.

## 9. Open threads (philosopher pass, pre-build, 2026-09-15)

**Deviations note (2026-09-15, review-wave synthesis):** auto-numbered
derivation sub-blocks (UI spec §4.2) are **DEFERRED to W2.2**. Professor
free-form `$$` blocks render fine in the transcript today (Streamdown +
KaTeX typeset them as display math); the numbered-steps-list presentation
needs the structured-derivation pass, which is out of scope for W2.1.

Interrogating the block-transcript design before it fossilizes surfaced three
threads worth holding — none block W2.1:

1. **Asymmetric voice (the live one).** The product is voice-first: the
   professor SPEAKS, but the student TYPES. Push-to-talk student answers
   (on-device SFSpeechRecognizer — no cloud) would end the asymmetry and give
   the professor better diagnosis signal: thinking aloud is exactly what
   teach-back wants. W2.4 candidate; the composer's architecture should not
   preclude it.
2. **Bidirectional page linking vs. the design rule.** The UI spec says page
   chips are evidence, never navigation. But the owner's mental model is
   "a notebook on top of the book": clicking a cited page should scroll the
   book there; selecting a passage on the page should drop it into the
   workbench. The two-pane dance wants a link both ways. Resolve in the
   review wave — default: chip click scrolls the book (cheap, expected),
   selection→workbench stays W2.3.
3. **Cross-book concepts.** learner.json is per-book, but the student's circle
   of knowledge isn't — "Fourier transform" spans books. Where mastery lives
   (per-book vs global concept graph) is a W3 question; per-book stays for
   W2.1, but concept ids should be content-addressed (name-normalized) so a
   future global layer can merge without migration.

The 🗡 Critic review-wave lane runs in philosopher mode (medium) against the
built workbench: what is this design blind to, what would embarrass it in
public, what assumption inside the framing is wrong.
M3a: workbench-mode prompt section + op vocabulary (additive) · M3b: applyTutorEvent
+ learner fields + contract tests · M3c: fault-path diagnosis + misconception library
+ seeds · M3d: two-channel trigger wiring + noise budget · M3e: teach-back +
re-test queue. Shadow mode first: state machine computed, phrasing unchanged,
validate constants from logs before going live.
