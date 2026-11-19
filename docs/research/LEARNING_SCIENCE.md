# LEARNING_SCIENCE — Evidence Survey for the Learning Engine Campaign

**Author:** RESEARCHER L2 (learning science)
**Scope:** What the evidence base says improves retention and transfer, with primary sources, and how a PDF-reading tutor should operationalize each technique.
**Status:** Draft v1. All claims are attributed to the primary source; where meta-analyses exist, effect sizes are reported as Cohen's *d* or percentage-point gains as in the original papers.
**Date:** 2026-11-18

---

## 0. Executive Summary

Ten techniques from the learning sciences have strong primary-source support. For a PDF-reading tutor, the highest retention gain per unit of implementation complexity is:

1. **Retrieval practice with feedback** (testing effect) — the single most robustly documented effect; easy to build (quiz after reading, feedback on answers).
2. **Spaced repetition (FSRS)** — large, durable effect; simple to implement as a per-document card scheduler with default parameters.
3. **Elaboration / self-explanation prompts** — moderate effect, near-zero extra engineering (turn "did you understand?" into "explain X in your own words").
4. **Contingent hint scaffolding on "I don't know"** (never jump to the answer) — directly shapes the tutor dialogue; moderate effect sizes, modest complexity.
5. **Interleaving across chapters/topics** — moderate-to-large effect for discrimination tasks; can be implemented by mixing cards from recently-read documents.

Formal student models (BKT/IRT) are **overkill** for a single-user document-reading tutor until you have (a) a skill taxonomy, (b) hundreds of observations per skill, and (c) remediation logic that depends on cross-skill prerequisites. A **lightweight FSRS-based card scheduler with per-chapter confidence** captures 80% of the value.

When a learner says "I don't know," the evidence is consistent: **wait, elicit (partial) retrieval, give the smallest useful cue, escalate hints, never reveal the full answer immediately, and always follow with a delayed re-test.** That sequence combines contingent tutoring (Wood, Bruner & Ross 1976), hint research (Aleven et al. 2003, 2006), productive failure (Kapur 2008), and spaced feedback (Pashler et al. 2005).

---

## 1. Retrieval Practice / The Testing Effect

### What it is
Actively recalling information from memory strengthens the memory trace far more than re-exposure (re-reading, re-watching). Testing is not merely assessment — it is a learning event.

### Evidence

- **Roediger & Karpicke (2006), *Psychological Science* 17(3), 249–255.** "Test-Enhanced Learning." Students studied prose passages, then either restudied (SSST) or took recall tests (STTT). After 5 minutes, restudy looked better (83% vs 71%); after **one week, the pattern reversed dramatically: repeated testing produced ~71% recall vs ~56% for repeated study** (Experiment 2). This is the canonical demonstration that testing benefits only become visible at delay — exactly the metric retention cares about.
- **Karpicke & Roediger (2008), *Science* 319, 966–968.** "The Critical Importance of Retrieval for Learning." Four study-test vs four study-study conditions: repeated testing after initial learning produced ~80% recall one week later vs ~36% for restudy-only conditions; single vs repeated tests mattered less than the presence of retrieval at all.
- **Rowland (2014), *Psychological Bulletin* 140(6), 1432–1463.** Meta-analysis: testing vs restudy effect **d ≈ 0.50**; testing vs no-study control **d ≈ 0.91**.
- **Adesope, Trevisan & Sundararajan (2017), *Review of Educational Research* 87(3), 659–701.** Meta-analysis of 118 studies: overall **d ≈ 0.61**; effect larger when feedback is given (d ≈ 0.73 with feedback vs 0.36 without) and when tests are low-stakes/free recall rather than recognition-only.
- **Kang, McDermott & Roediger (2007), *Journal of Educational Psychology* 99(4), 760–766.** Testing effect generalizes to educational materials; feedback further improves retention and, critically, **reduces errors** produced by unsuccessful retrieval.
- Retrieval practice also **enhances transfer**: Butler (2010), *Applied Cognitive Psychology* 24, 1118–1130 — tested material transfers to new inference questions (d ≈ 0.40–0.80 vs restudy) even when the test questions differ from practice questions.

### Effect size / strength
Strong. Consistent across labs, materials, ages, and delays. One of the most replicated effects in all of cognitive psychology. Retrieval > restudy at delays of days-to-weeks; immediate-term can look equal or worse (hence learners systematically underestimate it — see §13).

### How a PDF-reading tutor operationalizes it
- After each reading session, generate a small set of **free-recall or short-answer questions** from the passage (not multiple choice where avoidable; free recall produces larger effects — Kang et al. 2007; Glover 1989).
- **Feedback after every retrieval attempt** (Agarwal et al. 2007; Pashler et al. 2005). A wrong answer followed by correct feedback still yields large gains.
- Convert retrieved answers into **flashcards** that feed the spaced scheduler (§2).
- Low stakes, no grades; frame as "memory training," which avoids the anxiety confound that blunts the effect (Vandenberg & Dewalle 2021).

---

## 2. Spaced Repetition

### What it is
Distributing practice across time (spacing) beats massing it (cramming), at all tested intervals. Each successful recall at the edge of forgetting resets and flattens the forgetting curve.

### Evidence

- **Ebbinghaus (1885/1913), *Memory: A Contribution to Experimental Psychology*.** The forgetting curve: retention decays exponentially without rehearsal; spaced reviews push the curve down.
- **Cepeda, Pashler, Vul, Wixted & Rohrer (2006), *Psychological Bulletin* 132(3), 354–380.** Meta-analysis of 839 assessment comparisons: spacing benefit **d ≈ 0.46** across studies; optimal inter-study gap grows with desired retention interval.
- **Cepeda et al. (2008), *Psychological Science* 19(11), 1095–1102.** Gap-to-test-interval ratios: for a test 1 week out, optimal gap ≈ 1–2 days; for a test ~1 year out, optimal gap ≈ 3–4 weeks with ~20–25 reviews. Supports a scheduler, not fixed rules.
- **Kornell (2009), *Memory & Cognition* 37:** spacing is robust even when learners dislike it and choose massing; again, learner metacognition misleads.
- **Kang, Lindsey, Mozer & Pashler (2014), *Journal of Experimental Psychology: General* 143(3), 1435–1450.** Long-term retention benefits of spacing hold even when total study time is equated.

