# L3 — Post-mortem of OUR learning loop

**Lane:** L3 (our-current-loop post-mortem) · **Campaign:** LEARNING_ENGINE_CAMPAIGN.md
**Method:** read the code as a skeptical outsider. Every claim below is traced
to a file and line. Nothing here is vibes.
**Verdict up front:** the engineering is careful, honest, and well-tested. The
pedagogy is a layer cake of good individual ideas (retrieval practice, spaced
retest, hint ladders, Feynman checks) that — stacked in this order, with this
much prompt machinery — produce a professor who is *slower to trust, slower to
answer, and more ceremonially "teacherly"* than the ChatGPT upload the owner
says they'd rather use. The gap is not intelligence. It is friction per
answered question, and most of the friction is self-inflicted.

---

## 1. What the professor ACTUALLY does, step by step (traced from code)

There are two lanes. They share a persona prompt but have different loops,
different context, and different contracts. That fact alone — one "Professor,"
two different pedagogies glued to his back — is the first thing an outsider
notices.

### 1a. The Reader lane (PTT / ask-the-page voice loop)

1. **Entry.** Anything can fire `askProfessorFromUI(bookKey, question)`
   (`apps/readest-app/src/app/reader/components/notebook/StudyTab.tsx:60`),
   dispatching a window event that `useProfessor` owns. Sources: typed
   question, "quiz me on this highlight" (`StudyTab.tsx:114-121`), "Feynman
   review" (`StudyTab.tsx:123-131`), or a chapter-session objective
   (`session.ts:185-199`).
2. **Context pack.** `buildContextPack` (`contextPack.ts:84`) assembles:
   current page + md char span, a page excerpt capped at 6,000 chars
   (`DEFAULT_MAX_EXCERPT_CHARS`, `contextPack.ts:70`), the tail of the
   previous page (800 chars), recent exchanges, concept states, and the
   annotatable block list. In workbench mode this becomes a tiered pack:
   page (T0), chapter window ≤30,000 chars (T1), up to 3 "struggle" pages
   (T2), whole book if ≤80,000 chars (T4) (`contextPack.ts:153-162, 295-310`).
   In ollama/local mode tiers are dropped bottom-up at 60,000 chars
   (`contextPack.ts:154-156, 330-334`).
3. **System prompt.** The full `PROFESSOR_SYSTEM_PROMPT`
   (`prompt.ts:14-61`) rides as the system message: grounding law, voice law
   (≤ ~120 words, `prompt.ts:20`), spoken-word rule (`prompt.ts:22`),
   annotation DSL with "RESTRAINT FIRST: at most one or two marks"
   (`prompt.ts:31-33`), mandatory logging tags `[CONCEPT:name]` +
   `[QKIND:kind]` on **every** answer (`prompt.ts:40-42`), the disclosure
   ladder (`prompt.ts:44-50`), concept-history policy (`prompt.ts:52`),
   check-me protocol (`prompt.ts:53`), page-image evidence (`prompt.ts:56`),
   and problem mode (`prompt.ts:60-61`).
4. **The turn message.** `buildProfessorUserMessage` (`prompt.ts:63-117`)
   appends page number, page class, block list, chapter tail, excerpt,
   earlier exchanges, concept history as "asked Nx, Bloom b/6" lines, the
   question, and — because models drift — a recency reminder to annotate
   (`prompt.ts:113-116`). Note: it is a **single user message**. There is no
   conversation state server-side; every "exchange" is a one-shot completion
   with the last few exchanges summarized into the prompt.
5. **Generation.** `askProfessor` (`tutor.ts:158-192`) streams via Vercel AI
   SDK with a 45 s handshake timeout (`tutor.ts:167`). If no provider is
   configured, the **echo tutor** answers by keyword-matching the question
   against the page excerpt and quoting the top-2 sentences
   (`tutor.ts:98-137`) — retrieval cosplaying as teaching, and it says so.
6. **Consumption.** The streamed text is parsed for annotation tags
   (POINT/HIGHLIGHT/BOX/ARROW/WRITE/CAPTION), stripped, and the marks are
   rendered on the page; the spoken remainder goes to the overlay/PTT.
   `[CONCEPT]`/`[QKIND]` ride to the study log.
7. **Logging.** Every exchange is folded into `learner.json` via
   `applyExchange` (`learner.ts:103-126`): a new concept starts at Bloom 2;
   re-asking the same concept **drops** Bloom by 1 (min 1); a passed
   check-me raises it (max 6). `resolved` is inferred backwards — if you
   moved to a different concept, the previous one "landed" (`learner.ts:103-108`).
