# S6 — Integration Audit: the queen's merge plan

**Campaign:** Workbench 2.x — "The Living Desk" (`docs/WORKBENCH_2_X_CAMPAIGN.md`, owner-approved 2026-09-15)
**Lanes audited:** `s1-pedagogy.md` (A), `s2-grounding.md` (B), `s3-structure.md` (A), `s4-voice.md` (C), `s5-bridge-profile.md` (D)
**Method:** every claim below was re-verified against the tree at the audit commit (`a2b02e751` lineage). Line numbers are the real ones, measured this sitting; where a lane spec's anchor drifted, the corrected anchor is given. This document is the binding merge plan: rulings are written to be applied verbatim.

---

## 1. FILE-TO-TOUCH AUDIT

For each file named in any of the five specs: existence, current exports, import graph, owning lane, and write order. Verified by direct read and `grep` of the import graph, 2026-09-15.

### 1.1 Lane A files (s1 + s3 share one writer — campaign table, confirmed)

| File | Exists | Verified current state | Importers (who else reads it) | Audit verdict |
|---|---|---|---|---|
| `apps/readest-app/src/services/professor/professorTags.ts` (148 lines) | ✓ | `ParsedProfessorMessage` (:23), `PROTOCOL_TAG` (:41, four names), `captureProtocol` (:53), `parseProfessorTags` (:68) | `workbenchChat.ts`; `__tests__/services/professor-tags.test.ts` | **Single writer: A.** All five specs add tag grammar here; C's spec also lists it — see Ruling R4. |
| `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` (273 lines) | ✓ | `TranscriptBlock` (:17), `BlockCheck` (:30), `commitProfessorBlock` (:141), `stripPartialTagTail` (:166), `serializeTranscript` (:184), `isBlock` (:195), `parseTranscript` (:207), store (:223/:232), `newBlockId`, `extractMathSteps`, `summarizeChecks`, `PAGE_CITE_PATTERN` | `WorkbenchTab.tsx`; `__tests__/notebook/workbench-chat.test.ts` | **Writer: A in wave A; C adds `voice` field + `updateBlock` in wave C (sequential, additive — legal).** |
| `apps/readest-app/src/services/professor/prompt.ts` (262 lines) | ✓ | `PROFESSOR_SYSTEM_PROMPT` (:5), `buildProfessorUserMessage` (:70), `PROFESSOR_WORKBENCH_ADDENDUM` (:117), `PROFESSOR_WORKBENCH_SYSTEM_PROMPT` (:128) | `workbenchSession.ts` (imports `PROFESSOR_WORKBENCH_SYSTEM_PROMPT`); tests `professor.test.ts`, `professor-prompt.test.ts`, `professor-learner.test.ts` | **Writer: A only.** Four specs append here; s5 names a *wrong path* — see Ruling R1. One append batch by A carries all paragraphs. |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx` (1008 lines) | ✓ | `Prose`, `Slip`, `VerdictChip`, `BlockChips` (:196), `PageChip` (:245), tab component (:272), `contentHash` (:68), `runSilentCheck` (:348), `send` (:466), `startSession` (:405), persistence effects (:524/:557), `quoteForPage` (:682), `goToPage` (:703), `renderContent` (:716), block loop (:738), ƒx popover (:862) | `Notebook.tsx` (React.lazy) only | **Writer: A (waves A), C (wave C), queen (integration, s5 §1.6 seed hook).** Sequential, legal. God-file risk — Risk R4. |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.css` (587 lines) | ✓ | `.wb-*` chip/slip grammar, `@container (max-width: 239px)` width resilience, `[data-eink='true']` guards | imported by `WorkbenchTab.tsx` | **Writer: A, then C (appended `.wb-voice*`); queen appends nothing.** Appends only — no rule rewrites. |
| `apps/readest-app/src/app/reader/components/notebook/MathField.tsx` | ✓ | `MathFieldProps` (:43): `value`, `onChange`, `onCommit?` (:48), `placeholder`; MathLive `ssr:false` hard rule documented | `WorkbenchTab.tsx` (dynamic import) | **Writer: A (s3 §7.3: `autoFocus?`, `compact?` props).** Additive props only. |
| `apps/readest-app/src/services/professor/diagramSvg.ts` | ✗ new | — | — | **New file, writer A** (s3 §6.1). |
| `apps/readest-app/src/app/reader/components/notebook/DerivationSlip.tsx` | ✗ new | — | — | **New file, writer A** (s3 §7.1). |
| `apps/readest-app/src/app/reader/components/notebook/DiagramSlip.tsx` | ✗ new | — | — | **New file, writer A** (s3 §7.2). |
| `apps/readest-app/src/app/reader/components/notebook/wbShared.tsx` | ✗ new | — | — | **New file, writer A** — Ruling R5 (extract `Prose`/`Slip`/`VerdictChip`, pure move). |

### 1.2 Lane B files (s2; runs after A merges)

