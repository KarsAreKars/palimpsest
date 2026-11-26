# AXIOM_PSYCHOLOGY — The Psychology of the Blocked Learner

**Author:** RESEARCHER L2 (motivational / affective / identity psychology)
**Scope:** Why infinite resources do not produce learning. LEARNING_SCIENCE.md owns the
cognitive side (retrieval, spacing, load, modeling). This document owns the other half:
the motivational, emotional, identity, and social machinery that decides whether a
learner *engages* at all — and that fails long before the techniques in the other file
get a chance to matter. Every claim is labeled per campaign convention:
[established] = replicated science · [contested] = real, unresolved debate ·
[tradition] = long practice, thin science · [fiction] = truth unmanifested ·
[speculative] = our synthesis.
**Status:** Draft v1. Effect sizes are reported as in the primary sources.
**Date:** 2026-11-26

---

## 0. Executive Summary

The founding question of the campaign is: resources are infinite, access is free, AI
can explain anything — why isn't learning easy? The answer from this lane, stated in
one sentence: **because learning is not an information problem; it is a psychological
transaction, and information abundance changed nothing about the terms of that
transaction.** Learning is purchased with a currency the learner mints internally:
attention, tolerance for error, willingness to feel stupid in front of something,
energy to care. When that wallet is empty, every free library in the world is useless.

Eleven literatures converge on this, and they converge remarkably tightly:

1. **Self-determination theory** — motivation dies when the three basic needs
   (autonomy, competence, relatedness) are violated, and most "learning systems"
   violate all three by design.
2. **Flow** — engagement exists only inside a narrow challenge/skill channel; boredom
   and anxiety are the twin defaults of self-directed learning.
3. **Self-efficacy (Bandura)** — the learner's *belief* in ability is one of the best
   predictors of learning, and it is built almost entirely from early mastery
   experiences, not from information.
4. **The affective filter (Krashen)** — anxiety gates input. [contested] as a theory,
   [established] as a finding.
5. **Identity-based motivation** — "I'm not a math person" is not an excuse; it is a
   self-fulfilling ceiling that changes what the brain will even attempt.
6. **Growth mindset (Dweck)** — real, directionally correct, and far smaller and more
   fragile than the pop version. Honest numbers inside.
7. **The protégé effect** — explaining to another mind is one of the strongest known
   learning multipliers, and it requires zero new content.
8. **Psychological safety** — the cost of being wrong in public is the hidden tax on
   every classroom ever built.
9. **Play (Huizinga, Vygotsky)** — play is the oldest, most natural learning mode, and
   everything about it is engineered out of schooling.
10. **Polya's metacognition** — how-to-learn is a teachable, explicit skill, and most
    learners have never been taught it.
11. **The emotional cost of being bad at something** — the shame, frustration, and
    self-consciousness of the beginner. Our candidate for the single biggest blocker.

Each section below gives: the mechanism, the evidence strength (honestly, including
the replication caveats), and the implication for a machine tutor that wants to make
learning "easy as shit." Section 13 synthesizes; Section 14 extracts the axioms.

---

## 1. The Inverted Bottleneck

Before the individual theories, the framing observation that this whole document
exists to explain:

- Information was the binding constraint on learning for most of human history.
  Books, teachers, and libraries were scarce and expensive. The entire *design* of
  education was built around rationing: admissions, curricula, prerequisites,
  semesters, grades as allocation signals. [established — institutional history]
- That constraint is gone. Khan Academy, Wikipedia, arXiv, YouTube, and now LLMs that
  will explain anything at any level, forever, for free, instantly, without
  impatience.
- Learning outcomes did not collapse to "easy." Self-directed completion rates for
  free online courses famously sit near **~10%** (Jordan 2013, HarvardX/MITx data
  analysis) — and that's counting click-through, not mastery. MOOC research
  consistently shows the dominant predictor of completion is prior education — the
  people who need free learning least use it most. [established]
- Therefore the bottleneck moved. It moved from *supply of explanation* to
  *willingness to engage, sustain, and return*. That is a psychological bottleneck.

**The structural claim of this document [speculative]:** every free resource asks the
learner to pay in four internal currencies the resource cannot supply:

1. **Attention** — sustained focus in a world engineered to harvest it.
2. **Error cost** — the felt cost of being wrong, of trying and failing.
3. **Identity cost** — the threat a new skill poses to "who I am" (a beginner is,
   definitionally, someone who is not yet the person they are studying to become).
4. **Loneliness cost** — learning alone removes every social scaffold that sustained
   millennia of apprenticeship.

A machine tutor can, in principle, underwrite all four currencies. That is the entire
design brief for the rest of this document.

---

## 2. Self-Determination Theory (Deci & Ryan) — Motivation Dies When Needs Are Violated

### The mechanism

Ryan & Deci's self-determination theory (SDT) proposes that humans have three innate,
universal psychological needs — **autonomy** (I choose; my behavior is self-endorsed),
**competence** (I am effective; I am growing capable), and **relatedness** (I matter
to others; I belong) — and that motivation, engagement, and well-being collapse when
environments thwart them. The taxonomy of motivation matters:

- **Amotivation** — no intention to act; "why bother."
- **External regulation** — act for reward/punishment (grades, money, shame).
- **Introjected regulation** — act to avoid guilt, gain ego (internal pressure).
- **Identified regulation** — act because the goal is personally valued.
- **Integrated regulation** — act because it is fully self-congruent.
- **Intrinsic motivation** — act because the act itself is rewarding (the flow /
  play end of the continuum).

The continuum runs from external → internal. **The more externally regulated the
reason, the more fragile and poorer-quality the learning**: less persistence, less
deep processing, less transfer, more dropout when the external contingency is removed
(Ryan & Deci 2000, American Psychologist). Two specific SDT findings are directly
load-bearing for a tutor:

1. **Tangible, expected, contingent extrinsic rewards reliably *undermine* intrinsic
   motivation for the rewarded task** (Deci, Koestner & Ryan 1999 meta-analysis,
   d ≈ −0.25 for expected tangible rewards; the effect is small but highly
   replicable across 128 experiments). [established] A counter-meta (Cameron & Pierce
   1994) argues rewards are benign for performance; the debate persists, but the
   *motivational* undermining finding has held up far better than the "rewards are
   fine" side. [contested in detail, established in direction]
2. **Choice supports motivation** — Patall, Cooper & Robinson (2008) meta-analysis:
   choice effects on intrinsic motivation and task performance d ≈ +0.34.
   [established] But choice-without-structure can overload; autonomy support means
   meaningful options, not abandonment (Reeve et al. 1999 on autonomy-supportive
   teaching).

A third finding worth flagging: **intrinsic motivation for school declines steadily
across schooling years** (Gottfried, Marcoulides & Gottfried 2001, ages 9–17;
Lepper, Corpus & Iyengar 2005). Whatever schools are doing, the natural learning
appetite gets *drained* by it — and the drain is precisely the things SDT predicts:
controlling evaluation, zero autonomy, and competence feedback that is comparative
and judgmental. When adults say "I'm just not a learning person anymore," that is
not a personality fact; it is SDT damage in a person. [established for the decline;
speculative for the causal attribution]

### Evidence strength

Strong. SDT is one of the most-tested frameworks in motivational psychology, with
meta-analytic support for need satisfaction predicting engagement and well-being
(Vansteenkiste & Ryan 2013; see also the Deci, Olafsen & Ryan 2017 BPNT review).
Critiques exist (measurement circularity concerns — how "needs" are operationalized
vs. the outcomes they predict), but the practical findings — rewards undermine,
choice supports, control thwarts — are robust. [established, with meta-level
grumbles]

