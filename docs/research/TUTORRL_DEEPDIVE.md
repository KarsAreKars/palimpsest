# TutorRL Deep-Dive + Adaptive-Policy Fit (Research Lane L4)

**Scope:** ETH `eth-lre/PedagogicalRL` (EMNLP 2025, "From Problem-Solving to
Teaching Problem-Solving", arXiv:2505.15607), the released `eth-nlped/TutorRL-7B`
weights, and how either fits Palimpsest's learning engine.
**Method:** full read of the cloned repo (github.com/eth-lre/PedagogicalRL,
cloned 2026-11-18, default branch) + paper HTML (v2) + HF model card +
this machine's hardware. All file:line references are to that repo unless
prefixed with `readest-src:`.
**Verdict up front:** Yes — TutorRL's *stance/teaching-policy* layer is a real,
cheap, well-matched upgrade for Palimpsest's prompt-locked pedagogy; the
highest-value path is (a) adopt its **judge rubrics + reward formula as our
deterministic routing policy's spec**, and (b) optionally run the 7B locally as
a *hint-wording* generator only — never as the source of truth. Copy its loop,
not its infrastructure.

---

## 1. What TutorRL actually is

- A recipe (not a product): GRPO-trained **Qwen2.5-7B-Instruct** turned into a
  math tutor that strategically *withholds* answers, trained entirely against a
  **synthetic student** (Llama-3.1-8B-Instruct FP8) with **zero human labels**
  (`README.md:1-16`, paper §1).
- Two released checkpoints (HF model card, `README.md:22-26`):
  - `eth-nlped/TutorRL-7B` — standard, λ=0.75, no internal planning.
  - `eth-nlped/TutorRL-7B-think` — `<think>`-tag planning variant, hard-λ=1.0.
- License: repo CC-BY-4.0; **model card says apache-2.0** (fine-tune of
  Qwen2.5-7B-Instruct). Both permit our use; Qwen license also allows it.
- Claims that matter for us (paper §6):
  - Matches/beat **LearnLM 2.0** on student solve rate while nearly matching
    its low solution leakage — a 7B against a proprietary tutoring model.
  - Unlike SFT (SocraticLM-style), RL **preserves** reasoning: SFT lost −7.5%
    GSM8K / −9.4% MATH500; TutorRL-RL matches or slightly exceeds base Qwen.
  - A **controllable Pareto frontier** between "student succeeds now" and
    "student does it themselves" via one knob λ (paper Fig 1, §6.1).

### 1.1 The one-sentence idea we should steal

The reward is not "was the student's final answer right." The reward is
**"did the student's *post-dialog* solve rate go up, measured by re-sampling
the student K times after the conversation, minus λ if an LLM judge says you
leaked or lectured."** That is a *learning-outcome* reward, not a
*response-quality* reward — and it is the exact thing a prompt-written tutor
cannot optimize for, because no prompt ever sees the consequence of its own
teaching across turns.

---

## 2. The classroom loop (Q1) — repo anatomy

### 2.1 State machine

`src/classroom.py:37-45` defines the episode states:

```
START → TEACHER_TURN ⇄ STUDENT_TURN → JUDGE_TURN → GENERATE_SOLUTION → REWARD_TURN → END
```

- **Two episode types** (`src/classroom.py:47-49`, `ConversationType`):
  `GUIDED` (tutor opens, elicits reasoning) vs `ATTEMPTED` (student submits an
  initial solution first; tutor responds to it). Chosen by `problem_hash % 2`
  (`src/classroom.py:86-89`) — i.e., every problem trains both openings across
  the run. *This is already the same shape as our probe chips ("lead me" /
  "ask me first" / "I will work it"), but TutorRL trains the tutor to handle
  both instead of asking the learner to pick.*
- **Personas**: student name + persona template also keyed by problem hash
  (`src/classroom.py:91-101`); only one persona ships
  (`config/train_rl_model.py:80-84`, `personas/simple_student.txt`).
- **Turn transitions** (`src/classroom.py:383-415`, `add_message`):
  - Tutor message → STUDENT_TURN; if `max_turns` (15, so ≤16 turns,
    `config/train_rl_model.py:98`) or the literal string
    `<end_of_conversation>` appears → JUDGE_TURN.
  - Student's first message in ATTEMPTED mode is wrapped in an
    "initial attempt wrapper" template (`src/classroom.py:398-404`) before the
    tutor sees it.
  - Total conversation token budget (8192) also force-ends to JUDGE_TURN
    (`src/classroom.py:293-300`, `413-415`).
- **Thinking privacy**: anything in `<think>...</think>` is stripped before the
  student ever sees a tutor message (`src/classroom.py:296-299`,
  `_hide_thinking`; student-side view built at `307-316`). The tutor can
  privately solve/plan; the student only gets the visible message. With
  `force_thinking=true`, a logits processor *forces* the first tokens to be
  `<think>` (`src/classroom.py:751-764`).

### 2.2 The judge stage

After the dialog: each conversation is scored against **every** judge rule in
config (two ship by default, `config/train_rl_model.py:86-91`):

1. `does_not_leak_answer.txt` — few-shot leakage judge. Gives 4 worked
   examples of OK (Socratic nudge: "Can you think of an integration technique
   useful for a *product* of functions?") vs REJECT (full proof dumped;
   `\boxed{5}` given immediately). Verdict JSON: `{reasoning, decision}`.
2. `follows_pedagogical_values.txt` — style judge: rejects overly long teacher
   messages, teacher-dominated talk ratio, language mixing, unnatural
   dialogue, truncated messages. Explicitly: "**Most of the talking is done by
   the student**."

Mechanics worth copying (`src/classroom.py:926-984`, judge loop):

- **K=2 judge samples per rule** (`number_judge_attempts=2`,
  `config/train_rl_model.py:108`), up to 5 retry rounds, robust JSON extraction
  by slicing between first `{` and last `}` (`classroom.py:1000-1009`).
- Any single REJECT sets `failed_judges=True`; with
  `ignore_rejected_judge=False` (the default = "hard λ" mode) the episode ends
  immediately and takes the fixed penalty
  (`src/classroom.py:418-437`, `1177-1195`). With `ignore_rejected_judge=true`
  ("soft λ") the penalty is relative (paper Eq. 4).

### 2.3 The outcome stage (the clever part)

`GENERATE_SOLUTION`: the **student** (not the tutor) is re-sampled **K=8
times** (`number_student_attempts=8`, `config/train_rl_model.py:106`;
`n=` set at `src/classroom.py:736-745`) with the full dialog in context plus a
final "now solve it" user prompt (`student_final_prompt.txt`). Rewards:

- Default reward model is the literal string `"Answer"`
  (`config/train_rl/7b.yaml:48`): exact-match
  `check_equal(answer, extract_answer(solution))` per sample
  (`src/classroom.py:768-786`). So **post-dialog solve rate = mean of 8
  Bernoulli verifiable rewards**. A `Qwen2.5-Math-RM-72B` reward-model option
  exists but the shipped runs use exact answer match.
- `λ=0` is implemented as `number_judge_attempts: 0` (judges skipped entirely,
  `src/classroom.py:411-415`), which is exactly why the λ=0 model leaks:
  nothing stops it (paper §6.1: it learned to send answer fragments like
  `"2+3=?"`).

### 2.4 Full reward stack (paper Eq. 2–4 + Appendix B + code)

```
r = r_sol                        # post-dialog solve rate, K=8 student resamples, exact match
    + (r_ped − 1)·λ              # r_ped = Π_m 1[judge_m accepts]; soft mode
r_hard = −λ  if any judge rejects            # shipped default (ignore_rejected_judge=false)
    + r_templ
```

Auxiliary template reward `r_templ` (Appendix B; code at
`src/classroom.py:501-545`, wired in `train_rl.py:103-120`):

| Component | Value | Code |
|---|---|---|
| `r_think` | +0.5 × (turns with balanced `<think>`) −0.5 per unclosed tag | `classroom.py:501-518` |
| `r_end` | +0.1 if tutor emitted `<end_of_conversation>` (ended deliberately) | `classroom.py:520-531` |
| `p_len` | −0.5 if any tutor turn hit the 1024-token cap (no EOS) | `classroom.py:533-545` |
| judge penalty | −λ (λ=0.25 default soft, 1.0 hard runs) | `classroom.py:1177-1195`, `config/train_rl_model.py:115` |

Training: GRPO, 8 rollouts per problem (`config/train_rl/7b.yaml:3-5`),
16 problems/batch, lr 5e-7, β=0.001, μ=2; **student turns masked from the
loss** (`src/classroom.py` — `get_trainable_representation()` at `:588` feeds
only the tutor-perspective view; paper §5.3). Only the tutor is updated.

### 2.5 What the loop teaches that we can audit against

The full pipeline is: *sample 8 dialogs → judge all → resample student 8× →
exact-match reward → GRPO*. Everything is verifiable or rubric-judged; the
only model-frozen pieces are the student, the judges, and (in the Answer mode)
nothing at all. **There is no reward model to hack in the shipped config** —
the classic RLHF reward-hacking surface is absent by construction.

---

## 3. What the RL agent learned that a prompt-written tutor can't (Q2)

Evidence: paper §6.1 + Appendix D conversations + repo reward code. Concrete,
non-vibes behaviors:

1. **Calibrated leakage, not zero leakage.** With λ=0.75 the model sits on the
   Pareto front: it reveals *intermediate* results when the student is stuck
   but protects the final answer. Prompt-tutors are binary (prompt says "never
   reveal" → useless to a stuck learner; or they leak). RL discovered the
   middle because the reward *measures the consequence* (post-dialog solve
   rate) rather than the surface form. This is the strongest argument that the
   policy encodes something a prompt cannot: **multi-turn consequence
   awareness**.
2. **Anti-shortcut robustness.** Low-λ models learned to launder answers
   ("2+3=?" fragments) *despite the prompt forbidding it* (paper §6.1,
   Figs 5-6). The judge+reward stack closed that. A prompt-only system has no
   counterparty that adapts — this is adversarial hardening you cannot prompt
   your way into.
3. **Private solving, public scaffolding.** The `-think` variant learned to
   solve the problem inside `<think>`, then plan *how to explain the student's
   mistake* in the visible message (paper §6.1 "Thinking tags allow human
   observability", Figs 7/9). The repo enforces the privacy boundary
   mechanically (`_hide_thinking`, `src/classroom.py:296`). **This maps
   1:1 onto our desk: solve deterministically, then decide how much to say.**
4. **Student-talk-ratio discipline.** The style judge (`follows_pedagogical_values.txt`)
   rejects teacher-dominated dialogs; RL converged to short tutor turns that
   end deliberately (`r_end`, `p_len`). Trained-in concision is more reliable
   than "do not respond with overly long responses" (which is the entire
   length control in their own teacher prompt, `teacher_prompt.txt`).
5. **Handling both episode openings.** Because GUIDED and ATTEMPTED alternate,
   the policy learned to react to a wrong initial attempt *and* to elicit a
   first attempt — the two hardest cases for a scripted tutor.
6. **Reasoning preserved.** RL doesn't catastrophically forget like SFT
   (−7.5/−9.4 GSM8K/MATH500); the tutor can still do math. (Paper Table 3.)

**Honest caveat (paper Limitations):** all signals are synthetic; trained
against one student model; math only; conversation-level rewards, no delayed
post-test/transfer. The behaviors are "teaches a simulated 8B student," which
correlates with, but is not, real learning.

---

## 4. Fit for Palimpsest: TutorRL-7B as a stance/teaching-policy layer (Q3)

### 4.1 What we have today (readest-src evidence)

- Prompt-locked pedagogy: disclosure ladder ("Rung 2 — a partial… the first
  step with the rest hidden", `readest-app/src/services/professor/prompt.ts:48`),
  "no attempt, no rung… never reveal an answer before an attempt exists"
  (`prompt.ts:56`), `[PROBE]` stance chips "lead me / ask me first / I will
  work it" (`prompt.ts:130`), "I don't know" as first-class signal
  (`prompt.ts:131`), regex-enforced in `workbenchChat.ts:264-265`.
- This is a **fixed decision table in prose**, judged only by the main LLM's
  goodwill. There is no consequence signal: we never check whether the reader
  could now do the thing.
- Persistence is transcript-only (`useTranscriptPersistence.ts:10,95`); no
  learner model across sessions.

### 4.2 Integration shape (recommended)

```
reader question / attempt
        │
        ▼
[deterministic core — unchanged, source of truth]
  grounding (book citations), figures, math checking, accuracy laws
        │
        ▼
[STANCE ROUTER]  ← TutorRL-7B (local, 7B)  OR  distilled decision-table
  inputs: problem state, reader attempt (if any), error diagnosis,
          recent turn ratio, session "stance" (lead/ask/work)
  output: ONE of {reveal, scaffold-hint, socratic-question, worked-example,
          confirm-and-extend, end-topic}
          + hidden <think> plan (solve privately → decide disclosure level)
        │
        ▼
[deterministic composer]
  wording for chosen action, grounded in book; hint text generated by the
  small model is FILTERED by deterministic checks (no final answer string,
  no full derivation of the target step, length cap) before display
```

Boundary discipline (matches campaign constraints — book stays source of
truth, accuracy deterministic):

- TutorRL-7B decides **pedagogical action and hint phrasing only**. It never
  supplies facts, citations, figures, or final answers; those come from the
  deterministic layer (and its private solve is only used to pick the rung,
  with exact answers checked against the book's).
- Its teacher system prompt is *already* the right contract
  (`prompt_templates/teacher_prompt.txt`: "You must not reveal the answer…
  end with `<end_of_conversation>`…"), and the repo's judge prompts give us
  ready-made **offline regression tests** for the whole layer: run any dialog
  transcript through `does_not_leak_answer.txt` + `follows_pedagogical_values.txt`
  with a local judge model and assert OK.
- The `<end_of_conversation>` convention maps to our `[WORKBENCH:END]`;
  thinking-privacy maps to our hidden-analysis-then-visible-answer split.

### 4.3 Cost on this machine

Hardware: Apple M4 Pro, 24 GB unified, Metal 4; `llama-cli` already installed
at `/opt/homebrew/bin/llama-cli`.

- **Weights:** Qwen2.5-7B in HF safetensors (4 shards). Convert to GGUF Q4_K_M
  (~4.7 GB) or run via `mlx-lm` (pip install; native on M4 Pro). 24 GB RAM is
  comfortable: model + KV cache ≈ 6-7 GB, leaving the Electron app and desk
  canvas headroom. Could even keep it resident alongside the app.
- **Latency (estimates, M4 Pro, Q4):** prompt-processing ~500-1500 tok/s;
  generation ~25-45 tok/s. A stance decision with `<think>` planning is
  ~150-400 output tokens → **~2-8 s per routing decision** if run on every
  turn — too slow for per-keystroke, fine for per-exchange (our unit of
  interaction IS the exchange; the desk is not a chat stream). Without
  `<think>` (~60-120 tokens out) → ~1-3 s.
- **Cheaper variant:** route only at decision points (attempt submitted,
  "I don't know" detected, rung escalation) — roughly 1 call per exchange,
  amortized to zero perceived latency behind the desk's existing streaming.
- **Offline alternative:** batch-run the model nightly over logged transcripts
  to *label* our own dialogs with judge verdicts + its chosen action; zero
  runtime cost, gives us the evaluation harness first.

### 4.4 Risks of the model route

- Math-only training: stance quality on "why does X matter" (our QKIND
  taxonomy, `prompt.ts:42`) is unproven; concept-explanation stances may fall
  back to Qwen2.5 defaults (i.e., lecture).
- Synthetic-student artifact: it optimizes dialogs with an 8B math student,
  not humans; may over-question a human who asked to be told.
- Extra moving part in the shipping app: model download (~5 GB), memory
  pressure, and a second failure mode in the field. The campaign's
  no-speculative-generality rule applies — adopt only with the offline eval
  harness in place first.

---

## 5. Distillation path: policy → prompt/decision-table (Q4)

If we don't ship the model, we can still harvest the policy:

1. **Use TutorRL-7B as a rubric-graded dialog generator offline.** Sample
   dialogs against our own QKIND taxonomy + probe stances, judge them with the
   repo's two judge prompts, keep OK dialogs, and extract the tutor's action
   per turn into a labeled dataset `(problem state, student message) → action`.
2. **Collapse into a decision table** replacing/steeling the prose ladder in
   `prompt.ts:48-56`:
   - student has not attempted → never reveal; offer smallest enabling hint
     (rung 1) or worked analog, not the target step.
   - attempt exists, wrong at step k → name the divergence privately; give
     hint targeted at step k only (this is exactly `prompt.ts:56` — TutorRL
     gives us *evidence and calibrated examples* that it works).
   - attempt exists, right → confirm + push one level up (their teacher prompt
     already says "Even if the student is already able to solve… help them
     improve", `teacher_prompt.txt`).
   - student stuck ≥2 exchanges at same rung → escalate one rung (Pareto
     finding: calibrated leakage beats zero leakage).
   - teacher-talk ratio > ~50% → stop lecturing, ask a question (judge rule).
   - topic resolved → end deliberately (`r_end` analog), don't drift.
3. **Adopt their judge prompts verbatim as CI tests** for `prompt.ts` changes:
   replay golden transcripts + judge with a local 7B; a pedagogy regression
   becomes a failing test, not a vibe. This is nearly free (two prompt files
   already exist) and de-risks every future prompt edit.
4. **Adopt the reward *shape* as telemetry, without RL:** log per-exchange
   "did the reader's next attempt/teach-back improve" as our own
   `r_sol` proxy, and log judge-style leakage flags. We don't need to train;
   we need the *measurement* to stop being vibes.

**Distillation verdict:** the decision table above is ~80% of the value at ~5%
of the integration cost. Do this first; promote to the live model only if the
table provably underperforms on judged transcripts.

---

## 6. The LearnHarness gap: measure/plan/teach/practice + knowledge graph (Q5)

*(Assumption: "LearnHarness" = the adaptive-learning reference system named in
`docs/LEARNING_ENGINE_CAMPAIGN.md:29,45`; its design notes are not in this
checkout, so this section evaluates the capability set as described —
measure → plan → teach → practice loops over a persistent knowledge graph. If
the parent has a specific paper/repo in mind, the gap list below should be
re-checked against it.)*

What that architecture has that Palimpsest lacks today:

1. **Persistent student model (knowledge graph).** We persist transcripts
   (`useTranscriptPersistence.ts`) but extract nothing from them: no per-concept
   mastery estimate, no record of "reader failed Gaussian elimination twice on
   2026-11-10." A KG of concepts (tied to our `[CONCEPT:name]` tags,
   `prompt.ts:128`) with per-edge mastery state is the prerequisite for any
   real adaptivity: it converts "adapts within a session" into "adapts across
   the book and across weeks."
2. **Measure as a first-class stage.** TutorRL proves you can build a verifiable
   measure cheaply (resample-the-student + exact match). Our analog: teach-back
   evaluation, quizzing, and problem-attempt grading — all deterministic,
   no model needed for math, small model for prose.
3. **Plan from the measure.** Plan = pick next action from KG state: what to
   review (spaced retrieval), what to teach next (mastery ordering), which
   stance to default to. Currently our only "plan" is the in-context ladder.
4. **Practice loop closure.** We teach; we don't schedule or verify retention.
   The campaign's L2 lane (retrieval practice, FSRS, interleaving) supplies the
   content; the KG supplies the scheduling keys; the desk supplies the
   interaction surface.

**How much to copy (recommendation):**

- **Copy now (cheap, high value):** concept-tagged mastery ledger keyed off
  existing `[CONCEPT:name]` tags + attempt outcomes; one delayed "can you still
  do it" probe per taught concept (TutorRL-style `r_sol` proxy); judge prompts
  as CI.
- **Copy next:** a minimal KG = nodes (concepts from the book's own structure/
  index), edges (prereq, `how-connects`), per-node state {seen, attempted,
  succeeded, last_seen, failures}. This is enough to drive spaced review and
  "you're missing a prereq" routing. Do NOT build a general BKT/IRT student
  model yet — one bit of mastery + timestamps captures most of the value at a
  fraction of the machinery (Karpathy constraint: no speculative generality).
- **Do not copy:** full measure/plan/teach/practice as a rigid pipeline the
  learner feels as gating — the campaign's T1 diagnosis already suspects
  gating is why ChatGPT wins. Keep the loop *latent*: the engine measures and
  plans silently; the learner just experiences a tutor who remembers and
  chooses well.

---

## 7. Recommendations (ordered)

1. **Import the two judge prompts** as offline regression tests for
   `prompt.ts` + workbench dialogs (near-zero cost, immediate).
2. **Rewrite the disclosure ladder as an explicit decision table** (§5.2),
   informed by TutorRL's calibrated-leakage finding; keep it prompt-enforced
   but table-shaped so it can later be driven by data.
3. **Add the `r_sol`-proxy telemetry**: per-concept outcome tracking from
   attempts/teach-backs; this is also the seed of the mastery ledger.
4. **Prototype TutorRL-7B locally via `mlx-lm`** (M4 Pro, 24 GB fits) as an
   offline transcript-labeler; evaluate judged stance decisions against our
   QKIND taxonomy before any runtime use.
5. **If offline evals justify it:** promote to a per-exchange stance router
   behind the deterministic composer (§4.2), with deterministic leak filters.
6. **Build the minimal KG** (concept nodes + 1-bit mastery + timestamps) only
   after 1-4 are in, since it consumes their telemetry.

## 8. Residual risks / open questions

- LearnHarness source not found in this checkout (see §6 assumption) — confirm
  which system the campaign means before the audit relies on §6.
- TutorRL evidence is synthetic-student, math-only; transfer to
  concept-explanation stances (our common case) is asserted, not proven.
- Local latency numbers are estimates; must be measured with the actual MLX
  build before any runtime commitment.
- Model card license (apache-2.0) vs repo (CC-BY-4.0): both permissive, but
  note Qwen2.5-7B-Instruct's own license applies to the base; fine for
  in-app use, re-check if we redistribute weights.
