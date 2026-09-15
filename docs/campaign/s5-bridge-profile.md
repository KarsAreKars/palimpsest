# S5 — CHAT-BRIDGE + LEARN-PROFILE (W2.4) — Build Spec

Campaign: `docs/WORKBENCH_2_X_CAMPAIGN.md` (owner items 7 and 8). Lane **D**
(`A ∥ D`). Design world: **The Antiquarian Catalogue** — librarian voice,
stamp `#8C3B22` sole accent, light mode, unlayered CSS. Every user-facing
string via `_()`; no machinery talk; error kinds, never raw provider detail.

> **Filename reality check (binding).** The campaign table names
> `AIAssistant.tsx` as the chat surface. **No such file exists in the tree.**
> The professor chat surface is the Prof overlay:
> `apps/readest-app/src/app/reader/components/professor/ProfOverlay.tsx`
> (render) + `apps/readest-app/src/app/reader/hooks/useProfessor.ts`
> (streaming state machine, tag parse in `onDone`). The old assistant-ui chat
> tab was removed 2026-09-06 (see the comment at the top of
> `NotebookTabNavigation.tsx`). `src/components/assistant/Thread.tsx` is
> dormant. **Mapping: "AIAssistant.tsx (bridge)" → `ProfOverlay.tsx` +
> `useProfessor.ts`**, both lane-D files. The queen should note this mapping
> in the campaign ledger; everything else in the ownership table holds.

---

## Part 1 — CHAT-BRIDGE ("It's time to workbench", campaign #7)

### 1.1 The chat answer path today (grounding)

- The reader asks via the overlay field; `ProfOverlay.tsx` calls
  `useProfessor({ bookKey }).ask(question)`.
- `useProfessor.ts` streams tokens (`onToken`), then in `onDone(full, meta)`:
  - `stripAnnotations(full)` (`services/professor/annotations.ts:183`) removes
    DSL tags — this is the ONLY text that may reach speech or the eye;
  - `parseAnnotations(full)` (annotations.ts:96) parses known tags for the pen
    and the learner log; `pushExchange` stores the cleaned Q/A in the
    module-level `exchangesByBook` map (`EXCHANGE_CAP = 4`);
  - the exchange is folded into `learner.json` via `appendExchange`.
- The spoken path is **streaming**: `voice.push(t)` receives raw token deltas
  (useProfessor.ts `onToken`). `stripAnnotationTags` (annotations.ts:176) only
  strips tags matching `TAG_RE` (annotations.ts:80). **`TAG_RE` does not know
  `TO_WORKBENCH`** — an unhandled tag would be spoken aloud and shown in the
  subtitle. The bridge parser must therefore own both a stream filter
  (speech-safe) and a terminal extractor.

### 1.2 New file (D-owned): `apps/readest-app/src/services/professor/bridge.ts`

