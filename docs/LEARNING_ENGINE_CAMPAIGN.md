# LEARNING ENGINE CAMPAIGN — constitution (binding, owner ruling 2026-11-18)

**Owner ruling:** the PDF reader (Reader + Desk) is good. The teaching/learning
engine is "really, really bad." License to question every learning-design
assumption, research what the best teaching software on earth actually does,
and rebuild the learning loop from first principles. We may scrap current
pedagogy mechanics where the evidence says so.

**North star:** *the learning engine must be the reason you open Palimpsest —
not a thing you'd bypass by uploading the PDF to ChatGPT.* Every design
decision is tested against that sentence.

## The diagnosis we must answer first (T1 research)

Owner: "I'd rather genuinely just upload the PDF into ChatGPT and talk to it."
Why does raw ChatGPT win today? Candidate hypotheses to test, not assume:
- ChatGPT adapts; our professor is prompt-locked to a fixed stance/protocol
- ChatGPT lets the learner drive (freeform); we impose a rigid protocol
- ChatGPT doesn't gate (no probe-before-teach friction)
- Our grounding/pedagogy isn't visibly better, so the friction reads as cost
- Our persona/interruptions read as annoying, not teacherly

The honest answer shapes whether we keep, reshape, or drop each mechanism.

## Research lanes (parallel, read-only) — see docs/research/TEACHING_*.md

L1 best-teaching-software — reverse-engineer closed/open leaders (Khanmigo,
LearnLM/NotebookLM, Duolingo Math, Brilliant, Chegg/Quizlet, Cognii, Squirrel,
Century Tech, TeachTap; open: Kolibri, oppia, tutorRL/LearnHarness already read).
For each: the actual learning loop, what adaptivity exists, how they handle
not-knowing, what the learner sees, what makes it feel like teaching vs chat.

L2 learning-science — what actually improves retention (retrieval practice,
spaced repetition / SM-2/FSRS, interleaving, mastery learning, desirable
difficulty, elaboration, Bloom's 2-sigma / Bloom's tutoring research, cognitive
tutor / model-tracing (ACT-R), Socratic method evidence, faded worked
examples). What does a REAL tutoring system track (student model: knowledge
components, BKT/IRT) and is that worth it for us?

L3 our-current-loop post-mortem — read prompt.ts + workbenchChat + learner +
desk as an outsider: what is annoying, what is working against learning, what
ChatGPT-does-better. Concrete, not vibes.

L4 TutorRL deep-dive + local-fit — read the repo properly: could its stance
policy improve our teaching? What does LearnHarness's measure/plan/teach/
practice + knowledge graph give us that we lack?

Audit L5 arbitrates → wave plan for the Learning Engine rebuild.

## Standing constraints

- Reader + Desk are good — do not regress them.
- The book stays the source of truth (grounding, accuracy laws) — non-negotiable.
- Light-mode librarian voice; no machinery talk; no mid-session buttons.
- Karpathy: no speculative generality; every mechanism traces to a named finding.
- Queen protocol: constitution → research → audit → waves → verify → commit.

## StudentSim incorporation (Microsoft Research, owner ruling 2026-11-25)

Source: "Simulating student learning for better AI tutoring" (StudentSim).
Microsoft trains a PERSONALIZED student simulator from the learner's own
records, then uses the frozen simulator as a reward signal to train the tutor
RL-style — instead of TutorRL's generic synthetic student. This is the
promotion path the audit parked (Ruling 5 #7): a personalized learner-model,
OFFLINE ONLY, never a runtime router.

S1. The simulator is trained from the learner's OWN graded-check history
    (the Wave 2 concept ledger: what they got right/wrong, how their answers
    changed after guidance) — one simulator per learner, private, local.
S2. OFFLINE ONLY: it evaluates/labels professor transcripts and can train the
    stance policy. It NEVER sits in the runtime path (Ruling 5 #7 stands).
S3. Two-stage like Microsoft: stage 1 = the tutor's stance table as the prior
    (shared, from TutorRL); stage 2 = personalize on the learner's records.
S4. Success metric: does the simulator's predicted next-attempt-improvement
    (r_sol) agree with the learner's real r_sol from the ledger? That agreement
    IS the calibration; a simulator that disagrees is not trusted.
S5. It feeds the R4 eval harness: "would I rather upload to ChatGPT" is scored
    by a learner-model that knows THIS learner, not a generic judge.

## King's rulings on the audit's open questions (2026-11-18, binding)

R1. Answers are always free — even mid-chapter-session; only forward progress is gated.
R2. 'Ask me first' becomes a standing profile-level stance preference; the per-thread
    probe chips die.
R3. Due reviews wait for a section boundary (never interrupt deep reading).
R4. Build the standing ChatGPT-baseline eval harness (track 'would I rather upload this
    to ChatGPT' as a number per release).
R5. Scheduler: FSRS-5 with default weights (accept the dependency; Leitner is the
    pre-built fallback seam, not the default).
R6. Concept nodes come from the book's TOC/index first (cheap); a one-time per-book LLM
    pass is a Wave-4+ upgrade, not a blocker.
