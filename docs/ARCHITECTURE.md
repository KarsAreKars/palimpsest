# THE ARCHITECTURE — the whole app, from THE FORM (2026-11-26)

**The form:** a tutor, not a library. A room with a desk, a book, a professor,
and time. (docs/THE_FORM.md — the constitution this architecture serves.)

**This document:** the concrete architecture of the whole app. What the app
IS, how it flows, what the model stack is, what stays, what goes. The guided
back-and-forth (the LearnHarness loop) is the centerpiece — a first-class
mode, not a feature.

---

## 1. THE ROOM — the app's structure

The app has three surfaces. Everything else is machinery.

```
┌─────────────────────────────────────────────────┐
│  LIBRARY          the shelf — add books, manage  │
│       │                                          │
│       ▼                                          │
│  THE ROOM         book + desk + professor + time │
│  ┌───────────┬──────────────────────────────┐   │
│  │  THE BOOK │  THE DESK                     │   │
│  │  (reader) │  (the shared canvas)          │   │
│  │           │                               │   │
│  │  source   │  where the teaching happens   │   │
│  │  of truth │  you write, he writes beside  │   │
│  └───────────┴──────────────────────────────┘   │
│       │                                          │
│       ▼                                          │
│  THE STUDY        the ledger's surfaces:         │
│  (notebook)       review · graph · session ·     │
│                   practice · the route           │
└─────────────────────────────────────────────────┘
```

**Library** — add a book, it becomes a grounded book (the hpub pipeline).
Nothing else. No social, no recommendations, no store.

**The Room** — the core. The book on one side, the desk on the other. The
professor is present in both: he annotates the book (the ink), he writes on
the desk (the blocks). The voice speaks. This is where you spend your time.

**The Study** — the ledger made visible. What you know, what you're forming,
what's due, the route to your goal, the practice run. The guided session
starts here.

---

## 2. THE TWO MODES — free and guided (the toggle)

The professor teaches in two modes. The toggle is on the Study tab; the
session runs on the desk.

### FREE MODE (the desk, the default)
You drive. Ask anything, write anywhere, drag blocks around. The professor
answers first (no gates), works beside your ink, draws what words can't say.
The desk is yours; he's a guest who happens to know everything.

**When:** exploration, curiosity, "what does this mean?", working through a
problem yourself.

### GUIDED MODE (the session, the LearnHarness loop)
The professor drives. A structured session with a goal, a route, and a
rhythm. This is the back-and-forth the owner asked for — the
measure→plan→teach→practice loop as a lived experience, not a feature list.

**The session flow:**

```
  YOU: "I want to understand attention."
    │
    ▼
  MEASURE (latent — no quiz, ever)
    The professor reads your ledger: what you know, what's forming,
    what's untouched. Where the ledger is silent, he starts conservatively
    from the book's own order. He may weave one or two probes into the
    conversation — "have you seen softmax before?" — never a gate.
    │
    ▼
  PLAN (the route, visible)
    He draws the route on the desk: an ordered path from what you know
    to your goal. "THE ROAD TO ATTENTION." You see the whole journey.
    The route adapts — when you master a node, the path re-routes.
    │
    ▼
  TEACH (the loop, one beat at a time)
    For each concept on the route:
      → He teaches it (answer-first, grounded, visual when it helps)
      → He checks it (one micro-question, inline, seconds)
      → He diagnoses (your wrong answer → your mental model, named)
      → He repairs (the specific fix, page-cited)
      → He exits when you've got it (the 80% mastery threshold)
    The rhythm is teach→check→diagnose→repair→next. Seconds per beat.
    No ceremony. No drill. The exit is the rule, not the exception.
    │
    ▼
  PRACTICE (the FSRS queue, interleaved)
    After the route: a focused run of problems drawn from the due queue
    + the route's nodes, interleaved. The silent math checker grades
    instantly. The retry→re-explain→re-ask loop handles failures.
    │
    ▼
  THE REPORT (the session ends)
    What you learned, what's forming, what's next. Filed to your ledger.
    The route updates. The due queue grows. The session is over —
    the professor knows when to stop.
```

**The toggle:** on the Study tab, a single switch: **Free / Guided**. Free is
the desk as it is today. Guided starts a session — the professor takes the
lead, the route appears on the desk, and the loop runs. You can drop back to
free at any time ("actually, let me just ask you something") — the session
pauses, the desk is yours, and the professor picks the session back up when
you're ready.

---

## 3. THE MODEL STACK — the brains

Four layers. The professor is the voice; the sim is the metacognition; the
table is the guardrail; the scheduler is the clock.

```
┌─────────────────────────────────────────────┐
│  THE PROFESSOR (the main LLM)                │
│  Kimi K3 / GPT-5 / Claude — any strong LLM  │
│  Does the teaching: answers, explanations,   │
│  figures, plots, voice. Grounded in the book │
│  (the accuracy laws). The stance table tells │
│  him HOW to teach; he decides WHAT to say.   │
├─────────────────────────────────────────────┤
│  THE STANCE TABLE (the policy)               │
│  Deterministic. Reads: question-kind,        │
│  learner mastery, stuck-signal, stance       │
│  preference, learner state. Outputs: ONE     │
│  stance (answer / scaffold / socratic /      │
│  worked-example / reveal). Tuned by the sim. │
├─────────────────────────────────────────────┤
│  THE STUDENTSIM (the metacognition)          │
│  OFFLINE ONLY. A small local model (7B,      │
│  LoRA) trained on YOUR graded history.       │
│  Predicts: which stance will make YOUR next  │
│  attempt improve. Tunes the stance table.    │
│  Never in the runtime path.                  │
├─────────────────────────────────────────────┤
│  THE LEDGER + SCHEDULER (the memory + clock) │
│  The concept ledger: what you know, evidence │
│  based. FSRS: when to bring it back. The     │
│  due queue. The graph. The ground truth.     │
└─────────────────────────────────────────────┘
```