```ts
/**
 * Chat-bridge (Workbench 2.x #7) — "take it to the desk".
 *
 * When a chat exchange goes deep (the reader's question wants line-by-line
 * worked steps, a derivation, or page-anchored development that a spoken
 * answer cannot carry), the professor may close his answer with ONE
 * protocol tag on its own line at the very end:
 *
 *   [TO_WORKBENCH prompt:'one line, in his words, single-quoted']
 *
 * The tag is a signal, never display: stripped from speech and prose the
 * moment it streams, parsed into a persistent inline suggestion, and never
 * shown raw. Malformed variants pass through untouched (the
 * professorTags.ts precedent: only well-formed tags are consumed).
 */
import { create } from 'zustand';

/** Exact tag name and the single-quoted grammar. One tag per answer. */
export const WORKBENCH_BRIDGE_TAG = 'TO_WORKBENCH';
export const BRIDGE_PROMPT_MAX_CHARS = 280;

/** Well-formed tag, single line, single-quoted prompt, no newline inside. */
const BRIDGE_TAG_RE = /\[TO_WORKBENCH prompt:'([^'\n]*)'\]/;

export interface WorkbenchBridgeSuggestion {
  bookKey: string;
  /** The reader's own question that went deep — seeded into the desk session. */
  question: string;
  /** The professor's one-line reason, from the tag body (≤ 280 chars). */
  prompt: string;
  /** The exchange's concept slug, when the answer carried [CONCEPT:…]. */
  concept?: string;
  /** ISO timestamp of the answer. */
  at: string;
}

/**
 * Terminal parse — call once on the full raw answer (useProfessor onDone).
 * Returns the suggestion (null when the tag is absent or malformed) and the
 * text with every well-formed bridge tag removed. Whitespace is NOT
 * otherwise normalized: `stripAnnotations` downstream owns that, same
 * contract as `stripAnnotationTags`.
 */
export function extractBridgeSuggestion(
  raw: string,
  ctx: { bookKey: string; question: string; concept?: string },
): { suggestion: WorkbenchBridgeSuggestion | null; text: string } {
  const m = raw.match(BRIDGE_TAG_RE);
  if (!m) return { suggestion: null, text: raw };
  const prompt = (m[1] ?? '').trim();
  if (!prompt) return { suggestion: null, text: raw }; // malformed = leave intact
  return {
    suggestion: {
      bookKey: ctx.bookKey,
      question: ctx.question,
      prompt: prompt.slice(0, BRIDGE_PROMPT_MAX_CHARS),
      ...(ctx.concept ? { concept: ctx.concept } : {}),
      at: new Date().toISOString(),
    },
    text: raw.replace(BRIDGE_TAG_RE, ''),
  };
}

/**
 * Stream filter — call per token BEFORE `voice.push` and before appending to
 * the answer state. Chunk-safe: a tag split across token boundaries is
 * buffered and dropped whole; everything else passes through verbatim
 * (whitespace untouched — the voice path tracks offsets into this stream).
 * Call `flush()` from onDone to release a harmless trailing remainder.
 */
export function makeBridgeTagFilter(): { push(chunk: string): string; flush(): string } {
  let held = '';
  return {
    push(chunk: string): string {
      const buf = held + chunk;
      // A '[' followed by a newline or space is prose bracketing (the
      // holdPartialTag precedent in services/professor/voice.ts:101).
      const open = buf.lastIndexOf('[');
      if (open === -1) {
        held = '';
        return buf;
      }
      const close = buf.indexOf(']', open);
      if (close !== -1) {
        const seg = buf.slice(open, close + 1);
        const rest = buf.slice(0, open) + buf.slice(close + 1);
        if (/^\[TO_WORKBENCH\b/.test(seg)) {
          held = '';
          return rest; // complete bridge tag — dropped
        }
        held = '';
        return buf; // some other bracket construct — pass through
      }
      const frag = buf.slice(open);
      if (frag.includes('\n') || frag.startsWith('[ ')) {
        held = '';
        return buf;
      }
      held = frag; // possibly a tag split mid-stream — hold it
      return buf.slice(0, open);
    },
    flush(): string {
      const rest = held;
      held = '';
      return rest;
    },
  };
}

// ── Suggestion store (persistent, per the standing law) ────────────────────

interface BridgeState {
  /** The latest live suggestion for this book; survives overlay close/reopen,
   *  replaced by the next answer that carries the tag, cleared on act/dismiss. */
  suggestion: WorkbenchBridgeSuggestion | null;
  setSuggestion: (s: WorkbenchBridgeSuggestion) => void;
  clear: () => void;
}

export const useBridgeStore = create<BridgeState>((set) => ({
  suggestion: null,
  setSuggestion: (suggestion) => set({ suggestion }),
  clear: () => set({ suggestion: null }),
}));

// ── Handoff to the desk ────────────────────────────────────────────────────

export const WORKBENCH_BRIDGE_EVENT = 'palimpsest-workbench-bridge';

export interface WorkbenchBridgeRequest {
  bookKey: string;
  /** Seeded as the first student block of the desk session. */
  question: string;
  concept?: string;
  at: string;
}

// Consumed exactly once per book by the Workbench tab (integration note
// §1.6). Module-level, not zustand: a one-shot handoff, not state.
const pending = new Map<string, WorkbenchBridgeRequest>();

/** Stage + announce. The overlay calls this on "Take it to the desk". */
export function requestWorkbenchBridge(req: WorkbenchBridgeRequest): void {
  pending.set(req.bookKey, req);
  window.dispatchEvent(new CustomEvent(WORKBENCH_BRIDGE_EVENT, { detail: req }));
}

/** The desk calls this on mount and on the event; exactly-once semantics. */
export function consumeWorkbenchBridge(bookKey: string): WorkbenchBridgeRequest | null {
  const req = pending.get(bookKey) ?? null;
  if (req) pending.delete(bookKey);
  return req;
}
```

