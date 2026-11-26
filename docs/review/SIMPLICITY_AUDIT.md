# SIMPLICITY AUDIT — Karpathy Lens (r2)

**Reviewer:** r2 (Karpathy simplicity audit) · **Date:** 2026-11-26
**Scope:** `apps/readest-app/src/services/professor/` (all), `apps/readest-app/src/app/reader/components/desk/`, `notebook/StudyTab.tsx` + `notebook/blockBody.tsx` + `notebook/wbShared.tsx`.
**Method:** every exported symbol in scope was extracted and grep-verified for consumers (prod src, tests, scripts, docs). Symbols with **zero consumers anywhere** are below as *dead code*; symbols consumed **only by their own test** are marked **verify-first** (the campaign's Karpathy rule: unproven = stays, but a test with no prod caller is strong evidence of an abandoned wave).

Total scope: ~15,400 lines. Proposed deletion: **~1,080 lines proven dead + ~650 lines verify-first test-only** (plus their ~700 lines of now-orphaned tests, not counted below).

---

## A. DEAD CODE — proven zero consumers (delete)

Ranked by lines-saved × confidence.

### A1. `misconceptions.ts` Wave-3 seeded library — lines 22–398 (~377 lines) 🔥
`Misconception` interface, `SEEDED_LIBRARY` (a ~220-line curated catalog: `alg.exp_over_sum`, `alg.distrib_over_power`, …), `byId`, `norm`, `templateRegex`, `retrieveMisconceptions`, `heuristic`, `getMisconception`.

**Proof:** the entire Wave-3 retrieval pipeline was written to feed `diagnose.ts`'s LLM stage (`DiagnoseInput.candidates: Misconception[]`, `buildPrompt` reads `c.rootCause`). That stage (A2) is dead. Zero calls anywhere, including tests:
```
grep -rn -w retrieveMisconceptions src __tests__  →  hits only misconceptions.ts (def + header comment)
grep -rn -w getMisconception src __tests__        →  only misconceptions.ts:396 (its own comment claims "used by the diagnosis prompt builder" — it is not)
grep -rn -w SEEDED_LIBRARY src __tests__          →  only misconceptions.ts
```
Delete 22–398; keep only the Wave-4 section (`MisconceptionSourceRef`…`misconceptionsForConcept`, which `diagnoseFailedCheck` uses).

### A2. `diagnose.ts` Wave-3 LLM diagnosis stage — lines 18–20, 24–158 (~141 lines) 🔥
`Diagnosis`, `DiagnoseInput`, `DIAGNOSE_SYSTEM`, `buildPrompt`, `lenientParse`, `validateDiagnosis`, `diagnoseFaultPath`. The header says it was superseded by Wave 4's deterministic matcher.

**Proof:**
```
grep -rn -w diagnoseFaultPath   →  only diagnose.ts:131
grep -rn DiagnoseInput|Diagnosis (outside diagnose.ts) → zero hits, not even tests
grep -rn "generateText\|getAIProvider" diagnose.ts    → only inside the dead block
grep -rn "from './diagnose'" (prod) → workbenchSession imports ONLY diagnoseFailedCheck
```
Delete the block + 3 imports; reword the header comment. File becomes ~170 lines of the live Wave-4 matcher.

### A3. `tutorMachine.ts` — entire module, 272 lines 🔥
Tutor state machine (`initTutorSession`, `applyTutorEvent`, `NOISE_BUDGET`, `TutorSession/TutorEvent/TutorState`).

**Proof:**
```
grep -rln tutorMachine --include=*.ts --include=*.tsx   →  ONLY tutorMachine.ts + tutor-machine.test.ts
```
Zero prod importers in `app/` **and** in `services/professor/`. A whole Wave ("the tutor remembers its rungs"?) shipped its tests and never shipped its call site. Delete file + test, or keep test-only with an explicit "spec, not shipped" note.

### A4. `studentSim.ts` — entire module, 126 lines 🔥
`trainStudentSim`, `predictBestStance`, `stanceReward`, `eventsFromLedger`, `StanceEffect/StudentSimState/SimEvent`.

**Proof:**
```
grep -rln "studentSim|trainStudentSim|predictBestStance" (repo-wide, incl. scripts/eval) → only studentSim.ts + its test
```
The header self-labels "OFFLINE ONLY, never a runtime router" — but no offline script imports it either. Pure speculative wave (Microsoft StudentSim incorporation S1–S5) with zero consumers of any kind.

### A5. `tutor.ts` `distillNote` seam — lines 200–259 (~60 lines)
`DistillRequest`, `DISTILL_SYSTEM`, `distillNote`. Header: "ON-DEMAND ONLY … this seam exists for an explicit 'keep this' from the reader" — the 'keep this' button was never built.

**Proof:**
```
grep -rn -w distillNote → only tutor.ts:235 (+ a comment reference in diagnose.ts:12)
```
Delete block; `appendNote` (the writer StudyTab actually uses) stays.

### A6. `bridge.ts` `WORKBENCH_BRIDGE_TAG` — line 19 (1 line)
**Proof:** `grep -rn -w WORKBENCH_BRIDGE_TAG` → only the definition. The literal `'TO_WORKBENCH'` appears in comments/tests but the constant is never referenced. Delete constant (keep literal in tests).

### A7. `learner.ts` `recordMisconceptionHit` — lines 182–185 (4 lines)
**Proof:** zero consumers anywhere. Its only effect — writing `misconception_ids` onto concept state — has **no reader**:
```
grep -rn misconception_ids → learner.ts:81 (field decl), 183–184 (inside this function) — nothing else
```
A dead writer of a dead field. (Field itself stays until A1 lands; it survives persistence round-trips.)

### A8. `contextPack.ts` `buildWorkbenchContextPack` compat shim — lines 380–405 (~26 lines)
Self-described "backward-compat shim" whose only consumer is its own test (`professor-context-pack.test.ts:443`). Zero prod callers (`buildTieredPack` is what workbenchSession uses). Also carries a `@deprecated Ignored` param `wholeBookBudgetChars` that nobody passes. Delete function + the deprecated param + the shim test section.

### A9. `deskGeometry.ts` `isTailPoint` — lines 35–45 (~11 lines)
**Proof:** prod callers = 0. Its own doc comment (line 47–48) says `isWritablePoint` "Supersedes isTailPoint as the click predicate"; only the tail-invariant test imports it. Test-only; delete or fold into the test. (Sister finding: `shouldFollow`, lines 82–95, has **the same predicate inlined in DeskCanvas.tsx:189** — see B4.)

### A10. `DeskCanvas.tsx` the 'math' tool — line 174 union member + lines 961–969 button (~11 lines)
`tool === 'math'` is settable from the toolbar but **never read**: the only behavioral branch is `tool === 'select'` (line 410). Text and math tools are byte-for-byte identical paths — the ƒx button is a no-op dressed as a feature. Delete the button and the `'math'` union member (or wire it). Unreachable-in-effect branch.

### A11. Small dead exports (4 lines total)
- `stance.ts` `decideStance` (lines 167–170): a one-line wrapper over `matchingRow` used only by tests; prod calls `renderStanceLine` which uses `matchingRow` directly.
- `workbenchSession.ts` `StartWorkbenchSessionOptions.currentPage` (interface line 75 + destructure line 500 + pass-through 513): no call site passes it (`grep currentPage useDeskStreaming.ts` → absent); the standalone getter fallback path is dead config. ~3 lines.
- `scheduler.ts` `SchedulerKind` (line 142): dead type, even the Leitner seam (A-verify) never names it.

---

## B. VERIFY-FIRST — test-only consumers (strong delete candidates; confirm intent)

Karpathy rule: these have tests, so they're "used" — but the tests are the *only* users, and the production pipeline they describe was never wired.

### B1. `misconceptions.ts` Wave-4 generation pipeline — lines 447–616 (~170 lines)
`generateChapterMisconceptions`, `verifyChapterMisconception`, `storeChapterMisconceptions`, `libraryKey`, `MAX_GENERATED_PER_CONCEPT`, `MIN_QUOTE_CHARS`, `normText`, `slugify`, `lenientParseObject`, `GENERATE_SYSTEM`.

**The unwired chain:** `workbenchSession.ts:356` reads `learner?.misconception_library` → `diagnoseFailedCheck` — but **nothing in prod ever writes `misconception_library`**:
```
grep -rn "storeChapterMisconceptions|generateChapterMisconceptions|verifyChapterMisconception" (prod) → zero
grep -rn "misconception_library" (prod) → learner.ts:123,251 (passthrough), workbenchSession.ts:356 (read) — no writer
```
So the Wave-4 named-repair prompt line is dead-in-prod and `diagnoseFailedCheck`'s library is always `undefined` at runtime. Either wire generation (one call site, e.g. after chapter session) or delete the pipeline + its tests + the dead reader branch (~215 lines total).

### B2. `eval/judges/` — entire directory, ~326 lines (3+72+118+133)
`judgeLeak`, `judgeTranscript`, `judgeValues`, `renderJudgePrompt`, `parseJudgeVerdict`, golden constants. Zero importers outside `professor-judges.test.ts`:
```
grep -rln "eval/judges|professor/eval" (repo, incl. scripts/) → only professor-judges.test.ts
```
`LEARNING_AUDIT.md` calls them "the Wave 3 CI judges" — verify the CI actually runs them; if not, this is a 326-line spec module with no runner.

### B3. `telemetry.ts` Wave-3 r_sol proxy — lines 43–86 (~44 lines)
`nextAttemptImproved`, `noteStanceOutcome`, `stanceOutcomeRates`, `resetStanceOutcomes` (exported as "read by the Wave 3 CI and by the offline TutorRL labeling lane"). `noteStanceOutcome` is **never called in prod**, so the ring is always empty and `stanceOutcomeRates` returns `{}`. Prod uses only `profTrace/profTraceReset/profTraceDump`. Verify the CI claim; if false, delete the block + test.

### B4. `deskGeometry.ts` `shouldFollow` — lines 82–95 (~14 lines) — duplicated inline
Same predicate is re-implemented at `DeskCanvas.tsx:189`: `el.scrollHeight - el.scrollTop - el.clientHeight <= DESK_PIN_THRESHOLD_PX`. The helper is imported only by the test. Not a deletion — a **reuse**: delete the inline line and call `shouldFollow(...)` (or delete the helper). Don't keep both.

### B5. `scheduler.ts` Leitner-4 fallback seam — lines 140–163 (~24 lines)
`reviewCardLeitner`, `LeitnerCard`, `LEITNER_INTERVALS_DAYS` (and dead `SchedulerKind`, listed in A11). Header claims a "King R5 pre-built fallback, not the default" — but there is no selector; the seam is exercised only by tests. If R5's intent was "pre-built, not wired", the minimal version is deleting it and re-adding when the selector exists. Verify-first.

### B6. `learner.ts` stuck-signal trio — lines 187–207 (~21 lines)
`isStuck`, `stuckConcepts`, `stuckNoteForPrompt` — test-only. Meanwhile **StudyTab re-implements the check inline** (`s.asked >= STUCK_THRESHOLD`, line ~672) and no prompt builder consumes `stuckNoteForPrompt`. Either wire `stuckNoteForPrompt` into the context pack (the header says it should be there) or delete the trio. Note: deleting A-side dead code (A1–A5) shrinks learner.ts to its used surface.

### B7. `planRoute.ts` latent-measure extras — lines 62–93, 180–199 (~52 lines)
`senseEdge`/`EdgeSense` (test-only; `planRoute` does its own partition internally), `routeTagLine` (test-only), `probeCandidates` (test-only). Keep `planRoute` + types; delete or wire.

### B8. `DeskCanvas` growth/anchor scroll machinery — lines 196–300 (~100 lines)
Not dead (wired), but the heaviest "what if the reader unpins" machinery in the file: `anchorRef` capture, ResizeObserver height-only-growth path, `setGrowth` tri-state, `pinnedRef`/`pinned` mirror. Used only to show one "way back" chip (`showScrollChip = !pinned && growth`, line 626). Simplification candidate (rewrite sketch below, F2) — **verify-first**, it works.

---

## C. DUPLICATION — same logic 2+ times

### C1. `toText(c: string | ArrayBuffer)` — defined 5 times
`learner.ts:215`, `learnerProfile.ts:151`, `pageLookup.ts:105`, `StudyTab.tsx:75`, `desk/useTranscriptPersistence.ts:24` — identical 2-liner. Extract once (e.g. `services/professor/io.ts` or an existing util). Saves ~6 lines; removes a sixth copy next wave.

### C2. Lenient `{…}` JSON extraction — 3 implementations
`diagnose.ts:85-102` (`lenientParse` — dies with A2), `misconceptions.ts:527-543` (`lenientParseObject` — dies with B1), `eval/judges/prompts.ts:57-71` (`parseJudgeVerdict`). All: "strip fences, slice first `{` to last `}`, JSON.parse, null on failure". One shared `extractJsonObject(raw)` kills two copies.

### C3. The "not a learnable concept" filter — 3 implementations
- `practice.ts:36` `SKIP_CONCEPTS = new Set([UNCATEGORIZED_CONCEPT, 'chapter_session'])`
- `StudyTab.tsx:139-141` `concept !== 'uncategorized' && concept !== 'chapter_session'`
- `StudyTab.tsx:248-249` same predicate, second occurrence
`learner.ts` already exports `UNCATEGORIZED_CONCEPT`. Export `SKIP_CONCEPTS` from `learner.ts` and import it in both places. (planRoute.ts has its own private `SKIP_CONCEPTS` too — 4th copy.)

### C4. Mastery→human-label map — 2 implementations in `StudyTab.tsx`
- `MASTERY_LABEL` (lines 243–246): unknown→"not yet checked", edge→"still forming", known→"taking hold"
- Graph-view tone labels (lines ~768–774): same three strings re-derived inline for the tone groupings
And `learner.ts` exposes `masteryOf` while `conceptGraph.ts` exposes `toneOf` — two parallel mastery derivations over the same ledger (in-scope duplicates; flag for a single `masteryOf`).

### C5. `24 * 60 * 60 * 1000` — inline in `StudyTab.tsx:665` vs exported `scheduler.ts:39 DAY_MS`
Trivial; import the constant.

### C6. Stuck check — see B6 (StudyTab inlines what `isStuck` exports).

---

## D. OVER-ABSTRACTION / SPECULATIVE GENERALITY

1. **B1's unwired Wave-4 pipeline** is the flagship: generation + verification + store + reader, where the writer is missing. An abstraction with a consumer shape and no producer (D1).
2. **`buildWorkbenchContextPack`'s deprecated `wholeBookBudgetChars`** — an option accepted-and-ignored, passed by no one (dies with A8).
3. **`StartWorkbenchSessionOptions.currentPage`** — parameter never passed non-default (A11).
4. **The `distillNote` "on-demand seam"** — an interface, system prompt, and 30s-budgeted function for a button that doesn't exist (A5).
5. **`DeskCanvas` tool union (`'select' | 'text' | 'math'`)** — three-way type where only two-way behavior exists (A10).
6. **63 `export` keywords in professor/ on symbols with only-internal or only-test consumers** (`prof_cat` scan: 63 SELFONLY + 83 TESTONLY of 267 exports). Many are type exports that exist solely for tests (fine for pure-function discipline) — but several modules export *everything* by reflex. Not a line-saving target by itself; a habit note: export what callers need.

---

## E. COMPLEX FUNCTIONS — the half-length rewrite candidates

**No wholesale rewrites** (per brief); these are the ones a deletion pass makes shorter, with sketches.

### F1. `StudyTab.tsx` `reload` + `generateObjectives` + `endSession` (lines 85–478, ~390 lines of the 1032)
The session orchestration trio keeps four `useRef` mirrors of state (`objectivesRef`, `activeIdxRef`, `chapterLabelRef`, `awaitingVerdictRef`) plus `sessionEndedRef`, `retriedRef`, `lastSetRef` — seven refs to defeat a closure that exists only because the bus subscription is bound once. After A/B/C deletions (no stuck trio, no graph duplication), the tab drops ~100 lines; the session section itself is honestly sized but the ref-mirror pattern could be one `useRef({...})` blob (one mirror instead of five). Sketch: `const live = useRef({objectives, activeIdx, chapterLabel, awaiting, retried: new Set(), lastSet, ended: false});` updated in one effect — kills ~20 lines of setter pairs.

### F2. `DeskCanvas.tsx` growth/pin machinery (lines 183–300, ~120 lines) — see B8.
Sketch: follow = `scrollHeight - scrollTop - clientHeight <= 24` read **at scroll time** only (no pinnedRef mirror); show the back-to-bottom chip whenever `!atBottom && lastStreamTs > lastScrollTs`. The ResizeObserver's height-only-growth branch (line 247's `width === lastWidth` early-return) exists to distinguish width vs height resize — collapsible to one `if (height grew && !atBottom) setShowChip(true)`.

