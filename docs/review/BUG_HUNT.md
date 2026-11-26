# Bug Hunt — Palimpsest recently-shipped code (reviewer r1)

Scope: `services/professor/{stance,studentSim,planRoute,practice,conceptGraph,misconceptions,diagnose,scheduler,learner,prompt}.ts`,
`app/reader/components/desk/*`, `app/reader/components/notebook/{StudyTab,blockBody,wbShared,DerivationSlip,ChartSlip,PlotSlip,Notebook,NotebookTabNavigation}.tsx`.

Every finding below was verified by reading the surrounding code and, where
marked ✔probe, by running the actual module (tsx) or the real library
(KaTeX) against the trigger.

---

## P1 — wrong behavior / data loss

**1. P1 | `apps/readest-app/src/app/reader/components/desk/deskLayout.ts:286–308` (layoutSheet collision pass)**
What breaks: the stated collision policy — "AUTO-placed blocks flow DOWN past
any occupied rect; his drawings never land on your ink" — is order-dependent.
The pass walks blocks in document order and pushes hand-placed rects into
`occupied` as it goes, so an auto block only sees hand-placed blocks that
precede it in the transcript. Professor artifacts are never given a stored
point on commit (only user blocks get x/y from `sendTurn`), so every reply is
auto — and every user block is hand-placed.
Concrete trigger ✔probe: place question A → professor replies (auto) → later
drag a user block ONTO the reply. The drag commit stores x/y verbatim with no
collision check; on re-layout the auto reply was processed before the dragged
block, so it never dodges: the two blocks overlap permanently
(`OVERLAP: true` in the probe). Fix: two-pass — collect ALL hand-placed rects
into `occupied` first, then flow autos.