### 1.3 `useProfessor.ts` additive hooks (D-owned)

Precedent for cross-surface events already lives here: the `PROF_ASK_EVENT`
listener (`window.addEventListener(PROF_ASK_EVENT, onAsk)`) with
`'palimpsest-prof-ask'` dispatched from `StudyTab.tsx`'s
`askProfessorFromUI`. The bridge mirrors it.

1. Module top: `import { extractBridgeSuggestion, makeBridgeTagFilter, useBridgeStore } from '@/services/professor/bridge';`
2. Inside `ask`, beside `let streamBuf = '';`:
   `const bridgeFilter = makeBridgeTagFilter();`
3. In `onToken`, replace the raw token uses (speech, answer state, ink buffer):
   ```ts
   const safe = bridgeFilter.push(t);
   if (!safe && !t.includes(']')) return; // nothing releasable this chunk
   setAnswer((prev) => prev + safe);
   streamBuf += safe;
   if (safe.includes(']')) publishStreamingInk();
   voice.push(safe); // the tag can never reach the ear
   ```
   (If `safe` is empty and nothing was held-released, skip the rest — the
   `!t.includes(']')` guard is only an optimization; correctness comes from
   the filter.)
4. In `onDone`, **before** `stripAnnotations(full)`:
   ```ts
   const conceptTag = parsed /* existing parseAnnotations(full) call */.find(
     (a): a is Extract<ProfessorAnnotation, { kind: 'concept' }> => a.kind === 'concept',
   )?.name;
   const { suggestion } = extractBridgeSuggestion(full, { bookKey, question: q, concept: conceptTag });
   if (suggestion) useBridgeStore.getState().setSuggestion(suggestion);
   bridgeFilter.flush();
   ```
   `full` continues into the existing `stripAnnotations(full)` unchanged —
   the bridge tag is already gone from it (and was never in `answer`, which
   accumulated filtered tokens; `setAnswer(cleaned)` overwrites it anyway).

**No learner.json change.** The exchange logs exactly as today — the bridge
tag never enters `question` or the distilled note.

### 1.4 `ProfOverlay.tsx` — the persistent inline suggestion (D-owned)

Standing law: **no chat bubbles, no mid-session buttons, protocol tags never
displayed.** This renders as a cataloguer's plate **inline in the overlay
column** (not a floating chip — it is part of the answer's presence, anchored
below the ask card, above the subtitle slot) and stays for the life of the
suggestion: it does not auto-fade like the one-line subtitle, and it survives
an Esc-close/reopen because it lives in `useBridgeStore`. Exactly one action.

```tsx
import { useBridgeStore, requestWorkbenchBridge } from '@/services/professor/bridge';
import { useNotebookStore } from '@/store/notebookStore';
import './prof-bridge.css';

// inside ProfOverlay, after `const { open, phase, answer, ... } = useProfessor(...)`:
const suggestion = useBridgeStore((s) => s.suggestion);
const clearSuggestion = useBridgeStore((s) => s.clear);

const takeToDesk = () => {
  if (!suggestion) return;
  requestWorkbenchBridge({
    bookKey,
    question: suggestion.question,
    ...(suggestion.concept ? { concept: suggestion.concept } : {}),
    at: suggestion.at,
  });
  // Tab-activation precedent: Notebook.tsx handleTabChange →
  // setNotebookActiveTab; store-only, no settings write needed here.
  useNotebookStore.getState().setNotebookActiveTab('workbench');
  useNotebookStore.getState().setNotebookVisible(true);
  clearSuggestion();
};
```

Render (inside the existing overlay column `div`, after the ask-card block,
sibling of the subtitle):