### Implication for the machine tutor

This is the single most design-relevant framework in this document:

- **No extrinsic reward machinery.** No points-for-doing, no streak-threats ("don't
  lose your streak!" is an external contingency, i.e., a controller), no leaderboards,
  no badges as bribes. If the tutor gamifies, it must do so by making the learning
  itself more intrinsically rewarding (see play, §9), not by stapling Skinner-box
  currency onto it. [established → hard design rule]
- **Choice is first-class:** the learner chooses what to learn, when, at what depth,
  in what order, with what goal. The tutor's job is to make any choice good and any
  path coherent — to supply structure as *scaffolding*, not as *schedule*.
- **Feedback is informational, never evaluative.** The distinction is exact: "this
  answer shows the model conflates X and Y — here's the gap" (informational, feeds
  competence) vs. "wrong! 62%. Try again." (evaluative, feeds pressure).
- **Never decide for the learner without leaving the choice visible.** Even a
  perfect adaptive recommendation should be phrased as a strong option among
  real options, not a push notification of obligation.
- Relatedness: the tutor should behave as a *person-who-cares* (see §7, protégé
  effect, §10) because relatedness is a need, and a lonely learner with infinite
  resources still has no one to learn *for*.

---

## 3. Flow (Csikszentmihalyi) — Engagement Lives Inside a Narrow Channel

### The mechanism

Csikszentmihalyi's flow research (1975, *Beyond Boredom and Anxiety*; 1990, *Flow*)
began with a puzzle: why do people describe their *best moments* — rock climbers,
chess players, surgeons, dancers — as moments of hard effort, not relaxation? The
answer: **deep engagement requires the challenge of the activity to be matched to the
person's skill.** Too easy → boredom → disengagement. Too hard → anxiety → retreat.
Between them lies the **flow channel**, where the task stretches the skill by exactly
a reachable amount.

The eight phenomenological components of flow (Csikszentmihalyi 1990):
1. Clear goals (you know what "done" means right now).
2. Immediate, unambiguous feedback (you can tell how you're doing *now*).
3. Challenge–skill balance (the stretch is reachable).
4. Concentration on the task (distraction falls away).
5. Paradox of control (effortless sense of agency).
6. Loss of self-consciousness (the inner critic goes quiet).
7. Altered time sense.
8. Autotelic experience — the activity is the reward.

Note, for the axioms later: components 4 and 6 say that **flow is the suspension of
exactly the psychological taxes this document catalogs** — self-monitoring, shame,
identity worry. Flow is what learning feels like when the tax collector is off duty.

### Evidence strength

As a descriptive phenomenology, strong: experience-sampling studies repeatedly
recover the flow state and its association with engagement and well-being.
As a prescriptive theory, two honest caveats:
- **The challenge–skill balance is surprisingly hard to pin down empirically.**
  Some ESM work finds flow tracks *perceived* challenge and skill with the balance
  relationship weaker than the diagram suggests (Hektner, Schmidt & Csikszentmihalyi
  2007; Fong et al. 2014). [contested in exact form]
- **Flow measures are mostly self-report** (Flow State Scale, Jackson & Marsh 1996;
  game-flow questionnaire, Sweetser & Wyeth 2005). Self-report of absorption is fine
  for research, but a tutor will want behavioral proxies (error rate, pacing, return
  rate) rather than a "rate your flow" slider. [established that the state exists;
  contested that we can measure it cleanly from outside]

The challenge–skill channel itself is corroborated from a completely different
direction: adaptive tutoring systems converge empirically on holding learners in
a high-success band (Corbett & Anderson's Cognitive Tutor targeted ~90% success on
tutored steps, grounded in ACT-R practice; Khan Academy-style mastery targeting
similarly). Band ~70–85% success keeps learners neither bored nor panicked; games do
the same. [established as engineering practice]

### Implication for the machine tutor

- **The tutor's core control loop is a difficulty controller, not a content
  database.** Content is infinite and free; the scarce thing the tutor adds is holding
  the learner inside the channel. Success rate is the feedback signal: too high →
  raise challenge; too low → scaffold. [established]
- **Segment goals into immediately visible slices.** Flow needs "clear goals *now*,"
  not "finish chapter 7." Every unit of tutor interaction should end in a legible
  done/not-done.
- **Feedback must be immediate and unambiguous** — which also happens to be what
  retrieval-with-feedback research wants (LEARNING_SCIENCE §1). Motivation science and
  cognitive science agree on this one.
- **Boredom and anxiety are the two failure modes of self-directed learning**, and
  infinite resources make both *worse*: with a library of 10,000 courses, the bored
  learner switches tabs and the anxious learner never clicks. The tutor must detect
  and correct drift toward either pole fast, because no resource shortage will do it
  for the learner anymore.
- Flow is the target *experience*; the axioms in §14 will make it the tutor's
  north star.

---

## 4. Self-Efficacy (Bandura) — Belief Precedes Ability

### The mechanism

Bandura's self-efficacy theory (1977, *Psychological Review*; 1997, the definitive
monograph): **what a person believes they can do is a better predictor of what they
will do and achieve than what they can actually do** — because belief gates the
attempts that build ability. Self-efficacy theory is not "positive thinking."
Bandura was explicit that efficacy belief is built from evidence, through four
sources, in strict order of strength:

1. **Mastery experiences** — succeeding at something you weren't sure you could do.
   The single strongest source. Not success-by-lowering-the-bar (that builds nothing),
   but success at a *genuine* challenge slightly above comfortable.
2. **Vicarious experience** — seeing someone like me succeed. "Someone like me" is
   load-bearing: a guru's success is evidence about gurus, not about me.
3. **Verbal/social persuasion** — being told "you can do this." Real but weak and
   fragile; persuasion without a supporting mastery ladder collapses under the first
   failure.
4. **Physiological/affective states** — anxiety read as incapacity. A racing heart
   before the math exam gets interpreted as "I can't do math," and the interpretation
   feeds the next avoidance.

The loop: efficacy → choice of challenge, effort expenditure, persistence under
difficulty, and resilience after failure → new mastery evidence → efficacy. And the
reverse loop: low efficacy → avoidance of challenge → no new evidence → lower
efficacy. **Self-efficacy is therefore a compounding asset with a direction.**
Learners in the negative loop are precisely the ones free resources can't reach.

Crucially, self-efficacy predicts even after ability is controlled: Multon, Brown &
Lent (1991) meta-analysis, correlation of self-efficacy with academic performance
**r ≈ .38** across 39 studies; Stajkovic & Luthans (1998) find d ≈ .38 with work
performance. In intervention work, Schunk (1991, and many micro-studies) shows
short, mastery-sequenced tasks with attributional feedback reliably raise both
self-efficacy and achievement in children — the efficacy ladder is *buildable*.

### Evidence strength

[established] for the construct and its predictive power; the four sources are
well-supported, with mastery dominance robust. Boundary conditions: effects are
domain-specific (math efficacy ≠ reading efficacy); over-efficacy miscalibrates
metacognition (LEARNING_SCIENCE §13 territory); self-efficacy is not self-esteem,
and global praise programs (self-esteem education) failed precisely because they
tried to pour persuasion into a container without mastery evidence.

### Implication for the machine tutor

