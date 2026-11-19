# LEARNING AUDIT (L5) — binding rulings for the Learning Engine rebuild

**Role:** AUDITOR L5 · arbitrates L1–L4 into one buildable plan
**Date:** 2026-11-18 · **Status:** BINDING (queen protocol: constitution → research → **audit** → waves → verify → commit)
**Inputs:** `docs/LEARNING_ENGINE_CAMPAIGN.md`, `docs/research/TEACHING_SOFTWARE_TEARDOWN.md` (L1),
`docs/research/LEARNING_SCIENCE.md` (L2), `docs/research/OUR_TEACHING_POSTMORTEM.md` (L3),
`docs/research/TUTORRL_DEEPDIVE.md` (L4)
**Tie-break rule (from constitution, applied throughout):** resolve conflicts in favor of
the simplest mechanism that beats "upload the PDF to ChatGPT."

---

## 0. Verification of load-bearing claims (auditor duty)

**Code citations (L3) — spot-checked, ALL VERIFY:**
- `prompt.ts:20` ("at most about 120 words"), `:44-50` (disclosure ladder + Bloom release
  gates), `:52` (asked≥3 anti-repeat), `:130` (PROBE-before-teach + chips), `:167`
  ([TO_WORKBENCH] once/sitting, never first answer) — confirmed verbatim.
- `learner.ts:62-80,106-126` (Bloom starts at 2, −1 per re-ask, RETEST_INTERVALS_MS 24/72/168h)
  — confirmed; the decrement-on-any-re-ask is exactly as L3 describes.
- `contextPack.ts:65` (citation whitelist), `workbenchChat.ts:329-350`
  (MAX_ARTIFACT_BLOCKS_PER_EXCHANGE = 3, "sets down his pen"), `useDeskStreaming.ts:53`
  (CHECK_BUDGET_MS = 2500) — confirmed. (Minor: L3 omitted the two files' full paths under
  `app/reader/components/{notebook,desk}/`; line numbers are correct.)

**External claims (L1, L2, L4):** verified by the lanes against primary sources at fetch
time (URLs/dates recorded in each doc). L2's caveat stands: *no live web verification was
available in that session*; effect sizes are from established literature but spot-check
publisher pages before quoting externally. L2's FSRS default weights are version-locked
(FSRS-5) — verify against the open-spaced-repetition repo before implementation. L4's
latency numbers are estimates, not measurements.

**Flags (non-blocking):**
- L2 §7 contains an unresolved inline query ("Alphonse? see van Gog & Rummel") — sloppy but
  the worked-examples evidence itself is solidly sourced.
- L3's ladder provenance ("OpenMAIC tier guidance") is not verifiable from this checkout.
- L4 §6 assumed LearnHarness's design notes were unavailable, but L1 (B6) read the actual
  repo — L1's account governs; L4's gap analysis happens to agree with it anyway.
- L4 cites `prompt.ts:48,56,128-131` — line drift exists (actual: ladder ~`:44-50`, probe
  `:130`); treat L4 line numbers as approximate, L3's as exact (L3 audited this repo).

**Conclusion:** the research base is trustworthy enough to build on. L3's post-mortem is the
strongest document in the set (every claim traced to code); L1's "why ChatGPT wins" section
is the strategic key; L2 is the evidence floor; L4's distillation-first verdict is correct.

---

## BINDING RULING 1 — Why ChatGPT wins, and how we beat it (the direct answer)

**Why it wins (confirmed, single cause):** *latency to a trusted, complete, freely-shaped
answer is zero; ours is not.* Every hypothesis in the constitution's T1 list is true, but
they are facets of one cause: **we front-load pedagogy — the learner pays protocol tax
(ladder, probe, provenance, cap) before receiving value, while our genuine advantages
(grounding, cross-session memory) are invisible at the moment of the question** because the
learner log's ground truth is "asked," not "learned" (L3 §3.7). ChatGPT is a genie; we
built a toll booth.

**How we beat it (confirmed, two moves — not "be more like ChatGPT"):**
1. **Adopt ChatGPT-grade answer shape as an unconditional floor:** every learner-asked
   question gets a complete, structured, level-matched, book-grounded answer *in the first
   message*, at whatever length/format the question wants. Deleting our gates is the move —
   no new machinery required.