**The professor LLM** is the main brains — the teaching voice. Any strong
model works; the architecture is model-agnostic. The prompt carries the
grounding laws, the stance table's current row, the learner's ledger summary,
and the session state. The model's job is to teach; the stack's job is to
tell it how.

**The stance table** is the policy. It's deterministic — a lookup, not a
model. It reads the exchange's context and outputs one stance. The sim tunes
it (which stance works for THIS learner); the table keeps the policy honest
(no hallucinated pedagogy).

**The StudentSim** is the metacognition. Offline, local, trained on your
graded history. It answers one question: "given this learner's state and a
stance, will their next attempt improve?" It tunes the stance table between
sessions. It never makes a live decision.

**The ledger + scheduler** are the ground truth. The ledger records what you
know (evidence, not vibes). The scheduler (FSRS) decides when to bring it
back. Everything the professor knows about you comes from here.

---

## 4. THE DATA FLOW — from book to learned

```
  ADD A BOOK
    │
    ▼
  THE PIPELINE (hpub 2.0)
    PDF → grounded book (content.md + manifest + assets)
    Every page anchored. Every figure extracted. The accuracy
    laws apply: a book that can't be grounded honestly is
    rejected with a reason, never shipped broken.
    │
    ▼
  THE ROOM
    You open the book. The professor has read it (the grounding).
    He knows you (the ledger). He teaches.
    │
    ▼
  THE LOOP (free or guided)
    Every exchange produces evidence:
      - a graded check → the ledger (mastery, FSRS card)
      - a wrong answer → the misconception diagnosis
      - a question asked → the concept tagged
      - a struggle → the stance table's state read
    │
    ▼
  THE LEDGER GROWS
    The concept graph fills in. The due queue builds. The
    StudentSim gets more data. The stance table gets smarter.
    │
    ▼
  THE NEXT SESSION IS BETTER
    The professor knows you better. The route is more accurate.
    The reviews are better timed. The loop tightens.
    The system learns how you learn.
```

The flywheel: use → evidence → ledger → better teaching → more use. Every
session makes the next one better, for you specifically. This is the moat.

---

## 5. WHAT STAYS / WHAT GOES — the gutting

The app's identity is the tutor. Everything that doesn't serve the learning
loop is demoted or removed.

### STAYS (core)
- **Library** — add/manage books. Minimal.
- **The pipeline** — book → grounded book. The accuracy laws.
- **The reader** — the book, the source of truth. TTS narration.
- **The desk** — the shared canvas. Blocks, plots, charts, derivations.
- **The professor** — the LLM tutor. Voice + text + figures.
- **The Study tab** — the ledger's surfaces + the guided mode toggle.
- **The ledger + scheduler** — the learner model. The moat.
- **Voice** — TTS (the professor speaks) + STT (you speak).

### DEMOTED (kept but not prominent)
- **Annotations/highlights** — kept (they feed the review deck), but not a
  primary surface. The desk is where work happens, not the margin.
- **Dictionary/lookup** — kept as a reader tool, not a learning feature.
- **Settings** — simplified. The learning-relevant settings (stance
  preference, voice, provider) prominent; the rest buried.

### GOES (removed or never built)
- **Spine tab** — gone (done).
- **Notes tab** — gone (done). Notes live in the ledger and the desk.
- **Social/sync/community** — never built. The room has no audience.
- **Gamification** — never built. No streaks, no XP, no leaderboards.
- **Content store** — never built. We don't sell books.
- **The old chat surface** — gone (the desk replaced it).

---

## 6. THE BUILD PLAN — from here to the Room

The form is set. The architecture is this document. The build order:

**WAVE A — the guided session (the back-and-forth).**
The LearnHarness loop as a first-class mode. The toggle on the Study tab.
The session flow: measure (latent) → plan (the route on the desk) → teach
(the micro-check rhythm) → practice (the FSRS queue) → report. The professor
leads; you follow; the desk shows the work. This is the centerpiece.

**WAVE B — the state read.**
The stance table's first input becomes the learner's state (rushed, defended,
curious, bored), not just the concept. The professor reads the room before
teaching the lesson. State-repair before content-repair.

**WAVE C — the mastery exit.**
The 80% rule, formalized: stamp, say so, leave. The escalate-or-exit rule:
two correct on the same shape → different shape or done. The FSRS card as
the safety net.

**WAVE D — the sim wire.**
StudentSim → stance table. The policy learns from your graded history. The
professor gets better at teaching you with every exchange. The moat.

**WAVE E — the eval harness.**
The R4 number: "would I rather upload this to ChatGPT?" Scored per release.
The loop's tightness made measurable.

Each wave is independently shippable. Each makes the loop tighter. The form
holds throughout: a tutor, not a library. A room with a desk, a book, a
professor, and time.

---

*The architecture is the form made concrete. The Room is the app. The loop
is the engine. The ledger is the moat. Build the Room.*