- **The tutor's sequencing is an efficacy ladder before it is a curriculum.** Order
  material so the learner can *succeed forward* — each rung a genuine but reachable
  challenge, each success legible to the learner ("you just did the thing you
  couldn't do an hour ago"). [established]
- **Keep a visible win-history.** Efficacy feeds on evidence of progress; the
  learner forgets their own rungs. A ledger of "things you now can do that you
  couldn't" is literally a self-efficacy battery. (This is one of the concrete
  Palimpsest mechanisms the synthesis maps to.)
- **Never fake the ladder.** Lowering the bar or congratulating mediocrity is Bandura
  source #3 without source #1 — it collapses on first contact with reality, and it
  destroys the tutor's credibility, which is the tutor's only real asset.
- **Vicarious design:** worked examples featuring "someone like the learner" (the
  other doc covers worked examples cognitively; here they double as efficacy
  evidence — see a near-peer succeed).
- **Read the affective signal:** when a learner's physiology-level anxiety is high
  (rushed, abandoning mid-attempt), the tutor should downgrade difficulty *and name
  why*, converting a threat signal into information.

---

## 5. The Affective Filter (Krashen) — Anxiety Gates Input

### The mechanism

Krashen's Input Hypothesis model (1981–1985, *Second Language Acquisition and Second
Language Learning*; *The Input Hypothesis* 1985) proposed the **affective filter**: a
metaphorical barrier that rises with anxiety, low motivation, and low self-confidence
and blocks comprehensible input from reaching the language-acquisition apparatus.
The famous claim: an anxious learner exposed to perfect, appropriate input learns
*less* than a relaxed learner exposed to the same input — the input never "gets in."

Honest assessment requires splitting the package:

- The **monitor model as a whole** is not well supported — Krashen's core
  "acquisition vs. learning" distinction and the strong input-is-sufficient claim
  have been sharply criticized (Gregg 1984 is the classic demolition; SLA research
  since has largely moved on). [contested, trending toward rejected as theory]
- The **affective filter component, however, describes something real** that exists
  robustly outside Krashen's framework:
  - **Foreign language anxiety** is a measurable, reliable, negatively correlated
    construct (Horwitz, Horwitz & Cope 1986; meta-analyses find anxiety–achievement
    correlations around r ≈ −.30 to −.50). [established]
  - **Test anxiety** — Hembree (1988) meta-analysis: correlation with performance
    around −.45; anxiety treatments improve performance (ω ≈ .4). [established]
  - **Mechanism: anxiety consumes working memory.** Eysenck's attentional control
    theory (Eysenck et al. 2007, Emotion): worry is a cognitive load with no
    instructional value; it taxes exactly the executive resources learning needs.
    This gives Krashen's metaphor a cognitive chassis. [established]

So: anxiety doesn't just make learning *feel* bad; it occupies the hardware.
The filter is a WM thief. When a learner is anxious, the tutor is speaking to a
processor that is already busy.

### Evidence strength

[contested] as named theory (the filter is unfalsifiable as originally stated —
a latent barrier that explains failure by postulation). [established] as empirical
finding (anxiety impairs performance via working-memory competition) in test-anxiety,
SLA, and cognitive-load literatures independently. The tutor-relevant content is the
[established] part.

### Implication for the machine tutor

- **Privacy is a learning feature, not a UX nicety.** A one-to-one machine tutor has
  a structural superpower no classroom can match: there is no audience. Wrong answers
  are never witnessed, never recorded for judgment, never compared. Keep it that way
  by default: no social comparison, no public failure states, no third-party
  observation of the struggle. This is the affective filter lowered by architecture.
- **One-on-one itself is the intervention.** The 2-sigma tutoring result (Bloom 1984,
  cross-referenced in LEARNING_SCIENCE §8) has a motivational half-explanation: a
  private, patient, non-judging tutor removes the class anxiety that filters
  everything else. [established directionally; the apportionment between cognitive
  and affective causes of 2-sigma is unresolved]
- **De-catastrophize errors in language and pacing.** An error response should lower
  tension ("this is the interesting part"), never raise it (no red X's, no scores
  before explanations, no countdown timers).
- **Do not attempt to *use* anxiety as fuel.** Some performance cultures run on
  fear; the evidence says the fuel contaminates the engine (introjection, §2) and
  works only for already-efficacious learners. The tutor never plays the role of
  the intimidating examiner — that role is already played, loudly, everywhere else
  in the learner's life.

---

## 6. Identity & Learning — "I'm Not a Math Person" Is a Self-Fulfilling Ceiling

### The mechanism

Daphna Oyserman's **identity-based motivation (IBM)** theory (Oyserman 2007, 2015;
building on Markus & Nurius's "possible selves," 1986) supplies the missing mechanism
behind every "I'm not a math/writing/programming person":

- Identity is not just a self-description; it is a **procedure** that runs on
  behavior. When a situation is interpreted as identity-congruent, people engage,
  persist, and find meaning in difficulty. When interpreted as identity-incongruent,
  they disengage — even when engagement would objectively benefit them.
- **Difficulty interpretation** is the key IBM finding: the same hard problem is
  read as "this is important, this is what people like me do" *or* as "this is not
  for me," depending on which identity is cued. [established experimentally]
- **Possible selves** (Markus & Nurius 1986): the self-images of "who I could
  become" organize current effort. A vivid, plausible, *owned* image of a future
  competent self is fuel; an absent or negative one removes the point of trying.
- Identity interventions work in the field: Oyserman, Bybee & Terry (2006;
  Oyserman et al. 2009) randomized school-based trials where students connected
  schoolwork to their self-images produced improved grades and school behavior —
  effects that persisted months later. [established for school contexts]

Related findings:

- **Stereotype threat** (Steele & Aronson 1995): cueing a negative group stereotype
  depresses performance. Its replication record is genuinely troubled
  (publication bias and small-effect controversies; see the 2016 meta-analytic
  reassessment, Flore & Wicherts 2015 finding publication bias). [contested] —
  but the *identity-matters* umbrella finding stands on the IBM evidence even if
  this specific mechanism is smaller than once thought.
- The **"math person" myth** is culturally specific and empirically false: ability
  in math is normally distributed practice-sensitive skill, and the belief in a
  "math gene" itself does measurable damage (fixed-trait talk correlates with
  giving up — this is the Dweck connection, §7).

The compounding structure mirrors §4: identity → interpretation of difficulty →
engagement → evidence → identity. The ceiling is installed by a handful of early
experiences and a surrounding culture that hands out trait-labels ("gifted," "bad
at languages"), and thereafter the learner self-enforces it.

### Evidence strength

[established] for identity-based motivation as a framework and its difficulty-
interpretation experiments; [established] for school-based identity intervention
trials; [contested] for stereotype threat magnitude. The "self-fulfilling ceiling"
as applied to adults returning to learning is our synthesis [speculative], but it is
a straightforward composition of IBM + Bandura + SDT, each of which is established.

### Implication for the machine tutor

- **The tutor is an identity scaffold before it is a content pipeline.** The single
  most valuable question the tutor can ask is not "what do you want to learn?" but
  **"who do you want to become?"** — and then route content as evidence toward that
  self-image. [speculative but strongly implied]
- **Engineer identity-congruent difficulty.** When the learner struggles, the tutor's
  framing choice is exactly IBM's fork: "this is hard, maybe it's not for you" (never
  say anything in this family) vs. "this is hard, and people who become X hit exactly
  this wall" (the difficulty is re-cued as *evidence of the identity forming*).
