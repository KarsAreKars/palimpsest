# Research: OpenMAIC learning loop — what Palimpsest should port (2026-09-10 update)

Scope: update of `research.md` (same-day earlier pass). This file goes **deeper on the learning loop only** — objectives, quizzes, evaluation, pedagogy skills — and answers: *which OpenMAIC learning-loop features genuinely improve a single-learner, TTS-first, PDF-as-course notebook (Palimpsest), and which must not be ported.* Repo state verified against `main` (post-v1.0.1) via full clone + raw file reads.

## Summary

The old `research.md` verdict — "OpenMAIC has no Feynman protocol and no per-concept learner model; borrow only the disclosure ladder" — is now **stale**. v1.0.0 (2026-08-27) shipped a skills system with 20 built-in pedagogy skills, including a full **Feynman learning cycle**, **Bruner spiral curriculum**, **Understanding by Design**, and **learning-to-learn (metacognition)** skills; v1.0.1 (2026-09-06) added a fact-check skill plus security hardening. The PBL v2 evaluator's telemetry-grounded reflection cards and synthesis checks are the most transferable runtime machinery. For Palimpsest, the five port-worthy patterns are: the Feynman cycle protocol, spiral-revisit growth operators, telemetry-grounded reflection cards, closing/synthesis checks, and the quiz-grading JSON contract. The multi-agent cast, slide/scene machinery, course generation, and durable runtime remain firmly do-not-port.

## What is new since research.md