### F3. `misconceptions.ts` — the entire file is ~170 lines of live code wrapped in 446 lines of dead/wave-scaffolding (A1 + B1). The post-deletion file is already "the rewrite".

### F4. `workbenchSession.ts` `composeWorkbenchTurnMessage` (lines 308–497, ~190 lines)
Sequential `parts.push` with per-tier conditionals. Each tier is fine, but the file also carries `composeWorkbenchOpening` (259–306) which re-derives pack/page/learner/profile context — the two composers share ~8 lines of "summarize learner + profile + stance" that could be one `pushSessionContext(parts, {history, learner, profile})`. ~15 lines saved; keep behavior identical.

---

## SUMMARY TABLE (ranked, lines × confidence)

| # | Finding | Lines | Confidence |
|---|---------|-------|------------|
| A1 | misconceptions.ts Wave-3 seeded library (zero consumers) | 377 | proven |
| A2 | diagnose.ts Wave-3 LLM stage (zero consumers) | 141 | proven |
| A3 | tutorMachine.ts whole module (zero prod importers) | 272 | proven |
| A4 | studentSim.ts whole module (zero consumers at all) | 126 | proven |
| A5 | tutor.ts distillNote seam | 60 | proven |
| A8 | contextPack compat shim | 26 | proven |
| B1 | Wave-4 generation pipeline unwired (store never written) | ~170 (+45 dead reader branch) | verify-first |
| B2 | eval/judges directory (CI claim unverified) | 326 | verify-first |
| B3 | telemetry r_sol proxy (never recorded) | 44 | verify-first |
| A9+A10+A11 | isTailPoint / math-tool / small dead exports | ~20 | proven |
| B5+B6+B7 | Leitner seam, stuck trio, planRoute extras (test-only) | ~97 | verify-first |
| C1–C6 | duplications (toText ×5, JSON ×3, skip-filter ×3, label maps, DAY_MS) | ~40 | proven |
| F2 | DeskCanvas growth/pin machinery simplification | ~120 | verify-first |

**Proven dead total: ~1,080 lines. Verify-first total: ~650 lines.** No working, used code is touched by any A/C item — every A item's consumer grep returned empty.

### Residual risks
- **Test breakage is part of the deal**: A1–A5 orphan tests (`professor-misconceptions` Wave-3 sections, diagnose Wave-3 sections, `tutor-machine.test.ts`, `studentSim` tests, distill tests) — those tests should be deleted with the code (they test nothing that ships). ~700 lines of tests, deliberately not counted above.
- **B1 is a product decision, not a code decision**: deleting Wave-4's generation pipeline abandons the "specific repair names the learner's exact wrong reading" feature — the reader branch in workbenchSession is reachable *in principle* (a hand-edited learner.json with a library would activate it). Confirm with the owner before deleting; alternatively wire one writer and the whole B1 block becomes live.
- **B2/B3's "CI" claims** live only in doc comments (`LEARNING_AUDIT.md`, telemetry header). If an external CI repo imports them via path, my in-repo grep can't see it — hence verify-first.
- The Karpathy rule was applied strictly: every "proven" item above had a repo-wide grep (including `scripts/`, `docs/`, tests) returning zero non-definition references.