```tsx
{phase === 'idle' && suggestion && (
  <div className='wb-bridge plate chrome-lift' role='note'>
    <p className='wb-bridge-label'>{_('THE DESK WOULD SERVE THIS BETTER')}</p>
    <p className='wb-bridge-copy'>{suggestion.prompt}</p>
    <StampButton onClick={takeToDesk}>{_('Take it to the desk')}</StampButton>
  </div>
)}
```

Dismissal: a small typed text button beside the stamp, `_("Not now")` →
`clearSuggestion()`. No other chrome, no iconography beyond the stamp grammar
(`StampButton` from `@/components/apothecary`, props per
`StampButton.tsx`: `variant?: 'stamp' | 'ink'`, className passthrough).

### 1.5 New file (D-owned): `apps/readest-app/src/app/reader/components/professor/prof-bridge.css`

Unlayered CSS, catalogue grammar, light mode only, stamp `#8C3B22` sole
accent (same conventions as `WorkbenchTab.css`):

```css
.wb-bridge {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 24rem;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--stamp) 55%, transparent);
}
.wb-bridge-label {
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--stamp);
}
.wb-bridge-copy {
  font-family: Newsreader, Georgia, serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink);
  font-style: italic;
}
```

### 1.6 Desk seed consumption — **queen-wired integration note**

`WorkbenchTab.tsx` is lane-A; the seed hook is ~10 additive lines. Two
options — the queen picks at integration (recommend **(a)**):

**(a) Event + once-consume (recommended).** In `WorkbenchTab.tsx`, beside the
existing session bootstrap:

```ts
import { WORKBENCH_BRIDGE_EVENT, consumeWorkbenchBridge, type WorkbenchBridgeRequest } from '@/services/professor/bridge';

// after startSession is defined; startSessionRef mirrors the StudyTab
// askObjectiveRef pattern:
const startSessionRef = useRef(startSession);
startSessionRef.current = startSession;

useEffect(() => {
  // A bridge request that landed while the tab was unmounted.
  const staged = consumeWorkbenchBridge(bookKey);
  if (staged) seedAndStart(staged);
  const onBridge = (e: Event) => {
    const req = (e as CustomEvent<WorkbenchBridgeRequest>).detail;
    if (req?.bookKey !== bookKey) return;
    seedAndStart(req);
  };
  window.addEventListener(WORKBENCH_BRIDGE_EVENT, onBridge);
  return () => window.removeEventListener(WORKBENCH_BRIDGE_EVENT, onBridge);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [bookKey]);

/** The chat handoff: the question becomes the first student block, then the
 *  normal opening summarizes it (composeWorkbenchOpening's history section —
 *  no change to workbenchSession.ts needed). */
const seedAndStart = (req: WorkbenchBridgeRequest) => {
  const seed: TranscriptBlock = {
    id: newBlockId(),
    author: 'user',
    content: req.question,
    at: req.at,
  };
  appendBlock(bookKey, seed);
  startSessionRef.current();
};
```

Why no `workbenchSession.ts` change: `startSession` already passes
`resumeBlocks: existing` and `composeWorkbenchOpening` summarizes the last
`HISTORY_BLOCK_LIMIT = 12` blocks under "The recent professor–student
exchange in this workbench" — the seed question rides in as
`Student: <question>`. Backward compatibility untouched (a plain `user`
block; no new kind; `parseTranscript` loads 2.1 transcripts unchanged).

**(b) Optional `seedQuestion` param** on `startWorkbenchSession` →
`composeWorkbenchOpening` (B-owned files). More prompt control, more files
touched. Only if review finds the history-summary framing too weak.

### 1.7 Professor instruction — **queen-wired integration note (prompt.ts)**

`PROFESSOR_SYSTEM_PROMPT` (prompt.ts:14) gains one additive paragraph
(nothing above it changes; `professor-prompt.test.ts` keeps guarding the
original text — the test may gain an assertion that this paragraph exists):

