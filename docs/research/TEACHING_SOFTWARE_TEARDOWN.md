# TEACHING SOFTWARE TEARDOWN (L1)

**Lane:** L1 — best-teaching-software teardown
**Campaign:** LEARNING_ENGINE_CAMPAIGN.md (north star: *be the reason you open Palimpsest, not a thing you bypass by uploading the PDF to ChatGPT*)
**Date:** 2026-11-18 · **Mode:** read-only research + web verification
**Scope:** 9 commercial systems + ChatGPT-as-competitor; 8 open/research systems.
**Method:** reverse-engineering from official docs, blogs, product pages, papers, and
open-source repos (verified URLs in Sources; accessed 2026-11-18). Proprietary
mechanisms known only from company statements are labeled *inference*.

**Fields per system (the L1 contract):** (1) the ACTUAL learning loop step-by-step;
(2) how it adapts — student model (BKT/IRT), spaced-repetition scheduler, or LLM
improvisation?; (3) how it handles a learner who doesn't know; (4) what the learner
SEES that makes it feel like teaching; (5) the ONE mechanism most worth stealing for
a PDF-first reader app.

---

## PART A — CLOSED / COMMERCIAL AI TUTORS

---

## A1. Khanmigo (Khan Academy × OpenAI)

GPT-4o-class tutor with heavy prompt-side guardrails, integrated with Khan Academy's
exercise graph and video library. Sources:
[khan-labs](https://www.khanacademy.org/khan-labs),
[guide to Khanmigo](https://www.khanacademy.org/college-careers-more/khan-labs/a/guide-to-khanmigo).

**1. Loop.** Learner opens Khanmigo on a Khan unit or pastes a problem → tutor asks
what they're working on → if aligned to a Khan exercise, **it sees the problem and
the learner's typed answer on screen** → multi-turn Socratic dialogue (one guiding
question at a time, answer withheld) → solved or learner exits. Side modes
deliberately break Socratic mode: "explain this concept," quiz generation. Session
end/mastery is tracked by Khan's own mastery system (unit tests, skill levels
`familiar → proficient → mastered`), not by the dialogue.

**2. Adaptivity.** LLM improvisation within the turn + retrieval over Khan content +
the platform's pre-existing mastery sequencing. **No BKT/IRT student model in the
dialogue.** The LLM adapts the moment; the curriculum graph adapts the path.

**3. Not-knowing.** Ask-before-tell persona (diagnostic question, not explanation,
when stuck); after sustained struggle or on request it switches to direct
explanation — Socratic mode *with an escape hatch* is an explicit design goal. Hints
reference the exact numbers/variables on screen, not generic advice.

**4. Felt-teaching driver.** The tutor asks about *this problem right now*, in short
single questions; it offers "let's try a simpler problem"; it reads pasted
screenshots/diagrams. Teaching feel = contextual see-what-you-see.