8. **Distillation.** A second model call (`distillNote`, `tutor.ts:196-237`)
   rewrites the exchange into a first-person study note appended to
   `notes.md` — a whole extra generation per exchange, with its own system
   prompt and AI-ism blacklist (`tutor.ts:200-206`).

### 1b. The Desk lane (workbench transcript)

1. **Session open.** `startWorkbenchSession` (`workbenchSession.ts:420-458`)
   loads the book's text layer, the learner log, the reader's profile
   (`learnerProfile.ts:119-148`), builds the tiered pack, and asks the
   professor to greet, "set the stage," teach the first idea **with
   provenance — WHAT IT IS / WHERE IT CAME FROM / WHY IT MATTERS** — and
   close by asking ONE question (`workbenchSession.ts:236-262`). The greeting
   is compulsory: the first block of a fresh transcript is even typed
   `kind: 'greeting'` at commit (`workbenchChat.ts:534-535`).
2. **Turn assembly.** `composeWorkbenchTurnMessage`
   (`workbenchSession.ts:284-365`) rebuilds the entire pack **every turn**
   (cache-friendly byte-stable tiers + variable T3 tail: 12-block history
   summary capped at 1,200 chars/block, a 600-char "where we are" repeat of
   the professor's own last answer, learner concept states, profile lines,
   checker summary, the student's words, and a closing contract paragraph
   restating provenance + ladder + tag rules verbatim).
3. **System prompt.** `PROFESSOR_WORKBENCH_SYSTEM_PROMPT` = the reader
   persona **plus** the workbench addendum (`prompt.ts:120-168`, joined at
   `prompt.ts:170-171`). The addendum layers on: provenance three-ways
   teaching (`prompt.ts:122-126`), "THE VISUAL IS THE LESSON" with a
   mechanical decision rule (mechanism → DIAGRAM, rule → PLOT, numbers →
   CHART, steps → folio) and "OPEN with the artifact"
   (`prompt.ts:127-128`), probe-before-you-teach with a stance chip row
   (`prompt.ts:130`), "I don't know" as a first-class signal
   (`prompt.ts:131`), mandatory-feeling teach-back with `[TEACHBACK ask:…]`
   then `[EVALUATION]` (`prompt.ts:133`), a session concept map with
   one-shelf-per-commit movement clamp (`prompt.ts:135-136`;
   `workbenchChat.ts:351-378`), page lookup `[LOOK]` (`prompt.ts:139`),
   structured derivations with per-step justification and honest self-marks
   (`prompt.ts:142-148`), SVG figures under an accuracy law and a self-check
   (`prompt.ts:150-166`), computed PLOTs and data CHARTs (`prompt.ts:152-158`),
   spoken `[VOICE]` turns, and `[TO_WORKBENCH]` routing back from the reader
   lane — "never in your first answer; never more than once in a sitting"
   (`prompt.ts:167`).
4. **Commit.** `commitProfessorBlock` (`workbenchChat.ts:407-536`) parses the
   raw stream: protocol tags are consumed into metadata; display markdown
   survives. Three penecho guards then fire at commit time: at most **3
   artifact blocks per exchange** — after the third folio/figure/plot/chart,
   "the professor sets down his pen" and the payload is muted into prose with
   a librarian note (`workbenchChat.ts:330-349, 453-527`); failed figures
   consume their slot anyway (`artifactMuted`, `workbenchChat.ts:461-470`);
   concept shelves may move at most one step per commit
   (`clampConceptShelves`, `workbenchChat.ts:351-378`).
5. **Silent checking.** On every student turn, `runSilentCheck`
   (`useDeskStreaming.ts:262-328`) submits mathy blocks to a deterministic
   checker (cap: 8 steps, `workbenchChat.ts:157-162`), with a 2.5 s budget
   before the professor is allowed to answer (`CHECK_BUDGET_MS`,
   `useDeskStreaming.ts:53, 379-385`). The professor receives a one-line
   `checker: step 2 not_equivalent, counterexample …` summary he is told to
   trust over his own reading (`workbenchSession.ts:355-359`).
6. **Stance chips.** A `[PROBE]` block renders three chips — "Lead me" /
   "Ask me first" / "I will work it" (`blockBody.tsx:102-108`) — that become
   inert after one pick (`blockBody.tsx:119-140`) and are sent as an ordinary
   student message (`sendProbePick`, `useDeskStreaming.ts:437-445`).