```
Routing to the desk: when the reader's question wants line-by-line worked
steps, a multi-step derivation, or development that a short spoken answer
cannot carry, you may close your answer with ONE tag on its own line at the
very end, after the logging tags: [TO_WORKBENCH prompt:'one short line, in
your own words, single-quoted']. Never in your first answer to a reader;
never more than once in a sitting; never when the reader is mid-explanation.
The tag is never spoken and never shown — write the answer so it stands
without it.
```

---

## Part 2 — LEARN-PROFILE (W2.4, campaign #8)

### 2.1 New file (D-owned): `apps/readest-app/src/services/professor/learnerProfile.ts`

Storage: **one local JSON per reader** (app-level, not per book — unlike
`learner.json`). Real app-data helper: the `AppService` file API —
`readFile(path, base, mode)` / `writeFile(path, base, content)`
(`apps/readest-app/src/types/system.ts:69-70`), `BaseDir` includes `'Data'`
(types/system.ts:18). Service acquisition pattern: `environmentConfig.
getAppService()` exactly as `workbenchSession.ts:179` (`loadLearnerSafely`)
does. File: `'Data'` base, path `professor/learner-profile.json`.

```ts
/**
 * Learner profile (Workbench 2.x W2.4) — the reader's own account of how
 * they like to learn. One local JSON per reader (app-data dir). Every field
 * is OPTIONAL; an empty profile means "the professor teaches you as he finds
 * you" — the default professor, byte-identical prompts. The profile is a
 * gentle preference only: the evidence in learner.json always outranks it.
 *
 * Prompt use is additive-only: at most 5 short lines at T3 (session state),
 * next to the learner-log summary. It never rewrites
 * PROFESSOR_WORKBENCH_ADDENDUM and never touches the tiered pack (T0–T4).
 */
import environmentConfig from '@/services/environment';
import type { AppService } from '@/types/system';
import { slugifyConcept } from './annotations';

export const LEARNER_PROFILE_PATH = 'professor/learner-profile.json';

export const PROFILE_PACES = ['deliberate', 'steady', 'swift'] as const;
export type ProfilePace = (typeof PROFILE_PACES)[number];

/** Preferred probe depth — how high the disclosure ladder climbs before the
 *  professor releases a full answer (Bloom ceiling 1..6, matching the
 *  concept history's bloom scale in learner.ts). */
export const PROFILE_PROBE_MIN = 1;
export const PROFILE_PROBE_MAX = 6;

export const PROFILE_VOICES = ['formal', 'plain', 'playful'] as const;
export type ProfileVoice = (typeof PROFILE_VOICES)[number];

/** Cap on owned-concept names injected into the prompt line. */
export const PROFILE_OWNED_CONCEPT_MAX = 8;

export interface LearnerProfile {
  pace?: ProfilePace;
  /** Concepts the reader says they already own (slugs, deduped). */
  owned_concepts?: string[];
  probe_level?: number; // 1..6
  voice?: ProfileVoice;
}

export const emptyProfile = (): LearnerProfile => ({});

export const isEmptyProfile = (p: LearnerProfile): boolean =>
  p.pace === undefined &&
  p.owned_concepts === undefined &&
  p.probe_level === undefined &&
  p.voice === undefined;

/**
 * Tolerant parse — corrupt files degrade to the empty profile, never throw
 * (the loadLearner precedent). Invalid fields are dropped individually; a
 * present-but-empty object normalizes to {} (fields stripped when invalid).
 */
export function normalizeProfile(raw: unknown): LearnerProfile {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: LearnerProfile = {};
  if (PROFILE_PACES.includes(r.pace as ProfilePace)) out.pace = r.pace as ProfilePace;
  if (PROFILE_VOICES.includes(r.voice as ProfileVoice)) out.voice = r.voice as ProfileVoice;
  const probe = Math.round(Number(r.probe_level));
  if (Number.isFinite(probe) && probe >= PROFILE_PROBE_MIN && probe <= PROFILE_PROBE_MAX)
    out.probe_level = probe;
  if (Array.isArray(r.owned_concepts)) {
    const slugs = [
      ...new Set(
        r.owned_concepts
          .filter((c): c is string => typeof c === 'string')
          .map((c) => slugifyConcept(c))
          .filter(Boolean),
      ),
    ];
    if (slugs.length > 0) out.owned_concepts = slugs;
  }
  return out;
}

// ── Persistence (AppService file API, 'Data' base — per reader) ────────────

const toText = (c: string | ArrayBuffer): string =>
  typeof c === 'string' ? c : new TextDecoder().decode(c);

export async function loadProfile(appService: AppService): Promise<LearnerProfile> {
  try {
    const raw = toText(await appService.readFile(LEARNER_PROFILE_PATH, 'Data', 'text'));
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return {}; // no profile yet — the default professor
  }
}

export async function saveProfile(appService: AppService, profile: LearnerProfile): Promise<void> {
  const clean = normalizeProfile(profile);
  await appService.writeFile(LEARNER_PROFILE_PATH, 'Data', JSON.stringify(clean, null, 2));
}

/** Convenience for UI lanes: acquire the service the loadLearnerSafely way. */
export async function loadProfileCurrent(): Promise<LearnerProfile> {
  try {
    return await loadProfile(await environmentConfig.getAppService());
  } catch {
    return {};
  }
}

// ── Prompt material (additive-only, T3 session state) ─────────────────────

/**
 * The profile as 0–5 prompt lines (3–5 when anything is set — the header
 * plus one line per set field). Empty profile → []. Each line is short and
 * human; the professor reads preference, the log's Bloom counts remain the
 * release-gate authority (PROFESSOR_SYSTEM_PROMPT's ladder is untouched).
 */
export function profileLinesForPrompt(profile: LearnerProfile): string[] {
  const p = normalizeProfile(profile);
  if (isEmptyProfile(p)) return [];
  const lines: string[] = [
    "Reader's own account of themselves (their study profile — a gentle preference; the study log outranks it):",
  ];
  if (p.pace === 'deliberate') lines.push('- They like a deliberate pace — give ideas room to land before moving on.');
  else if (p.pace === 'steady') lines.push('- They keep a steady pace — match it, neither rushed nor lingering.');
  else if (p.pace === 'swift') lines.push('- They move swiftly — keep explanations tight and get to the question.');
  if (typeof p.probe_level === 'number')
    lines.push(`- Probe them up to Bloom ${p.probe_level} before releasing a full answer.`);
  if (p.owned_concepts && p.owned_concepts.length > 0)
    lines.push(
      `- They say they already own: ${p.owned_concepts.slice(0, PROFILE_OWNED_CONCEPT_MAX).join(', ')}.`,
    );
  if (p.voice === 'formal') lines.push('- Voice of instruction: formal — precise, no familiarity.');
  else if (p.voice === 'plain') lines.push('- Voice of instruction: plain — say it as you would across a desk.');
  else if (p.voice === 'playful') lines.push('- Voice of instruction: playful — wit welcome, never at the idea\'s expense.');
  return lines.slice(0, 5);
}
```