- **Kill trait-labels inside the product.** No "aptitude scores," no "you're a visual
  learner" type-ology boxes, no percentile ranks. Labels are identity installation;
  the tutor should install only identities the learner chose.
- **Progress as identity narrative:** "three weeks ago you couldn't read a single
  line of this; yesterday you explained it to me" (see protégé effect, §7) is a
  possible-self update in sentence form.
- **Respect existing identities the learner values.** Learning that threatens a
  valued self-image (e.g., an adult engineer "going back to basics") needs explicit
  dignity-preserving framing — the beginner status must be reframed as the
  *strongest* version of who they already are.

---

## 7. Growth Mindset (Dweck) — Real, Small, and Fragile (Stated Honestly)

### The mechanism

Carol Dweck's research program (Dweck 2006, *Mindset*; Dweck & Molden on achievement
goals) distinguishes **fixed mindset** (abilities are traits; difficulty = verdict)
from **growth mindset** (abilities are developable; difficulty = information).
Two mechanisms:

1. **Goals re-orient.** Fixed-mindset learners pick performance goals (look smart,
   avoid looking dumb); growth-mindset learners pick learning goals (get better).
   Performance-avoidance goals are poison: they make the learner hide ignorance,
   avoid challenge, and fold after failure (Dweck & Molden 2005).
2. **Attributions re-route effort.** Failure attributed to lack of ability → shame →
   withdrawal. Failure attributed to strategy/effort → adjustment → retry. The mindset
   is mostly a downstream story about what failure *means*.

### The honest evidence picture

This is where the pop version must be corrected, because the campaign labels
honestly:

- **Correlational link mindset↔achievement exists but is small:** Sisk et al. (2018,
  Psychological Bulletin) meta-analysis: r ≈ **.10**. [established]
- **Interventions show small average effects, with the usual hype-cycle structure:**
  Burnette et al. (2013) meta found d ≈ .34, but included many uncontrolled studies.
  Better-controlled work is smaller. [established that average effects are modest]
- **The flagship modern study** — Yeager et al. (2019, *Nature*; national US sample,
  ~12,000 adolescents, low-cost self-administered mindset module): overall effect on
  GPA **d ≈ 0.10**, rising to **d ≈ 0.25** among low-achieving students, plus an
  increase in advanced math enrollment among low-achievers. [established — and it is
  the strongest single finding, and it is *small*]
- **Replication is fragile:** the pre-registered UK adolescent replication (Li & Bates
  2019, of the closely related Yeager et al. 2016 implicit-theories-of-intelligence
  intervention) failed to find the GPA effect; Macnamara & Burgoyne (2023) find small,
  inconsistent effects when methodological quality is high; a 2024 meta-analysis
  (Burnette et al.) reasserts modest robustness with moderation. [contested]
- **Mechanism fragility:** mindset interventions work best where (a) the learner
  holds damaging fixed beliefs to begin with, (b) the environment gives them
  opportunities to act on the new belief, and (c) the intervention doesn't preach
  slogans. Preaching "you can do anything!" to a supported, already-mastery-rich
  learner does nothing or backfires (felt as condescension). [established]

**Balanced verdict [speculative synthesis]:** growth mindset is best understood not
as a standalone "unlock" but as the *belief layer* that makes the rest of the
machine in this document (mastery ladders, flow, safe error) usable. Its effect
through direct intervention is small; its effect as an *environmental condition the
tutor maintains* — honest difficulty, effort-attributed feedback, zero trait-talk —
may be larger, and is cheaper. [speculative, but well-aligned with IBM §6 and
attribution research, which are more robust]

### Implication for the machine tutor

- **Don't run mindset interventions.** No "believe in yourself" modules, no
  neuroscience-posters ("neuroplasticity!"). [established that slogan-pushing is the
  weakest version of this literature]
- **Maintain a growth-*consistent environment*** and let the belief be induced by
  evidence: effort-attributed feedback ("the strategy missed, not you"), explicit
  error-normalization ("this exact error is what everyone hits here"), zero fixed
  trait language anywhere in the product. [established as environment effect]
- **Normalize difficulty with data, not pep.** "Everyone is confused here; this is
  the wall at this level; here is the specific move that gets people past it" is an
  attribution intervention disguised as information. It survives replication far
  better than cheerleading.
- **Exploit the one robust moderator:** invest effort where the learner's fixed
  beliefs are doing active damage (math, "not creative," adult re-entries) and be
  content with the small-but-real d ≈ .1–.25 zone.

---

## 8. The Protégé Effect — Learning by Teaching

### The mechanism

**The protégé effect:** people preparing to teach, or teaching, learn the material
more deeply than people studying for a test. Mechanisms, all supported:

1. **Generative processing** — teaching forces organization, selection, and
   elaboration (Fiorella & Mayer 2013, 2014: "learning by teaching" is a generative
   activity; explaining beats restudy, with the *quality of the explanation*
   mediating the gain). [established]
2. **Accountability / audience** — an expectant audience raises the stakes of
   understanding (Bargh & Schul 1980: expecting to teach improved comprehension
   even without teaching). [established, small n classic]
3. **Explanation gaps surface** — you discover you don't understand the moment the
   imaginary student's question hits the seam (self-explanation effect, Chi et al.
   1989/1994; related to Feynman elaboration, LEARNING_SCIENCE §6). [established]
4. **Teachable agents** — even *simulated* students produce the effect: Chase et al.
   (2009) and the Betty's Brain line of work show learning gains from teaching an
   agent, attributed to preparing to teach and monitoring the agent's model.
   [established in that literature]

Meta-analytic: Kobayashi (2019) meta-analysis of learning-by-teaching effects finds
moderate gains, with larger effects for teaching with explanation preparation vs.
mere expectation. Effect sizes vary widely (d ≈ 0.2–0.8 depending on design); the
consistent qualitative result is that teaching deepens *understanding* especially.

### Evidence strength

[established] as a phenomenon; the mechanisms are reasonably well-distinguished
(generation vs. preparation vs. audience). Note the two-sidedness for identity:
teaching also confers a *status* — the learner is, briefly, the competent one —
which is an IBM (§6) and self-efficacy (§4) event, not just a cognitive one. The
status component is under-measured in the cognitive literature; we flag it
[speculative] but it's hard to imagine it's absent.

### Implication for the machine tutor

- **The tutor should regularly become the student.** "Explain it back to me as if
  I'm new to this" should be a first-class review mode, positioned above quizzes in
  the hierarchy of evidence-of-learning. The tutor plays a naive-but-persistent
  student, asks the seams-opening follow-up question, and — critically — *believes
  the learner* ("oh, that makes sense now"), supplying the status reward of §6/§4.
- **Prepare-to-teach framing for hard material:** "in two sessions I'm going to ask
  you to teach this to me" is a cheap, zero-content intervention that Bargh & Schul
  show changes how the learner reads. [established]
- **The tutor's persistent memory enables a beautiful loop:** the learner can
  literally teach their *past self's* recorded confusions. "You struggled with X
  three weeks ago — explain to past-you what you'd tell them now." The learner meets
  the vicarious "someone like me" (§4) in their own history. [speculative; this
  is one of our favorite syntheses in this document]
- Guardrail: teaching mode requires psychological safety (§10) to work — explaining
  badly to a judgmental audience is the affective filter at full throttle. The tutor
  must receive flawed explanations the way a kind student would: curious, not
  corrective-first.

---

## 9. Play (Huizinga, Vygotsky) — The Oldest Learning Mode

### The mechanism