7. **Teach-back.** When the professor emits `[TEACHBACK ask:…]`, the next
   student block is captioned "The professor asked you to restate it — in
   your own words" (`blockBody.tsx:412-420`); the following `[EVALUATION]`
   block is labeled "His reading of your restatement" (`blockBody.tsx:421-423`).
   "I don't know" is regex-detected and surfaced as an ungraded chip
   (`workbenchChat.ts:260-265`; `blockBody.tsx:424-432`).
8. **Loop close.** Blocks persist to `workbench-transcript.json`; learner.json
   and notes.md are not touched by the desk loop itself.

### 1c. The chapter-session lane (a third loop on the same professor)

`generateChapterObjectives` (`session.ts:141-156`) drafts 3–5 objectives from
≤12,000 chars of chapter text (`session.ts:25-26`). Each objective becomes one
voice-loop round whose prompt orders the professor to ask ONE question, grade,
and end with `[PASS]`/`[RETRY]` + `[CAPTION:…]` (`session.ts:185-199`); the
Study tab advances its checklist off the annotation bus
(`session.ts:211-226`, `StudyTab.tsx:294-310`), and a stamped report is
appended to notes.md (`session.ts:230-251`).

**The outsider's summary of the actual machine:** one model, one giant
accumulating prompt, three different orchestration loops, ~15 protocol tags,
two JSON logs, one notes.md, a deterministic math sidecar, and a profusion of
guards against the model misbehaving (mute the figure, clamp the shelf, cap
the artifact, re-remind to annotate). The learner's question travels through
roughly: event dispatch → pack rebuild → prompt concat → 45 s-bounded stream →
tag parse → guard pass → block commit → silent check → log write → optional
second-generation distillation. That is a lot of runway for "what does this
equation mean?"

---

## 2. What is pedagogically sound (keep the bones)

Stripping away the machinery, the *individual* mechanisms are mostly
well-chosen, and several are genuinely ahead of ChatGPT-with-a-PDF:

- **Retrieval practice with verdicts.** Chapter sessions ask the learner to
  produce answers, grade them, and stamp PASS/RETRY (`session.ts:185-226`).
  Retrieval practice is among the most replicated effects in learning
  science; ChatGPT-with-a-PDF does this only if the user knows to ask for it.
- **Spaced retest of named misconceptions.** `RETEST_INTERVALS_MS` 24h → 72h
  → 168h, two consecutive passes to retire (`learner.ts:65-70, 150-168`).
  This is a real student-model trace and it follows the learner across the
  book (T2 tier surfaces struggle pages in context, `contextPack.ts:209-215`).
  Nothing in raw ChatGPT remembers Tuesday's misconception on Friday.
- **"I don't know" is never graded** (`prompt.ts:131`;
  `workbenchChat.ts:260-265`). This is exactly right — honest not-knowing is
  the most valuable signal a tutor gets — and it is enforced in code, not
  just in prose.
- **Deterministic math checking.** `checkDerivation` with counterexamples is
  injected into the professor's context as ground truth he must trust
  (`workbenchSession.ts:355-359`). A hallucinated "yes, that's right" on a
  wrong step is the single most damaging thing a math tutor can do; this
  closes that hole better than any prompt rule could.
- **Explanation-before-terminology.** "Explain the idea first, then name the
  terminology" (`prompt.ts:19`). Correct and rare.
- **Diagnose before hinting in problem mode** — find the divergent step,
  speak in the student's own notation first (`prompt.ts:60-61`). This is
  model-tracing intuition done in prose, and it is the right instinct.
- **Book-grounding with honesty.** The whitelist of citable pages
  (`contextPack.ts:63-69`), the "I will look" page-fetch loop
  (`prompt.ts:139`; `workbenchSession.ts:465-476`), and the visual-page
  disclaimer (`prompt.ts:115-117`) are more epistemically careful than a
  chatbot doing RAG-by-vibes.
- **The anti-repeat rule for stuck concepts.** `stuckNoteForPrompt`
  (`learner.ts:177-186`) — "asked 3 times, your previous explanations failed,
  change strategy completely and keep it shorter" — encodes a true thing:
  repeating an explanation louder is not teaching.
- **Preference profile that degrades to nothing.** `learnerProfile.ts:9-12`
  is explicit that an empty profile means "the default professor, byte-
  identical prompts." Graceful degradation is the right default posture.

## 3. What is ANNOYING or actively working against learning

This is the section the campaign exists for. Ordered roughly by damage.

### 3.1 The disclosure ladder gates ANSWERS, not learning — and the gate key is junk data

The ladder (`prompt.ts:44-50`) is: never hand over the answer when the
learner is stuck; climb one rung per exchange (why → where to look → partial →
full), with release keyed off the concept-history Bloom level: Bloom 1–2
release after ONE stuck signal, Bloom 3–4 after TWO, Bloom 5–6 only on
explicit request.