| File | Exists | Verified current state | Importers | Audit verdict |
|---|---|---|---|---|
| `apps/readest-app/src/services/professor/pageLookup.ts` | ✗ new | — | — | **New file, writer B** (s2 §4). Hosts the moved `readBookSource` → `loadBookSource`. |
| `apps/readest-app/src/services/professor/workbenchSession.ts` (546 lines) | ✓ | `WorkbenchBlock` (:33–39; `kind` union :39 **already contains `'derivation'`** — s3's claim verified), `WorkbenchErrorKind` (:57), `readBookSource` (:142–171, private), `loadLearnerSafely` (:175), `packTierSections` (:275–300), `composeWorkbenchOpening` (:330), `composeWorkbenchTurnMessage` (:404), `startWorkbenchSession` (:475), `sendWorkbenchTurn` (:515), `summarizeHistory`, `summarizeLearner`, `summarizeWhereWeAre` | `WorkbenchTab.tsx`; `__tests__/services/professor-workbench-session.test.ts` | **Writer: B.** Takes s2's lookup tier + whitelist merge **and** s5 §2.2's profile injection (Ruling R6). Move of `readBookSource` into `pageLookup.ts` is safe: after the move, `pageLookup.ts` imports only `environmentConfig`, `getDir`, `useBookDataStore`, `getNarration`, `HpubManifest`, `TOCItem` — no cycle with `workbenchSession.ts`. |

### 1.3 Lane C files (s4; runs after A+B merged)

| File | Exists | Verified current state | Audit verdict |
|---|---|---|---|
| `apps/readest-app/src/services/professor/workbenchVoice.ts` | ✗ new | — | **New file, writer C** (s4 §4). |
| `WorkbenchTab.tsx/.css`, `workbenchChat.ts`, `professorTags.ts`, `prompt.ts` | ✓ | see §1.1 | C's spec lists edits to all four A-owned files "additive after A merges". Under Ruling R4, **C's `professorTags.ts` and `prompt.ts` edits are already satisfied by A's batch — C does not touch them**; `workbenchChat.ts` (`voice` field, `updateBlock`) and `WorkbenchTab.tsx/.css` (`VoiceControl`) are C's real edits. |

**Read-only imports C relies on — all verified exported:** `ProfessorSpeechSource` (`services/professor/voice.ts:164`), `PROFESSOR_INSTRUCT` (`voice.ts:38`), `SpeechFeeder` (`voice.ts:119`), `holdPartialTag` (`voice.ts:101` — also the precedent s5's bridge filter cites), `AudioSink` (`services/narration/player.ts:24`), `WebAudioSink implements AudioSink` (`services/narration/webAudioSink.ts:12`), `getNarration` (`services/narration/speakMode.ts:27`), `verbalizeInlineMath`/`isVerbalizerReady` (`services/narration/verbalize.ts:79/:85`), `doctorSpeakText` (`services/narration/narrative.ts:123`), controller `get speech()` (`controller.ts:214`) and `get active()` (`controller.ts:231`), `unit-change` re-dispatch (`controller.ts:70-71`), `NarrationQwenProvider` `POST {base}/tts` (`narrationQwenProvider.ts:113`, `DEFAULT_BASE = 'http://127.0.0.1:8737'` :23), `SpeechSynthesisPermanentError` (`services/tts/providers/types`). s4's grounding is accurate in every particular checked.

### 1.4 Lane D files (s5; runs parallel with A — disjointness proven)

| File | Exists | Verified current state | Importers | Audit verdict |
|---|---|---|---|---|
| `apps/readest-app/src/services/professor/bridge.ts` | ✗ new | — | — | **New file, writer D.** |
| `apps/readest-app/src/services/professor/learnerProfile.ts` | ✗ new | — | — | **New file, writer D.** Depends on `slugifyConcept` (`annotations.ts:86` ✓ exported) and `AppService.readFile/writeFile` (`types/system.ts:69-70` ✓), `BaseDir` includes `'Data'` (`types/system.ts:18` ✓). |
| `apps/readest-app/src/app/reader/hooks/useProfessor.ts` | ✓ | `PROF_ASK_EVENT` listener (:150), `streamBuf` (:272), `onToken` → `voice.push(t)` (:334), `onDone` (:336), `parseAnnotations`/`stripAnnotations` flow | `ProfOverlay.tsx` | **Writer: D.** Additive filter + extractor per s5 §1.3. Verified the s5 claim that `TAG_RE` (`annotations.ts:80`) does not know `TO_WORKBENCH` — the stream filter is genuinely required. |
| `apps/readest-app/src/app/reader/components/professor/ProfOverlay.tsx` | ✓ | overlay column, `useProfessor({ bookKey })` | professor overlay mount | **Writer: D.** |
| `apps/readest-app/src/app/reader/components/professor/prof-bridge.css` | ✗ new | — | — | **New file, writer D.** |
| `apps/readest-app/src/components/settings/StudyProfilePanel.tsx` | ✗ new | — | — | **New file, writer D.** Primitives per `components/settings/primitives`; `StampButton` (`components/apothecary/StampButton.tsx:10`, `variant?: 'stamp' | 'ink'`) ✓. |
| `apps/readest-app/src/components/settings/SettingsDialog.tsx` | ✓ | `SettingsPanelType` union (:38 — **9 members, no `'Study'`**), `tabConfig` (:84), `resetFunctions` (:170), `panelMap` (:206) | settings dialog mount | **Writer: D, additive only.** s5's four touch points all verified present. |
| `apps/readest-app/src/services/prompt.ts` (s5 file table names `src/services/prompt.ts`) | **path does not exist** | real file is `src/services/professor/prompt.ts` | — | **Ruling R1.** |
| `AIAssistant.tsx` (campaign table) | **does not exist** | removed 2026-09-06; chat surface = `ProfOverlay.tsx` + `useProfessor.ts` | — | s5's filename reality check verified correct. Ledger note stands. |

**D ∥ A disjointness:** D writes no file A writes. The three "queen-wired" s5 edits (`prompt.ts` paragraph, `workbenchSession.ts` profile arg, `WorkbenchTab.tsx` seed hook) are explicitly *not* D's — their assignments are fixed by Rulings R1, R6, R7.

### 1.5 Files the specs cite read-only (spot-verified)

- `services/narration/script.ts:59-78` — `HpubManifest` exactly as s2 quotes, `page_class?: 'prose'|'mixed'|'visual'`, `blocks?: HpubBlock[]` ✓
- `services/professor/contextPack.ts:97-109` — `md.slice(entry.md_char_start, entry.md_char_end)` pattern ✓; `buildTieredPack` :268 ✓
- `services/professor/session.ts:47` — `ChapterSlice.includedPages?: number[]` ✓ (the whitelist-honesty precedent)
- `services/professor/mathCheck.ts:169` — `checkDerivation(steps, goalLatex?)` ✓; `goal_latex` wire field :193 ✓; `CheckDerivationResult` :46 ✓
- `services/professor/annotations.ts:86` — `slugifyConcept` ✓
- `store/notebookStore.ts:55-57` — `setNotebookVisible`, `setNotebookActiveTab` ✓ (s5's desk-activation call is real)
- `app/reader/components/notebook/NotebookTabNavigation.tsx:3` — `PiGraduationCap` ✓ (s5's Study-tab icon exists)
- `styles/apothecary.css:46` — `--stamp: #8c3b22` ✓ (sole-accent law holds; :73 is the dark-mode twin, unused — light mode only)
- `sanitize.ts` / `dompurify` — s3's sanitizer idiom has a live precedent ✓

---

## 2. CONTRACT CONFLICTS — and the ruling for each

### R1. s5 edits the wrong prompt target (PATH ERROR + non-negotiable 4 breach)

**Conflict:** s5 §1.7 and its file table name `apps/readest-app/src/services/prompt.ts` — **no such file exists**; the real file is `apps/readest-app/src/services/professor/prompt.ts`. Worse, s5 §1.7 appends the bridge-emit paragraph to `PROFESSOR_SYSTEM_PROMPT`, but non-negotiable 4 says *"new prompt material is **additive-only** to `PROFESSOR_WORKBENCH_ADDENDUM`"*, and `professor-prompt.test.ts:15` guards the system prompt's text.
**Ruling (verbatim):** The paragraph in s5 §1.7 is appended **inside `PROFESSOR_WORKBENCH_ADDENDUM`** (after the s3 FIGURES section, before the closing backtick), not to `PROFESSOR_SYSTEM_PROMPT`. `prompt.ts` is A-owned, so **writer A appends it in wave A** as part of the single addendum batch (D supplies the text; D never touches `prompt.ts`). `professor-prompt.test.ts` gains one assertion that the addendum contains `[TO_WORKBENCH prompt:` — it does not touch the system-prompt guard.

### R2. Three incompatible `PROTOCOL_TAG` regex definitions

**Conflict:** s1 §2.1 replaces `PROTOCOL_TAG` with a dual-arm regex (colon value **or** space-joined `key:value` body) over `(CONCEPT|QKIND|WORKBENCH|POINT|PROBE|CONCEPTS|TEACHBACK|EVALUATION)`. s3 §2.4 says extend to `/(DERIVE|STEP|DIAGRAM|CONCEPT|QKIND|WORKBENCH|POINT)(?::([^\]\n]*))?/` — which **cannot match its own `[STEP 3 /CHECKED ok]` grammar** (space after the name, no colon; the optional colon group skips, `\]` fails on ` 3`). s4 §3 replaces it with `(CONCEPT|QKIND|WORKBENCH|POINT|VOICE)(?::([^\]\n]*))?` — which loses s1's space arm and all of s2/s3's names. One file, one writer (A), one regex.
**Ruling (verbatim):** Writer A supersedes all three definitions with this single regex (drop-in for `professorTags.ts:41`):

```ts
const PROTOCOL_TAG =
  /\[(CONCEPTS|TEACHBACK)(?:[ \t]+[a-z][A-Za-z0-9_-]*:[^\]\n]*|:[^\]\n]*)?\]|\[(STEP)(?:[ \t]+\d+)?(?:[ \t]*\/CHECKED[ \t]+(?:ok|bad))?[ \t]*\]|\[(CONCEPT|QKIND|WORKBENCH|POINT|PROBE|EVALUATION|LOOK|DERIVE|DIAGRAM|VOICE)(?::([^\]\n]*))?\]/g;
```

`captureProtocol` adapts: for `CONCEPTS`/`TEACHBACK` the body arrives with its leading space (s1's parse code is unchanged); for `STEP`, the writer reconstructs `value` as `` ` ${numeral ?? ''}${checked ? ` /CHECKED ${checked}` : ''}` `` trimmed of empties so s3's existing value parse `/^\s*\d+\s*(?:\/CHECKED\s+(ok|bad))?\s*$/` works verbatim (`[STEP]` → value `''` → captures `{}`, tag still consumed). `CONCEPTS` is listed **before** `CONCEPT` so the alternation never depends on backtracking. Writer C's `professorTags.ts` edit in s4 §3 is thereby **already satisfied — C does not touch this file.**

**Why the narrow arms matter (load-bearing):** applying the space-joined arm to *every* name (s1's draft does) would swallow prose like `[NOTE see: below]` in pass 1 that today's pass 2 deliberately leaves alone (`TAG_PATTERN` cannot match it: after `NOTE` comes a space, so the colon group and `\]` both fail). The ruling limits space-bodies to the three names whose grammar requires them.

### R3. `stripPartialTagTail`: s3's "needs no change" is wrong for `[STEP …]`

**Conflict:** s3 §3.2 asserts the existing tail regex already eats `[DERIVE…]`/`[STEP…]`/`[DIAGRAM…]`. True for `DERIVE`/`DIAGRAM` (colon bodies), **false for STEP**: neither `[STEP 3 /CHECKED ok]` nor `[STEP /CHECKED ok]` matches `\[A-Z][A-Z0-9_-]*(?::…)?\]?(?=[ \t\n]*$)` — after the name comes a space, then `3` or `/`, so the lookahead fails and a half-streamed step mark flashes at the reader. s1's replacement regex also misses STEP (its space arm requires a lowercase `key:`).
**Ruling (verbatim):** s1 §2.2's replacement stands, with one arm added for the step mark. The tail regex in `workbenchChat.ts:166` becomes:

```ts
const tag =
  /[ \t]*\[[A-Z][A-Z0-9_-]*(?::[^\]\n]*|[ \t]+[a-z][A-Za-z0-9_-]*:[^\]\n]*|[ \t]+\d*(?:[ \t]*\/CHECKED[ \t]+(?:ok|bad))?[ \t]*)?\]?(?=[ \t\n]*$)/.exec(text);
```

The trailing-lone-`[` arm below it is untouched. Add to `workbench-pedagogy.test.ts` the case: `'…words\n[STEP 3 /CHEC'` → `'…words'` (s3's writer may place it in `workbench-derivation.test.ts` instead — one home, not both).

### R4. `[LOOK]` parse ownership and the impossible cross-lane import

**Conflict:** s2 §2 says "parsed in A's s1 batch" and s2 §11 says A's parser slices to `LOOK_MAX_PAGES` **by import from `pageLookup.ts`** — but `pageLookup.ts` is B's new file and does not exist when A writes. A literal import breaks wave A's `tsc` gate. Meanwhile s1's own spec never mentions `LOOK` at all, and s2 §5 vs §11 disagree on where `lookedUp` is declared (`WorkbenchBlock` vs `TranscriptBlock`).
**Ruling (verbatim):** (a) **No cross-lane import.** The parser does not slice; `ParsedProfessorMessage.look?: number[]` is the raw page list (numbers only, malformed → nothing, per s2 §2). The cap is enforced once, at the desk: `lookupPages` in `pageLookup.ts` already contracts to "deduped, sorted, sliced to `LOOK_MAX_PAGES`" — the cap lives there alone. (b) **`lookedUp?: number[]` is declared by A on `TranscriptBlock`** (`workbenchChat.ts:17`, with s2's doc comment) so A's `commitProfessorBlock` line `if (parsed.look !== undefined) block.lookedUp = parsed.look;` typechecks in wave A. **B additionally declares the identical optional field on `WorkbenchBlock`** (`workbenchSession.ts:33`) — an identical-property subtype redeclaration is legal TypeScript and keeps non-transcript consumers informed; B must not *remove* A's line. (c) A's batch includes the `LOOK` regex name (R2) and the `captureProtocol` case: value `/^page:(\d+(?:\s*,\s*\d+)*)$/` → numbers, else nothing.

### R5. `Prose`/`Slip`/`VerdictChip` — where the shared pieces live

**Conflict:** s3 §4.3/§10 leaves it open ("exported from WorkbenchTab.tsx or moved"), but s1's new components (`ProbeRow`, `ConceptMapSlip`) and s2's `ConsultMark` also want `Slip`-adjacent patterns, and C's `VoiceControl` reuses `Slip` too. Everyone importing from `WorkbenchTab.tsx` (a default-exported tab) is brittle.
**Ruling (verbatim):** Writer A extracts `Prose`, `Slip`, and `VerdictChip` **unchanged** (byte-identical props, markup, and class names) into a new file `apps/readest-app/src/app/reader/components/notebook/wbShared.tsx`, and `WorkbenchTab.tsx` re-imports them. Pure move; no behavioral edit. s1's `ProbeRow`/`ConceptMapSlip` are co-located in `WorkbenchTab.tsx` per s1 §5.2 (kept, but they import `Slip` from `wbShared`). s3's `DerivationSlip`/`DiagramSlip` import from `wbShared`. C's `VoiceControl` imports `Slip` from `wbShared`. This is the single extraction; no further moves in later waves.

### R6. Who applies s5 §2.2 (profile injection into the compose functions)

**Conflict:** s5's file table says "queen" for the `workbenchSession.ts` edit, but §2.2's own heading calls it queen-wired while the file is B's, and s1 §10 Q3 floats the same seam as "lane B's call". Unassigned seams stall.
**Ruling (verbatim):** **Writer B applies s5 §2.2 during wave B**, immediately after s2's own `composeWorkbenchTurnMessage` edit (same functions, same writer, one diff): both composers gain the optional `profile?: LearnerProfile` argument; `startWorkbenchSession`/`sendWorkbenchTurn` load it via a `loadProfileSafely()` helper (try/catch → `{}`, mirroring `loadLearnerSafely` at `workbenchSession.ts:175`); the lines are pushed immediately after the `summarizeLearner` block. B imports `profileLinesForPrompt` and `loadProfileCurrent` from D's `learnerProfile.ts` (read-only import — D's file exists since wave A∥D). The queen does not touch `workbenchSession.ts` at integration. The s5 §2.2 *optional* chat-path injection (`buildProfessorUserMessage`) is **deferred** — no edit to it this campaign.

### R7. The bridge seed hook and the `ConsultMark` render branch — when they land

**Conflict:** s5 §1.6 marks the `WorkbenchTab.tsx` seed hook "queen picks (a) vs (b)"; s2 §8 marks the `ConsultMark` branch "s1's batch vs B-merge".
**Ruling (verbatim):** (a) **`ConsultMark` lands with writer A's batch** (s2 §8 code verbatim, wired as `b.author === 'professor' && b.lookedUp && <ConsultMark pages={b.lookedUp} />` in the block loop) — A already owns that neighborhood; B then touches only `workbenchSession.ts`/`pageLookup.ts`. The in-flight "Consulting the book…" state rides the commit flow as specced. (b) **The bridge seed hook (s5 §1.6 option (a)) lands at integration by the queen** (~20 additive lines in `WorkbenchTab.tsx`: `consumeWorkbenchBridge` on mount + `WORKBENCH_BRIDGE_EVENT` listener + `seedAndStart`). It must land **after** C merges (it coexists with C's `send()` edit; the queen rebases the one `send()` hunk if C's `voiceRef.current?.stop()` and the seed's `appendBlock` collide — they do not; different statements). Option (b) (`seedQuestion` param) is rejected: it touches `composeWorkbenchOpening` for no proven gain.

### R8. s5 bridge-plate string casing

**Conflict:** s5 §1.4 JSX renders `{_('THE DESK WOULD SERVE THIS BETTER')}` while s5 §2.4's string table says `The desk would serve this better` "rendered uppercase by the typed label".
**Ruling (verbatim):** The `_()` key is sentence case — `_('The desk would serve this better')` — uppercased by the `.wb-bridge-label` CSS (`text-transform: uppercase; letter-spacing: 0.12em` as in s5 §1.5). Shouting-case keys leak typography into translations and break the catalogue's TypedLabel convention (`components/apothecary/TypedLabel.tsx`).

### R9. `TranscriptBlock` — one interface, five partial views

**Conflict:** s1 §3, s3 §3.1, and s4 §3 each print a full `TranscriptBlock` — none contains the other two's fields (s1 lacks `derivation`/`diagram`/`voice`; s3's print omits s1's pedagogy fields; s4's omits both).
**Ruling (verbatim):** Not a true conflict — sequential additive fields on one interface — but the writer must not copy any single spec's print wholesale. The wave-A interface is the union: s1 §3's fields (`probe`, `probePicked`, `conceptMap`, `teachbackAsk`, `teachbackOf`, `probeSignal`) **plus** s3 §3.1's (`derivation?`, `diagram?`) **plus** `lookedUp?: number[]` (R4). Wave C adds s4 §3's `voice?` and the `updateBlock` store action. `BlockCheck` is widened once, by A, per s3 §3.4 (goal member added; existing two members byte-identical — verified against `workbenchChat.ts:30-37`). No spec adds a `kind` union value — confirmed correct against `workbenchSession.ts:39` (s1 §3's constraint honored; `'derivation'` was already in the union, which s3 verified).

### R10. Voice block metadata vs the campaign contract

**Conflict:** the campaign contract says voice blocks carry "audio ref + duration + voice id"; s4 §1.1 collapses this to `{ requested, voiceId?, lastHeardAt? }`, dropping audio ref and duration.
**Ruling (verbatim):** **s4's narrowing stands.** The campaign table allows either "re-synthesized on replay or cached under the book's dir"; s4 chose re-synthesis, which makes an audio ref a pointer to nothing and duration unstable metadata (rate- and voice-dependent). The transcript schema keeps `version: 1` (s1 §3.3, s2 §10, s4 §3 all agree; verified `TRANSCRIPT_VERSION = 1` at `workbenchChat.ts:48` is untouched). No `workbench-transcript.json` written by 2.1 changes shape; every new field is optional and gated at render. This is the constitutionally-correct reading of non-negotiable 5; the ledger notes the narrowing.

---

## 3. RISKS — top five, each with its mitigation

**Risk 1 — Transcript schema drift across five lanes.**
Five specs extend the same block schema; two (s2 §11, s4 §3) touch fields whose owning file is another lane's. If any writer lands a *required* field or a `kind` value, 2.1 transcripts break and non-negotiable 5 fails.
*Mitigation:* rulings R4 and R9 pin every field as optional-on-`TranscriptBlock` with a single owner-wave; `TRANSCRIPT_VERSION` stays 1 (verified at `workbenchChat.ts:48`); `isBlock` (:195) is never tightened (it checks only `id`/`author`/`content`/`at` — s1 §3.3 verified). The integration smoke test resumes a real 2.1 transcript (campaign verification gate 2). Each lane's round-trip test (s1 case 11, s2 case 8, s3 case 12, s4 case 8) is the per-wave tripwire.

**Risk 2 — Addendum growth vs the prompt context budget.**
Five appends land in one string: s1's pedagogy paragraph (~40 lines), s2's LOOK paragraph (~10), s3's DERIVATIONS + FIGURES sections (~50, the largest), s4's voice sentence (2), s5's bridge paragraph (~8, relocated per R1). The addendum roughly doubles; in local/ollama mode the system prompt plus the tiered pack must still fit `LOCAL_PACK_MAX_CHARS` (`contextPack.ts`), and looked-up text (4 × 6000 chars) can push past it — s2 §10 concedes this.
*Mitigation:* (a) one A-owned append batch (R1) so the growth is reviewed as a whole, once; (b) `professor-prompt.test.ts` keeps guarding the original addendum text byte-for-byte — the new material is asserted by *containment*, not by pinning the whole string, so later trims don't cascade; (c) the queen measures the assembled system prompt at integration (log `PROFESSOR_WORKBENCH_SYSTEM_PROMPT.length` in the smoke session) and, if over budget, trims the *examples* inside s3's FIGURES section first — the tag grammar sentences stay; (d) s2's `LOOK` cap (4 pages × 6000 chars) is the hard bound on the lookup tier — do not raise it.

**Risk 3 — `professorTags.ts` scanner fragility under the new grammar.**
The dual-arm regex (R2) is the most delicate code in the campaign. Failure modes: (i) prose bracketing eaten by an over-broad space arm (e.g. `[NOTE see: below]` — demonstrated in R2); (ii) `CONCEPT` shadowing `CONCEPTS` in the alternation; (iii) a math interval at the stream tail (`[0,1]$`) interacting with the new tail arm (R3); (iv) a miscounted professor step numeral desyncing `stepMarks` from `$$` segments (s3 §2.2 guards the *display* numbering but the marks array is positional).
*Mitigation:* (i)+(ii) are closed by R2's narrow per-name arms and the `CONCEPTS`-first ordering — both pinned by tests (s1 case 4, s3 §8.3); (iii) pinned by s1's existing `[0,1]`-at-tail case and the new R3 case; (iv) pinned by s3 case 4 (`[STEP 9 /CHECKED ok]` on the first step still renders ordinal 1). The scanner's invariants (case-sensitivity, malformed brackets pass through, unterminated `$$` shield) each keep a named test in the wave-A suites; the queen does not waive them.

**Risk 4 — `WorkbenchTab.tsx` god-file growth.**
1008 lines today; A adds `ProbeRow` + `ConceptMapSlip` + `ConsultMark` + two slip mounts + pair-mode composer (~250), C adds `VoiceControl` + player wiring (~150), the queen adds the seed hook (~20). ~1430 lines with four owners' fingerprints.
*Mitigation:* R5's `wbShared.tsx` extraction removes the shared presentational layer before it grows; A's new components stay co-located per s1/s3 (they are transcript-shaped, not shared); C's `VoiceControl` stays in the tab per s4 §6 (it needs the player ref); the queen's hook is one `useEffect` + one callback. Any *further* component in integration review goes in its own file — no fourth co-location. Reviewers: treat >1500 lines as a P1 refactor trigger, not a P0.

**Risk 5 — Voice/narration/teach-back focus contention.**
Three surfaces compete for the reader's ear and the professor's turn: narration (`useNarration.ts` Space-to-pause), workbench voice (s4), and teach-back (s1 — the professor *waits* for the learner). Concrete collision: a `[VOICE]` block playing while narration starts; a probe-chip pick firing `send()` while C's `stop()` hasn't landed; a teach-back ask arriving while a derivation folio is open (s3 §10 Q2 — unresolved pedagogy).
*Mitigation:* s4 §5's precedence law is complete and adopted: `isNarrationActive` refusal (`voice-busy`), `unit-change` instant yield (`controller.ts:70-71` verified), stop-on-new-turn in `send()`, no global shortcuts. The one gap: s1's `pickProbe` goes through `send()` (s1 §5.2) — ruling: **C's `voiceRef.current?.stop()` is the first statement of `send()`** (s4 §6.3), so the pick inherits silence automatically; the queen verifies the merge keeps that ordering. s3 §10 Q2 (folio closer) is left open by design — a professor prose block closes a folio; if dogfood shows interleaved LOOK blocks closing folios wrongly, the fix is a one-line condition in the pair-mode trigger, not a new tag.

---

## 4. TEST INVENTORY

**New files (7):**

| # | Path | Lane | Extends the idiom of |
|---|---|---|---|
| 1 | `apps/readest-app/src/__tests__/notebook/workbench-pedagogy.test.ts` | A (s1 §7) | `workbench-chat.test.ts` (imports via `@/`, `describe`/`test`) |
| 2 | `apps/readest-app/src/__tests__/notebook/workbench-derivation.test.ts` | A (s3 §8.1) | `mathcheck.test.ts` (`vi.stubGlobal` fetch, `HEALTHY` body) + `workbench-chat.test.ts` |
| 3 | `apps/readest-app/src/__tests__/services/diagram-svg.test.ts` | A (s3 §8.2) | existing DOMPurify sanitizer tests (jsdom env) |
| 4 | `apps/readest-app/src/__tests__/services/professor-page-lookup.test.ts` | B (s2 §9) | `professor-workbench-session.test.ts` (`vi.hoisted` ai mock, three-page `HpubManifest` fixture) |
| 5 | `apps/readest-app/src/__tests__/services/workbench-voice.test.ts` | C (s4 §9) | `narration-player.test.ts` (FakeProvider/FakeSink) — name is distinct from the existing `professor-voice.test.ts` ✓ |
| 6 | `apps/readest-app/src/__tests__/services/professor-bridge.test.ts` | D (s5 Part 3) | `professor-learner.test.ts` |
| 7 | `apps/readest-app/src/__tests__/services/learner-profile.test.ts` | D (s5 Part 3) | `professor-learner.test.ts` (in-memory `AppService` stub) |

**Existing suites extended (additive describe-blocks only — no existing case edited):**

| Suite | Addition | Lane |
|---|---|---|
| `apps/readest-app/src/__tests__/services/professor-tags.test.ts` | `describe('workbench 2.x protocol tags')` — DERIVE/STEP/DIAGRAM in unterminated `$$` shield, `[STEP]` bare, empty DIAGRAM claim, `[0,1]`/`[A]` survival, unknown-tag stripping (s3 §8.3) + per R4 the LOOK parser cases s2 §9 defers here (`[LOOK page:N,M]`, malformed → nothing) + `[VOICE]` cases s4 §9 case 9 | A |
| `apps/readest-app/src/__tests__/services/professor-prompt.test.ts` | `describe('workbench 2.x addendum')` — DERIVE/STEP/DIAGRAM literals, self-check sentence, emitted ` ```svg ` fence; per R1 the `[TO_WORKBENCH prompt:` containment assertion (s3 §8.4 + s5) | A |
| `apps/readest-app/src/__tests__/notebook/workbench-chat.test.ts` | **Not extended** — s1 §7 keeps all S1 assertions in file #1; the R3 tail case lives in file #1 or #2, one home | — |

**Suites that must stay green untouched (writer gates):** `workbench-chat.test.ts`, `professor-workbench-session.test.ts`, `professor-prompt.test.ts`, `professor-tags.test.ts`, `mathcheck.test.ts`, `professor-voice.test.ts`, `narration-player.test.ts`.

---

## 5. SEQUENCING VERDICT — exact writer execution order

The campaign's `A ∥ D → B → C → integration` is **confirmed correct**; the rulings above fill in who writes the cross-lane seams. Verbatim order:

**Wave A — writer A (s1 + s3 + the R1/R2/R4/R5 prompt-parser-shared pieces).** One writer, one coherent batch over the block model: `professorTags.ts` (final regex R2, all `captureProtocol` cases), `workbenchChat.ts` (union interface R9, `lookedUp`, helpers, store actions, tail regex R3), `prompt.ts` (**all five addendum paragraphs in one append**: s1 pedagogy → s2 LOOK → s3 DERIVATIONS → s3 FIGURES → s4 voice sentence → s5 bridge paragraph relocated per R1), `wbShared.tsx` extraction (R5), `WorkbenchTab.tsx/.css` (probe row, concept slip, teach-back captions, marker chip, `ConsultMark` per R7, derivation/diagram mounts, pair mode), `MathField.tsx`, the three new renderers/services, `diagramSvg.ts`, test files #1–#3 and the two additive describe-blocks.
*Rationale:* five specs' worth of tag grammar and prompt material funnel through two files (`professorTags.ts`, `prompt.ts`) that only A may write; landing it whole eliminates every regex/append-order hazard before anyone else touches the tree.

**Wave D — writer D (s5), parallel with A.** `bridge.ts`, `learnerProfile.ts`, `useProfessor.ts`, `ProfOverlay.tsx`, `prof-bridge.css`, `StudyProfilePanel.tsx`, `SettingsDialog.tsx`, test files #6–#7. **No file shared with A** (verified §1.4); D's three queen-wired seams are assigned away by R1 (→A), R6 (→B), R7 (→queen).
*Rationale:* the chat surface and settings panel are disjoint from the desk; the only coupling is D's `learnerProfile.ts` being *read* by B next wave, which is satisfied by D finishing before B starts.

**Wave B — writer B (s2 + s5 §2.2 per R6).** `pageLookup.ts` (with the `readBookSource` → `loadBookSource` move), `workbenchSession.ts` (lookup tier, whitelist merge in `packTierSections`, `collectLookedUpPages`, `WorkbenchBlock.lookedUp` per R4, profile injection per R6), test file #4.
*Rationale:* consumes A's parser output (`lookedUp`) and D's `profileLinesForPrompt`; must follow both. Landing profile injection here (not at integration) keeps `workbenchSession.ts` a one-writer file across the whole campaign.

**Wave C — writer C (s4).** `workbenchVoice.ts`, `workbenchChat.ts` (`voice` field + `updateBlock` — additive on A's merged interface), `WorkbenchTab.tsx/.css` (`VoiceControl`, player wiring, `stop()` first in `send()` per Risk 5), test file #5. **C does not touch `professorTags.ts` or `prompt.ts`** (R2/R4 already satisfied them — A's batch included `VOICE`).
*Rationale:* voice UI mounts in the transcript render loop that A and B have finished reshaping; `WorkbenchTab` coupling is why the campaign table serializes C last.

**Integration — the queen.** (1) The bridge seed hook in `WorkbenchTab.tsx` (R7b, ~20 lines); (2) full build + install + the campaign's five-point smoke (probe, derivation with CAS chips, diagram, voice playback, 2.1-transcript resume); (3) the assembled-addendum length check (Risk 2); (4) then the review loop: 3 fresh-context reviewers, P0/P1/P2, max 3 rounds; (5) owner dogfood; commit, `v0.2.0` tag.

---

## 6. Open questions left for the queen (carried from the lanes, none blocking)

1. s1 §10 Q1 — concept chips: transcript-only travel now; book-page scroll later via `goToPage`? *Audit: defer; s1's transcript-only choice keeps wave A self-contained.*
2. s1 §10 Q2 — literal `kind` values for the W2.x block family? *Audit: rejected this campaign; optional-field gating is the compat mechanism (R9/R10).*
3. s1 §10 Q3 — re-tell the picked stance on resume (T3 line)? *Audit: covered by R6's machinery if dogfood asks for it; no code now.*
4. s2 §11a — professor-visible nudge when a `[LOOK]` returns all-missing? *Audit: the UI's nothing-found copy (`The book had nothing on that page.`) suffices for v1; a prompt nudge is a one-line addition inside B's lookup tier if the owner disagrees after dogfood.*
5. s3 §10 Q4 — `MAX_STEPS_PER_CHECK = 8` on folios (step 9+ wears no chip)? *Audit: confirmed, cap unchanged; the folio documents it.*
6. s4 §11 Q1 — multiple `[VOICE]` per turn: first wins, idempotent `true`. *Audit: confirmed as specced.*
7. s4 §11 Q3 — ElevenLabs ride-along has no special handling. *Audit: confirmed; `controller.speech` resolves it (`controller.ts:214`).*