Johan Huizinga's *Homo Ludens* (1938) defined play by formal properties: play is
**voluntary**, **bounded** (a separate "magic circle" apart from ordinary life),
**rule-governed**, **uncertain in outcome**, **unproductive** in the immediate sense,
and **utterly absorbing** — the player is *inside* it. Roger Caillois (1958) added
the paidia↔ludus spectrum (free improvisation ↔ rule-bound competition). The
pedagogical insight from the formalists: play is *by definition* a low-stakes
uncertain-outcome activity that recruits full engagement — which is a nearly exact
description of what §3 (flow) and §10 (safety) jointly require.

The developmental mechanism came from Vygotsky (1933, "Play and its role in the
development of the child," and *Mind in Society*):

- **"In play, a child is always above his average age, above his daily behavior; in
  play it is as though he were a head taller than himself."** Play creates the zone
  of proximal development: within the magic circle, the child operates *as if* the
  competence were already present, and the "as if" rehearses it into reality.
- Play also teaches **delayed motivation** — the child acts from meaning inside the
  game rather than the immediate stimulus — i.e., play is intrinsically-motivated
  behavior school, and it is self-taught.

Modern evidence: playful learning research (Zosh et al. 2018, *The Power of Play*
review) converges on characteristics that make play educational: active engagement,
meaningfulness, social interaction, iteration, and joy — with associated gains in
executive function, language, math, and socio-emotional skills; school-readiness
program comparisons (e.g., Tools of the Mind vs. control curricula) show play-heavy
designs competing or winning on academic measures. Video-game learning research (Gee
2003, *What Video Games Have to Teach Us about Learning and Literacy*; cross-ref
L4 lane) repeatedly finds that well-designed games achieve — accidentally — the
exact conditions schooling fails: instant failure-without-stigma, calibrated
challenge ladders, clear goals, identity play ("become the assassin/mage/engineer"),
and flow. [established that the conditions exist in good games; the mapping to
declarative learning is our [speculative] synthesis]

### Evidence strength

Play's *formal properties* [tradition]-adjacent (Huizinga is a historian, not an
experimentalist), but the properties are remarkably congruent with SDT/flow/safety
science. Play's *educational* effects: [established] for early-childhood domains
(language, EF, social), [contested] for direct effect sizes on academic achievement
in older learners — adult play-based learning studies are thinner. Games: [established]
engagement, [speculative] transfer to non-game learning.

### Implication for the machine tutor

- **Build the magic circle explicitly.** A bounded, voluntary, "apart from real
  life" learning space — a place where attempts don't count in the real world — is
  the play-formalist answer to the affective filter and psychological safety at
  once. The tutor's sandbox is the circle; the learner enters by choice; what
  happens inside carries no transcript to the outside world.
- **Failure must be cheap and even fun.** A well-designed game makes death
  interesting ("what killed me? let's see"). A well-designed tutor makes error
  *diagnosis* the game: every wrong answer is a clue, the postmortem is the
  interesting part. [speculative synthesis]
- **Identity play:** games let you *become* someone. Let the learner try on the
  identity they're studying toward inside the circle (the "as if" competence,
  Vygotsky) before they must claim it outside. This directly operationalizes §6.
- **Voluntariness is a floor condition of play** — which restates §2's autonomy rule
  from the play side. A tutor that coerces play has built a workbook with cartoons.
- **Juice the iteration loop:** play is re-attempt without shame. Fast undo, fast
  retry, "one more run" energy is the behavioral signature the difficulty controller
  should optimize for (§3).

---

## 10. Psychological Safety — The Cost of Being Wrong in Public

### The mechanism

Amy Edmondson's research (1999, *Administrative Science Quarterly*; 2018, *The
Fearless Organization*) defined **team psychological safety** as "a shared belief
that the team is safe for interpersonal risk-taking," and showed it predicts
learning behavior in teams: people who fear humiliation hide errors, don't ask
questions, and stop experimenting; teams that can't afford to be wrong can't learn.
The transfer to education is direct and empirically supported:

- **Error climate research** (Steuer, Rosentritt-Brunn & Dresel 2013, 2016, German
  math-classroom studies): classes differ in "error climate" — whether errors are
  treated as learning opportunities or as something shameful — and a positive error
  climate predicts adaptive error handling and achievement, over and above individual
  fear of mistakes. [established in that literature]
- **Question-suppression:** the classic classroom finding that students — especially
  the ones most confused — almost never ask the questions they most need answered,
  because asking reveals ignorance to the exact audience that grades them (and
  peers). The confused stay confused, publicly silent. [established as robust
  observational phenomenon; the asking-and-learning causal chain is our [speculative]
  but near-obvious inference]
- **Impostor phenomenon** (Clance & Imes 1978; Clance 1985): high-achieving
  individuals who experience achievements as fraud and live in fear of exposure —
  a documented pattern disproportionately present in people entering fields where
  they lack the "native" identity (§6). [established as a measurable, widespread
  experience; underlying structure debated]
- **Embarrassment research** (Miller 1996, social psychology of embarrassment): the
  emotion is specifically *social exposure* — people endure physical pain more
  readily than public idiocy, and will distort behavior drastically to avoid being
  seen failing. [established as emotion science]

The deep structure: **most of the cost of error lives in the *audience*, not the
error.** The same wrong answer that teaches in private corrodes in public. This is
why the classroom — one teacher grading thirty students in front of thirty peers —
is a psychological-safety catastrophe by construction, and why the tutoring dyad,
even with an imperfect tutor, wins before content quality is compared.

### Evidence strength

[established] as organizational/behavioral science; classroom-specific error-climate
work is solid but concentrated in German mathematics education research; the
"audience is the tax" framing is our synthesis [speculative] but each component is
established.

### Implication for the machine tutor

- **Default to total privacy.** No one watches the learner fail except the tutor,
  and the tutor never judges. Never share progress, streaks, or errors with any
  other human or comparative context by default. The machine tutor is the first
  learning environment in history where complete psychological safety is *free*.
- **The tutor's error-language is the error climate.** Every wrong-answer response
  is either "interesting — the model has a gap here" or "incorrect." Same
  information, opposite climates. Script it like it determines everything, because
  per Edmondson's definition, it does.
- **Make asking free.** "Ask me anything, as many times as you like, in any words"
  must be literally true in the product: no hint of exasperation simulation, no
  "as I said before," no escalation of cost with repetition. The confused-silent
  student is the market the tutor exists for.
- **No timed or observed assessment inside the learning space.** Evaluation can
  exist (people want to know where they stand) but must be *separate, chosen, and
  kind* — a chosen diagnostic, never ambient surveillance.
- **Watch for impostor language** ("I just got lucky," "I don't really know this")
  and counter it with the learner's own evidence ledger (§4), not reassurance
  (reassurance is persuasion, the weakest efficacy source).

---

## 11. Polya's *How to Solve It* — Metacognition Made Explicit

### The mechanism

George Pólya's *How to Solve It* (1945; 2nd ed. 1957) is the founding text of
explicit problem-solving pedagogy. Its mechanism: **stuckness is not lack of
knowledge; it is lack of procedure for deploying knowledge.** Pólya's four phases:

1. **Understand the problem** — what is unknown? what is given? what are the
   conditions? can you restate it? (Most failure happens here and masquerades as
   failure later.)
2. **Devise a plan** — have you seen it before? a related problem? solve a simpler
   version? work backwards? solve part of it? his famous heuristic list.