1. **v1.0.1 (2026-09-06)** — security/stability release: five GHSAs fixed (classroom path traversal on write path; stored slide HTML sanitized at persistence boundary; SSRF URL guard now runs in *every* environment — local provider URLs like Ollama now need `ALLOW_LOCAL_NETWORKS=true`; redirect hops re-validated with credential stripping; dev persistence auth refused under production). Node floor raised to 22.19.0. Also: **fact-check skill**, Exa search provider, `POST /api/classroom` now validates scene DSL. [CHANGELOG](https://github.com/THU-MAIC/OpenMAIC/blob/main/CHANGELOG.md). **Confidence: high** (read directly).
2. **The skills system is the big learning-loop addition** (v1.0.0, PR #1240): 20 built-in skills under `skills/agent-runtime/`, including `feynman-learning`, `spiral-curriculum`, `understanding-by-design`, `learning-to-learn`, `curriculum-planner`, `k12-core-literacy-planning`, `social-emotional-learning`, `vocational`, `workshop-style`, `deep-research`. **This supersedes research.md's claim "(d) Mostly no … no Feynman protocol."** Correction: Feynman now exists as a prompt-level skill; there is still **no spaced-repetition scheduler and no persistent per-concept learner model in the app runtime** — the spiral skill's "concept memory" is explicitly a teacher-side *conversation record* the skill tells the agent to maintain itself ("平台不会替本 Skill 自动维护概念模型"). Palimpsest's `learner.json` remains ahead on persistence. **Confidence: high** (SKILL.md files read in full).
3. **Evaluator machinery depth** (existed since v0.3.0 PBL v2, not covered before): three evaluator modes (task / milestone / final) with a **narrative + JSON-tail output contract**, engagement-telemetry-grounded prompts, exclusion boundaries, and parse-failure resilience. Details below. **Confidence: high** (`lib/pbl/v2/agents/evaluator.ts`, `operations/runtime/eval-prompts.ts` read directly).
4. Minor: end-of-course completion page with persistent quiz state (v0.2.1); quiz grading endpoint (`app/api/quiz-grade/route.ts`) confirmed as a minimal LLM grader.

## The OpenMAIC learning loop, as it stands now

- **Objectives/planning:** courses are built outline → scenes; pedagogy skills layer on top (UbD: enduring understandings + essential questions + GRASPS performance evidence + WHERETO; spiral: concept spine + per-concept encounter history + per-lesson "Spiral Contract" with 7 fields including `future_hook`). All planning jargon is explicitly banned from learner-visible surfaces ("页面内容红线") — planning labels stay in briefs, learner UI gets action language ("别急着翻，先把答案写出来").
- **Quizzes:** single/multiple choice + short answer; short answers go to `/api/quiz-grade` — a minimal prompt returning `{"score": int clamped to [0,points], "comment": 1–2 sentences}`, with regex JSON extraction and a **fallback of half credit + generic comment on parse failure**. Quiz state persists to a completion page.
- **Multi-agent roles:** teacher (guard explain-before-feedback ordering, decide when to scaffold), "layperson/novice" agent (the primary gap detector — genuinely says "I don't get it" and probes causality), optional misconception agent (presents a common wrong explanation for the learner to dismantle; never reveals the answer early), evaluator (separate agent with separate prompt — reflection tone, JSON tail, no tool calls; explicitly separated because "same system prompt would fight itself").
- **Evaluation:** PBL v2 evaluator fires at three grain sizes. Task eval: feedback + `{strengths, improvements, score?}`, grounded in latest submission only, with an explicit **exclusion boundary** (later microtasks listed only so the grader does *not* penalize the learner for not-yet-covered material). Milestone eval: a **reflection card** (`{learned, performance, stars}`) fed real engagement telemetry — time on task, learner turns, error counts with *repeat-error counts and error signatures*, concepts unlocked, struggle notes, questions raised, closing-check quality — because telemetry is "the difference between generic 'Great work!' feedback and feedback that references what the learner did." Final eval: `{stars, what_you_built, what_you_learned, whats_next}` fed milestone recaps + a project engagement rollup + **integrative synthesis checks** (per-milestone core-concept question with learner answer graded weak/ok/strong). Engineering rules worth copying: JSON tail parsed once at stream end; malformed tail is non-fatal (prose still shown, nothing persisted); learner never sees raw JSON tokens.
- **Paper** (*From MOOC to MAIC*, JCST 41(1), DOI 10.1007/s11390-025-6000-0): 500+ students, 100k+ behavioral records, two pilot courses over 3+ months. No new learning-loop mechanism in the paper beyond what the repo implements; it validates the multi-agent classroom framing, not spaced repetition.

## Port-worthy patterns, ranked

### 1. The Feynman learning cycle protocol (`skills/agent-runtime/feynman-learning/SKILL.md`) — highest value

- **Pedagogy:** self-explanation + teach-back; the learner's *own explanation* is the object of study, not the material. Rules: learner explains to a lay audience **before** any authoritative definition is shown; diagnose only the **1–2 minimal gaps**, never dump the whole text; probing questions before answers; understanding must survive **jargon stripping** (re-explain without the exact terms *the learner themselves used*), **analogy breaking** (learner proposes an analogy, must name where it fails — at least one failure point), and **transfer to a novel context** with a counterexample or changed assumption. Ends with a written **Feynman learning record** in the learner's own words: what I can now explain / how I first understood it / where I was stuck / my new explanation / my analogy and its failure point / a new problem I can solve / what I still can't explain + next-round goal. The record is "not a celebration page — the starting point of the next loop."
- **Minimal Palimpsest form:** the Feynman review queue already exists with Bloom levels in `learner.json`. Port the *cycle structure and the record artifact*, not the 7–9-page classroom scaffolding: a Feynman session becomes (a) explain-first prompt before the Prof says anything substantive, (b) one-gap diagnosis, (c) Socratic rebuild (existing disclosure ladder), (d) jargon-strip round, (e) analogy-break round, (f) transfer question, (g) append the 7-field learning record to the notes tab and stamp `learner.json` with residual gaps as the next queue entry. All prompt-level; no new UI beyond rendering the record.

### 2. Spiral-revisit growth operators for the resurfacing deck (`skills/agent-runtime/spiral-curriculum/SKILL.md`)

- **Pedagogy:** Bruner's spiral curriculum — "revisit ≠ review." Every re-encounter with a concept must add structure on at least one named dimension via an operator: `ADD_COMPLEXITY`, `ADD_RELATION`, `ABSTRACT`, `FORMALIZE`, `CHANGE_REPRESENTATION`, `INCREASE_TRANSFER_DISTANCE`, `ADD_EXCEPTION`. Includes a "fake spiral" checklist (repeated-not-spiraled, vocabulary inflation, difficulty escalation without conceptual deepening) and `future_hook` — deliberate productive incompleteness. Also specifies the per-concept **concept-memory record**: encounter history, representation history, complexity level, misconceptions detected, mastery evidence, next revisit target.
- **Minimal Palimpsest form:** the highlight-resurfacing deck currently resurfaces; upgrade it to *spiral*. `learner.json` gains a per-concept encounter history (it likely already has Bloom level — add the misconception + encounter fields from their record schema). When the GO/QUIZ ME deck resurfaces a concept, the Prof picks **one** growth operator and the card must answer "what's new this time" (new relation, new representation, counterexample, or transfer distance) instead of replaying the same highlight. Chapter boundaries give this for free: the book is the spine, chapters are the revisits.

### 3. Telemetry-grounded reflection cards (PBL v2 evaluator: `evaluator.ts` + `eval-prompts.ts`)

- **Pedagogy:** feedback must cite evidence of what the learner actually did; reflection at milestone grain, not just task grain. The prompt engineering is the lesson: feed the grader a structured ledger (time, turns, error counts *with repeat counts and signatures*, concepts unlocked, struggle notes, questions raised) plus the **exclusion boundary** (never penalize for not-yet-covered material) plus "grade the latest attempt only; older drafts are context, not evidence."
- **Minimal Palimpsest form:** Palimpsest already logs quiz results and resurfacing outcomes to `learner.json`. After a chapter QUIZ ME session, the Prof generates a short spoken + written reflection card: strengths / growth edges / what to revisit — grounded in a session ledger (questions missed, repeats of the same miss, highlights re-opened, questions the learner asked the Prof). Adopt three contract rules verbatim: (1) narrative + trailing JSON block parsed once, malformed JSON non-fatal; (2) exclusion boundary keyed to chapters not yet read; (3) latest-attempt-only grading.

### 4. Closing/synthesis checks (`eval-prompts.ts`: `stage_synthesis_check`, quality weak/ok/strong)

- **Pedagogy:** generative integration — one question per chapter/milestone that forces connecting the core concept across the material, graded on a coarse 3-point rubric, stored as mastery evidence and surfaced again in end-of-book synthesis.
- **Minimal Palimpsest form:** extend chapter QUIZ ME with exactly one spoken integrative question ("how does X in this chapter change what Y meant earlier?"), grade weak/ok/strong into `learner.json` as a Bloom-level signal, and replay the weak ones at book completion. Trivial to implement; directly feeds the existing review queue.

### 5. Quiz-grading JSON contract (`app/api/quiz-grade/route.ts`)

- **Pedagogy:** immediate, specific feedback on free-form answers.
- **Minimal Palimpsest form:** the Prof grades spoken quiz answers; adopt their contract — system prompt demands `{"score": int, "comment": 1–2 sentences}` only, score clamped to range, regex JSON extraction, graceful fallback (partial credit + generic comment) on parse failure. A 50-line port that hardens the existing spoken-quiz grading against LLM format drift.

Also worth knowing (not ranked): `learning-to-learn` skill's four embedding points (opening retrieval before explanation; predict-before-feedback; self-explanation with a "why" probe; closing that covers *both* "what I learned" and "how I'll retrieve it later") — free prompt-level upgrades for the Prof's session openers/closers.

## Explicitly do NOT port

1. **Multi-agent cast** (novice agent, misconception agent, roundtable, LangGraph director). Palimpsest has one Prof; the novice agent's gap-detection role collapses into the Prof asking "where did that get hard to say?" Keep the *roles as prompt stances*, not agents.
2. **All classroom page/scene machinery** — the Feynman skill's 7–9 page mapping, quizzes as slide scenes, PBL milestone UI, slide DSL, PPTX import. PDF is the only rendered layer; port loops, not scaffolding.
3. **Course-generation pipeline and agent workbench** (`@openmaic/generation`, durable runtime, skills-as-packages system, materials/asset registry). The book is the course; nothing is generated ahead of time. Note their own Feynman skill admits static pre-generated pages "cannot do per-sentence diagnosis" — Palimpsest's live Prof is structurally *better* positioned than OpenMAIC's classroom for this loop.
4. **Durable agent runtime / Postgres / leases / session steering** — local-first single user; `learner.json` + Readest storage suffice.
5. **Fact-check skill's web-search verification layer** (v1.0.1) — it exists to catch hallucinations in *generated* courses. Palimpsest's source of truth is the book; if anything, keep only its ordering rule ("check supplied materials before web") inverted as "check the book's text before answering."
6. **Scenario/role-play PBL mode, stars-as-gamification beyond a simple card, video/image generation, voice cloning, OpenClaw skill packaging** — all out of scope (unchanged from research.md).
7. **Their SSRF-guard default** — v1.0.1 rejects loopback provider URLs unless `ALLOW_LOCAL_NETWORKS=true`; correct for their hosted product, wrong default to copy into a local-first reader that *wants* localhost Kokoro/Whisper servers.

## Contradictions

- **research.md (earlier today) vs. current repo:** research.md stated "(d) Mostly no … no Feynman protocol." v1.0.0's `feynman-learning` skill contradicts this — the protocol now exists as a skill (prompt-level), though still without a persistent learner model behind it. This file supersedes that claim.
- **License note unchanged but worth restating:** GitHub's API/search caches still show AGPL-3.0 in some snapshots; the repo `LICENSE` is MIT since v0.3.0 (2026-06-28). MIT applies to everything recommended here.

## Missing evidence

- Did not read `lib/pbl/v2/agents/instructor.ts` (91 KB) or the `evaluator-*.md` prompt markdown files themselves — the JSON-tail schemas and telemetry fields are confirmed from the TS builders, but exact rubric wording inside the markdown prompts is unread.
- Skill quality is unverified by execution — SKILL.md files are well-engineered prompt artifacts, but no evidence of measured learning outcomes for the Feynman/spiral skills specifically (the JCST paper predates them).
- Stars/activity stats are point-in-time; repo moves fast (v1.0.1 landed 4 days before this writing).

## Sources

- Kept: [OpenMAIC repo + README](https://github.com/THU-MAIC/OpenMAIC) and [CHANGELOG](https://github.com/THU-MAIC/OpenMAIC/blob/main/CHANGELOG.md) — v1.0.0/1.0.1 facts, read from clone/raw.
- Kept (read in full from clone): `skills/agent-runtime/feynman-learning/SKILL.md`, `spiral-curriculum/SKILL.md`, `understanding-by-design/SKILL.md`, `learning-to-learn/SKILL.md`, `fact-check/SKILL.md`; `lib/pbl/v2/agents/evaluator.ts`; `lib/pbl/v2/operations/runtime/eval-prompts.ts`; `app/api/quiz-grade/route.ts` — primary evidence for every port recommendation.
- Kept: [JCST paper page](https://jcst.ict.ac.cn/en/article/doi/10.1007/s11390-025-6000-0) / [arXiv:2409.03512](https://arxiv.org/abs/2409.03512) — evaluation scale and framing only.
- Deprioritized: openmaic.io marketing page; MAIC-Core (predecessor repo); alphaXiv summary; Tsinghua news article — no primary evidence beyond repo/paper.

## Next steps

1. Read the four `lib/pbl/v2/prompts/evaluator-*.md` files if pattern 3 is adopted — the reflection-card rubric wording is the final missing piece.
2. Diff `lib/pbl/v2/agents/tier-guidance.ts` at v1.0.1 vs. the version research.md summarized, before re-vendoring the disclosure ladder.
3. Skim `curriculum-planner/SKILL.md` only if Palimpsest ever spans multiple books as one curriculum.