Two fatal problems, both traceable:

1. **The Bloom level is a random walk, not a measurement.** `applyExchange`
   (`learner.ts:103-126`) sets every new concept to Bloom 2, decrements on
   *any re-ask of the same concept name*, increments on a passed check-me.
   The concept name comes from the model's own `[CONCEPT:name]` tag — free
   text, model-chosen, with no normalization beyond slugging
   (`learnerProfile.ts` reuses `slugifyConcept`; the log key is whatever the
   model happened to write). So the gate that decides how many hoops a
   learner jumps through before hearing "x = 2" is keyed off a counter that
   (a) starts arbitrarily at 2, (b) goes *down* when the learner asks a
   legitimate follow-up on the same topic ("okay but why is it d_k and not
   d_v?"), and (c) silently resets when the model coins a slightly different
   name for the same idea. A learner who asks two good clarifying questions
   *lowers* their release level and gets probed harder. That is the ladder
   working against exactly the behavior it should reward.
2. **The ladder applies to "stuck or problem" but the prompt's trigger is
   broad** — "When the reader is stuck, or asks for help with a problem
   rather than a definition" (`prompt.ts:45`). A learner who asked a plain
   definitional question yesterday and re-asked today is, by the Bloom
   decrement, now "stuck," so today's innocent "what is an associated prime
   again?" can legally be met with a question instead of an answer. Nothing
   in the code distinguishes "re-asked because it didn't land" from "re-asked
   because it's Tuesday and I forgot."

The research the ladder was ported from (OpenMAIC tier guidance) assumed a
tutor that *diagnoses*. Ours counts. The gate is theater.

### 3.2 Probe-before-you-teach interrupts the learner's momentum to ask a meta-question

"PROBE BEFORE YOU TEACH — when a thread starts, do not lecture first"
(`prompt.ts:130`) means: thread opens → professor says some words → emits
`[PROBE]` → UI shows three chips (`blockBody.tsx:112-140`) → chips go inert
after one pick → the pick is sent as a message → only now does teaching
begin. That is a compulsory extra round-trip before the first answer of every
thread. The stance itself is then advisory — the addendum says "teach
according to the chosen stance," but nothing enforces or remembers it beyond
the transcript; a fresh thread re-asks. So the learner pays a tax (one click,
one model round, one interruption) for a preference that expires at the next
thread boundary and is invisible to the reader lane.

Worse, the probe happens on *thread start*, which is precisely when the
learner's question is freshest and their patience highest. The desk's first
teaching turn is spent on administrative ceremony ("how would you like to be
taught?") instead of the answer. ChatGPT answers immediately. We answer after
a form.

### 3.3 Mandatory teach-back and the "greeting + ONE question" opening make the desk a quiz show, not a conversation

The desk opening is scripted (`workbenchSession.ts:249-257`): greet, set the
stage, teach the first idea with provenance, then ask ONE first question.
Teach-back is similarly mandated the moment "the student has just grasped
something" (`prompt.ts:133`), with `[EVALUATION]` of the restatement
(`blockBody.tsx:421-423`). Stack these and a learner who came to the desk
with one question gets: a greeting, a provenance lecture, a quiz question, a
stance-form, an answer (gated by the ladder), a teach-back demand, an
evaluation, and a concept-map shelf update. Bloom's 2-sigma found tutors win
by adapting; nothing here adapts to "I just wanted to know one thing."
The "one question per block, do not answer it yourself" cadence
(`session.ts:192-195`) is imported from chapter sessions and re-imposed on
free chat via the opening/turn closers (`workbenchSession.ts:360-364`) —
every turn ends with a restated contract that pushes the professor toward
more questioning, less answering.

### 3.4 The provenance three-ways + visual-first laws inflate every teaching turn

"Teach every concept three ways, in order" (WHAT / WHERE FROM / WHY,
`prompt.ts:122-126`) plus "the desk's first language is the picture … OPEN
with the artifact" (`prompt.ts:127-128`) plus the mechanical mapping
(mechanism → DIAGRAM, rule → PLOT, numbers → CHART, `prompt.ts:127`) means
the *default shape of a desk answer* is: artifact first, caption, provenance
trilogy, tags. For "what does the book mean by regular here?" that is a
diagram of nothing, a historical anecdote about Dedekind, and an applications
paragraph — when the learner wanted two sentences. The prompt does contain
the escape hatch ("prose-first is reserved for what genuinely has no
picture"), but the ordering of the law ("visual is the lesson", "mechanical,
not a matter of taste") stacks the deck against prose for the model, and the
3-artifact-per-exchange cap (`workbenchChat.ts:330-349`) exists precisely
because unrestrained, the model floods the desk with figures. The guard's
existence is the tell: the visual law over-triggers.

### 3.5 The reader-lane answer is capped at ~120 words and forced through a spoken-word straitjacket — while the desk lane is uncapped and markdown-rich

`prompt.ts:20-22` hard-caps the reader professor at ~120 words, no markdown,
no lists, math spoken in words ("the intersection over all prime ideals").
For a listener on a walk, right. For someone reading a math book with a
question about a derivation, 120 words of spelled-out prose with no
notation, no list, and a maximum of one visual mark ("RESTRAINT FIRST,"
`prompt.ts:31`) is an impoverished answer — ChatGPT will happily give a
structured 300-word explanation with LaTeX. And when the answer genuinely
needs structure, the professor's only escape is to *route the learner away*
via `[TO_WORKBENCH]` — which is capped at once per sitting and never on the
first answer (`prompt.ts:167`). So the reader lane's design response to
"this answer needs more than 120 words" is "go to another room." The learner
experiences this as: my reader can't answer my question, it wants me to
switch surfaces. That is the bypass trigger.

### 3.6 Every answer carries protocol tax, and the model is policed in-band

Every reader-lane answer must end with `[CONCEPT:name]` + `[QKIND:kind]`
(`prompt.ts:40-42`) and every desk block with up to six tag lines; the user
turn even carries a trailing reminder nag because "prose-only answers in the
session history teach the model to stop annotating" (`prompt.ts:113-116`).
This is all invisible to the learner — but it burns model attention on
metawork, and the context pack is padded with machinery the learner never
sees: concept-history lines on every turn, profile lines, a verbatim restated
contract per desk turn (`workbenchSession.ts:360-364`). The model's finite
obedience budget is being spent on tag compliance and ladder bookkeeping
instead of on the explanation's quality. The guards (mute the figure, clamp
the shelf, strip the partial tag) are more code evidence of the same
disease: we do not trust the professor, so we surround him with referees.

### 3.7 The learner log knows what was asked, not what was learned — and it lies politely

`resolved` is inferred by concept-change (`learner.ts:103-108`) — a
heuristic that calls an exchange "landed" if you moved on. `verdict` on
check-mes is model-generated (`learner.ts:44-51`), and Bloom credit for a
check-me without a verdict defaults to `resolved` (`learner.ts:112-116`) —
the exact bug the 2026-09-13 review note says it fixed (`learner.ts:48-51`),
which means the current behavior is the *patched* version of a hole in the
ground truth. The T2 "struggle pages" tier (`contextPack.ts:198-215`)
surfaces pages where the learner asked ≥ threshold — not where they *failed*
a check. The whole evidence base is "asked," explicitly: "it never guesses
what the reader knows — it counts what they asked" (`learner.ts:2-5`).
Asking is not knowing. A system that cannot distinguish a curious re-read
from a failed concept will keep mis-adjusting (see 3.1).

### 3.8 Chapter sessions are a linear checklist with pass/retry and no branching

Objectives are drafted once (`session.ts:141-156`), then quizzed one by one
in fixed order; RETRY does not loop back to re-teach before re-asking —
`buildSessionQuestion` grades and captions, and the Study tab just advances
the checklist (`StudyTab.tsx:294-310`). A retried objective gets a caption
and the session moves on. There is no mastery loop, no re-explanation on
retry, no reordering. This is the weakest pedagogical object in the repo
despite being the most session-shaped.

### 3.9 Two lanes, two prompt contracts, one confused persona

The reader professor speaks ≤120 words, no markdown, point-first, restraint-
first (`prompt.ts:20-33`). The desk professor opens with figures, writes $$
folios, teaches provenance trilogies, and suspends the spoken-word rule
(`prompt.ts:128`). The `[TO_WORKBENCH]` bridge is the only door between
them, capped at once per sitting (`prompt.ts:167`), and the bridge seed
drops the learner's question into the desk as a history summary
(`useDeskStreaming.ts:238-258`) — context the desk professor may or may not
honor. The learner's mental model is "I asked the Professor a question"; the
code's mental model is two different tutoring systems wearing the same coat.

## 4. What does raw ChatGPT-with-a-PDF do that this doesn't — and is the gap fixable?

Trace the owner's sentence — "I'd rather genuinely just upload the PDF into
ChatGPT and talk to it" — against the traced behavior:

| What ChatGPT-with-a-PDF does | What our loop does | Fixable? |
|---|---|---|
| Answers the question, first message, no ceremony | Reader lane: ≤120 words, tag tail, possible ladder deflection; Desk lane: greeting + provenance + stance chips before teaching | **Yes — trivially.** The answer is gated by prompt law, not capability. Removing ceremony is a deletion, not an invention. |
| Adapts within two turns to the user's evident intent ("just tell me" is honored immediately) | Stuck signals must be "genuine" and ladder release is keyed to a noisy Bloom counter (`prompt.ts:50`; `learner.ts:103-126`) | **Yes.** Honor "just tell me" in the first turn (the prompt already half-does: explicit request releases rung 3 — but Bloom 5–6 blocks even explicit requests, `prompt.ts:50-51`, which is indefensible). |
| No fixed stance; it mirrors the user's mode each message | One stance pick per thread, via chips, advisory only, forgotten at thread end (`prompt.ts:130`; `blockBody.tsx:119-140`) | **Yes.** Drop the chips; make stance a per-turn inference from the learner's last message, or a profile default. |
| Freeform length and structure (LaTeX, lists, tables) | Reader lane: spoken-word, ≤120 words, 1–2 marks (`prompt.ts:20-33`); escape only via one-shot routing to the desk (`prompt.ts:167`) | **Yes — this is the single biggest fixable gap.** Lift the 120-word cap and the spoken-word rule when the reader is in study (not narration) mode; let the overlay render markdown; let it write a folio inline. The desk already knows how; the reader refuses to. |
| Remembers the whole conversation natively | We re-summarize: 12 blocks × 1,200 chars + 600-char self-echo ("where we are" repeats the professor's last answer back to him, `workbenchSession.ts:165-172`) + pack rebuild every turn | **Partly.** Native conversation memory is provider-side; but we can stop *defeating* ourselves: the "where we are" tier is redundant by construction (the last block is in the history summary) and can go. |
| Never interrupts to administer forms | Probe chips, teach-back demands, evaluation blocks, verdict tags (`prompt.ts:130-133`) | **Yes.** Keep them available, make them opt-in or model-invoked-once-per-session, not thread-opening ceremony. |
| Says "I don't know" gracefully and moves on | Same, plus honest echo tutor and "I will look" (`prompt.ts:139`) — we are actually better here | Already better; keep. |
| No grounding — hallucinates page content confidently | Book text layer, citation whitelist, honest visual-page disclaimer (`contextPack.ts:63-69`; `prompt.ts:115-117`) | We win. Do not regress this to close the gap. |
| No memory of misconceptions across sessions | learner.json + retest queue (`learner.ts:65-168`) | We win on paper — but see 3.7: the log's ground truth is weak, so the win is more theoretical than experienced. |

**The honest bottom line:** raw ChatGPT wins on exactly one axis — *latency
to a trusted, complete, freely-shaped answer* — and loses on grounding and
memory, which the owner currently does not feel because our memory is noisy
(3.7) and our grounding mostly manifests as refusals-to-guess and page-fetch
round trips rather than visibly better answers. The gap is fixable: ~80% of
it is prompt deletions (cap, ladder gating, probe compulsion, provenance
compulsion), and the remaining 20% is making the reader lane as articulate as
the desk lane. None of it requires new model capability. It requires
admitting that most of our pedagogy is currently *friction the learner pays
up front for benefits they experience, if ever, days later.*

## 5. Keep / change / drop — every current mechanism, justified

| # | Mechanism | Where | Verdict | Justification |
|---|---|---|---|---|
| 1 | Book grounding + citation whitelist | `contextPack.ts:63-69`, `prompt.ts:115-117` | **KEEP** | Our only structural moat vs ChatGPT; constitution calls it non-negotiable. |
| 2 | Page-image evidence (screenshot + clean renders) | `prompt.ts:56-58`, `tutor.ts:33-41` | **KEEP** | Lets the professor see what the learner sees — genuinely better than a PDF upload's fixed context. |
| 3 | Disclosure ladder (hint rungs) | `prompt.ts:44-49` | **CHANGE** | The rungs are sound tutoring; the *gates* are keyed to a noisy Bloom counter (3.1). Keep rungs as hint *menu*; let the learner's explicit ask release immediately, always. |
| 4 | Bloom release gates | `prompt.ts:50-51` | **DROP** | Bloom 5–6 requiring explicit request is fine, but the level itself is a random walk (`learner.ts:103-126`). Decide release from the learner's words this turn, not from a broken counter. |
| 5 | Concept history in prompt (asked Nx) | `prompt.ts:52`, `learner.ts` | **CHANGE** | Keep it as context for the professor ("they've been here before"), stop feeding it as authority. Asked-count ≠ understanding (3.7). |
| 6 | Anti-repeat stuck rule (switch strategy at ≥3 asks) | `learner.ts:170-186` | **KEEP** | Right instinct, cheap. Refine trigger to failed check-mes, not raw asks. |
| 7 | Spaced retest queue (24/72/168h) | `learner.ts:65-70, 141-168` | **KEEP** | Real spaced repetition; one of the few mechanisms the learner experiences as care. Needs better ground truth to schedule (see 4). |
| 8 | `[CONCEPT]`/`[QKIND]` logging tags | `prompt.ts:40-42`, `professorTags.ts` | **KEEP (but move)** | The study log is load-bearing for 5–7. But mandate them only when a log write will actually happen; the trailing reminder nag (`prompt.ts:113-116`) is a symptom of over-mandating. |
| 9 | Annotation DSL (POINT/HIGHLIGHT/BOX/ARROW/WRITE/CAPTION) | `prompt.ts:27-38` | **KEEP, loosen** | Pointing at the page is our best trick. But "at most one or two marks, restraint first" plus "every referring sentence gets a POINT" (`prompt.ts:31-33`) are contradictory; relax to judgment, keep the no-announce rule. |
| 10 | 120-word cap + spoken-word rule (reader lane) | `prompt.ts:20-22` | **CHANGE** | Right for narration/audio; wrong for study. Make it mode-dependent: listening → spoken rules; reading/asking → full markdown, LaTeX, longer answers. This is the highest-leverage single edit in the repo. |
| 11 | Restraint-first visual marks | `prompt.ts:31-33` | **DROP the quota, keep the taste** | A hard "1–2 marks" ceiling prevents the professor from building a visual explanation on the page. Keep "never announce marks," drop the count. |
| 12 | Problem mode (diagnose-before-hint, no-attempt-no-rung, do_not_say fences) | `prompt.ts:60-61` | **KEEP** | The most pedagogically literate paragraph in the prompt. Unverifiable-step honesty ("I will look") is excellent. |
| 13 | Echo tutor | `tutor.ts:98-156` | **KEEP** | Honest zero-key fallback that exercises the loop; also a constant reminder of what retrieval-without-understanding feels like — useful as a design conscience. |
| 14 | Distillation to notes.md | `tutor.ts:196-237` | **CHANGE** | A second model call per exchange is expensive and the notes it writes are model-voiced, not learner-voiced. Generate on demand ("save this as a note"), not automatically. |
| 15 | Chapter sessions (objectives → quiz → PASS/RETRY → report) | `session.ts` | **CHANGE** | Retrieval practice is right (§2) but: no re-teach loop on RETRY, fixed order, objectives from a 12k-char slice. Add retry→re-explain→re-ask, and let the learner choose 1–3 objectives, not 5. |
| 16 | Provenance three-ways (WHAT/WHERE FROM/WHY) | `prompt.ts:122-126` | **CHANGE** | Lovely as a *repertoire*, suffocating as a *law*. Make it available on demand ("where does this come from?") and occasional by judgment; delete "teach every concept three ways, in order." |
| 17 | Visual-first mechanical rule + open-with-artifact | `prompt.ts:127-128` | **DROP the mandate, keep the capability** | DIAGRAM/PLOT/CHART/folio machinery is a genuine differentiator; the compulsion is what floods the desk (hence the 3-artifact cap needing to exist, `workbenchChat.ts:330`). Judgment > mapping table. |
| 18 | 3-artifacts-per-exchange mute | `workbenchChat.ts:330-349, 453-527` | **KEEP** | If 17 is dropped, the mute rarely fires — but as a circuit breaker it should stay. Its librarian notes ("sets down his pen") are charming and honest. |
| 19 | Figure accuracy law + commit-time self-check | `prompt.ts:150-166`, `diagramSvg.ts` | **KEEP** | "A figure that looks plausible but is unverifiable is worse than no figure" is exactly right; this is a moat, not friction. |
| 20 | Probe-before-you-teach + stance chips | `prompt.ts:130`, `blockBody.tsx:102-140` | **DROP the compulsion, keep the chips** | The chips are a fine *offer* ("how do you want this one?"); as thread-opening ceremony they tax the exact moment momentum is highest (3.2). Model may offer; never require. |
| 21 | "I don't know" first-class signal | `prompt.ts:131`, `workbenchChat.ts:260-265` | **KEEP** | Best small design in the repo. Never graded, surfaced as honesty. Extend the regex as new phrasings appear. |
| 22 | Teach-back + [EVALUATION] | `prompt.ts:133`, `blockBody.tsx:412-423` | **CHANGE** | Feynman checks work when timely and wanted. Make them model-invoked sparingly (once per concept, not per grasped thing) and never back-to-back with a probe. The current stacking is interrogation-shaped (3.3). |
| 23 | Concept map shelves + one-shelf clamp | `prompt.ts:135-136`, `workbenchChat.ts:351-378` | **KEEP the map, DROP the clamp** | The rail is a good navigational artifact. The one-shelf-per-commit movement rule exists to stop the model's oscillation — a guard against a problem the map's *prompted* maintenance creates. Simplify: desk derives shelves from check-me outcomes mechanically, model never files. |
| 24 | `[LOOK]` page lookup | `prompt.ts:139`, `workbenchSession.ts:465-476` | **KEEP** | Honest "let me check the book" beats confident hallucination; feels like a real tutor thumbing pages. |
| 25 | Structured derivations (folio, per-step justification, honest self-marks) | `prompt.ts:142-148` | **KEEP** | Faded worked examples + justification lines are learning-science gold; the desk checking it independently (19) makes it trustworthy. |
| 26 | Computed PLOT / data CHART tags | `prompt.ts:152-158`, `plotCompute` | **KEEP** | "A plot is computed, never imagined, so it cannot be false" — correct and impossible for ChatGPT-upload to match inside a chat bubble. Capability yes, mandate no (17). |
| 27 | Deterministic silent checker in the loop | `useDeskStreaming.ts:262-328, 379-385`, `mathCheck.ts` | **KEEP** | Ground truth on math; the 2.5s budget keeps it off the critical path. Extend coverage as the engine grows. |
| 28 | `[TO_WORKBENCH]` routing (once/sitting, never first answer) | `prompt.ts:167`, `bridge.ts` | **CHANGE** | The reader→desk escape hatch is the wrong direction: it exports the learner instead of importing the capability. Let the reader lane render folios/figures inline; then the desk is a place, not an escalation. |
| 29 | Learner profile (pace/probe/voice/owned) | `learnerProfile.ts` | **KEEP, grow** | Empty-profile-is-default is the right posture. After dropping gate #4, let `probe_level` become the actual release policy — the learner's stated preference is better data than the Bloom counter. |
| 30 | "Where we are" T3 tier (professor's last answer echoed) | `workbenchSession.ts:165-172` | **DROP** | Redundant with the history summary that precedes it; pure token spend teaching the model to repeat itself. |
| 31 | Per-turn verbatim contract restatement | `workbenchSession.ts:360-364` | **DROP** | The system prompt already says it; restating it in every user message pushes the model toward ceremony over answer. If small models need the reminder, the reminder is cheaper as one line, not a paragraph. |
| 32 | Per-turn full pack rebuild | `workbenchSession.ts:284-365` | **KEEP** | Finding B in the context architecture is correct: grounding dies without it. Byte-stable ordering for caching is good engineering. |
| 33 | Verdict-driven Bloom credit (fixed 2026-09-13) | `learner.ts:44-51, 112-116` | **CHANGE** | The verdict default (`resolved`) still leaks: a check-me with no verdict and a concept-change counts as a pass. Require an explicit verdict for ANY Bloom credit; otherwise count as asked-only. |
| 34 | Feynman review entry point | `StudyTab.tsx:123-131` | **KEEP** | Voluntary, learner-initiated, uses the existing loop. This is what mandatory teach-back wishes it were. |

## 6. The one-paragraph synthesis for Audit L5

The learning engine's problem is not pedagogy shortage; it is **pedagogy
front-loading**. Every mechanism is individually defensible and jointly
suffocating: the learner must clear the ladder, the probe, the provenance
trilogy, the visual-first mandate, the teach-back, and the 120-word cap
before receiving what ChatGPT gives in message one — a complete answer in the
shape the question wanted. The fix is not more research-shaped machinery; it
is a ruthless ordering pass: **answer first, then teach.** Give the full
answer immediately and unconditionally; spend the machinery on what comes
after — the retest queue, the struggle-page tier, the check-me when the
learner volunteers it, the folio when the answer needs steps. The mechanisms
worth keeping (1–2, 6–9, 12–13, 18–19, 21, 24–27, 29, 32, 34) are exactly
the ones that operate *after* or *alongside* the answer; the ones to drop or
demote (3–4, 10–11, 16–17, 20, 22–23, 28, 30–31, 33) are the ones standing
in front of it.

---

*Read for the campaign by L3, 2026-11-18. All citations are to
`apps/readest-app/src/` paths as of this date.*