### 2.2 T3 injection — **queen-wired integration note (workbenchSession.ts)**

`workbenchSession.ts` is lane-B; the hook is additive and rides beside the
existing learner summary (never inside `packTierSections` — T0–T4 stay
byte-stable; T3 is the turn-varying tail per the `composeWorkbenchTurnMessage`
docstring):

- `composeWorkbenchOpening` and `composeWorkbenchTurnMessage` gain an
  optional `profile?: LearnerProfile` argument; when `profileLinesForPrompt`
  returns non-empty, its lines are `parts.push(...)`ed **immediately after**
  the `summarizeLearner` block.
- `startWorkbenchSession` / `sendWorkbenchTurn` load it once per call,
  `loadLearnerSafely`-style:
  ```ts
  const profile = await loadProfileSafely(); // try/catch → {} — same shape as loadLearnerSafely
  ```
- Net effect on the prompt: +1 header + up to 4 lines, capped at 5 total.
  **Additive-only; `PROFESSOR_WORKBENCH_ADDENDUM` is never edited** (standing
  law 4).
- (Optional, queen's call) the same lines may ride in the chat path's
  `buildProfessorUserMessage` (prompt.ts:63) after the concept-history
  block. Same function, same cap — one call site is the W2.4 minimum.

### 2.3 Settings panel (D-owned): new file
### `apps/readest-app/src/components/settings/StudyProfilePanel.tsx`

Registered as a new **'Study'** tab in `SettingsDialog.tsx` (the settings
touch D owns — additive everywhere):

1. `SettingsPanelType` union gains `'Study'`.
2. `tabConfig` gains `{ tab: 'Study', icon: PiGraduationCap, label: _('Study') }`
   (`PiGraduationCap` is already the study icon in `NotebookTabNavigation.tsx`).
3. `resetFunctions` initial state gains `Study: null`; render branch gains
   `<StudyProfilePanel onRegisterReset={(fn) => registerResetFunction('Study', fn)} />`.
4. The `panelMap` in the `activeSettingsItemId` effect gains `study: 'Study'`
   (deep-link parity).

Panel shape — primitives from `@/components/settings/primitives`
(`SectionTitle`, `SettingsRow`, `SettingsSelect`, `SettingLabel`,
`NavigationRow` pattern per `IntegrationsPanel.tsx`; local state +
`loadProfileCurrent`/`saveProfile` on mount/save; no new persistence
machinery):

- Loads on mount via `loadProfileCurrent()`; every change saves via
  `saveProfile(appService, next)` (acquire `appService` from `useEnv()`,
  like every panel). Reset (for `onRegisterReset`) clears to `emptyProfile()`.
- **Pace of study** — `SettingsSelect` over the three paces; unset row means
  default. Options labelled: `deliberate` → `_("Deliberate — room to think")`,
  `steady` → `_("Steady — neither rushed nor lingering")`,
  `swift` → `_("Swift — keep it tight")`.
- **How far the professor probes** — `SettingsSelect` 1–6, unset = default;
  option labels plain numerals with Bloom names 1 `Remembering` … 6
  `Creating` (the Bloom scale the concept history already uses).
- **Voice of instruction** — `SettingsSelect`:
  `formal` → `_("Formal — precise, no familiarity")`,
  `plain` → `_("Plain — across the desk")`,
  `playful` → `_("Playful — wit welcome")`.
- **Concepts you already own** — the current list, each row with a remove
  (✕) action; a `PaperField`-style input + "Add" appends via
  `slugifyConcept` (write through `normalizeProfile` so duplicates collapse).
- Empty-state copy: `_("Leave everything unset and the professor teaches you as he finds you.")`

### 2.4 `_()` string table (every new user-facing string)

| String id (source text) | Where |
|---|---|
| `The desk would serve this better` → rendered uppercase by the typed label | bridge plate |
| `Take it to the desk` | bridge action |
| `Not now` | bridge dismiss |
| `Study` | settings tab |
| `How you like to learn` | panel heading (`SectionTitle`) |
| `Pace of study` | panel section |
| `Deliberate — room to think` / `Steady — neither rushed nor lingering` / `Swift — keep it tight` | pace select |
| `How far the professor probes` | panel section |
| `Voice of instruction` | panel section |
| `Formal — precise, no familiarity` / `Plain — across the desk` / `Playful — wit welcome` | voice select |
| `Concepts you already own` | panel section |
| `Add a concept` (input placeholder) / `Add` | owned-concepts input |
| `Nothing set yet` | owned-concepts empty |
| `Leave everything unset and the professor teaches you as he finds you.` | panel footer |
| `Reader profile cleared.` (or reuse Reset toast copy) | reset feedback |

(Prompt-side strings in `profileLinesForPrompt` are professor-facing prompt
material, not UI — they follow the existing `summarizeLearner`/`stuckNoteForPrompt`
precedent of English prompt prose, exempt from `_()` exactly like those.)

---

## Part 3 — Tests (6–10 vitest cases)

Two new files, matching the existing layout
(`apps/readest-app/src/__tests__/services/professor-*.test.ts`,
vitest, `describe/it/expect` per `professor-learner.test.ts`). No existing
test files are modified.

### `apps/readest-app/src/__tests__/services/professor-bridge.test.ts`

1. **parse: well-formed tag** — `extractBridgeSuggestion` on an answer ending
   `[TO_WORKBENCH prompt:'This wants working line by line.']` returns the
   prompt, the ctx question, and `text` with the tag removed; the remaining
   prose is intact.
2. **parse: absent / malformed** — no tag → `suggestion: null`, text
   byte-identical; double-quoted `prompt:"…"`, unquoted, and
   `prompt:''` → null **and the raw text left untouched** (malformed passes
   through, the professorTags precedent).
3. **parse: multiple tags → first wins, all stripped**; prompt longer than
   280 chars is capped.
4. **filter: speech-safety** — `makeBridgeTagFilter()` fed the tag split
   across 2–3 chunk boundaries drops it whole and releases the surrounding
   prose unchanged; a non-tag bracket like `[0,1]` passes through; a trailing
   partial `[TO_WOR` is held, then returned by `flush()`.
5. **handoff: exactly-once** — `requestWorkbenchBridge` (stub
   `window.dispatchEvent` or run under jsdom) then `consumeWorkbenchBridge`
   returns the request once and `null` thereafter; a different `bookKey`
   returns `null`.

### `apps/readest-app/src/__tests__/services/learner-profile.test.ts`

6. **normalize: garbage in, empty out** — non-object, wrong-typed fields,
   `probe_level: 9` / `0.5` / `'4'` → dropped; concepts slugged + deduped
   (`"Associated Primes!"` → `associated_primes`); `isEmptyProfile({})` true.
7. **round-trip** — an in-memory `AppService` stub (`readFile`/`writeFile`
   over a `Map`, cast to `AppService`) round-trips a full profile through
   `saveProfile`/`loadProfile`; a corrupt JSON file loads as `{}` without
   throwing.
8. **injection cap** — every field set → `profileLinesForPrompt` returns
   ≥3 and ≤5 lines; empty profile → `[]`; owned list of 12 concepts injects
   at most `PROFILE_OWNED_CONCEPT_MAX` names on one line.

Writer gate: `npx tsc --noEmit` + `npx vitest run src/__tests__/services/professor-bridge.test.ts src/__tests__/services/learner-profile.test.ts` + no new lint errors in touched files.

---

## File-touch list (summary)

| File | Lane | Nature |
|---|---|---|
| `apps/readest-app/src/services/professor/bridge.ts` | **D new** | tag grammar, stream filter, suggestion store, handoff |
| `apps/readest-app/src/app/reader/hooks/useProfessor.ts` | **D** | additive: filter in `onToken`, extract in `onDone` |
| `apps/readest-app/src/app/reader/components/professor/ProfOverlay.tsx` | **D** | inline suggestion plate + one action |
| `apps/readest-app/src/app/reader/components/professor/prof-bridge.css` | **D new** | unlayered, wb-bridge classes |
| `apps/readest-app/src/services/professor/learnerProfile.ts` | **D new** | schema, normalize, persistence, `profileLinesForPrompt` |
| `apps/readest-app/src/components/settings/StudyProfilePanel.tsx` | **D new** | view/edit panel |
| `apps/readest-app/src/components/settings/SettingsDialog.tsx` | **D** | additive 'Study' tab registration |
| `apps/readest-app/src/services/prompt.ts` (`PROFESSOR_SYSTEM_PROMPT`) | **queen** | additive bridge-emit paragraph (integration note §1.7) |
| `apps/readest-app/src/services/professor/workbenchSession.ts` (compose fns) | **queen** | additive `profile` arg + `profileLinesForPrompt` at T3 (§2.2) |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx` | **queen** | additive bridge seed-consume hook (§1.6, option a) |
| `apps/readest-app/src/__tests__/services/professor-bridge.test.ts` | **D new** | 5 cases |
| `apps/readest-app/src/__tests__/services/learner-profile.test.ts` | **D new** | 3+ cases |

## Backward compatibility (standing law 5)

- No transcript schema change (seed is a plain `user` block); 2.1
  `workbench-transcript.json` loads unchanged.
- `learner.json` untouched. New `learner-profile.json` is a new file; absence
  = default professor.
- The bridge tag is invisible to old renderers only in the sense that old
  builds would leak it — it is a new protocol signal gated behind the new
  prompt paragraph, and the filter guarantees no render/speech path can show
  it in new builds.