2. **Add the two things ChatGPT structurally cannot do** (both confirmed absent in every
   LLM chat competitor, L1 synthesis): **(a)** an attempt→feedback inner loop anchored to
   the exact page — checks the learner *does*, fired at the book's own section boundaries
   or on request, with an on-demand "I'm stuck" hint ladder and a bounded bottom-out;
   **(b)** persistent per-concept memory across sessions (FSRS-scheduled returns of *this
   learner's* weak concepts from *this book*), visibly acted on ("last time you weren't
   sure about X — did chapter 5 resolve it?").

The division of labor, which arbitrates the L2/L3 conflict (see §Rulings on conflicts):
**learner-asked → answer immediately; professor-posed checks → productive struggle with
ladder.** Bloom's 2-sigma gates *curriculum progress*, never utterances (L1 B5). ChatGPT
can discuss any book; only this teaches you *this* one. That sentence is the campaign's
product definition.

---

## BINDING RULING 2 — Target architecture (beats both raw ChatGPT AND current professor)

```
                        ┌────────────────────────────────────────┐
                        │ ANSWER FIRST (unconditional floor)     │
                        │ ChatGPT-grade shape, book-grounded,    │
                        │ citations to the exact page, no gates  │
                        └───────────────┬────────────────────────┘
                                        ▼
┌──────────┐   ┌───────────────────────────────────────────────────────┐
│ STUDENT  │──▶│ INNER LOOP (professor-posed, learner-initiated only)  │
│ MODEL    │   │ attempt → immediate local feedback → on-demand tiered │
│ (below)  │◀─▶│ hint (what→how→worked) → bottom-out: demonstrate,     │
│          │   │ restate, move on. Leakage-checked. Never imposed.     │
└────┬─────┘   └───────────────┬───────────────────────────────────────┘
     │                         ▼
     │         ┌───────────────────────────────────────────────┐
     │         │ STANCE / POLICY (explicit decision table)     │
     │         │ no attempt → smallest enabling hint           │
     │         │ wrong at step k → hint targeted at step k     │
     │         │ right → confirm + raise one level             │
     │         │ stuck ≥2 turns → escalate one rung            │
     │         │ talk-ratio >50% → stop lecturing, ask         │
     │         │ resolved → end deliberately                   │
     │         │ (distilled from TutorRL; judge prompts as CI) │
     │         └───────────────┬───────────────────────────────┘
     │                         ▼
     │         ┌───────────────────────────────────────────────┐
     │         │ SCHEDULER (FSRS-5, default weights, R=0.90)   │
     │         │ every check outcome → card; due-queue mixes   │
     │         │ books (interleaving); professor's returns are │
     │         │ scheduled by predicted decay, not app-opens   │
     │         └───────────────────────────────────────────────┘
     ▼
┌──────────────────────────────────────────────────────────────────┐
│ STUDENT MODEL = three numbers + timestamps, per concept:         │
│   fsrs state (D, S, due)  ·  mastery {unvisited|learning|mastered}│
│   last-10 accuracy  ·  concept nodes/edges from the book's own   │
│   structure (TOC/index), 1-bit-per-node. NO BKT/IRT. NO          │
│   proposition graph in waves 1–3.                                │
│ Sourced from check outcomes (verdict-required), not asks.        │
└──────────────────────────────────────────────────────────────────┘
DETERMINISTIC CORE (unchanged, source of truth): book text layer, citation
whitelist, page lookup [LOOK], silent math checker, figure accuracy law.
```

- **Loop:** answer-first free dialogue **plus** a book-anchored inner loop at section
  boundaries and on request (the book's TOC is the lesson plan — L1 A2). Checks are short,
  optional-feeling, and always escapable; "I don't know" is never graded (kept).
- **Student model:** L2 §15's exact recommendation (FSRS card state + per-chapter EMA +
  3-state mastery flag), keyed by `[CONCEPT]` tags but fed **only by graded outcomes**
  (fixes L3 §3.7's "asked ≠ learned"). This is the memory moat; ChatGPT's memory is
  theater (L1).
- **Scheduler:** FSRS-5 default weights, desired retention 0.90, Again/Hard/Good/Easy;
  Leitner-4 (1d/3d/7d/16d) is the sanctioned fallback if FSRS is too heavy, upgrade path
  preserved. Session cap ~20 cards, 1/3 new : 2/3 due (interleaving falls out free).
- **Stance/policy:** L4's distilled decision table (§5.2 of that doc), prompt-enforced now,
  data-driven later. TutorRL-7B runs **offline only** (transcript labeling + judge CI) until
  offline evals prove the table underperforms. Private solve → public scaffold (plan-then-
  speak) applies to the desk's derivations.

---

## BINDING RULING 3 — Keep / change / drop on every existing mechanism

Ratified from L3 §5 (all 34 verified against code), with L5 modifications where lanes
conflict — marked **[L5]**. Verdicts are final absent new evidence.

| # | Mechanism | File | Verdict |
|---|---|---|---|
| 1 | Book grounding + citation whitelist | `contextPack.ts:65+` | **KEEP** — the moat; constitution non-negotiable |
| 2 | Page-image evidence | `tutor.ts`, `vision.ts` | **KEEP** — sees-what-you-see beats PDF upload |
| 3 | Disclosure ladder rungs | `prompt.ts:44-49` | **CHANGE** — keep rungs as the hint *menu* for professor-posed checks only; scope to checks, never to learner questions **[L5]** |
| 4 | Bloom release gates | `prompt.ts:50-51`, `learner.ts:113-126` | **DROP** — random walk keyed to a broken counter; release decided from the learner's words this turn + profile default |
| 5 | Concept history "asked Nx" in prompt | `prompt.ts:52,94` | **CHANGE** — keep as soft context ("they've been here before"), zero authority; replaced by mastery state from graded outcomes |
| 6 | Anti-repeat stuck rule | `learner.ts:170-186` | **KEEP** — trigger on failed checks, not raw asks |
| 7 | Spaced retest queue (24/72/168h) | `learner.ts:65-80,141-172` | **KEEP but RE-ENGINEER** — real moat; swap fixed intervals for FSRS once the card store lands (Wave 2) |
| 8 | `[CONCEPT]`/`[QKIND]` logging tags | `prompt.ts:40-42`, `professorTags.ts` | **KEEP, demote** — only mandatory when a graded write follows; drop the trailing reminder nag |
| 9 | Annotation DSL | `prompt.ts:27-38` | **KEEP, loosen** — drop the contradictory 1–2-mark quota; keep no-announce rule |
| 10 | 120-word cap + spoken-word rule (reader) | `prompt.ts:20-22` | **CHANGE** — mode-dependent: narration/voice → keep; study/typing → full markdown, LaTeX, length by need. Highest-leverage single edit. |
| 11 | Restraint-first visual marks | `prompt.ts:31-33` | **DROP quota, keep taste** |
| 12 | Problem mode (diagnose-before-hint) | `prompt.ts:60-61` | **KEEP** — most pedagogically literate paragraph in the prompt |
| 13 | Echo tutor | `tutor.ts:98-156` | **KEEP** — honest fallback + design conscience |
| 14 | Distillation to notes.md | `tutor.ts:196-237` | **CHANGE** — on-demand only ("keep this"), not a second generation per exchange |
| 15 | Chapter sessions | `session.ts:141-251` | **CHANGE** — add retry→re-explain→re-ask loop; learner picks 1–3 objectives; gate at section end (mastery on curriculum, not dialogue) |
| 16 | Provenance three-ways | `prompt.ts:122-126` | **CHANGE** — repertoire on request, not law; delete "teach every concept three ways, in order" |
| 17 | Visual-first mechanical rule | `prompt.ts:127-128` | **DROP mandate, keep capability** |
| 18 | 3-artifact mute | `workbenchChat.ts:329-350` | **KEEP** — circuit breaker stays even if rarely fired |
| 19 | Figure accuracy law + self-check | `prompt.ts:150-166`, `diagramSvg.ts` | **KEEP** — moat, not friction |
| 20 | Probe-before-teach + stance chips | `prompt.ts:130`, `blockBody.tsx:102-140` | **DROP compulsion, keep chips as offer** — model may offer stance; never at thread open |
| 21 | "I don't know" first-class | `prompt.ts:131`, `workbenchChat.ts:260-265` | **KEEP** — best small design in the repo |
| 22 | Teach-back + `[EVALUATION]` | `prompt.ts:133`, `blockBody.tsx:412-423` | **CHANGE** — model-invoked, ≤1 per concept, never adjacent to a probe; voluntary Feynman entry stays |
| 23 | Concept shelves + one-shelf clamp | `prompt.ts:135-136`, `workbenchChat.ts:351-378` | **KEEP map, DROP clamp** — shelves derived mechanically from check outcomes; model never files |
| 24 | `[LOOK]` page lookup | `prompt.ts:139`, `pageLookup.ts` | **KEEP** — "thumbing the pages" is teacherly |
| 25 | Structured derivations / folio | `prompt.ts:142-148` | **KEEP** — faded worked examples, independently checked |
| 26 | Computed PLOT/CHART | `prompt.ts:152-158`, `mathCheck.ts` | **KEEP** — "computed, never imagined" is unmatchable in a chat bubble |
| 27 | Silent deterministic checker | `useDeskStreaming.ts:262-385` | **KEEP** — ground truth; extend coverage |
| 28 | `[TO_WORKBENCH]` routing | `prompt.ts:167`, `bridge.ts` | **CHANGE** — reader must render folios/figures inline; desk becomes a place, not an escalation **[L5: cheapest version of 10]** |
| 29 | Learner profile | `learnerProfile.ts` | **KEEP, grow** — `probe_level` becomes the actual release policy now that #4 is dropped |
| 30 | "Where we are" T3 echo tier | `workbenchSession.ts:165-172` | **DROP** — redundant with history summary |
| 31 | Per-turn contract restatement | `workbenchSession.ts:360-364` | **DROP** — one-line reminder max |
| 32 | Per-turn full pack rebuild | `workbenchSession.ts:284-365` | **KEEP** — grounding dies without it; byte-stable caching is correct |
| 33 | Verdict-default Bloom credit | `learner.ts:44-51,112-116` | **CHANGE** — no explicit verdict → asked-only, never credit; this is the student-model ground-truth fix |
| 34 | Feynman review entry point | `StudyTab.tsx:123-131` | **KEEP** — voluntary, learner-initiated; the model for all checks |

**Net:** 18 keep/keep-with-tuning, 13 change, 3 drop (4, 11-quota, 30, 31 counted in
change/drop as above). Every mechanism that stood *in front of* the answer is dropped or
demoted; everything operating *alongside or after* it survives. **Answer first, then teach.**

---

## BINDING RULING 4 — Wave plan (with file ownership)

Principle: **the safest first wave ships a visibly better teaching experience fastest** —
Wave 1 is nearly all deletions, zero new machinery, and it alone closes most of the
ChatGPT gap. Each wave is independently shippable and verifiable.

### WAVE 1 — "Answer First" (friction amputation; ~prompt-only, ships visibly better in days)
**Outcome:** any question gets a complete, well-shaped, book-grounded answer in message one;
no gates, no ceremony. This is the wave that makes the owner stop wanting the ChatGPT tab.
- **Owner:** prompt + desk session assembly.
- **Files:** `services/professor/prompt.ts` (drop Bloom gates #4; scope ladder to
  professor-posed checks #3; mode-dependent length/format #10; probe compulsion → offer #20;
  provenance & visual-first from law to repertoire #16/#17; contract trim), 
  `services/professor/workbenchSession.ts` (drop #30, #31), 
  `services/professor/tutor.ts` (distill on-demand #14; inline folio capability in reader),
  `app/reader/components/notebook/blockBody.tsx` (chips as offer, not gate),
  `services/professor/learner.ts` (verdict-required credit #33 — small but critical),
  `services/professor/learnerProfile.ts` (probe_level = release policy #29).
- **Verification:** replay 20 golden transcripts; first professor message contains the
  complete answer; zero protocol tags before substance; professor-prompt tests updated.

### WAVE 2 — "The Professor Remembers" (student model + scheduler; the moat)
**Outcome:** check outcomes feed a real per-concept ledger; reviews return on predicted
decay, visibly ("this is back because you're about to forget it"). Now ChatGPT
structurally cannot follow.
- **Owner:** learner state + scheduler.
- **Files:** `services/professor/learner.ts` (re-engineer: graded-outcome ledger, FSRS card
  state, mastery flags; migrate retest queue), **NEW** `services/professor/scheduler.ts`
  (FSRS-5 reference impl or Leitner fallback; cross-book due queue, 1/3–2/3 mix),
  `services/professor/session.ts` (retry→re-explain→re-ask; learner-picked objectives),
  `app/reader/components/notebook/StudyTab.tsx` (due-queue surface "cards due"),
  `services/professor/contextPack.ts` (T2 "struggle" tier keyed on *failed checks*, not asks).
- **Verification:** card created per graded check; due dates move under FSRS; a seeded
  learner state produces correct review scheduling in tests.

### WAVE 3 — "Stance With Evidence" (policy table + judge CI + offline TutorRL)
**Outcome:** the ladder is replaced by an explicit, testable decision table; every prompt
edit is regression-tested by TutorRL's own judge prompts; TutorRL-7B labels our transcripts
offline. (Distillation-first per L4 §5 — 80% of value at 5% of cost.)
- **Owner:** policy + evaluation harness.
- **Files:** `services/professor/prompt.ts` (decision table replaces prose ladder),
  **NEW** `services/professor/stance.ts` (table as code, prompt-rendered; leak filter),
  **NEW** `services/professor/eval/judges/` (imported `does_not_leak_answer.txt` +
  `follows_pedagogical_values.txt` as CI over golden transcripts), 
  `services/professor/telemetry.ts` (r_sol proxy: did the next attempt improve?).
- **Verification:** CI judges pass on golden set; table decisions unit-tested per state row.

### WAVE 4 — "Specificity Engine" (misconception libraries, worked-example fading, polish)
**Outcome:** repairs name the learner's exact wrong reading (Oppia-style, pre-generated per
chapter, book-verified); examples fade with demonstrated competence.
- **Files:** `services/professor/misconceptions.ts` (exists — formalize generation+verify
  pipeline), `services/professor/diagnose.ts`, prompt worked-example fading hooks.
- **Verification:** failed check on a seeded misconception yields the named repair, not
  generic feedback.

**Explicit sequencing dependency:** Wave 1 has no dependencies and must ship first. Wave 2
consumes Wave 1's verdict-required ground truth (#33). Wave 3 consumes Wave 2's telemetry.
Wave 4 consumes Wave 2's concept nodes. Do not reorder.

---

## BINDING RULING 5 — Explicit non-builds (do not build these)

1. **No RL training** (no GRPO, no simulated classroom) — out of scope; TutorRL is
   harvested for rubric/table/judges only.
2. **No BKT/IRT or any formal probabilistic student model** until >500 reviews AND a stable
   skill taxonomy AND a named decision the proxy gets wrong exist (L2 §10 criteria, all
   three). The FSRS+EMA proxy is the model.
3. **No full LearnHarness-style proposition graph** (L1 steal #2 in its heavy form) — 1-bit
   mastery + timestamps per concept node is the graph; revisit only if Wave 4 shows the
   proxy failing on prerequisite routing.
4. **No hearts/streaks/lives/coercion mechanics** — tone clash with librarian voice (L1).
5. **No model-tracing cognitive models / production rules** — infeasible for arbitrary PDFs.
6. **No heavy upfront measure/probe phase of every dependency** (LearnHarness's own
   friction; our T1 diagnosis) — measurement is latent, from real exchanges.
7. **No runtime second-model (TutorRL-7B) stance router in waves 1–3** — offline labeling
   only; promotion requires offline evals showing the table underperforms, then a latency
   measurement on the actual MLX build (estimates are not evidence).
8. **No Socratic-only register** — direct telling is a first-class stance (VanLehn: no
   reliable edge for Socratic-only; Bloom's gates apply to curriculum, not utterances).
9. **No new chat surface / no "learning dashboard" UI** — the engine lives inside Reader +
   Desk (which are good; do not regress them); machinery talk stays banned.

---

## Dependency constraints (standing, restated for builders)

- Reader + Desk are **good — do not regress them.** Wave 1 touches professor behavior only.
- **The book stays the source of truth** — grounding law, citation whitelist, `[LOOK]`,
  figure accuracy law, silent checker are untouchable (items 1, 2, 19, 24–27 above).
- **Light-mode librarian voice; no machinery talk; no mid-session buttons** — stance chips
  and hint offers must read as the professor's words, never as UI chrome.
- **Karpathy rule:** every mechanism traces to a named finding in L1/L2/L4 — the table
  above carries the tracing; new mechanisms must cite one or wait for Wave 4+ evidence.
- **Local-first:** learner state lives on-device (Kolibri architecture steal); sync is
  opportunistic, never blocking.
- **Prompt budget:** every prompt addition must pay for itself in judged transcript
  quality — the Wave 3 judges are the meter.

---

## Conflict resolutions applied (for the record)

| Conflict | Lanes | Ruling (simplest-mechanism tie-break) |
|---|---|---|
| Answer-first (L3) vs never-reveal hint ladder (L2 §16, TutorRL) | L2/L3/L4 | **Bifurcate by initiation:** learner-asked → full answer immediately; professor-posed check → ladder with bottom-out. Both lanes' evidence preserved. |
| Proposition-graph student model (L1 #2) vs FSRS+EMA (L2 §15) vs minimal KG (L4 §6) | L1/L2/L4 | **FSRS+EMA+1-bit mastery wins.** Graph demoted to optional Wave 4; L1's own "even crude HLR differentiates" supports the lighter call. |
| Ship 7B stance router (L4 §4) vs distill table (L4 §5) | L4 internal | **Table first** — L4's own verdict (80% value / 5% cost); model is offline-only until proven otherwise. |
| Keep Socratic escape hatch (L1 A1) vs anti-Socratic evidence (VanLehn) | L1 internal/L2 | **Stance menu includes "just tell me" as default-respected option;** Socratic is one stance, never the gate. |
| Drop all gating (constitution hypothesis) vs keep mastery gating (Bloom) | campaign/L1/L2 | **Gate curriculum (section-end checks, Wave 2 sessions), never conversation.** |
| 120-word cap right for narration vs wrong for study (L3 §3.5) | L3 internal/constitution | **Mode-dependent, not lane-dependent** — unify by reading mode, removing the two-persona split at the root. |

---

## Open questions for the king

1. **Answer-first scope:** when the learner is in an active *chapter session* (Wave 2's
   mastery loop), may they still get instant answers to side questions, or does the session
   own the hour? My ruling presumes yes (answers are always free; only *forward progress*
   is gated) — confirm.
2. **The single-stance question:** should "ask me first" be available as a *standing
   preference* (profile-level, replacing the per-thread probe we are deleting), or only as
   a per-check offer? I ruled profile default + per-turn words; the chips themselves die.
   Confirm the chips' death.
3. **Review cadence vs. reading flow:** when the scheduler says a card is due *while* the
   learner is deep in a chapter, does the professor (a) wait for a section boundary,
   (b) surface a one-line margin whisper, or (c) hold all reviews for session end? I ruled
   (a) with (b) at the learner's own highlights — "no mid-session buttons" makes (b) hard
   to do tastefully. Decide.
4. **TutorRL promotion bar:** what evidence threshold justifies the runtime 7B router —
   judged-transcript win rate over the table, and is a ~2–8 s per-exchange latency
   acceptable if so? My ruling: only after Wave 3 CI shows the table failing on a named
   state class.
5. **ChatGPT-baseline benchmark:** do you want a standing eval harness that scores the
   professor's answers against a frontier chat baseline on answer-quality rubrics (the
   Wave 3 judges repurposed), so "would I rather upload this to ChatGPT" becomes a number
   we track per release? Cheap; recommend yes.
6. **Leitner vs FSRS call:** FSRS default weights are version-locked and unverified in
   this session. If the king wants zero external dependency, Wave 2 ships Leitner-4 with
   the FSRS seam pre-built. Preference?
7. **Concept-node extraction:** concept nodes/edges come from the book's TOC/index (cheap,
   noisy) or from a one-time per-book LLM pass stored alongside the book (better edges,
   per-book build cost). Wave 2 assumes the cheap version; confirm before build.