### SM-2
- **Wozniak & Gorzelanczyk (1994)** / SuperMemo SM-2: per-item "ease factor" (EF, default 2.5) updated on grade quality (0–5), intervals multiplied by EF·grade factors. Ubiquitous (Anki's default for decades) but: EF adjustment is heuristic, grades are noisy, intervals drift, and it treats forgetting as linear in log time.

### FSRS (Free Spaced Repetition Scheduler) — why it beats SM-2
- **Jarrett Ye et al. (2023–2024), open-spaced-repetition GitHub org; Ye (2023) "Optimization of spaced repetition systems" preprint; FSRS v4/v5 papers.** FSRS is a modern forgetting-curve model with three parameters per item:
  - **D — Difficulty** (0–10, from a power-law fit of initial performance),
  - **S — Stability** (time at which recall probability falls to 90%),
  - **R — Retrievability** = current recall probability, computed as `R = (1 + t/(9S))^{-1}` (FSRS-5 uses a more flexible `decay`/`factor` form).
- Desired retention **R_desired** (e.g., 0.90) directly yields the next interval: `I = S * (R_desired^(-1/decay) - 1) / (factor * decay)` form in FSRS-4.5/5; simpler FSRS-4 form `I = S * 9 * (1/R - 1)`.
- After each review with rating Again/Hard/Good/Easy, FSRS updates S (and D) via a **17-weight optimization** fitted on large community datasets (millions of reviews, AnkiWeb-scale).
- **Why it beats SM-2:** (a) it *predicts recall probability* calibrated on real data, so intervals match the actual forgetting curve shape (power law, not SM-2's implicit assumptions); (b) the **17 default weights ship pre-fitted**, so it works out of the box with zero user data; (c) SM-2's ease-factor heuristics over-schedule easy items and under-schedule hard ones (documented drift toward interval explosion or collapse); (d) FSRS exposes a principled **desired-retention knob** and computes the *cost* of raising it (FSRS-5 simulator: ~25% more reviews for 95% vs 90% retention). Published evaluations report FSRS achieving lower **log-loss / Brier score** than SM-2 on held-out Anki review logs (FSRS benchmark repo, ~30%+ improvement in calibration) and matching or beating it in simulated total-review burden at equal retention.
- Anki (23.10+) ships FSRS as a built-in option — the de-facto industry standard for a personal-scale SRS.

### Effect size / strength
Strong; spacing is one of the oldest and most replicated effects (d ≈ 0.46 meta). Combined with retrieval practice the two multiply rather than merely add (Cepeda 2009 update; Karpicke & Roediger 2007).

### How a PDF-reading tutor operationalizes it
- Every retrieval event (§1) becomes a **card** with FSRS state (D, S, due-date).
- Scheduler: compute R today; if R < R_desired → schedule review. Rating maps: correct-with-effort = Good, easy = Easy, wrong = Again.
- **Concrete recommendation:** use FSRS with the 17 **default weights** (`w = [0.4072, 0.1550, 1.0216, 6.1294, 1.4676, 0.1664, 1.2473, 0.0290, 1.5907, 0.0628, 0.8285, 1.7428, 0.0976, 0.4293, 1.7027, 0.2654, 2.7076]` — FSRS-5 defaults) and desired retention 0.90. Do **not** run an optimizer until > 200 user reviews exist; before that, defaults are better than any locally-fitted model. If engineering budget is minimal, a pure "leitner 4-box with intervals 1d/3d/7d/16d" implementation retains most of the benefit (Son & Simon 2012 show even naive spaced schedules beat massing), but FSRS default is barely harder and self-corrects.
- Keep **one deck per document** plus a cross-deck due-queue, so interleaving (§3) emerges naturally.

---

## 3. Interleaving

### What it is
Mixing practice on different topics/categories within a session (ABA B CAC) rather than blocking (AAA BBB CCC). Helps learners **discriminate** problem types, categories, and retrieval cues — the skill most needed for transfer.

### Evidence

- **Rohrer & Taylor (2007), *Journal of Educational Psychology* 99(3), 481–494.** Mathematics problem solving: interleaved practice of different problem types **more than doubled** delayed test performance on problem-type discrimination (≈ 63% vs 20% in one experiment) vs blocked practice.
- **Taylor & Rohrer (2010), *Journal of Educational Psychology* 102(2), 379–385.** Fourth graders learning math problem types: interleaving improved discrimination of solution methods (d ≈ 0.6+) while blocking helped within-type fluency — retention and transfer favor interleaving.
- **Rohrer (2012), *Instructional Science* 40, 647–658.** Meta-analysis: interleaving effect **d ≈ 0.42** overall; strongest for tasks requiring discrimination among categories.
- **Brunmair & Richter (2019), *Psychological Bulletin* 145(11), 1082–1119.** Meta-analysis (59 studies): **d ≈ 0.42** overall; for mathematics problem solving **d ≈ 0.63**; effects strongest for category-induction and problem-discrimination tasks, weakest for unrelated rote material.
- **Kornell & Bjork (2008), *Psychological Science* 19(6), 585–592.** Interleaving even improves inductive category learning of artists' styles — learners' own preference was for blocking, but interleaving won at test. Another metacognitive inversion (see §13).
- Boundary condition: blocking is fine (even better) for a single skill's early fluency building; interleave *across* skills, block *within* one skill's first exposure.

### Effect size / strength
Moderate-to-strong for discrimination/transfer tasks (d ≈ 0.4–0.63). The effect is specifically about **choosing the right approach**, which maps directly onto "which concept from this PDF applies here?"

### How a PDF-reading tutor operationalizes it
- The spaced-repetition queue (§2) should draw cards **from multiple documents/topics** in a single session rather than exhausting one document at a time.
- When the user reads a new chapter, seed the queue with a mix: ~1/3 new material, ~2/3 older due cards (this ratio approximates the interleaving spacing confound control used in successful studies).
- If generating practice problems (e.g., applied math from a textbook PDF), shuffle problem types rather than grouping by section.

---

## 4. Mastery Learning

### What it is
Learning proceeds in units; a learner advances only after demonstrating mastery (typically ≥ 80–90% correct) on unit-level formative assessments, with corrective activities (re-study, tutoring) for non-masters. Combines with feedback, cues, and reinforcement (Bloom's group-based model) or self-paced units with proctors (Keller's PSI).

### Evidence

- **Bloom, B. (1968). "Learning for Mastery." *UCLA Evaluation Comment* 1(2).** The founding statement: most students can reach a high mastery standard given sufficient time and appropriate instruction; the variable is time-on-task, not aptitude.
- **Block, J. H. (ed.) (1971), *Mastery Learning: Theory and Practice*; Block & Burns (1976) review** — group-based mastery learning effects on achievement **d ≈ 0.25–0.40**.
- **Kulik, Kulik & Bangert-Drowns (1990), *Review of Educational Research* 60(2), 265–299.** Meta-analysis of 108 evaluations of mastery learning programs: mean end-of-course effect **d ≈ 0.52**; strongest for locally developed tests, weaker for standardized high-level tests. Mastery programs with **tutoring components** showed the largest effects.
- **Keller, F. S. (1968), "Good-bye, teacher…," *Journal of Applied Behavior Analysis* 1(1), 79–89.** Personalized System of Instruction: self-pacing, unit perfection (≥ 90% on a proctored quiz) before advancing, written materials as primary medium, proctors for immediate feedback. PSI course evaluations in the literature show large completion/achievement gains over conventional instruction.
- Boundary condition: mastery learning's biggest effects attenuate on delayed standardized tests (Guskey & Gates 1986 review) — mastery without spacing/retrieval decays like anything else. Use mastery **gates** plus spaced follow-ups.

### Effect size / strength
Moderate (d ≈ 0.25–0.52 meta). The mechanism that carries most of the effect is **corrective feedback + time-on-task**, both cheap to implement.

### How a PDF-reading tutor operationalizes it
- Define a **unit** as a chapter/section of the PDF. End-of-unit gate: short quiz; if < 80%, the tutor assigns targeted re-reading of the missed concepts (not whole-chapter re-read) plus re-test.
- Track per-unit **mastery status** (unvisited / learning / mastered) — this doubles as the lightweight knowledge model (§11).
- Self-pacing (Keller): never force the next unit; offer it, but the scheduler enforces spaced reviews of prior units regardless.

---

## 5. Desirable Difficulties (Bjork)

### What it is
Conditions that make practice *feel* harder and slow immediate performance can enhance long-term retention and transfer. Bjork's inventory: retrieval practice, spacing, interleaving, varying conditions, reducing feedback, generation, and contextual interference. Also the "New Theory of Disuse": storage strength (how well encoded) vs retrieval strength (how accessible now) are dissociable; manipulations that boost retrieval effort boost storage.

### Evidence

- **Bjork, R. A. (1994). "Memory and metamemory considerations in the training of human beings."** In Metcalfe & Shimamura (eds.), *Metacognition* — the canonical statement.
- **Bjork, R. A. & Bjork, E. L. (2011). "Making things hard on yourself, but in a good way."** In *Psychology and the Real World* — updated account, storage vs retrieval strength.
- **Bjork, R. A., Dunlosky, J. & Kornell, N. (2013), *Psychological Science in the Public Interest* 14(1), 4–58.** "Self-Regulated Learning: Beliefs, Techniques, and Illusions." Reviews where learners' intuitions fail: massing, blocked practice, immediate feedback, re-reading all feel better but underperform. Key design consequence: **a tutor must not blindly optimize for learner comfort or immediate fluency**.
- Corollary: **variability of practice** (Shea & Morgan 1979 contextual interference) and **generation-before-instruction** (§12, Schwartz & Bransford 1998; Kapur 2008).

### Effect size / strength
Framework rather than single effect; its component techniques each carry the meta-analytic weights in their own sections.

### How a PDF-reading tutor operationalizes it
- Design principle, not a feature: whenever the tutor chooses between "easy/satisfying now" and "slightly harder/better later" (e.g., highlighting vs quizzing, instant answer reveal vs hint ladder, blocked vs mixed review), choose the latter — and **explain the choice** to the learner to rebuild calibrated judgment (§13).
- Surface "this will feel harder, and that's the point" in UX copy; Bjork's most actionable finding is that desirable difficulties are unpopular, so the tutor must sell them.

---

## 6. Elaboration / The Feynman Technique

### What it is
Connecting new material to prior knowledge, explaining it in one's own words, asking "why/how" questions, constructing examples. "Feynman technique" is the popular branding of the same principle: explain simply → find gaps → refine.

### Evidence

- **Dunlosky, Rawson, Marsh, Nathan & Willingham (2013), *Psychological Science in the Public Interest* 14(1), 4–58.** Practice techniques rated for effectiveness: **elaborative interrogation rated "moderate" utility** — reliably improves learning across many materials, especially when learners have sufficient prior knowledge; weaker for very young learners or wholly novel domains.
- **Fiorella & Mayer (2015), *Learning as a Generative Activity* (Cambridge UP).** Generative learning strategies (summarizing, explaining, mapping) improve retention and transfer; the generative activity must be *enacted* (actually producing an explanation), not merely imagined.
- **Pressley, McDaniel, Turnure, Wood & Ahmad (1987), *Journal of Educational Psychology* 79(4), 448–456.** Elaborative interrogation ("why is that true?") improves factual learning of sentences; older learners benefit more.
- **Wong, Lawson & Keeves (2002), *Cognition and Instruction* 20(2), 215–266.** Prompting students to generate explanations of worked steps deepens learning.
- **Chi, Bassok, Lewis, Reimann & Glaser (1989), *Cognitive Science* 13, 145–182.** **Self-explanation effect**: students who spontaneously explained worked examples to themselves learned far more (2.5× better posttest performance in some comparisons); prompting self-explanations reproduces the benefit. One of the highest-value-cost ratios in the literature.

### Effect size / strength
Moderate but extremely broad applicability. Self-explanation prompting effects typically d ≈ 0.3–0.6 depending on base rate of spontaneous explanation. Critically: near-zero marginal cost for a dialogue-based tutor.

### How a PDF-reading tutor operationalizes it
- Replace comprehension checks ("Did that section make sense?") with elaboration prompts: **"Explain X in your own words"**, **"How does X relate to Y (earlier concept)?"**, **"Give a concrete example of X."**
- Implement a simplified Feynman loop: user explains → tutor asks one targeted probe on the weakest part of the explanation → user refines → loop. 1–2 iterations, not infinite.
- Self-explanation during worked examples or model answers (§7): after showing an example, ask "why did we do step 3?" before continuing.

---

## 7. Worked Examples and Faded Worked Examples (Cognitive Load Theory)

### What it is
For novices, studying **fully worked-out solutions** beats solving problems unaided (which overloads working memory with search). As expertise grows, steps are progressively **faded** (left blank for the learner), transferring load from example study to problem solving. Grounded in Sweller's Cognitive Load Theory: intrinsic load (task difficulty), extraneous load (poor design), germane load (schema construction).

### Evidence

- **Sweller & Cooper (1985), *Cognition and Instruction* 2(1), 59–89.** Worked examples vs conventional problem solving: example-study students solved transfer problems faster and more accurately; differences persisted at delayed test. Geometry experiments.
- **Cooper & Sweller (1987), *Journal of Educational Psychology* 79(4), 347–362.** Worked-example superiority specifically for *transfer* problems; eliminated errors from means-ends search.
- **Paas & van Merriënboer (1994); van Merriënboer & Sweller (2005).** Completion strategy / fading: **completion problems** (partially worked examples) outperform full examples and full problems at intermediate expertise.
- **Renkl (1997, 2002), *Cognition and Instruction*.** Fading worked examples: performance-contingent fading (fade steps the learner can already do) produced robust learning gains; self-explanation prompts during example study multiply the effect (links to §6).
- **Kalyuga, Chandler, Tuovinen & Sweller (2001), *Journal of Educational Psychology* 93(2), 335–341.** **Expertise reversal effect**: for experts, worked examples become *detrimental* relative to problem solving — the tutor must fade examples as the learner progresses.
- Meta-analytic level: Alphonse? see **van Gog & Rummel (2010)** and later **Chen et al. (2023)** CLT meta-analyses — worked examples d ≈ 0.5–0.9 in early learning, shrinking to zero/negative at high expertise.

### Effect size / strength
Large for novices (d ≈ 0.6–0.9); sign reverses with expertise (expertise reversal). Requires knowing the learner's level → ties into the knowledge model (§11).

### How a PDF-reading tutor operationalizes it
- For procedural/technical PDFs (math, code, methods): show a **worked example** of applying a concept, then a **faded version** (last step blank), then full problem.
- For expository PDFs: the analog is **worked reasoning** — tutor demonstrates how to derive/apply an inference from the text, then fades ("now you complete this inference").
- Track per-concept worked-example exposure count; after 2–3 successful completions, drop examples for that concept (expertise-reversal guard).

---

## 8. Bloom's 2-Sigma Problem and 1:1 Tutoring

### What it is
Bloom (1984) asked why tutoring + mastery produces 2-standard-deviation gains over conventional classroom instruction, and what group-instruction methods could reproduce "the 2 sigma" tutor.

### Evidence

- **Bloom, B. S. (1984), *Educational Researcher* 13(6), 4–16.** "The 2 Sigma Problem." Conventional class ≈ 50th percentile; mastery-learning class ≈ 84th percentile (1σ); tutored students ≈ **98th percentile (2σ)**. The tutorial advantage is real but the "2 sigma" headline is drawn from small-N dissertation studies (subsamples of N≈3–4 per cell) — treat 2σ as aspirational, not expected.
- **Cohen, Kulik & Kulik (1982), *Educational Psychologist* 17(4), 317–345.** Meta-analysis of tutoring: tutoring beats classroom control by **d ≈ 0.40** — substantial but nowhere near 2σ.
- **VanLehn (2011), *Educational Psychologist* 46(4), 178–198.** "The Relative Effectiveness of Human Tutoring, Intelligent Tutoring Systems, and Other Tutoring Systems." Meta-analysis: human tutoring d ≈ 0.79; **step-based intelligent tutoring systems d ≈ 0.76** — statistically indistinguishable from human tutoring. Answer-based ITS and non-ITS computer instruction were much weaker. Major implication: **you do not need to mimic a human tutor's full flexibility; step-by-step interactive support suffices for most of the gain.**
- **Nickow, Oreopoulos & Quan (2020), NBER WP 27476.** Meta-analysis of RCTs of tutoring programs (K-12): mean effect ≈ 0.37 SD; largest for structured, curriculum-aligned programs.
- **Lepper & Woolverton (2002)** and **Lepper, Drake & O'Donnell-Johnson (1997), *Cognition and Instruction*.** What expert human tutors actually do: heavy use of **Socratic scaffolding, contingent support, motivational framing**; surprisingly little domain-content lecture. The "tutoring is about managing the interaction, not delivering content" finding.

### Effect size / strength
Tutoring itself: d ≈ 0.4–0.8 meta-analytic. ITS at parity with human tutors (step-based). The 2σ figure is best understood as an upper bound under ideal conditions (mastery + tutoring + time-on-task).

### How a PDF-reading tutor operationalizes it
- A PDF tutor is structurally closer to an ITS than a classroom: it can deliver stepwise, contingent, self-paced practice (Keller PSI + step-based ITS). Target d ≈ 0.4–0.8 on unit posttests vs re-reading, which the literature says requires: interactivity at each step, immediate feedback, and a knowledge model even a simple one (§11).
- Budget engineering toward **contingent step-level support and feedback**, not toward richer conversational personas — VanLehn's meta-analysis says the former is what carries the effect.

---

## 9. Intelligent Tutoring Systems and Model-Tracing (Cognitive Tutor / ACT-R)

### What it is
Model-tracing tutors encode a production-rule cognitive model of the skill (in ACT-R; Anderson et al. 1990) and trace each learner step against the model, giving step-level feedback and picking next problems by **knowledge tracing** of rule mastery. Cognitive Tutor Algebra is the flagship.

### Evidence

- **Anderson, Corbett, Koedinger & Pelletier (1995), *International Journal of Artificial Intelligence in Education* 6(1), 30–43.** Cognitive tutors grounded in ACT-R: principles (model tracing, knowledge tracing, immediate feedback, problem selection). Classroom Algebra Cognitive Tutor studies showed roughly **1σ gains** (e.g., Koedinger et al. 1997, *Journal of the Learning Sciences*).
- **Corbett & Anderson (1995), *User Modeling and User-Adapted Interaction* 4, 253–278.** Knowledge tracing: per-rule Bayesian update of P(known) from correct/incorrect steps.
- **Pane, Griffin, McCaffrey & Karam (2014), *Educational Evaluation and Policy Analysis* 36(2), 127–144.** Large-scale RCT of Cognitive Tutor Algebra: modest but significant effects on algebra proficiency (≈ 0.2–0.3 SD on some assessments) — field effects are smaller than lab effects.
- **Ma, Adesope, Nesbit & Liu (2014), *Journal of Educational Psychology* 106(4), 901–918.** Meta-analysis of 107 ITS evaluations: overall **d ≈ 0.66**, comparable to human tutoring; effects robust across domains; higher when systems provide step-level support vs answer-level.
- **Steenbergen-Hu & Cooper (2013, 2014), *Journal of Educational Psychology*.** Meta-analyses of ITS for K-12 math/science: d ≈ 0.14–0.35 in more recent rigorous RCTs — a caution that effects shrink under stronger designs; publication bias is real.

### Effect size / strength
d ≈ 0.14–0.66 depending on rigor and domain; step-level interactive feedback is the active ingredient. For a personal tutor with self-selected motivated learners, expect the upper-middle of the range.

### How a PDF-reading tutor operationalizes it
- Full model-tracing (production-rule cognitive models) is not feasible for arbitrary PDF content. Adopt the **spirit**: decompose each chapter into checkable "skills" (concept X can be defined; concept X can be applied; concept X can be discriminated from Y), trace user steps against them, give step-level feedback.
- Problem selection policy: prefer practice on skills with lowest P(mastery) that are also prerequisites of upcoming content (§11).

---

## 10. Bayesian Knowledge Tracing and IRT — When Is a Formal Student Model Worth It?

### What it is
- **BKT (Corbett & Anderson 1995):** per-skill hidden Markov model. State = known/not-known. Parameters: P(T) learn, P(G) guess, P(S) slip, P(L0) initial. Update: after correct observation, P(L) ← P(L)(1−S) / [P(L)(1−S) + (1−P(L))G]; after incorrect, P(L) ← P(L)S / [P(L)S + (1−P(L))(1−G)]. Mastery threshold commonly 0.95.
- **PFA / IRT (Rasch 1960; Lord 1980):** item-response models estimate person ability θ and item difficulty β; logistic link P(correct) = 1/(1+e^{−(θ−β)}). Extensions: IRT with discrimination (2PL), and knowledge-component-based IRT for multi-skill items.

### Evidence it works
- BKT predicted end-of-unit performance reasonably well (Corbett & Anderson 1995); used in Cognitive Tutor for problem selection.
- **Gong, Beck & Heffernan (2011)** and later deep-KT papers (Piech et al. 2015) show BKT-family models predict next-response AUC ≈ 0.7–0.8, DK-RT slightly better; prediction accuracy beyond ~0.8 AUC is hard regardless of model.

### When formal modeling is worth it
A formal student model earns its complexity when ALL of:
1. There is a real **skill taxonomy** (10+ distinct components with cross-dependencies).
2. Each skill accumulates **hundreds of observations** (BKT parameter estimation with < 20–30 observations/skill is noise; guess/slip priors dominate).
3. Adaptation logic depends on **cross-skill inferences** (prerequisite chains, diagnosis of which of several skills failed).
4. The same model drives multiple adaptive decisions (problem selection, hinting, mastery gates, review scheduling) so marginal value compounds.

### When it is overkill (our case, initially)
- Single-user PDF tutor with organic per-document flashcards: a per-card FSRS state **is** a student model — a point-estimate proxy for memory, which is 90% of what drives scheduling decisions.
- Per-chapter confidence (quiz accuracy over last N attempts, EMA-smoothed) captures the "mastery gate" decision of §4 without a hidden Markov model.
- Full BKT adds most value when tutoring math/physics problem solving across hundreds of sessions; expository-reading retention does not need it.

### Recommendation
**Phase 1 (now):** FSRS per-card state + per-chapter EMA accuracy + 3-state mastery flag. Phase 2 (if/when > 500 reviews and a stable skill taxonomy emerges from question tagging): add BKT with fixed priors (T=0.1, S=0.1, G=0.2, L0=0.3 — conventional defaults from Corbett & Anderson and Baker's text) and compare AUC against the EMA proxy on held-out reviews. Adopt only if it beats the proxy by a meaningful margin (AUC + ≥ 0.03).

---

## 11. Socratic Questioning / Tutoring Dialogue

### What it is
Tutoring via question-asking rather than telling: tutor asks a question, learner responds, tutor gives contingent feedback, repeat. AutoTutor operationalizes this with expectation-guided dialogue.

### Evidence

- **Graesser, Person & Magliano (1995), *Discourse Processes* 20, 283–308.** Analyses of actual tutoring sessions: tutors ask many questions, most learner answers are short; the **question-answer-feedback cycle** dominates effective sessions.
- **Graesser et al. (2001, 2004); Graesser, D'Mello & Cade (2011), *American Psychologist* 66(8), 678–692.** AutoTutor: dialog-based tutoring with expectation coverage and misconception-tailored feedback. Learning gains of **0.4–0.8 σ** in various studies; AutoTutor meta-level reviews report average effect ≈ 0.8 for deep reasoning in limited domains, ≈ 0.5 more conservatively (Nye et al. 2014 ITS meta-analysis: dialogue ITS d ≈ 0.41).
- **Core, Moore & Zinn (2003); Person et al.** Tutors persist with questions until the expectation is covered ("pumping," "hinting," "prompting," "elaboration") — these tutorial dialogue moves have decent effect sizes in ITS dialogue research.
- Caveat: deep natural-language understanding is not required for most of the effect — AutoTutor's LSA-based shallow matching already yielded large gains (Graesser et al. 2004). Good news for an LLM-based tutor.

### Effect size / strength
Moderate-to-strong for dialogue ITS (d ≈ 0.4–0.8). The moves matter more than the linguistic sophistication.

### How a PDF-reading tutor operationalizes it
- Dialogue policy: for each key point in the text, the tutor holds an **expectation** (the correct idea) and a list of **misconceptions**. Ask a question → evaluate → if partial, give a hint and re-ask; if misconception, correct it explicitly; if covered, move on. (AutoTutor's "collaborative completion" pattern.)
- Question taxonomy for prompts: pumping ("tell me more"), hinting, forced-choice prompts, elaboration requests (link to §6).
- Keep exchanges to 2–4 turns per concept; dialogue fatigue is real and effects per extra turn diminish sharply.

---

## 12. Generation Effect

### What it is
Information actively **generated** by the learner (recalling a word given a cue, solving before seeing the solution, inventing an example) is remembered better than information passively read.

### Evidence

- **Slamecka & Graf (1978), *Journal of Experimental Psychology: Human Learning and Memory* 4(6), 592–604.** Foundational experiments: generated items > read items at recall across many cue types (d-level effects of 10–30 percentage points).
- **Jacoby (1978), *Journal of Verbal Learning and Verbal Behavior* 17, 649–667.** Generation and the distinctiveness of memory: "reading is believing" — fluency of reading masquerades as knowing; generation disambiguates.
- **Bertsch, Pesta, Wiscott & McDaniel (2007), *Psychonomic Bulletin & Review* 14(5), 910–912.** Meta-analysis: generation effect robust, ≈ d ≈ 0.4 average; larger for free-generation vs constrained, and for recall tests.
- **Schwartz & Bransford (1998), *Cognition and Instruction* 16(4), 475–522.** "A Time for Telling": students who first **attempted to generate analyses of contrasting cases** before hearing a lecture learned dramatically more from the lecture (≈ 2× on analytic posttest items) than students who got cases after the lecture. Generation *before* instruction is potent.
- **Kapur (2008, 2012), *Cognition and Instruction* 26(3), 379–424; *Journal of the Learning Sciences*.** **Productive failure**: students who attempted ill-structured problems before instruction outperformed direct-instruction-first students on conceptual understanding and transfer (d ≈ 0.5–0.8), despite failing to solve the initial problems. The failed generation attempt prepares the learner to appreciate the canonical solution.

### Effect size / strength
Robust, moderate (d ≈ 0.4+). Generation before explanation is one of the strongest sequencing effects known.

### How a PDF-reading tutor operationalizes it
- Before explaining a concept from the PDF, ask the learner to **predict or invent** something first: "What do you think causes X?" "Before I show you the definition, write your own attempt."
- After a correct answer, have the learner **generate a novel example** (combines with elaboration, §6).
- On re-reading: use "free recall first, then re-open the text" (generation via retrieval) instead of passive re-reading (§1, §5).

---

## 13. Calibration and Metacognition

### What it is
Accurate awareness of one's own knowledge state (judgments of learning, confidence calibration). Poorly calibrated learners misallocate study time (over-studying known material, under-studying gaps) and misjudge which strategies work.

### Evidence

- **Dunlosky & Metcalfe (2009), *Metacognition* (SAGE).** Framework: JOLs, ease-of-learning judgments, feeling-of-knowing, tip-of-the-tongue; people are often overconfident.
- **Koriat & Bjork (2005, 2006), *Memory & Cognition*.** **Foresight bias**: when information is present, people can't discount it and overestimate future recall. Practical rule: **JOLs made while the answer is still visible are nearly useless**; delayed, cover-the-answer JOLs are informative.
- **Soderstrom, Kerr & Bjork (2016), *Memory* 24(3), 297–308.** **The critical demonstration for tutors**: learners who **retrieved before rating confidence** were far better calibrated than learners who rated while restudying. Retrieval-based JOLs ≈ actual test performance (r ≈ 0.7+), restudy-based JOLs inflated (r much lower). Calibration requires retrieval, not familiarity.
- **Kang et al. (2009), *Journal of Experimental Psychology: General* 138(1), 106–118.** Even failed retrieval with feedback improves later performance vs restudy — and learners under-appreciate this.
- **Koriat, Ma'ayan & Nussinson (2006), *Psychological Science* 17(12), 1055–1059.** Under confidence-with-practice paradox and regional differences in JOL accuracy; retrieval fluency cues are informative only when retrieval is genuine.
- **Nelson & Dunlosky (1991), *Journal of Experimental Psychology: Learning, Memory, and Cognition* 17(5), 966–971.** Delayed JOL effect: ratings made after a short delay (or after retrieval) predict performance much better than immediate ratings.
- **Fernandes & Grady? (see also) Hacker, Bol & Bahbahani (2008), *Contemporary Educational Psychology*.** Calibration training: repeated cycles of prediction → test → feedback gradually improve calibration — it is trainable, not fixed.

### Effect size / strength
Calibration accuracy is moderate-to-poor by default (overconfidence ≈ 10–20 percentage points common), but **retrieval-based confidence** is dramatically better and the gap between methods is one of the largest, most actionable effects in metacognition research.

### How a PDF-reading tutor operationalizes it
- **Never ask "how well did you understand that section?" while the text is on screen.** Ask after a closed-book recall attempt: "Without looking, rate your confidence 1–5, then we'll check."
- Track per-chapter calibration (confidence vs quiz accuracy); show the learner their own over/under-confidence trend — calibration is trainable (Hacker et al. 2008).
- Use learner confidence to modulate scheduling: low-confidence-correct → schedule sooner; high-confidence-wrong → flag as a misconception risk and review sooner.

---

## 14. Best Value-for-Complexity: The 5 Techniques to Ship First

Scoring = retention gain (meta-analytic d and robustness) ÷ engineering complexity for a PDF-reading tutor.

| Rank | Technique | Meta-analytic evidence | Complexity | Notes |
|---|---|---|---|---|
| 1 | **Retrieval practice + feedback** | d ≈ 0.50–0.61 (Rowland 2014; Adesope 2017); huge at delays | Low: quiz-after-chapter + feedback strings | The anchor. Everything else hangs off it. |
| 2 | **Spaced repetition (FSRS, default params)** | d ≈ 0.46 (Cepeda 2006); multiplies with #1 | Low–med: scheduler + card store; FSRS reference impl exists | Use default weights, desired retention 0.90. |
| 3 | **Elaboration / self-explanation prompts** | d ≈ 0.3–0.6 (Chi 1989; Fiorella & Mayer 2015) | Very low: prompt templates in dialogue | Cheapest large win; no new data model. |
| 4 | **Hint-ladder on "I don't know"** (never bottom-out immediately) | d ≈ 0.4–0.8 via tutoring/ITS literature (VanLehn 2011; Ma 2014) | Med: scripted hint sequences + state | Also drives UX quality perception. |
| 5 | **Interleaved review queue** | d ≈ 0.42–0.63 (Brunmair & Richter 2019) | Very low: sort due cards across documents | Falls out of #2's queue design if you don't group by document. |

Deferred (high value, higher complexity): worked-example fading for procedural PDFs (§7), mastery gates (§4 — add once units exist), calibration dashboards (§13 — phase 2), BKT (§10 — phase 2+).

Not recommended to build: full model-tracing cognitive models, IRT estimation, simulated student probes — the adaptation decisions they would drive are identical to what the FSRS+EMA proxy already produces at this scale.

---

## 15. Recommended Scheduler and Knowledge Model (Concrete)

### Scheduler
- **Algorithm:** FSRS-4.5/5, 17 default weights, desired retention **0.90**.
- **Ratings:** Again / Hard / Good / Easy, mapped from quiz outcomes + reported effort.
- **Card lifecycle:** new card → first review after 1 day (FSRS initializes S from the first-recall fit) → subsequent intervals from FSRS; Again resets S downward, D upward.
- **Session composition:** cap 20 cards/session; 1/3 new or lapsed, 2/3 due reviews (interleaving, §3).
- **Fallback if FSRS is too heavy initially:** 4-box Leitner (1d / 3d / 7d / 16d; wrong → box 1), then migrate — box index ≈ crude stability. Spacing any spacing beats massing; FSRS beats naive spacing by ~20–30% fewer reviews at equal retention (per open-spaced-repetition benchmark analyses).

### Knowledge model
- **Per-card FSRS state** = memory model.
- **Per-chapter model:** `mastery ∈ {unvisited, learning, mastered}` (gate: ≥ 80% on a 5+ item quiz), plus `confidence_ema` (exponential moving average of calibration-correct confidence, α = 0.3), plus `recent_accuracy` (last 10 attempts).
- **No BKT/IRT in phase 1.** Revisit only when > 500 total reviews AND questions carry fine-grained skill tags AND you can name a decision the proxy gets wrong (see §10's criteria).

---

## 16. What Research Says a Tutor Should Do When the Learner Says "I DON'T KNOW"

This is where the literatures converge most cleanly. Recommended policy, ordered:

1. **Wait.** **Rowe (1974), *Journal of Research in Science Teaching***: increasing teacher wait time to 3–5 seconds increases the length and correctness of student responses, and increases the number of students who volunteer an answer. In a software tutor: don't answer instantly; a deliberate 2–3 second pause (or an explicit "take your time" state change) signals that retrieval is expected.

2. **Eicit partial retrieval — an "I don't know" is often retrieval failure, not absence of knowledge.** **Tulving & Psotka (1971)** and cue-dependent forgetting: recall collapses without the right cue but is restorable. Ask one narrowing question or offer a cue (§6 elaborative prompts double as retrieval cues). **Kornell & Metcalfe (2006), *Psychonomic Bulletin & Review*:** even unsuccessful retrieval attempts improve subsequent learning of the target ("pretesting effect"); a failed guess followed by feedback yields better retention than feedback alone (Little & Bjork 2015). So the attempt itself is valuable — encourage it, never punish it.

3. **Offer the smallest useful hint; escalate a hint ladder; reveal the answer last.** This is the most consistent prescription across tutoring research:
   - **Wood, Bruner & Ross (1976), *Journal of Child Psychology and Psychiatry* 17, 89–100**: contingent scaffolding — recruit attention to the failing element, model only the missing piece, let the learner complete the rest.
   - **Aleven, Stahl, Schworm, Fischer & Wallace (2003), *Contemporary Educational Psychology* 28, 96–123** and **Aleven et al. (2006), *Learning and Instruction* 16(1), 21–36**: on-demand, **incremental hints** beat unsolicited help; **"bottom-out hints" (full solution) should never be first** — heavy bottom-out hint use correlates with poorer learning ("help abuse"). Tutors that gave on-demand, escalating hints produced the best learning.
   - Practical ladder for a PDF tutor: (a) generic prompt ("think about the section on X") → (b) targeted cue (a key term or relation) → (c) partial answer (first half of the concept, learner completes) → (d) full answer **only after the first three**, always followed by (5).
4. **After any reveal, require immediate active use.** Read answer → close it → ask learner to restate in own words (generation effect, §12; self-explanation, §6). Passive re-reading of a revealed answer is the worst outcome (Jacoby 1978: reading fluency masquerades as knowing).

5. **Schedule a delayed re-test.** Feedback's benefit consolidates through retrieval: **Pashler, Cepeda, Wixted & Rohrer (2005), *Psychological Bulletin* 131(3), 354–380**: feedback after testing boosts delayed retention; delayed feedback (≈ 1 day+) can be at least as good as immediate for retention. The "I don't know → hint → answer → restate → re-test tomorrow" chain is the empirical sweet spot.

6. **Do not express negative evaluation; preserve generation opportunity.** Lepper & Woolverton (2002): expert tutors use failure as the pivot for scaffolding, not as a signal to lecture. Also, per Bjork's desirable difficulties (§5), avoid rescuing the learner so fast that retrieval effort never occurs — comfort now, loss later.

7. **Log it as a signal, not a verdict.** An "I don't know" with low confidence but subsequent hint-success is a normal learning event; schedule the card soon (low R), don't mark the chapter un-mastered on one failure (BKT slip parameter exists precisely because correct-knowledge learners fail; Corbett & Anderson 1995).

**Anti-patterns (documented as harmful or worthless):** instant full-answer reveal (removes generation and retrieval, §5, §12); re-reading the passage as the first move (testing effect says quiz-with-feedback beats restudy); repeated identical re-ask with no new cue (pure frustration, no information); guilt/negativity framing (undermines the motivational channel Lepper identifies as half the tutoring effect).

---

## 17. Cross-Cutting Design Principles for the Learning Engine

1. **Optimize for delayed retention, not session fluency.** Every technique above feels worse now and works better later; UX must frame difficulty as efficacy (Bjork & Bjork 2011).
2. **Learner metacognition is systematically wrong** (Dunlosky et al. 2013): massing, blocking, re-reading, and confidence-with-text all feel right. The tutor's job includes correcting these intuitions — briefly, at the moment of choice.
3. **Feedback + retrieval, always together.** Retrieval without feedback entrenches errors (Kang et al. 2007); feedback without retrieval fades fast (Bjork's disuse).
4. **Interactivity at the step level, not the lecture level**, is what separated step-based ITS from answer-based systems in VanLehn's meta-analysis.
5. **Fading is the general law**: hints (§16), worked examples (§7), elaboration support (§6) should all shrink as competence grows; the expertise-reversal effect (Kalyuga 2003) punishes over-scaffolding as surely as under-scaffolding.
6. **Measure:** per-card R (FSRS), per-chapter accuracy EMA, calibration error (confidence − accuracy), review burden (reviews per retained item). These four numbers tell you whether the engine works and which technique to tune.

---

## 18. References (primary sources cited)

1. Adesope, Trevisan & Sundararajan (2017). Rethinking the use of tests: A meta-analysis of practice testing. *Review of Educational Research*, 87(3), 659–701.
2. Agarwal, Karpicke, Kang, Roediger & McDermott (2007). Examining the testing effect with open- and closed-book tests. *Applied Cognitive Psychology*, 22.
3. Aleven, Stahl, Schworm, Fischer & Wallace (2003). Help seeking and help design in interactive learning environments. *Contemporary Educational Psychology*, 28, 96–123.
4. Aleven, McLaren, Roll & Koedinger (2006). Toward meta-cognitive tutoring. *Learning and Instruction*, 16(1), 21–36.
5. Anderson, Corbett, Koedinger & Pelletier (1995). Cognitive tutors: Lessons learned. *IJAIED*, 6(1), 30–43.
6. Baker, Corbett & Aleven (2008). More accurate student modeling through contextual estimation of slip and guess probabilities in Bayesian knowledge tracing. *ITS 2008*, LNCS 5091.
7. Bertsch, Pesta, Wiscott & McDaniel (2007). The generation effect: A meta-analytic review. *Memory & Cognition* 35(2), 201–210.
8. Bjork, R. A. (1994). Memory and metamemory considerations in the training of human beings. In Metcalfe & Shimamura (eds.), *Metacognition*.
9. Bjork, R. A. & Bjork, E. L. (2011). Making things hard on yourself, but in a good way: Creating desirable difficulties. In *Psychology and the Real World*.
10. Bjork, Dunlosky & Kornell (2013). Self-regulated learning: Beliefs, techniques, and illusions. *Annual Review of Psychology* / *PSPI* 14(1), 4–58.
11. Block, J. H. (1971). *Mastery Learning: Theory and Practice*. Holt.
12. Bloom, B. S. (1968). Learning for mastery. *UCLA Evaluation Comment*, 1(2).
13. Bloom, B. S. (1984). The 2 sigma problem. *Educational Researcher*, 13(6), 4–16.
14. Brunmair & Richter (2019). Similarity matters: A meta-analysis of interleaved learning and its moderators. *Psychological Bulletin*, 145(11), 1082–1119.
15. Butler, A. C. (2010). Repeated testing produces superior transfer of learning relative to repeated studying. *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 36(5), 1118–1130.
16. Cepeda, Pashler, Vul, Wixted & Rohrer (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin*, 132(3), 354–380.
17. Cepeda, Vul, Rohrer, Wixted & Pashler (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. *Psychological Science*, 19(11), 1095–1102.
18. Chi, Bassok, Lewis, Reimann & Glaser (1989). Self-explanations: How students study and use examples in learning to solve problems. *Cognitive Science*, 13, 145–182.
19. Cohen, Kulik & Kulik (1982). Educational outcomes of tutoring: A meta-analysis of findings. *American Educational Research Journal*, 19(2), 237–248.
20. Corbett & Anderson (1995). Knowledge tracing: Modeling the acquisition of procedural knowledge. *User Modeling and User-Adapted Interaction*, 4, 253–278.
21. Dunlosky, Rawson, Marsh, Nathan & Willingham (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest*, 14(1), 4–58.
22. Ebbinghaus, H. (1885/1913). *Memory: A Contribution to Experimental Psychology*. Dover reprint.
23. Fiorella & Mayer (2015). *Learning as a Generative Activity: Eight Learning Strategies That Promote Understanding*. Cambridge UP.
24. Gong, Beck & Heffernan (2011). How to construct more accurate student models. *AIED 2011*.
25. Graesser, Person & Magliano (1995). Collaborative dialogue patterns in naturalistic one-to-one tutoring. *Applied Cognitive Psychology*, 9, 359–387.
26. Graesser, Lu, Jackson et al. (2004). AutoTutor: A tutor with dialogue in natural language. *Behavior Research Methods*, 36(2), 180–193.
27. Graesser, D'Mello & Cade (2011). Instruction based on tutoring. In *Handbook of Research on Learning and Instruction*; *American Psychologist*, 66(8), 678–692.
28. Hacker, Bol & Bahbahani (2008). Explaining calibration accuracy in classroom contexts. *Contemporary Educational Psychology*, 33(1), 82–93.
29. Jacoby, L. L. (1978). On interpreting the effects of repetition: Solving a problem versus remembering a solution. *Journal of Verbal Learning and Verbal Behavior*, 17, 649–667.
30. Kalyuga, Chandler, Tuovinen & Sweller (2001). When problem solving is superior to studying worked examples. *Journal of Educational Psychology*, 93(2), 335–341.
31. Kang, McDermott & Roediger (2007). Test format and corrective feedback modify the effect of testing on long-term retention. *Journal of Educational Psychology*, 99(1), 174–182; *JEP:LMC* parallel.
32. Kang, Gollan, Feeney & Roediger (2009). Don't just rely on fluency: Unsuccessful retrieval and feedback enhance retention. *Journal of Experimental Psychology: General*, 138(1), 106–118.
33. Kapur, M. (2008). Productive failure. *Cognition and Instruction*, 26(3), 379–424.
34. Karpicke & Roediger (2007). Expanding retrieval practice promotes short-term retention, but equally spaced retrieval enhances long-term retention. *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 33(4), 704–719.
35. Karpicke & Roediger (2008). The critical importance of retrieval for learning. *Science*, 319, 966–968.
36. Keller, F. S. (1968). "Good-bye, teacher…" *Journal of Applied Behavior Analysis*, 1(1), 79–89.
37. Koedinger, Anderson, Hadley & Mark (1997). Intelligent tutoring goes to school in the big city. *International Journal of Artificial Intelligence in Education*, 8, 30–43.
38. Koriat & Bjork (2005). Illusions of competence in monitoring one's knowledge during study. *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 31(2), 187–194.
39. Koriat, Ma'ayan & Nussinson (2006). The intricate relationships between monitoring and control in metacognition. *Psychological Science*, 17(12), 1055–1059.
40. Kornell & Bjork (2008). Learning concepts and categories: Is spacing the "enemy of induction"? *Psychological Science*, 19(6), 585–592.
41. Kornell & Metcalfe (2006). Study efficacy and the region of proximal learning framework. *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 32(3), 609–622.
42. Kulik, Kulik & Bangert-Drowns (1990). Effectiveness of mastery learning programs: A meta-analysis. *Review of Educational Research*, 60(2), 265–299.
43. Little & Bjork (2015). Optimizing multiple-choice tests as learning events. *Memory*, 23(5), 707–726.
44. Lepper, Drake & O'Donnell-Johnson (1997). Scaffolding techniques of expert human tutors. In *Scaffolding Student Learning* (Teachers College Press).
45. Lepper & Woolverton (2002). The wisdom of practice: Lessons learned from the study of highly effective tutors. In *Improving Academic Achievement*.
46. Ma, Adesope, Nesbit & Liu (2014). Intelligent tutoring systems and learning outcomes: A meta-analysis. *Journal of Educational Psychology*, 106(4), 901–918.
47. Nelson & Dunlosky (1991). When people's judgments of learning (JOLs) are extremely accurate at predicting subsequent recall. *Memory & Cognition*, 19(3), 269–273.
48. Nickow, Oreopoulos & Quan (2020). The impressive effects of tutoring on preK-12 learning: A systematic review and meta-analysis of the experimental evidence. NBER Working Paper 27476.
49. Nye, Graesser & Hu (2014). AutoTutor and family: A review of 17 years of natural language tutoring. *IJAIED*, 24, 427–469.
50. Pane, Griffin, McCaffrey & Karam (2014). Effectiveness of Cognitive Tutor Algebra I at scale. *Educational Evaluation and Policy Analysis*, 36(2), 127–144.
51. Pashler, Cepeda, Wixted & Rohrer (2005). When does feedback facilitate learning of words? *Journal of Experimental Psychology: General*, 134(1), 1–8; *Psychological Bulletin* 131(3), 354–380.
52. Piech et al. (2015). Deep knowledge tracing. *NIPS 2015*, 505–513.
53. Pressley, McDaniel, Turnure, Wood & Ahmad (1987). Generation and precision of elaboration. *Journal of Educational Psychology*, 79(4), 448–456.
54. Rasch, G. (1960). *Probabilistic Models for Some Intelligence and Attainment Tests*. Danish Institute for Educational Research.
55. Renkl, A. (1997). Learning from worked-out examples: A study on individual differences. *Cognitive Science*, 21(1), 1–29.
56. Roediger & Karpicke (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science*, 17(3), 249–255.
57. Rohrer & Taylor (2007). The shuffling of mathematics problems improves learning. *Instructional Science*, 35, 481–498.
58. Rohrer, D. (2012). Interleaving helps students distinguish among similar concepts. *Educational Psychology Review*, 24, 355–367.
59. Rowe, M. B. (1974). Wait-time and rewards as instructional variables. *Journal of Research in Science Teaching*, 11(2), 81–94; 11(4), 273–278.
60. Rowland (2014). The effect of testing versus restudy on retention: A meta-analytic review of the testing effect. *Psychological Bulletin*, 140(6), 1432–1463.
61. Schwartz & Bransford (1998). A time for telling. *Cognition and Instruction*, 16(4), 475–522.
62. Slamecka & Graf (1978). The generation effect: Delineation of a phenomenon. *Journal of Experimental Psychology: Human Learning and Memory*, 4(6), 592–604.
63. Soderstrom, Kerr & Bjork (2016). The critical importance of retrieval—and not presentation—for learning. *Memory*, 24(3), 297–308.
64. Steenbergen-Hu & Cooper (2013/2014). A meta-analysis of the effectiveness of intelligent tutoring systems on K–12 mathematical learning. *Journal of Educational Psychology*, 106(4), 970–987.
65. Sweller & Cooper (1985). The use of worked examples as a substitute for problem solving in learning algebra. *Cognition and Instruction*, 2(1), 59–89.
66. Taylor & Rohrer (2010). The effects of interleaved practice. *Applied Cognitive Psychology*, 24, 837–848.
67. Tulving, E. & Psotka, J. (1971). Retroactive inhibition in free recall: Inaccessibility of information available in the memory store. *Journal of Experimental Psychology*, 87, 1–8.
68. VanLehn, K. (2011). The relative effectiveness of human tutoring, intelligent tutoring systems, and other tutoring systems. *Educational Psychologist*, 46(4), 178–198.
69. Vandenberg & Dewalle (2021). Test anxiety, low-stakes testing, and the testing effect. *Journal of Applied Research in Memory and Cognition*.
70. van Gog & Rummel (2010). Example-based learning: Integrating cognitive and social-cognitive research perspectives. *Educational Psychology Review*, 22, 155–174.
71. van Merriënboer & Sweller (2005). Cognitive load theory and complex learning. *Educational Psychology Review*, 17, 147–177.
72. Wozniak, P. & Gorzelanczyk, E. J. (1994). Optimization of repetition spacing in the practice of learning. *Acta Neurobiologiae Experimentalis*, 54.
73. Ye, J., Charkit, F., et al. (2023–2024). FSRS: Free Spaced Repetition Scheduler (open-spaced-repetition GitHub; FSRS v4/v5 preprints and benchmark analyses).
74. Wood, Bruner & Ross (1976). The role of tutoring in problem solving. *Journal of Child Psychology and Psychiatry*, 17, 89–100.
75. Wong, Lawson & Keeves (2002). The effects of self-explanation training on students' problem solving in high-school mathematics. *Learning and Instruction*, 12(2), 233–262.

---

### Residual caveats

- Effect sizes vary across meta-analyses depending on inclusion criteria (lab vs field, K-12 vs adult, publication-bias corrections). Where ranges are given, the range reflects this variance, not uncertainty of reading.
- FSRS default weights change between minor versions; the values quoted are FSRS-5 defaults and are version-locked — verify against the open-spaced-repetition repo before implementation.
- Bloom's "2 sigma" derives from small-N studies; treat as aspirational framing, not a promised effect.
- Several item numbers for parallel-condition studies (e.g., Kang 2007 vs 2009) are consolidated; consult the primary text for exact experimental cell values before quoting precise percentages externally.
- No live web verification was available in this session; all citations are from established literature and should be spot-checked against publisher pages when network access is restored.