**5. Steal:** **See-what-you-see tutoring — hints bound to the exact location/problem
in front of the learner.** PDF-first equivalent: the professor must reference the
actual sentence on the actual page ("the paragraph you just highlighted claims X —
does that follow from what came before?"), never a generic chat about "the document."
This is our single biggest gap vs ChatGPT — and it's a grounding feature, not a
pedagogy feature.

---

## A2. Google LearnLM + Guided Learning (+ NotebookLM as its study surface)

LearnLM: Gemini models fine-tuned for pedagogy (May 2024; LearnLM 1.5 Pro shipped
December 2024 with a "Guided Learning" mode in Gemini), also inside Classroom and
NotebookLM. Sources:
[ai.google.dev LearnLM docs](https://ai.google.dev/gemini-api/docs/learnlm),
[Gemini update Dec 2024](https://blog.google/technology/google-deepmind/google-gemini-ai-update-december-2024/),
[NotebookLM Audio Overviews](https://blog.google/technology/ai/notebooklm-audio-overviews/),
[NotebookLM help](https://support.google.com/notebooklm/answer/14276468).

**1. Loop (Guided Learning).** Learner drops a topic → LearnLM generates a **visible
lesson plan** (sequence of checkpoints/cards) → presents a step, then **pauses and
prompts** the learner to predict/apply/answer before revealing the next step → free-
text answer graded qualitatively → proceed, re-teach, or follow up → the plan
**re-plans** around revealed gaps (visible to the user). Learner can export to
NotebookLM for source-grounded review/quiz/podcast.

**NotebookLM loop.** Upload sources → auto **source guide** (summary, key topics,
suggested questions) built from sources only → chat with **inline citations** + one-
tap jump to the exact passage → study aids (briefing, FAQ, timeline, quiz) → **Audio
Overview** (two-host podcast) with **Interactive Mode**: interrupt the hosts, ask
questions, answers cite sources. Marketing rule: NotebookLM "only knows" what you
upload.

**2. Adaptivity.** Prompt-level pedagogical principles over a frontier model —
Google's published LearnLM principles: inspire **active learning** (make the learner
do something), **manage cognitive load** (chunk), **adapt to the learner** (meet
their level, ask diagnostics), stimulate curiosity, use multimodality — plus a
**persisted lesson-plan object** giving the session memory of position. Grounding
fidelity is itself the adaptation: it refuses to answer beyond the sources. No BKT/
IRT, no scheduler in either product.

**3. Not-knowing.** Pause-and-prompt makes "not knowing" a *planned event* before
confusion compounds; Guided Learning backtracks the plan and re-teaches the missing
sub-concept more simply, then re-checks; Interactive Audio treats "I don't know" as
first-class — hosts answer from sources or say the sources don't cover it
(calibrated uncertainty, a trust move most tutors skip).

**4. Felt-teaching driver.** A **visible lesson plan** (progress is legible);
interruption is native (the learner's question is the main event, not a disruption);
citation chips everywhere — the strongest "this is honest teaching" signal in any
commercial product; a social two-voice podcast that models curiosity.

**5. Steal:** **Checkpointed visible plan + planned pause-and-prompt.** Derive the
chapter map from the book's own structure so the learner always knows where they
are, and have the professor's checks fire at section boundaries the *book* defines —
the TOC becomes the lesson plan. Second place: NotebookLM-style citation chips, one
tap back to the exact source sentence — non-negotiable in a reader app.

---

## A3. Duolingo (+ Duolingo Max)

The world's largest language app: a spaced-repetition engine in game-mechanics
clothing; Max adds GPT-4 features on top. Sources:
[spaced repetition](https://blog.duolingo.com/spaced-repetition-for-learning/),
[Duolingo Max](https://blog.duolingo.com/duolingo-max/),
[engineering blog](https://blog.duolingo.com/) *(Birdbrain details from published
talks; partly inference)*.

**1. Loop.** Home screen shows exactly one next step — the learner never chooses
curriculum → lesson = short exercises, each answered in <10 s with instant
correct/incorrect feedback → every answer updates the item's memory model → next
session's queue is rebuilt from what's predicted to decay → streaks/hearts/leagues
create the daily return loop. Max overlays episodes *inside* the SR engine: "Explain
My Answer" (chat explanation of the exact missed exercise) and "Roleplay" (scenario
conversation with feedback).

**2. Adaptivity.** The most principled in the commercial set: **half-life
regression** — a per-user, per-lexeme statistical model predicting recall as
exponential decay with a learned half-life (features: past results, exposures,
exercise type); scheduling = reshow when predicted recall drops to ~80%. Plus
**Birdbrain**, a two-part DNN (knowledge tracing + exercise difficulty) used for
difficulty calibration, and relentless A/B testing — even curriculum order is
experiment-driven, not theory-driven.

**3. Not-knowing.** Hint button reveals letter/translation scaffold at zero cost;
repeated failure re-enters the item more aggressively (error-driven scheduling, the
opposite of punitive); hearts gate progression (a retention mechanic dressed as
difficulty); Max's "Explain My Answer" gives an on-demand worked explanation of the
exact missed item, with follow-up chat.

**4. Felt-teaching driver.** Not teaching — a well-tuned game. The teaching-ness
comes from instant feedback with the correct answer shown immediately, the "why"
explainer on mistakes (Max), and the eerie accuracy of review timing ("it knew I'd
forgotten that"). Lesson: **perceived teaching quality ≈ timing of review + quality
of the "why" on errors**, not persona.

**5. Steal:** **Per-concept memory half-life scheduling from the learner's own
history, surfaced as "this is back because you're about to forget it."** The
professor's follow-ups on a book should be scheduled by predicted decay of *concepts
from the book*, not "chat when the user opens the app." Even crude BKT/HLR over the
book's key concepts differentiates against every LLM chat competitor — none of which
remember what *you specifically* forgot from *this book*.

---

## A4. Brilliant

Interactive STEM learning; the anti-video company — lessons are sequences of
interactive problem screens with minimal prose. Source:
[brilliant.org/about](https://brilliant.org/about/) + product surface.

**1. Loop.** Pick course → path of interactive scenes → rapid alternation: 2–4
sentences of concept → **widget the learner manipulates** (drag, guess, simulate) →
immediate visual feedback → next micro-step; difficulty ramps within a lesson; wrong
answers trigger a shorter re-explanation variant; end-of-lesson recap + spaced
review queue re-surfaces old material.

**2. Adaptivity.** Weak formal student modeling; strong *structural* adaptivity —
the path re-plans to prerequisite remediation on failure, review timing follows an
SR scheduler over lesson concepts, in-lesson branching is hand-authored. No LLM, no
visible BKT *(inference: they invest in content tooling, not student models)*.

**3. Not-knowing.** **Manipulable worked examples** — the explanation is often a live
diagram the learner plays with before being asked to predict (scaffolding by
interaction, not text); lesson-level remediation loop (fail → simpler variant →
retry); tiered progressive-disclosure hints in problems.

**4. Felt-teaching driver.** **Generative visuals**: concepts are systems the learner
causes to move — "I discovered it," the concept feels self-evident rather than
asserted. Plus brutally short text and visible path progress.

**5. Steal:** **Prediction-before-revelation on artifacts.** Before the professor
explains a passage, the learner commits to a prediction about it (what the argument
does next, what the author must conclude), then compares. In a reader, marginalia is
the widget: "you highlighted this — does the next paragraph agree with your reading
of it?" The commitment-then-feedback beat is the smallest high-yield teaching move
available to a text-first app.

---

## A5. Quizlet / Chegg (CheggMate)

Quizlet: flashcards + study modes (~60M students/mo) over a massive UGC deck base;
Chegg: homework help/textbook solutions. Their AI layers (Q-Chat, Magic Notes;
CheggMate) put LLM tutoring on top of the content base. Sources:
[quizlet.com](https://quizlet.com), [chegg.com/cheggmate](https://www.chegg.com/cheggmate/)
(bot-gated but live) + company announcements.

**1. Loop (Quizlet).** Learner has a set — own, classmate's, or AI-generated from
their notes ("Magic Notes" turns uploaded docs into decks) → **Learn mode**: adaptive
question queue (multiple-choice → written → test) with per-answer grading; wrong
cards return within the session (Leitner-ish) and across sessions (scheduled
reminders) → Flashcards/SR modes drill due cards → **Q-Chat** quizzes conversationally
*from the deck* — tutoring as a wrapper over the learner's material.

**2. Adaptivity.** Per-card correctness with escalating response demands (written →
multiple choice on failure) and error-driven repeats; the deck is the knowledge
model. CheggMate: pure LLM improvisation over the exact textbook problem the student
is viewing. No BKT/IRT in consumer Quizlet.

**3. Not-knowing.** Card flip = self-managed hint one tap away; Learn mode degrades
question formats gracefully on failure; Q-Chat corrects with reference to the card.

**4. Felt-teaching driver.** Not teaching — *studying*, and that's the point: the
learner brought the material, so the tool's job is drilling. Key signal: **the
learner-authored deck creates ownership** no generic tutor replicates; AI generation
from *their own notes* removes the authoring friction entirely.

**5. Steal:** **One-tap artifact → study-material generation.** In a PDF-first app
this is nearly free: every highlight, annotation, and conversation turn is already a
card candidate. Auto-materialize "cards due" from the learner's own marginalia — the
learner's engagement with the book *becomes* the deck with zero authoring. Answers
the ownership gap: they study from *their* traces, not a generic summary.

---

## A6. Cognii

Boston EdTech; its Virtual Learning Assistant is one of the few commercial products
whose core is **open-response assessment**: students write free-form answers, NLP
scores them against a rubric, and a conversational agent drives revision. Source:
[cognii.com](https://www.cognii.com/).

**1. Loop.** Course content loaded → Cognii generates assessment questions per topic
→ student answers in their own words → response evaluated semantically (correctness,
completeness vs. model answer/rubric) → if defective, **conversational remediation**:
targeted follow-up questions → student revises → re-scored → analytics flow to the
instructor dashboard (class-level misconceptions).

**2. Adaptivity.** Rubric/semantic scoring (much of Cognii's life predates LLMs) +
a dialog policy that picks the follow-up question given the *specific defect* in the
student's prose. Response-level adaptivity; no spaced repetition; no cross-session
student model beyond scores.

**3. Not-knowing.** Its signature: **the written answer IS the diagnostic.** Unlike
MCQ, an open response shows *how* the learner is wrong (misconception vs. omission
vs. sloppiness). Remediation walks the student to a corrected version, then the
student **re-writes** — the loop closes on production, not recognition.

**4. Felt-teaching driver.** Written feedback on *your own words* — far more
teacherly than "incorrect, try again." Multi-turn revision reads like an office
hour ("you said X — what about the case where…?"), and instructors see the same
dialogues, so the tool mediates a real teacher-student relationship.

**5. Steal:** **Grade the learner's own free-text articulation, then force revision,
not re-attempt.** Recognition quizzing lets learners feel fluent while producing
nothing. The professor should periodically ask the learner to *state* the argument
of the last section in their own words — and respond to the wording, not just the
verdict. Cognii's core insight survives at LLM prices: production > recognition for
detecting not-knowing.

---

## A7. Squirrel AI (Yixue Group, China)

Largest dedicated AI-tutoring company (100M+ accounts, thousands of physical
centers); adaptive K-12 tutoring. Source:
[squirrelai.com](https://www.squirrelai.com/) + company talks/papers *(internals
partly marketing — treat as inference)*.

**1. Loop.** Diagnostics initialize a knowledge profile → the curriculum is
**atomized** into thousands of micro-knowledge-points (a single fraction-addition
skill splits into dozens of atomic points) → engine picks the next micro-point →
short video + practice; every response updates the profile → continuous re-testing
probes transfer between points → advance along the point graph only on mastery →
human tutors at centers handle motivation and escalation.

**2. Adaptivity.** The most aggressive commercial student model: a **knowledge-point
graph** with prerequisite edges; **Bayesian/IRT-flavored per-point mastery
estimation** ("MCM" — capability/mastery model, including transfer between points);
RL-style ordering of points/lessons. Crucially, the target function is crisp and
measurable (exam score) — an advantage over "learning" as a target, and its
corruption mode.

**3. Not-knowing.** **Atomization IS the hint ladder**: failure localizes to a
*prerequisite point*, and the system routes backward along the graph to the exact
missing predecessor — automated prerequisite remediation at micro-granularity. Item
difficulty adapts to keep success probability productive. Humans escalate stuck
students.

**4. Felt-teaching driver.** Less than it should be: the UX is an exercise/video
conveyor. The teacher-feel comes from diagnostic accuracy ("how did it know I'd
forgotten that from grade 5?") and visible mastery on the point map. Weakness and
cautionary tale: it optimizes exam outcomes and reads as test-prep surveillance —
**student models without warmth read as surveillance.**

**5. Steal:** **Prerequisite-routed backward remediation.** When a learner fails a
check on chapter 7, don't re-explain chapter 7 — trace the failure to the earliest
*book-grounded* concept (the author's own earlier definitions/examples) and repair
there. The reader has an unfair advantage: the book is a self-contained dependency
graph; the professor can literally link back to page 41.

---

## A8. Century Tech

UK AI learning platform (schools); micro-lessons + AI learning paths + live teacher
analytics. Sources: [century.tech](https://www.century.tech/) *(engine internals
proprietary — inference)*.

**1. Loop.** Teacher assigns topic or student self-directs → Century generates a
**path of micro-lessons** (2–6-minute video/quiz nuggets) → as the student works,
the engine updates strengths/weaknesses per topic in real time → path re-sequences:
gaps trigger targeted remedial nuggets, strengths trigger acceleration → teacher
dashboard shows a live mastery heat-map; the human intervenes where the AI flags
stuck students.

**2. Adaptivity.** Company describes the engine as spaced-repetition/pacing
algorithms + knowledge-tracing-style estimates (materials mention Bayesian
techniques; specifics closed — *inference*: BKT-style per-topic mastery + forgetting
+ sequence optimization). Adaptivity at the *lesson-selection* layer, not within
dialogue.

**3. Not-knowing.** **Micro-lesson remediation**: fail a check → a targeted 2-minute
nugget, not a re-watch of a 20-minute video (granularity is itself scaffolding);
teacher-in-the-loop escalation — analytics tell a human *who* is stuck *on what*
right now; re-quizzing at spaced intervals until mastery stabilizes.

**4. Felt-teaching driver.** Legible momentum — "your path" bends visibly around you
("it skipped what I knew"); students feel *seen* because the human teacher follows
up the next day. Lesson: the software that most increases felt-teaching is the one
that makes a human (or a convincingly persistent agent) more timely.

**5. Steal:** **Two-minute remediation granularity.** Our instinct on failure is a
longer explanation; the evidence-backed move is the opposite — the smallest targeted
repair, then immediate re-attempt. In the reader: remediation should be a *margin-
note-scale* intervention (one focused exchange), never a new lecture mode.

---

## A9. TeachTap (brief; campaign-nominated)

TikTok-format learning: lessons are <1-minute beats with question interrupts and AI
tutors persona'd as historical figures. Loop: watch beat → answer question →
continue/rewind → streak. Adaptivity: light (sequence + difficulty). **Steal:**
**pace-matched interrupt cadence** — questions land every ~30–60 seconds, matching
attention cycles. For a reader: professor checks should fire at *page-paragraph*
cadence, not *chapter* cadence. Source: [teachtap.com](https://www.teachtap.com/).

---

## A10. THE COMPETITOR: raw ChatGPT as a tutor ("upload the PDF")

General-purpose frontier chat with file upload, memory, voice, canvas — no pedagogy
engine, no student model, no curriculum — that beats purpose-built tutors for many
learners. Source: [openai.com/chatgpt](https://openai.com/chatgpt/) + product behavior.

**1. Loop (what learners actually do).** Upload the PDF → optional incantation
("quiz me on this," "explain like I'm new to this") → freeform dialogue: the learner
asks whatever they actually wonder, in whatever words, at whatever depth → the model
answers with strong rhetorical adaptation (mirrors register, invents examples,
escalates on request) → learner drives every beat ("harder," "example," "test me") →
ends when satisfied. No plan, no checks the learner didn't ask for, no records
beyond memory snippets, no schedule.

**2. Adaptivity.** Pure within-dialogue LLM improvisation — and register-mirroring
is a real adaptive layer, underestimated by educators. Across sessions: nothing
reliable. It does not know what you forgot, does not bring anything back, does not
notice you skipped the hard chapter. Its memory is episodic anecdote, not a student
model.

**3. Not-knowing.** Whatever the learner knows to ask for: "explain simpler,"
"example," "quiz me." Crucially — **no shame, no gate, no probe phase**: a learner
who doesn't know never has to admit it to anything; they just ask. The single
biggest psychological difference from protocol-driven tutors, and the campaign's own
hypothesis list names it.

**4. Felt-teaching driver.** Zero-latency value: question → fluent, structured,
level-matched answer in seconds, formatted with examples. It feels like the best TA
who read everything and never sleeps — and it flatters, meeting the learner at their
exact vocabulary. What's absent from the teaching feel: it never makes you do
anything, never waits, never checks, never returns.

**5. Steal:** **Answer-shaped-first responsiveness.** Not chat features — *rhetorical
quality*: structured, example-forward, level-matched answers, no ceremony. When the
professor responds, it must be at least this good this fast, or every pedagogical
intervention reads as friction against a free baseline. Teaching moves + ChatGPT-
grade answer craft is the bar.

---

## PART B — OPEN / RESEARCH SYSTEMS

---

## B1. Kolibri (Learning Equality)

Open-source offline learning platform (with Kolibri Studio content curation),
deployed in low-connectivity schools and camps; content "channels" (Khan Academy,
CK-12…) synced device-to-device. Sources:
[learningequality.org/kolibri](https://learningequality.org/kolibri/),
[kolibri docs](https://kolibri.readthedocs.io/en/latest/).

**1. Loop.** Coach/learner picks content from channels → learners work through
resources (videos, exercises, EPUB/PDF books — built-in readers) on tablets →
embedded exercises give instant right/wrong; progress recorded → coach dashboard:
completion, time-on-task, exercise performance → coach assigns targeted material →
exercise sets repeatable until all correct (mastery criterion).

**2. Adaptivity.** **Almost none automatically — deliberately.** No student model,
no IRT, no scheduler. Adaptation is human-in-the-loop: analytics exist so a coach
adapts. Kolibri's bet: in its deployment context, content access + completion data +
a human beats an algorithm. Only behaviorist micro-loops (get N-in-a-row) in the
software itself.

**3. Not-knowing.** Authored progressive hints on some exercises; repeat-until-
mastered; the human coach. Content is leveled by source channels, so fallback =
easier content one tap away.

**4. Felt-teaching driver.** The coach relationship, not the software. Lesson:
**analytics-in-service-of-follow-up** — data nobody acts on reads as bureaucracy. If
the reader tracks anything, the professor must visibly act on it ("last time you
weren't sure about X — did chapter 5 resolve it?").

**5. Steal (architectural, not pedagogical):** **local-first, on-device learning
record.** Kolibri treats the device as the canonical home of the learning record,
syncs opportunistically, never blocks on a server. A personal reader-tutor should own
the learner's data on-device — Palimpsest's local-first architecture is already
aligned, which makes a *persistent personal student model* trustworthy rather than
creepy.

---

## B2. Oppia

Open-source lesson platform: creators build "explorations" — adaptive lessons as
state machines where each answer routes to targeted feedback. Strong in
volunteer-built global lessons. Sources:
[oppia.org](https://www.oppia.org/), [github.com/oppia/oppia](https://github.com/oppia/oppia).

**1. Loop.** Learner enters an exploration — a sequence of **states** (question +
content cards) → submits a free-form or MC answer → the lesson's **answer
classification rules** route it: correct → next state; *known misconception*
(authored rule, e.g. "answered 'add the exponents'" for a product-rule question) →
a **specific misconception feedback state** written for exactly that wrong thought →
continue until goal state; progress saved.

**2. Adaptivity.** **Hand-authored adaptivity**: the intelligence is the author's
anticipated-misconception graph. No learner model across states beyond progress; no
scheduler. (2010s "intelligent worksheet" tech that still delivers real gains —
evidence that *anticipating the exact wrong answer* is high-leverage.)

**3. Not-knowing.** Its design center: **every classic wrong answer has a named
feedback card.** The learner who doesn't know gets not "incorrect" but the feedback
a teacher wrote for people who thought *exactly what they thought*. Hints and worked
examples are states like any other, with explicit routes.

**4. Felt-teaching driver.** The jolt of specificity: "you're thinking of the product
rule — that applies when…" Feedback that names your exact misconception is the most
teacherly experience software can produce — and Oppia proves it can be *authored*.

**5. Steal:** **Misconception libraries per chapter.** For a fixed corpus, classic
errors are enumerable: pre-generate per chapter the 5–10 most likely wrong readings
of key passages (LLM-generated, book-verified); the professor answers a failed check
with *that specific* repair — Oppia-quality specificity at LLM scale. The difference
between "not quite right" and teaching.

---

## B3. MATHia / Cognitive Tutor (Carnegie Learning)

Commercial descendant of the original Cognitive Tutors (Anderson, Corbett, Koedinger
— ACT-R lineage); decades of RCT evidence behind it. Source:
[carnegielearning.com MATHia](https://www.carnegielearning.com/solutions/math/mathia/)
+ literature (Corbett & Anderson 1995, BKT; Koedinger et al.).

**1. Loop.** Student works **step-by-step inside a problem workspace** (each
transformation is an entered step, not just the final answer) → **model tracing**:
a hand-built cognitive model (production rules) predicts legal steps and infers the
student's strategy from *intermediate* work → immediate per-step feedback (the
"inner loop," VanLehn 2011) → step outcomes update a **Bayesian Knowledge Tracing**
estimate per knowledge component → the outer loop picks the next problem to move
every KC toward mastery → **on-demand tiered hints** (first: where to act; deeper:
how; final: effectively does the step) → **LiveLab** streams real-time
engagement/mastery indicators to the teacher.

**2. Adaptivity.** The gold standard pre-LLM: production-rule cognitive model + BKT
student model + problem-selection policy. Nothing improvises; every adaptive move is
grounded in a theory of the domain's cognitive structure. Trade-off: authoring cost
is enormous, domain-locked to math where steps are machine-checkable.

**3. Not-knowing.** This system *defined* the playbook: **step-level granularity**
catches not-knowing the moment it happens (mid-solution, not after failure); the
**learner-initiated hint ladder** (what → how → do-it) keeps agency with the student
— hints are requested, not imposed; "hint abuse" (clicking through) is a known,
measured failure mode; the tutor never re-teaches what the BKT posterior says is
known.

**4. Felt-teaching driver.** Immediate, local, non-judgmental per-step signals; a
hint button that behaves like a patient teacher; visible mastery bars per skill;
problems *provably* at the edge of ability (no boring review, no hopeless leaps).
Teaching feel = **competent diagnosis**, not persona.

**5. Steal:** **On-demand, learner-initiated, tiered hint ladder — never unprompted
lecturing.** The learner who doesn't know must have an explicit, stigma-free way to
escalate ("I'm stuck") and receive the *smallest* help that unblocks, deeper help
one tap away. Converts our probe-first protocol's biggest annoyance (gates) into an
agency-preserving move — the evidence-backed best practice for helping behavior in
two decades of AIED research.

---

## B4. ASSISTments (WPI / Heffernan)

Free, open homework platform (Neil & Cristina Heffernan) with instant feedback,
hints, and — critically — embedded randomized controlled trials (E-TRIALS):
hundreds of RCTs on what actually works in feedback and hinting. Source:
[assistments.org](https://www.assistments.org/).

**1. Loop.** Teacher assigns a set (or the system generates one) → student does
homework *in* ASSISTments → each answer gets **instant scoring + feedback**
(correct-answer display, or "try again" with hints) → on request, **scaffolded
multi-part hints** decompose the problem; **bottom-out hints** end the chain with
the worked answer → item report flows to the teacher (which problems, which hints,
where the class stumbled) → optional **skill-building follow-ups** re-practice
missed skills across assignments.

**2. Adaptivity.** Per-item and per-skill correctness over time (BKT-flavored
estimates drive skill recommendations); next hint depends on hint history. Its
deeper contribution is methodological: embedded A/B tests answer micro-questions
causally (e.g., "try again before showing the answer" beats immediate answer display
for retention).

**3. Not-knowing.** **Bottom-out design**: after N hints, *give the worked answer
and move on* — hint chains that never terminate frustrate and waste time. Tested
"try again vs. show answer" policies at scale. Error feedback references the
specific wrong step where possible.

**4. Felt-teaching driver.** Instant homework grading (the teacher move students
always wanted), hints that decompose rather than lecture, and a teacher who *knows
what happened* next class. Felt-teaching = the human loop closing quickly, again.

**5. Steal:** **The bottom-out rule and the one-re-attempt policy, as product
policy**: define in advance the terminal behavior of every help sequence — after the
third hint (or second failed check), the professor demonstrates and moves on. No
infinite Socratic standoffs: learners forgive being taught; they don't forgive being
stalled. (For L2: ASSISTments' RCT literature is the cheapest source of evidence-
grounded defaults for our feedback policies.)

---

## B5. The research bedrock: Bloom, the ITS literature, AutoTutor

**Bloom (1984), "The 2 Sigma Problem"** — classic one-on-one mastery tutoring moved
students ~2 SD above conventional instruction; Bloom asked how group methods could
reach 1 SD. Two separable ingredients: **mastery learning** (proceed only when the
unit is mastered, with corrective re-teaching) and one-on-one responsiveness.
Source: [ERIC ED336341](https://eric.ed.gov/?id=ED336341). *Steal:* mastery gating is
half the 2-sigma effect — but Bloom's tutors gated *curriculum progress*, not every
utterance. The modern mistake (ours included) is applying the gate to dialogue
instead of to forward motion.

**VanLehn (2011), "The Behavior of Tutoring Systems," IJAIED** — the field's
cleanest anatomy: an **outer loop** (task selection) wrapped around an **inner loop**
(step-level feedback/hints within a task). Outer-loop-only systems show weak effects;
the learning gains live in the **inner loop**. And: expert human tutoring is dominated
by inner-loop step management and plain telling — celebrated "Socratic" natural-
language tutoring showed no reliable advantage over step-based feedback alone.
*Steal:* invest in the inner loop first; don't fetishize Socratic questioning —
well-timed direct telling inside an attempt loop is evidence-backed. (DOI
`10.1007/s40593-011-0009-0`; Springer link bot-gated at fetch time.)

**AutoTutor (Graesser et al.)** — dialogue tutoring research system: the tutor holds
a set of **expectations** (ideal answer components) and likely misconceptions; it
runs expectation-covering dialogue (pumping, hints, "what about…?") until the student
articulates every expectation, with semantic (LSA) matching of free text. Source:
[autotutor.org](https://www.autotutor.org/), Graesser et al. (2012) *Amer.
Psychologist* 67(4). *Steal:* **expectation coverage as completion criterion** — the
check isn't "did they answer the question" but "did they articulate the components
of the correct understanding," pumped until covered. A concrete, stealable
definition of "actually learned it."

**Andes (VanLehn, physics) — one line:** flags errors only when propagated (delaying
detection until the error's consequence appears) vs. Cognitive Tutor's immediate
flags — studied trade-off. Reader analog: don't correct every misreading instantly;
let the learner's *prediction* fail first (desirable difficulty), then repair.

---

## B6. LearnHarness (amosblomqvist/learnharness — open source, AGPL-3.0)

An open-source desktop "agent harness for learning" — arguably the most
intellectually complete LLM-native tutor design that exists. Sources:
[github.com/amosblomqvist/learnharness](https://github.com/amosblomqvist/learnharness),
docs/teaching-methodology.md (fetched raw 2026-11-18),
[learnharness.ai](https://learnharness.ai).

**1. Loop (from its README, verbatim in spirit):** (1) **Measure.** "Before teaching,
the agent finds where your understanding ends on each part the lesson depends on.
Your answers, confidence, and thinking show it where to start." (2) **Plan.** "It
works out a dependency map from that starting point to your goal. You can see the
plan, and the lesson adapts when your understanding turns out different." (3)
**Teach.** "Each step builds on something you already understand. You predict, get
an explanation, and check your understanding. Confusions are repaired before
anything is built on them. The aim is for the goal to feel obviously true, not
merely familiar." (4) **Practice.** "Separate sessions pose varied problems that
require the right knowledge to come to mind without being named first."
Persistent artifact: knowledge accumulates as **propositions and reasoning chains in
a graph**, linked back to source sessions; future sessions read the graph; a
flashcards subsystem (docs/flashcards-*) adds spaced repetition on top.

**2. Adaptivity.** Theory-first LLM orchestration (its canonical theory doc is worth
a full team read). Tenets: two states (current/goal understanding); terminal
condition = *the goal feeling obviously true*, not recall; knowledge is a graph; the
atomic teaching act = "facts in the right order, one reasoning step at a time";
checks after every step; foundations can be *motivated* (a felt question eases
acceptance) but not derived. Adaptivity = re-measuring at each step — free-text
"thinking out loud" fields (reasoning, uncertainty, confidence) are first-class
inputs, not just answers — plus the persistent graph. No BKT numbers: the student
model *is* the recorded graph of held propositions, with linked evidence.

**3. Not-knowing.** Gaps "surface instantly" because steps are single-reasoning-step
sized; the agent repairs the weak spot *before continuing* and never builds on
unheld nodes. The per-step check is the diagnostic; thinking-aloud fields catch
wrong-but-lucky answers. Failure = backtrack the dependency map to the nearest held
node, re-derive.

**4. Felt-teaching driver.** Visible plan; thinking fields (with dictation); per-step
checks small enough to always succeed; the knowledge graph as a *tangible
possession* ("here is what you now hold, and the session it came from"). Progress
renders as *understanding earned*, not activities completed. Weaknesses: the measure
phase is heavy (probing every dependency is exactly the friction our diagnosis
flags); cold-technical tone; the graph UI risks machinery-talk (banned by our
constraints).

**5. Steal:** **One-reasoning-step-at-a-time teaching, checked per step, over a
persistent proposition graph that carries across sessions.** The coherent answer to
"what replaces our prompt-locked professor": the book's key propositions are graph
nodes (book-derived, grounding-safe); dependency edges come from the book's own
structure; the learner's held-set is the student model; each professor turn advances
exactly one edge — predict → check → repair-before-building-on. Also compatible with
our librarian voice: one small step reads as quiet expertise, not machinery.

---

## B7. TutorRL (eth-lre/PedagogicalRL — open source, CC-BY-4.0)

ETH Zürich research codebase + paper (arXiv:2505.15607, May 2025): turn a 7B
instruction-tuned LLM into a tutor that *teaches* via multi-turn GRPO in a simulated
classroom (tutor vs. frozen student-LLM vs. judges). Zero human labels; their 7B
tutor approaches LearnLM-level pedagogy while keeping GSM8K/MATH500 accuracy.
Sources: [github.com/eth-lre/PedagogicalRL](https://github.com/eth-lre/PedagogicalRL),
[arXiv:2505.15607](https://arxiv.org/abs/2505.15607),
[conversation visualizer](https://pedagogical-rl.vercel.app) (all verified 2026-11-18).

**1. Loop (classroom.py state machine).**
`START → TEACHER_TURN → STUDENT_TURN → … → JUDGE_TURN → GENERATE_SOLUTION → REWARD → END`.
Sample a problem; tutor and synthetic student alternate (student turns masked from
loss; only the tutor updates, via GRPO). The tutor's prompt hard-codes the contract
(verbatim from `teacher_prompt.txt`): "You must not reveal the answer to the student
at any point in time… If possible, do not respond with overly long responses."
Judges score each turn for **leakage** (revealed solution/decisive step?) and
**helpfulness/pedagogy**. Reward = post-dialogue **student solve rate** (did the
student, following this tutoring, solve it independently?) minus λ·leakage penalty;
hard mode: rejection zeroes the whole reward.

**2. Adaptivity (the meta-lesson).** The simulated student improvises; the tutor's
*policy* is trained to choose moves (hint, counter-question, sub-problem,
encouragement) maximizing the student's eventual independent solve without leaking —
the reward function is the student model. Direct RL is out of reach for us, but the
**judge/leakage architecture is not**: a verifier pass on professor outputs ("does
this message contain the answer to the pending check? leak 0.8 → rewrite") is a
cheap prompt-time imitation of their leakage judge, aimed at our worst failure mode
(the professor answering its own questions).

**3. Not-knowing (as learned behavior).** Trained tutors decompose into sub-goals,
prompt attempts before hints, scale hint specificity to the student's errors, and
(in the think-variant) **plan the hint privately in `<think>` tags before speaking** —
private planning, public scaffolding. The visualizer shows tutors learning to
withhold even when the student begs — pure Socratic RL discovers the hint ladder by
itself.

**4. Felt-teaching driver.** (n/a — research codebase, no product UI. But its
published conversations show the register: short, warm, single-question messages —
the anti-wall-of-text distribution, *learned* rather than prompted.)

**5. Steal:** **Answer-leakage as an explicit, checkable, verified constraint + plan-
then-speak.** Before any professor message ships, run a cheap classifier/prompt pass
against the pending check's answer; block or rewrite on leak. Makes productive
struggle *enforced and measurable* rather than prompt-hoped — the difference between
TutorRL's trained constraint and every prompt-locked persona (ours) that degrades
the first time a message drifts.

---

## CROSS-SYSTEM SYNTHESIS

### The canonical loop every serious system implements (in whole or part)

```
        ┌──────────────────────────────────────────────┐
        │ OUTER LOOP (what next): target + learner     │
        │ model → choose next task                     │
        └──────────────┬───────────────────────────────┘
                       ▼
        ┌──────────────────────────────────────────────┐
        │ INNER LOOP (this task, this moment):         │
        │ attempt/step → immediate local feedback      │
        │ → on-demand tiered hint (what→how→worked)    │
        │ → bottom-out: demonstrate, move on           │
        └──────────────┬───────────────────────────────┘
                       ▼
        ┌──────────────────────────────────────────────┐
        │ MEMORY (what persists): student model        │
        │ (BKT/HLR/graph) + scheduler → brings         │
        │ material back before it's gone               │
        └──────────────────────────────────────────────┘
```

| System | Inner loop | Student model | Scheduler | Not-knowing | Felt-teaching driver |
|---|---|---|---|---|---|
| Khanmigo | dialogue w/ Socratic guardrail | none (mastery system) | platform SR tests | ask-first, then explain | sees-your-problem |
| LearnLM/Gemini | pause-and-prompt cards | none | none | plan backtracks, re-teach | visible plan + citations |
| NotebookLM | grounded Q&A + quizzes | none | none | "sources don't cover it" | citations, interruptible podcast |
| Duolingo | instant item feedback | half-life regression | HLR scheduler | easy hints, error-driven returns | review timing + "why" |
| Brilliant | interactive predict-check | weak | light SR | manipulable worked examples | generative visuals |
| Quizlet | drill feedback | per-card | Leitner/SR | flip = self-serve hint | learner's own deck |
| Cognii | open-response grade→revise | rubric scores | none | revise-your-own-words | feedback on your prose |
| Squirrel AI | item feedback | per micro-point BKT-ish | mastery routing | prerequisite backward routing | diagnostic accuracy |
| Century | quiz + micro-lesson | topic mastery | pacing algo | 2-min remediation nuggets | path bends visibly |
| TeachTap | beat→question | light | light | rewind beat | interrupt cadence |
| ChatGPT | none (freeform) | none (memory snippets) | none | ask-for-what-you-need | responsiveness, zero friction |
| Kolibri | exercise micro-loop | none | none | coach-in-loop | human follow-up |
| Oppia | state machine + routing | none | none | named misconception feedback | specificity |
| MATHia/CogTutor | step-level model tracing | BKT production rules | outer-loop selector | learner-initiated hint ladder | competent diagnosis |
| ASSISTments | item feedback + hints | skill estimates | skill re-practice | bottom-out hints, 1 re-attempt | teacher closes loop next day |
| AutoTutor | expectation-covering dialogue | expectations checklist | none | pumping until covered | dialogue until complete |
| LearnHarness | one-step predict→check | proposition graph | practice sessions | repair-before-build | visible earned understanding |
| TutorRL | RL-trained hint policy | reward = student solve | n/a | learned hint ladder | short, single-question register |

**Three facts fall out of the table:**
1. **The inner loop is where the evidence lives.** Every system with replicated gains
   (Cognitive Tutor, ASSISTments, Duolingo, AutoTutor) invests in the moment of
   attempt. ChatGPT has no inner loop at all — exactly what a purpose-built system
   can beat it on. **Memory is the moat.** Only Duolingo, Squirrel, Century, MATHia,
   LearnHarness carry anything across sessions — and it's what makes learners say
   "it knows me." ChatGPT's memory is theater; every LLM chat competitor shares
   this weakness. **Felt-teaching = specificity** (your exact problem, words,
   misconception) — never persona. Our librarian voice is right; our specificity is
   what's missing.

---

## THE RANKED STEAL LIST (for a PDF-first reader)

Ranked by (evidence strength × differentiation vs ChatGPT × fit with standing
constraints: book is source of truth, librarian voice, no machinery talk).

**1. Book-anchored inner loop: attempt → check → tiered hint → bottom-out.**
(MATHia/ASSISTments/VanLehn.) Checks are *attempts the learner makes inside the
reading* — predict the argument's next move, state a claim in own words, apply the
just-read idea — with immediate local feedback, an on-demand "I'm stuck" ladder, and
a worked answer after bounded struggle. ChatGPT will talk about the book forever; it
will never make you *do* anything with it. **The rebuild's spine.**

**2. One-reasoning-step-at-a-time teaching, checked per step, over a book-derived
proposition graph.** (LearnHarness; compatible with #1.) Book's key claims = graph
nodes; dependency edges from the book's own structure; the learner's held-set = the
student model; each professor turn advances exactly one edge: predict → check →
repair-before-building-on. Turns our grounding law into the student model itself.

**3. Persistent per-concept memory across sessions (HLR/BKT over book concepts).**
(Duolingo/Squirrel/MATHia; Kolibri for architecture.) The professor schedules its
own returns: "yesterday you weren't sure about X; chapter 5 just used it — resolved?"
ChatGPT cannot do this; a local-first app can. The moat mechanism. Pair with FSRS-
grade scheduling defaults (L2 lane).

**4. On-demand, learner-initiated "I'm stuck" hint ladder — never imposed.**
(Cognitive Tutor + our own diagnosis: gating reads as cost.) A stigma-free escalate
button with tiered help; the professor never volunteers a lecture mid-page. Converts
agency (ChatGPT's edge) from a protocol violation into a teaching instrument.

**5. Misconception-specific feedback, pre-generated per chapter.** (Oppia + Cognii.)
Precompute the 5–10 classic misreadings of each key passage (LLM-generated, book-
verified); repairs name the learner's specific wrong reading. Highest feedback-
quality gain per unit effort.

**6. Leakage verifier + private plan-then-speak.** (TutorRL.) A cheap pass blocks
the professor from answering its own pending check; reasoning plans the next move
without exposing machinery. Makes productive struggle enforceable, not prompt-hoped.

**7. Expectation-coverage completion criterion.** (AutoTutor.) A concept is "held"
when the learner has articulated its components, not when the chat felt good —
matches LearnHarness's "obviously true" terminal condition; gives wave-2 a testable
success definition.

**8. Answer-shaped-first responsiveness floor.** (From ChatGPT itself — steal the
baseline.) Every professor explanation must match frontier-chat rhetorical quality:
structured, example-forward, level-matched, no ceremony, no machinery talk. Each
teaching intervention is priced against "I could just ask ChatGPT."

**Deliberately NOT stolen:** Squirrel-style test-prep optimization (target-function
corruption); hearts/lives/streak coercion (tone clash with librarian voice); heavy
upfront probing of every dependency (LearnHarness's own friction); RL training (out
of scope); Socratic-only registers (VanLehn: no reliable edge over step-based
feedback).

---

## WHY RAW CHATGPT BEATS A PURPOSE-BUILT TUTOR TODAY — THE L1 ANSWER

Testing the campaign's hypotheses against this evidence:

1. **"ChatGPT adapts; our professor is prompt-locked."** Partially true, but
   ChatGPT's in-conversation adaptation is shallow register-mirroring. Deeper truth:
   *prompt-lock is fine if the protocol is right* — Cognitive Tutor is prompt-locked
   (production rules don't improvise) and beats unstructured tutoring. Our problem
   isn't lock; it's that the locked protocol fights the learner instead of the
   material.
2. **"ChatGPT lets the learner drive; we impose a rigid protocol."** **The single
   biggest cause.** Every beloved system keeps agency over *when to get help* with
   the learner (hint button in MATHia, card flip in Quizlet, freeform in ChatGPT).
   We gate before value; ChatGPT gates never. Learners experience our probe-first
   professor as a toll booth and ChatGPT as a genie. Toll booths lose.
3. **"ChatGPT doesn't gate."** True, adjacent to #2 — but the fix is not "drop
   gating": Bloom's evidence makes mastery gating half the 2-sigma effect. The fix
   is **move the gate from the conversation to the curriculum**: checks on request
   and at natural section boundaries (the book's own), never as a precondition for
   talking.
4. **"Our grounding/pedagogy isn't visibly better, so friction reads as cost."**
   Absolutely true — the multiplier on #2. Khanmigo sees the problem; NotebookLM
   cites the sentence. Our professor must prove in its first two messages that it is
   *of this book* — quoting the exact passage, knowing the page. Until the advantage
   is visible, every protocol step is pure cost.
5. **"Our persona/interruptions read as annoying, not teacherly."** Confirmed by the
   specificity finding: teaching feel = specificity, never persona. A well-voiced
   interruption not about the learner's exact situation is nagging; a plain sentence
   that is, is teaching.

**Verdict — the one missing capability most responsible:**
**A visible, book-anchored inner loop that knows where the learner is — with memory
of it across sessions.** ChatGPT wins today because it has zero friction and we have
friction with no visible payoff. But ChatGPT has no inner loop and no memory — and
those are the only mechanisms in this teardown with strong, replicated learning
evidence. So the campaign answer is not "be more like ChatGPT" (drop gating, add
freeform); it is: **keep ChatGPT-grade responsiveness as the floor, and add the two
things ChatGPT structurally cannot do — an attempt-feedback inner loop anchored to
the exact page, and persistent per-concept memory that brings the book back to the
learner at the right moment.** That combination turns "why not just upload it to
ChatGPT" from a rhetorical question into a category error: ChatGPT can discuss any
book; only this can teach you *this* one.

---

## SOURCES (accessed 2026-11-18)

**Commercial**
- Khanmigo / Khan Labs: https://www.khanacademy.org/khan-labs · https://www.khanacademy.org/college-careers-more/khan-labs/a/guide-to-khanmigo · https://en.wikipedia.org/wiki/Khan_Academy
- LearnLM: https://ai.google.dev/gemini-api/docs/learnlm · https://blog.google/technology/google-deepmind/google-gemini-ai-update-december-2024/
- NotebookLM: https://blog.google/technology/ai/notebooklm-audio-overviews/ · https://support.google.com/notebooklm/answer/14276468
- Duolingo: https://blog.duolingo.com/spaced-repetition-for-learning/ · https://blog.duolingo.com/duolingo-max/ · https://blog.duolingo.com/
- Brilliant: https://brilliant.org/about/ · Cognii: https://www.cognii.com/ · Squirrel AI: https://www.squirrelai.com/ · Century: https://www.century.tech/ · TeachTap: https://www.teachtap.com/
- Quizlet: https://quizlet.com · CheggMate: https://www.chegg.com/cheggmate/ · ChatGPT: https://openai.com/chatgpt/

**Open / research**
- LearnHarness: https://github.com/amosblomqvist/learnharness · docs/teaching-methodology.md (raw-fetched) · https://learnharness.ai
- TutorRL: https://github.com/eth-lre/PedagogicalRL · https://arxiv.org/abs/2505.15607 · https://pedagogical-rl.vercel.app · teacher_prompt.txt (raw-fetched)
- Kolibri: https://learningequality.org/kolibri/ · https://kolibri.readthedocs.io/en/latest/ · Oppia: https://www.oppia.org/ · https://github.com/oppia/oppia
- MATHia: https://www.carnegielearning.com/solutions/math/mathia/ · Corbett & Anderson (1995); Koedinger & Corbett (2006)
- ASSISTments: https://www.assistments.org/ · Heffernan & Heffernan (2014) IJAIED
- Bloom (1984): https://eric.ed.gov/?id=ED336341 · VanLehn (2011) IJAIED, DOI 10.1007/s40593-011-0009-0 · AutoTutor: https://www.autotutor.org/ · Graesser et al. (2012) Amer. Psychologist 67(4)

*Caveats:* Squirrel AI and Century internals are known only from company statements
(labeled inference). Khanmigo's system prompt is not public; behavior reconstructed
from Khan Academy's own descriptions. Some vendor blog URLs 404'd at fetch time;
substantive facts rely on the live sources listed above.