3. **Carry out the plan** — check each step.
4. **Look back** — can you check the result? can you derive it differently? can you
   use the result? *can you generalize it?*

The book's deep move is metacognitive: it converts the tacit judgment of experts
("when stuck, try X") into nameable, teachable moves, so the beginner is not alone
with the wall. Schoenfeld (1985, *Mathematical Problem Solving*) then empirically
demonstrated the tragedy: novices and experts differ less in *knowledge* than in
**self-regulation** — what they do when stuck, how they monitor, when they abandon
strategies. Teaching the Pólya-style moves measurably improves problem solving
(Schoenfeld's own courses; Mevarech & Kramarski's IMPROVE program in Israeli
schools showed metacognitive questioning instruction yielding achievement gains of
d ≈ 0.5–1.0 in math, unusually large; Wang, Haertel & Walberg's 1990 synthesis
similarly rates metacognitive/strategy instruction among the strongest influences).
[established that metacognitive instruction helps; exact sizes vary by study quality]

Crucial bridge to §5/§7: **a learner with a procedure for stuckness does not
interpret stuckness as verdict.** Pólya is partly an anxiety intervention: named
moves convert "I'm lost, therefore I'm dumb" into "I'm in phase 2, so the move is
'related problem'." Stuckness with a procedure is flow maintenance; stuckness
without one is affective filter fuel. [speculative synthesis, strongly implied]

### Evidence strength

[established] as pedagogy and as a research program (Schoenfeld, IMPROVE,
metacognition syntheses); effect sizes are among the larger ones in this document
when the intervention is real strategy instruction rather than poster-ware.

### Implication for the machine tutor

- **The tutor teaches the loop, not just the material.** Understand → plan → act →
  look back should be the visible skeleton of every hard problem the learner faces,
  and the tutor should *name the phase* when the learner is in it.
- **Hint tiers are Pólya heuristics.** "Can you restate it?" (phase 1), "have you
  seen something like this?" / "what's a simpler case?" (phase 2), "check this
  step" (phase 3), "now find a second way to see the same thing" (phase 4) — the
  hint ladder (LEARNING_SCIENCE §16) and the Pólya heuristic list should be the same
  list. [established × established]
- **Train stuckness explicitly.** Periodic "you're stuck — that's expected; here's
  the menu of moves" moments teach the procedure *while* the learner is in the
  emotional state that needs it, which is the only time it actually transfers.
- **Every session ends in "look back."** Reflection closes the loop cognitively
  (retrieval) and motivationally (mastery evidence for the ledger, §4). Two
  literatures, one cheap mechanism.

---

## 12. The Emotional Cost of Being Bad at Something — The Beginner's Shame

### The mechanism (the synthesis core)

Everything above converges here. Beginner status has an *affective price tag* that
no resource abundance discounts, and most learners pay it alone, silently, in
private — which is why it looks like laziness from the outside and feels like
worthlessness from the inside. The components:

1. **Competence is developmentally load-bearing.** Erikson's stage model (1950;
  industry vs. inferiority, roughly ages 6–12) proposed that the child's experience
  of *mattering through competence* sets the lifelong stance toward effort:
  "I am what I can learn to do" vs. the inferiority stance that expects to fail and
  hides. The specifics of the stage theory are dated [contested], but the
  developmental insight — early mastery experience writes the stance — recurs in
  Bandura (mastery dominance), IBM (identity formation), and Dweck (goal
  orientation) independently. [established as convergent finding; contested as
  staged theory]
2. **Being bad is socially expensive** (§10): the beginner must perform incompetence
  to exit incompetence, and the performance is witnessed. Embarrassment (Miller),
  impostor feelings (Clance), and audience anxiety (Edmondson's transfer) make the
  *entry ramp* of any skill the highest-tariff zone of the whole journey, precisely
  where the learner has the least efficacy (§4) and the thinnest identity (§6).
3. **Being bad is emotionally aversive in itself** — frustration tolerance, the
  ability to sit in "I don't get this," varies hugely and is partly trainable; low
  frustration tolerance predicts dropout from exactly the self-directed learning
  free resources offer (attrition research in MOOCs and adult education consistently
  implicates early discouragement). [established directionally]
4. **Time perception distorts the price.** The beginner's shame is experienced in
  minutes ("I've been stuck on this for 20 minutes, I must be hopeless") while the
  competence horizon is measured in months. A tutor with perfect memory can hold the
  long view the learner cannot (§4, win-ledger) — one of the few genuinely
  superhuman things a machine can offer a human psyche.
5. **The Dunning–Kruger aftershock.** The early-learner double-bind: at the exact
  moment of starting, one can't even tell *how* bad one is (calibration is a skill
  too — LEARNING_SCIENCE §13), so shame arrives without reliable coordinates
  ("everyone else gets this instantly"). The Dunning–Kruger finding (Kruger &
  Dunning 1999) that the least skilled overestimate most has been statistically
  critiqued (regression-to-the-mean artifacts; Nuhfer et al. 2016) — [contested] —
  but the *subjective* experience of groundless shame in beginners is real and
  documented qualitatively.
6. **Culture has no honored place for the adult beginner.** Childhood supplies
  structured beginnerhood (school, coaches, parents underwriting failure). Adulthood
  mostly doesn't. The adult learner is culturally expected to already *be*; hence
  "embarrassing" is the dominant descriptor adults use for beginning anything
  visible, and hence most adult learning happens secretly or not at all.
  [tradition/observational — thin formal literature, but overwhelming anecdotally
  and in practitioner literatures]

**The synthesis [speculative, but the composition of this section's established
parts]:** the emotional cost of being bad is the exchange rate between "free
resources" and actual learning. Information is free; *enduring your own
incompetence long enough to convert it into competence* is the real tuition.
Learners who can pay it become autodidacts; learners who can't experience infinite
resources as infinite accusation ("all this free knowledge, and I still can't…").

### Implication for the machine tutor

- **Design for the dignity of the beginner as the prime directive.** Every other
  section's rule — privacy, no judgment, calibrated challenge, win-ledgers, safe
  error climate — is this rule under a different description.