**2. P1 | `deskLayout.ts:142/156/159` (layoutCluster) + `layoutSheet` extent**
What breaks: hand-placed artifacts keep their stored (x, y) verbatim, but
`cursorY` advances by `estimateHeight(a) + gap` only — the stored `a.y` is
never folded into `height`, and `layoutSheet` computes
`cursor = max(cursor, baseY + height)`. A block dragged below the flow extent
therefore contributes nothing to `extent`, which is the stage's
`minHeight` (DeskCanvas renders `<div className='desk-spatial'
style={{minHeight: sheetLayout.extent}}>`). Absolutely positioned children
don't grow the container, so the block lands beyond `scrollHeight`.
Concrete trigger ✔probe: on a spatial sheet, drag a professor reply 2000px
down the paper → `placements.get('p1').y = 3000` while `extent = 244` — the
block is unreachable (can't scroll to it), persists in the transcript, and
every later auto block that the collision pass pushes below it becomes
unreachable too. Fix: for stored-point artifacts use
`cursorY = max(cursorY, a.y + estimateHeight(a) + gap)`.

**3. P1 | `apps/readest-app/src/app/reader/components/notebook/Notebook.tsx:319` + `StudyTab.tsx` (session state)**
What breaks: `StudyTab` is rendered without a `key`, so when the reader
switches books with the notebook pinned, the component instance — and all its
session state (`objectives`, `activeIdx`, `picked`, `chapterLabel`,
`sessionNote`, `retriedRef`, `awaitingVerdictRef`, `objectivesRef`,
`endSessionRef`) — survives. `reload()` re-runs on the new `bookKey` (ledger
resets) but nothing resets the session refs. The verdict subscription
re-binds to the new book while `awaitingVerdictRef.current` may still be
true with the OLD book's objectives.
Concrete trigger: start a chapter session on book A (objectives drafted,
first question asked), switch to book B. The Session view shows book A's
objectives; the next professor grading in book B carrying [PASS]/[RETRY]
stamps book A's objective and advances it; at session end `endSession` calls
`getBookData(bookKey)` — the NEW book — and appends book A's session report
to book B's `notes.md` and a `chapter_session` exchange to book B's
`learner.json` (cross-book data corruption). Fix: `<StudyTab
key={sideBarBookKey} …/>` or reset all session refs/state in an effect keyed
on `bookKey`.

**4. P1 | `apps/readest-app/src/app/reader/components/desk/DeskCanvas.tsx:133–144` (editBlock) + `deskGeometry.ts` reducer**
What breaks: `editBlock` calls `deleteBlock(id)` FIRST, then dispatches
PLACE → FOCUS → CHANGE. The composer's `deskComposerReducer` treats all
three events as no-ops while the state is `sending` (i.e. for the whole
duration of an in-flight professor turn). So editing a block mid-stream
deletes it from the persisted transcript and the edit composer never opens —
the original text is dropped. `editStashRef` only restores it if the user
later dismisses the composer (and then appends the block at the END of the
transcript, wrong position); closing the desk first loses the block
entirely.
Concrete trigger: send a question, wait for the professor's reply to start
streaming (composer is `sending`), select any user block, click ✎ → block
vanishes, nothing to type into. Fix: disable/hide ✎ while
`composer.kind === 'sending'`, or make editBlock queue the PLACE until SENT.

## P2 — wrong behavior / polish with a concrete trigger

**5. P2 | `deskLayout.ts:124–128` (layoutCluster mode test) vs `DeskCanvas.tsx` handleSend**
What breaks: the beside/below decision tests
`anchorPos.x + STAGE.anchorWidth (380) + gap + artifactWidth + margin ≤
stageWidth`, but composed user blocks are stored with
`width = stage?.clientWidth ?? column.offsetWidth` (≈720) in
`DeskCanvas.handleSend`. `layoutCluster` renders the anchor at its stored
720px width while the mode test assumed 380, so 'beside' mode never actually
renders beside for typed turns: the artifact slot at `baseX + 380 + 24`
falls horizontally inside the 720-wide anchor, the collision pass shoves it
below the anchor, and every artifact/stream slot stacks at an offset x=436
column under a full-width block.
Concrete trigger ✔probe: `layoutSheet([user(x=32,y=100,w=720), prof(no
point)], 1200)` → artifact at `(436, 212)`, streamSlot at `(436, 324)` —
never beside. Fix: use `anchorPos.width` (not `STAGE.anchorWidth`) in the
fit test and in the beside slot x.

**6. P2 | `apps/readest-app/src/services/professor/diagnose.ts:239` (misconceptionSimilarity)**
What breaks: the "one shared word is a coincidence" guard only applies to
signatures of ≥3 tokens (`if (signature.size >= 3 && hits < 2) return 0`).
A 2-token wrong reading matches at 0.5 — exactly the default
`MISCONCEPTION_MATCH_THRESHOLD` — with a SINGLE shared word, so a failed
answer is attributed a wrong reading it never expressed, and the learner is
shown a named repair "You <wrong reading>, but on page N the book says…".
Concrete trigger ✔probe: wrongReading "swapped bounds" (tokens
{swapped, bounds}) vs failed answer "I swapped the order of integration and
Fubini says that is fine" → similarity 0.5 → `matchMisconception` returns it.
Fix: require `hits >= min(2, signature.size)` before the ratio test.

**7. P2 | `diagnose.ts:221` (contentTokens) — CJK**
What breaks: content tokens are `s.toLowerCase().replace(/[^a-z0-9]+/g, ' ')`
— every CJK character is stripped, so for a CJK book both the generated
wrong readings (Chinese clauses) and the learner's failed answers tokenize
to the empty set, `misconceptionSimilarity` always returns 0, and
`matchMisconception`/`diagnoseFailedCheck` can never fire. The whole Wave 4
named-repair feature is silently dead for non-Latin books (safe fallback,
but dead). (Same root cause upstream: `slugifyConcept` in
`annotations.ts:86` strips CJK, so CJK concept names never log a concept at
all — concept graph/route/practice are empty for CJK books.)
Fix: tokenize with Unicode classes (`[^\p{L}\p{N}]+`, `u` flag) and add a
CJK n-gram fallback for spaceless scripts.

**8. P2 | `apps/readest-app/src/app/reader/components/notebook/wbShared.tsx:35` (Tex)**
What breaks: the stray-delimiter strip `latex.replace(/^\$+|\$+$/g, '')`
eats the `$` of a trailing ESCAPED dollar, leaving a dangling backslash.
Concrete trigger ✔probe (real KaTeX): step latex `\text{price} = 5\$` →
stripped to `\text{price} = 5\` → `KaTeX parse error: Unexpected character
'\'` — rendered as red error text (throwOnError:false) on the derivation
slip. Fix: strip only unescaped delimiters, e.g.
`replace(/(?<!\\)^\$+|(?<!\\)\$+$/g, '')`.

**9. P2 | `apps/readest-app/src/services/professor/studentSim.ts:120–122` (eventsFromLedger)**
What breaks: (a) every graded pair `i` is attributed the stance at
`state.last_ts` — the LATEST exchange's timestamp — so all historical events
for a concept are credited to the current stance, not the stance that was
actually in force at attempt `i`; (b) `improved: graded[i] === 'pass'`
counts a pass→pass pair as "improved", inflating `improvedRate` /
`overallImprovementRate` (no improvement happened). Both corrupt the offline
r_sol reward signal the sim exists to produce. Consumer today is the offline
eval harness/tests only, hence P2. Fix: thread per-event timestamps (the
ledger needs a ts per graded entry) and define improvement as
`graded[i-1] === 'retry' && graded[i] === 'pass'`.

**10. P2 | `apps/readest-app/src/app/reader/components/notebook/StudyTab.tsx:204–212` (graphStats)**
What breaks: the stats strip counts are computed over `graphNodes` AFTER
`.slice(0, 60)`, so a reader with more than 60 mapped concepts sees
"TAKING HOLD / STILL FORMING / NOT YET CHECKED" totals for an arbitrary
60-node subset presented as the whole map. Fix: compute stats over the
unsliced `Object.values(profile.concept_graph)`.

---

## Checked and cleared (no defect)

- `scheduler.ts`: negative elapsed clamped (`Math.max(0, …)`), stability
  always > 0 through both branches, `nextIntervalDays` floors at 1 day;
  `composeReviewQueue` slot-backfill arithmetic verified by hand.
- `learner.ts`: read-modify-write serialization, NaN-ts guard
  (`Number.isNaN(now)`), graded-window/card updates gated on graded verdicts.
- `stance.ts`: table total (last row `{}` matches all); probeLevel guards.
- `planRoute.ts` / `practice.ts`: goal never dropped by the trim loop;
  due/fresh partition disjoint.
- `conceptGraph.ts`: fresher-review-wins merge, NaN `Date.parse` guarded by
  `Number.isFinite`.
- `misconceptions.ts`: verbatim-quote verification (`MIN_QUOTE_CHARS`),
  lenient JSON, cap enforcement — all sound; `templateRegex` escapes
  correctly.
- `PlotSlip`/`plotCompute`: `evaluatePlotSpec` returns null when no finite
  sample exists, so `initialView` never sees Infinity/NaN extents;
  `ticksFor` can't loop (step > 0 whenever span > 0).
- `ChartSlip`: `parseChartBody` guarantees ≥1 row, no div-by-zero.
- `deskGeometry` reducer, `DeskComposer` focus/splice flow (root onClick
  focuses the textarea before the ƒx commit path can run in 'placed'),
  `DerivationSlip` replay bounds (`stepReplay` clamps 0..total), Notebook
  placeholder cleanup effects — all verified sound.

## Count by severity

- **P0: 0**
- **P1: 4** (#1 collision-pass ordering, #2 extent ignores dragged blocks,
  #3 StudyTab cross-book session leak, #4 edit-during-sending deletes block)
- **P2: 6** (#5 beside-mode width mismatch, #6 one-word misconception match,
  #7 CJK tokenizer dead-zone, #8 Tex `\$` strip, #9 studentSim attribution/
  improvement definition, #10 graph stats over capped list)