- **Make the beginning *tiny and fast*.** The shortest path to "I did a thing"
  (Bandura's mastery unit) beats the most efficient path to coverage. The first
  session must end in success at something real, however small.
- **Name the state honestly.** "You are two weeks into something that takes months;
  feeling lost here is not evidence about you, it's the calendar." Calendars are
  facts; shame is interpretation. The tutor supplies facts.
- **Absorb the embarrassment the world won't.** Private practice space, zero
  witnesses, total redo-freedom: the tutor is the one place the learner is
  guaranteed to be bad in good company.

---

## 13. Cross-Cutting Synthesis: Why Infinite Resources Don't Produce Learning

The eleven literatures, arranged as one argument:

1. **Access scarcity was replaced by motivational scarcity** (§0–1; Jordan 2013;
   completion correlates with prior education).
2. **Motivation is need-based (SDT).** Systems that control, compare, and reward
   externally undermine the motive they hoped to harvest; infinite access delivered
   through controlling interfaces is still a controlling environment.
3. **Engagement is channel-based (flow).** Self-directed learners drift to the
   channel walls: boredom when resources outpace skill, anxiety when ambition
   outpaces it. Left alone, the drift is toward quitting.
4. **Attempts are belief-gated (Bandura).** The learner's belief about their ability
   — not their actual ability — decides whether the next attempt happens. Free
   resources cannot mint a single unit of self-efficacy.
5. **Attempt quality is anxiety-gated (affective filter).** Anxiety occupies working
   memory; the filter is a hardware tax that no amount of free content can refund.
6. **Interpretation is identity-gated (IBM).** The same wall is either "the doorway"
   or "the sign that says not for me," depending on which identity is active — and
   identity is installed by culture and early experience, not by content.
7. **Belief interventions are small and environmental (mindset, honest version).**
   You cannot lecture someone into growth; you can build a growth-consistent
   environment and let evidence accumulate.
8. **The multipliers are social (protégé, safety, play).** Explaining to another,
   risking error before another, playing inside a circle with another — the
   strongest known multipliers are all dyadic or tribal, and self-directed learning
   is usually solitary.
9. **The binding constraint is the emotional cost of incompetence (§12).** The
   beginner's shame is the exchange rate. Paying it is the actual act of learning;
   everything else is logistics.

[speculative] conclusion, stated as the campaign's founding answer: **learning is
hard not because knowledge is scarce but because the learner must keep paying the
psychological price of being a beginner, alone, unwitnessed, and unassured, for the
months the conversion takes. A machine tutor that wants to make learning "easy as
shit" must therefore not mainly explain better — it must make incompetence cheap,
private, meaningful, and even playable, and hold the evidence of growth against the
identity that says none of this is for me.**

---

## 14. THE AXIOMS (L2's contribution to the synthesis)

Seven axioms. Each traces to the sections above; each is stated generally enough to
bind the design of any learning product.

**AXIOM 1 — Learning is a motivational transaction, not an information transfer.**
The scarce resource in learning has never been explanation; it is willingness
sustained over months. Any system whose theory of improvement is "better content,
more content" is optimizing the variable that stopped binding decades ago.
*[established: §0–2, §13; Jordan 2013; SDT]*

**AXIOM 2 — Control kills the motive it means to serve; autonomy, competence, and
relatedness are the three legs, and a system may not amputate any of them.** Help
that decides for the learner, help that grades the learner, help that bribes the
learner — each is a different violation of the same three needs. The tutor's
correct posture: the learner steers, the ladder is real, the tutor cares.
*[established: §2; Ryan & Deci 2000; Deci et al. 1999; Patall et al. 2008]*

**AXIOM 3 — Failure must be free before it can be frequent, and it must be
frequent before mastery is possible.** Error is the raw material of learning; the
cost of error lives in the audience; therefore the learning environment must
minimize audience to near zero and reprice error as information or even play. The
machine tutor's structural superpower is that private, unjudged failure is free for
it to give. *[established: §5, §10, §9; Edmondson 1999; Steuer et al. 2013; Eysenck
et al. 2007]*

**AXIOM 4 — Learning lives in a narrow channel between boredom and anxiety; the
tutor's first job is to hold the learner there.** Challenge must track skill in
real time, goals must be immediate, feedback instant. A difficulty controller — not
a content database — is the core artifact of any tutor that intends to be used.
*[established as phenomenology and engineering practice, contested in exact form:
§3; Csikszentmihalyi 1990; Corbett & Anderson]*

**AXIOM 5 — Belief precedes ability: self-efficacy compounds, identity ceilings
hold, and difficulty is interpreted through whoever the learner believes they are.**
Interventions at the belief layer are real but small and environmental; the durable
move is to feed belief with legible mastery, supply identity-consistent meaning for
struggle, and let trait-labels die. The tutor should ask "who do you want to
become?" before "what do you want to learn?" *[established: §4, §6, §7; Bandura;
Oyserman; Yeager et al. 2019 with honest caveats]*

**AXIOM 6 — Metacognition is the beginner's prosthetic: named moves for stuckness
turn verdicts into phases.** Stuckness with a procedure is flow; without one it is
identity threat. Understand → plan → act → look back, taught in the moment of
being stuck, is both a cognitive intervention and an affective one.
*[established: §11; Pólya 1945; Schoenfeld 1985; IMPROVE]*

**AXIOM 7 — Learning is socially wired: the multipliers are dyadic — teach,
belong, play — and the tutor can simulate the dyad well enough to harvest them.**
Explaining to another deepens understanding; risking error before a safe other
unlocks asking; playing inside a circle makes incompetence affordable. A
one-to-one machine that plays the student, guards the circle, and remembers every
rung can manufacture all three multipliers for a solitary learner.
*[established multipliers: §7–9; the simulate-the-dyad claim is our [speculative]
synthesis]*

---

## 15. References (primary sources cited)

- Bandura, A. (1977). Self-efficacy: Toward a unifying theory of behavioral change.
  *Psychological Review*, 84(2).
- Bandura, A. (1997). *Self-Efficacy: The Exercise of Control*. Freeman.
- Bargh, J. A., & Schul, Y. (1980). On the cognitive benefits of teaching.
  *Journal of Educational Psychology*, 72(5).
- Blackwell, L. S., Trzesniewski, K. H., & Dweck, C. S. (2007). Implicit theories
  of intelligence predict achievement across an adolescent transition.
  *Child Development*, 78(1).
- Bloom, B. S. (1984). The 2-sigma problem. *Educational Researcher*, 13(6).
- Burnette, J. L., et al. (2013). Mind-sets matter: A meta-analytic review.
  *Psychological Bulletin*, 139(3).
- Caillois, R. (1958). *Man, Play, and Games*.
- Cameron, J., & Pierce, W. D. (1994). Reinforcement, reward, and intrinsic
  motivation. *Review of Educational Research*, 64(3).
- Chase, C. C., Chin, D. B., Oppezzo, M. A., & Schwartz, D. L. (2009). Teachable
  agents and the protégé effect. *Journal of Science Education and Technology*, 18.
- Chi, M. T. H., et al. (1989). Self-explanations: How students study and use
  examples. *Cognitive Science*, 13(2).
- Clance, P. R., & Imes, S. A. (1978). The impostor phenomenon in high achieving
  women. *Psychotherapy: Theory, Research & Practice*, 15(3).
- Corbett, A. T., & Anderson, J. R. (1995). Knowledge tracing. *User Modeling and
  User-Adapted Interaction*, 4.
- Csikszentmihalyi, M. (1975). *Beyond Boredom and Anxiety*. Jossey-Bass.
- Csikszentmihalyi, M. (1990). *Flow: The Psychology of Optimal Experience*.
  Harper & Row.
- Deci, E. L., Koestner, R., & Ryan, R. M. (1999). A meta-analytic review of
  experiments examining the effects of extrinsic rewards on intrinsic motivation.
  *Psychological Bulletin*, 125(3).
- Deci, E. L., Olafsen, A. H., & Ryan, R. M. (2017). Self-determination theory in
  work organizations. *Organization Psychology Review*, 7.
- Dweck, C. S. (2006). *Mindset: The New Psychology of Success*.
- Dweck, C. S., & Molden, D. C. (2005). Self-theories: Their impact on competence
  motivation and acquisition. In *Handbook of Competence and Motivation*.
- Edmondson, A. (1999). Psychological safety and learning behavior in work teams.
  *Administrative Science Quarterly*, 44(2).
- Edmondson, A. (2018). *The Fearless Organization*. Wiley.
- Erikson, E. H. (1950). *Childhood and Society*.
- Eysenck, M. W., Derakshan, N., Santos, R., & Calvo, M. G. (2007). Anxiety and
  cognitive performance: Attentional control theory. *Emotion*, 7(2).
- Fiorella, L., & Mayer, R. E. (2013). The relative benefits of learning by
  teaching vs. teaching expectancy. *Contemporary Educational Psychology*, 38(4).
- Fiorella, L., & Mayer, R. E. (2014). Role of generative activity in learning by
  teaching. *Journal of Educational Psychology*, 106(3).
- Flore, P. C., & Wicherts, J. M. (2015). Does stereotype threat influence
  performance? *Frontiers in Psychology*, 6.
- Fong, C. J., et al. (2014). Challenge–skill balance and flow. *The Journal of
  Positive Psychology*, 9(6).
- Gee, J. P. (2003). *What Video Games Have to Teach Us about Learning and
  Literacy*. Palgrave.
- Gottfried, A. E., Marcoulides, G. A., & Gottfried, A. W. (2001). Continuity of
  academic intrinsic motivation from childhood through late adolescence.
  *Journal of Educational Psychology*, 93(1).
- Hektner, J. M., Schmidt, J. A., & Csikszentmihalyi, M. (2007). *Experience
  Sampling Method: Measuring the Quality of Everyday Life*. Sage.
- Hembree, R. (1988). Correlates, causes, effects, and treatment of test anxiety.
  *Review of Educational Research*, 58(1).
- Horwitz, E. K., Horwitz, M. B., & Cope, J. (1986). Foreign language classroom
  anxiety. *The Modern Language Journal*, 70(2).
- Huizinga, J. (1938). *Homo Ludens*.
- Jackson, S. A., & Marsh, H. W. (1996). Development and validation of a scale to
  measure optimal experience. *Journal of Sport & Exercise Psychology*, 18(1).
- Jordan, K. (2013). MOOC completion rates: The data. (HarvardX/MITx analysis.)
- Kobayashi, K. (2019). Learning by preparing-to-teach and teaching: A meta-
  analysis. *Japanese Psychological Research*, 61(3).
- Krashen, S. D. (1982). *Principles and Practice in Second Language Acquisition*.
- Krashen, S. D. (1985). *The Input Hypothesis*.
- Kruger, J., & Dunning, D. (1999). Unskilled and unaware of it. *Journal of
  Personality and Social Psychology*, 77(6).
- Lepper, M. R., Corpus, J. H., & Iyengar, S. S. (2005). Intrinsic and extrinsic
  motivational orientations in the classroom. *Contemporary Educational Psychology*,
  30(2).
- Li, Y., & Bates, T. C. (2019). Testing the association of growth mindset and
  grades across a challenging transition (failed UK replication, PsyArXiv).
- Macnamara, B. N., & Burgoyne, A. P. (2023). Do growth mindset interventions
  impact students' academic achievement? *Psychological Science*, 34(4).
- Markus, H., & Nurius, P. (1986). Possible selves. *American Psychologist*, 41(9).
- Mevarech, Z. R., & Kramarski, B. (1997). IMPROVE. *American Educational Research
  Journal*, 34(2).
- Miller, R. S. (1996). *Embarrassment: Poise and Peril in Everyday Life*. Guilford.
- Multon, K. D., Brown, S. D., & Lent, R. W. (1991). Relation of self-efficacy
  beliefs to academic outcomes. *Journal of Counseling Psychology*, 38(1).
- Nuhfer, E., et al. (2016). Random number simulations reveal how random noise
  affects the measurements of the Dunning–Kruger phenomenon. *PeerJ Preprints*.
- Oyserman, D. (2007). Social identity and self-regulation. In *Handbook of
  Motivation Science*.
- Oyserman, D. (2015). Identity-based motivation. In *Emerging Trends in the Social
  and Behavioral Sciences*.
- Oyserman, D., Bybee, D., & Terry, K. (2006). Possible selves and academic
  outcomes. *Journal of Personality and Social Psychology*, 91(1).
- Oyserman, D., et al. (2009). A possible selves intervention. *Child Development*,
  80(2).
- Patall, E. A., Cooper, H., & Robinson, J. C. (2008). The effects of choice on
  intrinsic motivation and related outcomes. *Psychological Bulletin*, 134(2).
- Pólya, G. (1945/1957). *How to Solve It*. Princeton.
- Reeve, J., Bolt, E., & Cai, Y. (1999). Autonomy-supportive teachers. *Journal of
  Educational Psychology*, 91(3).
- Ryan, R. M., & Deci, E. L. (2000). Self-determination theory and the facilitation
  of intrinsic motivation. *American Psychologist*, 55(1).
- Schoenfeld, A. H. (1985). *Mathematical Problem Solving*. Academic Press.
- Schunk, D. H. (1991). Self-efficacy and academic motivation. *Educational
  Psychologist*, 26(3–4).
- Sisk, V. F., et al. (2018). To what extent and under which circumstances are
  growth mind-sets important to academic achievement? *Psychological Bulletin*,
  144(2).
- Steele, C. M., & Aronson, J. (1995). Stereotype threat and the intellectual test
  performance of African Americans. *Journal of Personality and Social Psychology*,
  69(5).
- Steuer, G., Rosentritt-Brunn, G., & Dresel, M. (2013). Dealing with errors in
  mathematics classrooms: Structure and relevance of perceived error climate.
  *Contemporary Educational Psychology*, 38(3).
- Stajkovic, A. D., & Luthans, F. (1998). Self-efficacy and work-related
  performance. *Psychological Bulletin*, 124(2).
- Sutton-Smith, B. (2009). *The Ambiguity of Play*. Harvard.
- Sweetser, P., & Wyeth, P. (2005). GameFlow. *Computers in Entertainment*, 3(3).
- Vansteenkiste, M., & Ryan, R. M. (2013). On psychological growth and
  vulnerability: Basic psychological need satisfaction and need frustration as a
  unifying principle. *Journal of Psychotherapy Integration*, 23(3).
- Vygotsky, L. S. (1933/1967). Play and its role in the development of the child.
- Vygotsky, L. S. (1978). *Mind in Society*.
- Wang, M. C., Haertel, G. D., & Walberg, H. J. (1990). What influences learning?
  *Journal of Educational Research*, 84(1).
- Yeager, D. S., et al. (2019). A national experiment reveals where a growth mindset
  improves achievement. *Nature*, 573.
- Zosh, J. M., et al. (2018). Learning through play: A review of the evidence.
  (LEGO Foundation / Brookings white paper.)

---

### Residual caveats

- **Intervention fragility:** motivational/affective interventions show the classic
  pattern — large effects in original studies, smaller in pre-registered
  replications. We have deliberately reported the honest (smaller) numbers
  throughout (mindset especially, §7) and flagged where a claim rests on
  correlational or self-report evidence (flow measurement, §3; stereotype threat,
  §6).
- **Cultural scope:** much of this literature is US/Western, educated, and often
  WEIRD (Henrich et al. 2010). Whether autonomy-need salience or the "math person"
  script generalizes across cultures is under-studied; the campaign should not
  hard-code culturally specific findings as universal without noting it.
- **The Dunning–Kruger item** is cited for the *phenomenon* (beginner
  groundlessness), not the statistical interpretation, which is disputed.
- **The strongest claims in this document are synthesis claims** (§12–14): they are
  compositions of established findings plus our construction of "the emotional cost
  of being bad" as the binding constraint. They are labeled [speculative] in situ.
- **Overlap with L1 (philosophy), L3 (contemplative), L4 (fiction), L5 (hidden
  pedagogies):** shame, beginner's mind, mentor archetypes, and apprenticeship each
  re-appear in those lanes from different angles; L6 should treat convergence as
  strengthening evidence, with epistemic discipline about which lane supplied it.
