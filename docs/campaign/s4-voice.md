# S4 Spec — VOICE ANSWERS (owner item 5, lane C)

**Status:** scout spec, ready for writer C. **Runs AFTER A+B merge.**
**Design world:** The Antiquarian Catalogue — light mode, `var(--stamp)` = `#8C3B22` is the sole accent, unlayered CSS, librarian voice (error *kinds* with fixed copy, never raw provider detail).
**Binding constraints:** `docs/WORKBENCH_2_X_CAMPAIGN.md` non-negotiables 1–5 ( `_()` for every user-facing string; no chat bubbles / no mid-session buttons / tags never displayed; light mode; prompt material **additive-only** to `PROFESSOR_WORKBENCH_ADDENDUM`; transcript schema extensions additive and 2.1-backward-compatible).

---

## 1. Decision log (decided + justified)

### 1.1 Transcript stores metadata only; audio re-synthesized on replay — **RECOMMENDED, adopted**

The campaign contract allows either "re-synthesize on replay" or "cache audio files under the book's dir". **We re-synthesize.** Justification, grounded in the code:

- Professor workbench blocks are short (one teaching turn, `HISTORY_BLOCK_CHARS = 1200` cap in `workbenchSession.ts`), and the local server (`narrationQwenProvider.ts`, `DEFAULT_BASE = 'http://127.0.0.1:8737'`, `POST /tts`) returns a whole `ArrayBuffer` in one request. Replay latency is one local synthesis, not a network fetch — and `NarrationQwenProvider.cacheable = true` already in-RAM caches per unit in the narration player (`player.ts` `#audioCache`), proving the latency model is acceptable on this stack.
- **Always matches edits:** replay speaks the block's current `content`, so a restored/edited transcript can never point at stale audio. A file cache keyed on text-hash duplicates the transcript document's job and orphans `.audio` blobs under the book's directory when blocks are deleted.
- **Single-document persistence:** the transcript stays one `workbench-transcript.json` per book (the 2.1 contract, `workbenchChat.ts` `WORKBENCH_TRANSCRIPT_FILENAME`). No second artifact to version, clean up, or corrupt.
- **Disk cost avoided:** no audio files under the book dir; no new AppService write path.
- Mitigation for latency: a **session-scoped in-memory cache** inside the player, keyed `blockId + contentHash(text)` (see §4). It dies with the sitting; the paper remains the source of truth.

Consequence: the campaign's `voice` block metadata (audio ref + duration + voice id) collapses to **voice id + last-heard timestamp**; the "audio ref" is deliberately omitted (there is no audio file) and **duration is deliberately omitted** — the duration of re-synthesized audio is not stable metadata (it changes with voice, rate, and provider), and nothing in the UI consumes it. This is noted against the campaign contract as an intentional narrowing.

### 1.2 `[VOICE]` semantics: on-demand playback control per professor block, NOT auto-speak — **adopted**

- The reader presses to hear; sound never arrives uninvited. The desk is quiet paper; a speaking professor with no gesture breaks the room (and startles in a library).
- Auto-speak at commit time would race synthesis latency: the professor block streams token-by-token (`WorkbenchTab.tsx` `onToken`), and the proven low-latency machinery for that (`SpeechFeeder` sentence streaming in `professor/voice.ts`) is built for the tutor overlay, not the transcript. On-demand playback speaks a *complete* block; no streaming feeder is needed.
- **Audio focus:** auto-speak guarantees focus fights with the narration session (Space-to-pause, sentence skip — `useNarration.ts`). On-demand + the busy-refusal rule (§6) makes conflicts the reader's explicit choice, and rare.
- `[VOICE]` remains meaningful: it is the professor's explicit *request* to be heard. The playback control on a `[VOICE]`-tagged block renders in the stamp accent with a slip ("The professor asks that this be heard."). On untagged professor blocks the same control renders quiet (muted ink tone). Playback is always initiated by the reader either way.

### 1.3 Ride the narration controller's speech identity (HP-3 pattern) — **adopted**

`workbenchVoice.ts` does **not** re-implement provider selection. It receives `getSpeech: () => ProfessorSpeechSource | null` (interface already exported from `services/professor/voice.ts`: `{ provider, voice, lang, rate }`), and `WorkbenchTab` supplies `() => getNarration(bookKey)?.controller?.speech ?? null` — exactly the pattern `useProfessor.ts:84-90` uses for `ProfessorVoice`. Voice id and rate therefore come from narration settings (`useNarrationSettings`: `provider`, `qwenVoiceId`, `edgeVoiceId`, `elevenlabsVoiceId`, `rate`) **resolved once by `NarrationController.load`** (`controller.ts:160-196`), with the controller's hot-swap rebuild (`useNarration.ts` settings subscription) applying automatically. **No new settings.** When `getSpeech()` returns `null` (no narration session — e.g. the speech engine itself failed init even though the text layer exists), the control renders muted with the `voice-unavailable` notice; we do not construct a private provider.

### 1.4 How the "token" is fetched — clarification for the writer

There is **no auth token** anywhere in this path. The sidecar at `http://127.0.0.1:8737` is unauthenticated loopback; `NarrationQwenProvider.synthesize` posts `{ text, voice, instruct? }` to `/tts` and returns `{ audio, boundaries }` (`narrationQwenProvider.ts:120-151`). Transport rides `getAIFetch()` (`services/ai/utils/httpFetch`) so the Tauri webview CSP/preflight stays out of the picture. The "voice identity" a caller needs is `NarrationController.speech` (`controller.ts`), which `workbenchVoice` reads at speak time — so a Settings voice hot-swap applies to the next playback, per the file's own doc comment.

---

## 2. `[VOICE]` tag semantics

- **Professor's contract:** end a turn with `[VOICE]` on its own line (with the other protocol tags) when the turn is best *heard* — a pronunciation, a rhythm, a quoted voice. The written answer must still be complete and self-sufficient; the transcript is read first, heard on request. (Additive addendum line, §8.)
- **Parsing:** `[VOICE]` is a boolean protocol tag, case-sensitive, captured in pass 1 of the two-pass scanner `parseProfessorTags` (`professorTags.ts`), i.e. it is stripped from `display` even inside an unterminated `$$` shield, and it never reaches the synthesizer or the eye. It carries **no value** (`[VOICE:anything]` captures nothing — value ignored).
- **Streaming:** no change needed to `stripPartialTagTail` (`workbenchChat.ts`) — its tail regex `[A-Z][A-Z0-9_-]*` already eats a trailing `[VOICE]` during streaming.
- **Metadata:** `commitProfessorBlock` (`workbenchChat.ts`) sets `block.voice = { requested: true }` when `parsed.voice`. The player later writes back `voiceId` and `lastHeardAt` (§4.4). Unknown/2.1 transcripts simply lack the field — graceful by construction.

---

## 3. Block model extension (additive-only; campaign non-negotiable 5)

In `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` (A-owned; C edits **after A merges**, strictly additive):

```ts
export interface TranscriptBlock extends WorkbenchBlock {
  concept?: string;
  qkind?: string;
  point?: string;
  ended?: boolean;
  /** [VOICE] — the professor asked that this turn be heard (never displayed).
   *  voiceId/lastHeardAt are written back after a successful playback so a
   *  restored sitting remembers which voice spoke. Absent on 2.1 transcripts. */
  voice?: {
    requested: boolean;
    voiceId?: string;
    lastHeardAt?: string; // ISO timestamp
  };
}
```

`isBlock` (`workbenchChat.ts`) is **not** tightened — extra fields already pass the shape check and JSON round-trip preserves them, which is exactly what keeps 2.1 transcripts loading cleanly.

In `apps/readest-app/src/services/professor/professorTags.ts` (A-owned; additive after merge):

```ts
export interface ParsedProfessorMessage {
  display: string;
  concept?: string;
  qkind?: string;
  end?: boolean;
  point?: string;
  voice?: boolean; // [VOICE]
}
```

- `PROTOCOL_TAG` becomes `/\[(CONCEPT|QKIND|WORKBENCH|POINT|VOICE)(?::([^\]\n]*))?\]/g`.
- `captureProtocol` gains `case 'VOICE': voice = true; break;` (value ignored).

---

## 4. `workbenchVoice.ts` — the player

**New file:** `apps/readest-app/src/services/professor/workbenchVoice.ts`.

### 4.1 Why a new player rather than reusing `ProfessorVoice`

`ProfessorVoice` (`professor/voice.ts`) is a streaming barge-in machine: it consumes token deltas (`push(delta)`), speaks sentence-by-sentence through `SpeechFeeder`, and drops everything on `stop()`. The workbench speaks **whole committed blocks** on demand with pause/resume/replay — a different state machine. We reuse its *interfaces* (`ProfessorSpeechSource`, `AudioSink`) and the same `WebAudioSink` audio element/buffer management (`webAudioSink.ts`, whose offset-bookkeeping pause/resume is exactly the resume semantics we need), and we reuse its speech-identity seam (`getSpeech`). We duplicate, locally, the 3-line `PROFESSOR_INSTRUCT` constant (calm-flat professor delivery — the user-report lesson of 2026-09-03 lives in `voice.ts:31-38` and applies verbatim to workbench turns) with a comment pointing at `voice.ts` as the source of truth, so C touches no file outside its ownership.

### 4.2 Exact TypeScript surface

```ts
import type { SpeechSynthesisResult } from '@/services/tts/providers/types';
import type { AudioSink } from '@/services/narration/player';
import type { ProfessorSpeechSource } from './voice';

/** Player lifecycle. 'unavailable' is sticky until reset() — the desk
 *  cannot speak this sitting (no speech identity), so the control stays
 *  muted rather than failing on every press. */
export type WorkbenchVoiceState =
  | 'idle'
  | 'synthesizing'
  | 'playing'
  | 'paused'
  | 'unavailable';

/** Error kinds — the UI maps each to fixed librarian copy and never shows
 *  the raw provider message. Mirrors WorkbenchErrorKind's contract in
 *  workbenchSession.ts. */
export type WorkbenchVoiceErrorKind = 'voice-unavailable' | 'voice-busy' | 'voice-failed';

export interface WorkbenchVoiceOptions {
  /** Live speech identity, HP-3: read at speak time so a Settings voice
   *  hot-swap applies to the next playback. Return null = no speech
   *  identity this sitting. */
  getSpeech: () => ProfessorSpeechSource | null;
  /** True while the narration controller owns audio focus
   *  (controller.active — player state !== 'stopped'). The workbench
   *  voice never fights it. */
  isNarrationActive: () => boolean;
  sink?: AudioSink;
  onState?: (state: WorkbenchVoiceState) => void;
  onError?: (kind: WorkbenchVoiceErrorKind) => void;
}

export class WorkbenchVoicePlayer {
  constructor(opts: WorkbenchVoiceOptions);

  get state(): WorkbenchVoiceState;
  /** The block currently playing/paused, else null. */
  get activeBlockId(): string | null;
  /** True while this block is the active one and state is playing/paused/synthesizing. */
  isActive(blockId: string): boolean;

  /** Synthesize (or reuse the session cache) and play one complete block.
   *  Speaking another block first stops the current one. */
  speak(blockId: string, text: string): Promise<void>;
  /** Same utterance from the top: replay(blockId) === speak(blockId, <the
   *  text last given for blockId>). */
  replay(blockId: string): Promise<void>;
  /** Pause the active utterance (sink offset bookkeeping). */
  pause(): void;
  /** Resume a paused utterance. */
  resume(): void;
  /** Barge-in: silence now, drop the session cache entry in flight, return
   *  to idle. Called on stop-on-new-turn and when narration takes focus. */
  stop(): void;
  /** Called once when a speech identity appears (narration session loaded
   *  late), clearing the sticky 'unavailable' state. */
  reset(): void;
}
```

No event-target surface is required: `onState`/`onError` callbacks into the React layer are sufficient (the tab holds one instance in a ref, as `useProfessor.ts` does with `ProfessorVoice`).

### 4.3 Internal state machine

- States: `idle → synthesizing → playing ⇄ paused → idle` (natural completion or `stop()`); `synthesizing/playing/paused → idle` on `stop()`; any → `unavailable` (sticky) when `getSpeech()` is null at `speak()` time.
- A monotonically increasing `#token` invalidates in-flight async work across `stop()` — the exact play-token discipline of `NarrationPlayer` (`player.ts` `#playToken`) and `ProfessorVoice` (`#token`).
- Synthesis: `speech.provider.synthesize({ lang, text, voice, pitch: 0, instruct: PROFESSOR_INSTRUCT }, AbortSignal.timeout(30_000))` — the 30 s hung-socket lesson (`player.ts SYNTH_TIMEOUT_MS`, `voice.ts` `#synthesize`). One immediate retry on transient failure (non-`SpeechSynthesisPermanentError`), then `onError('voice-failed')` and back to `idle`. `SpeechSynthesisPermanentError` skips the retry (mirrors both precedents).
- Playback: `await sink.play(result.audio, speech.rate)` — rate is sink-side and read live, so it follows the narration settings rate.
- Text preparation before synthesis (the professor's block is display markdown; tags are already stripped at commit): collapse whitespace; split off `$$…$$` display math and speak its verbalized form via `verbalizeInlineMath` + `doctorSpeakText` (both already exported from `services/narration/verbalize` and `services/narration/narrative`, used the same way by `SpeechFeeder#verbalize` in `voice.ts`). Guard with `isVerbalizerReady()` exactly as `SpeechFeeder` does. This is additive reuse — no edits to those modules.
- **Session cache:** `Map<string, Promise<SpeechSynthesisResult>>` keyed by `${blockId}:${contentHash(text)}` where `contentHash` is the same cheap hash `WorkbenchTab.tsx` already defines locally (move/duplicate the 6-line function into `workbenchVoice.ts` — do **not** export it from `WorkbenchTab`). A settled failure is evicted (`cached.catch(() => cache.delete(key))`, the `player.ts` pattern) so a retry is a fresh request. This is the only cache; nothing touches disk (§1.1).

### 4.4 Playback-result metadata write-back

On natural completion of `speak(blockId, text)`, the player resolves with the identity it used; the tab writes back into the transcript block:

```ts
block.voice = { ...block.voice, requested: block.voice?.requested ?? false, voiceId: speech.voice, lastHeardAt: new Date().toISOString() };
```

This flows through `useWorkbenchChatStore.setBlocks` (an update helper may be added to the store **additively**: `updateBlock(bookKey, blockId, patch: Partial<TranscriptBlock>)`), persisting via the existing `serializeTranscript` effect in `WorkbenchTab.tsx`. Round-trip safety is what test §9.6 guards.

---

## 5. Focus rules — the narration controller owns audio focus

The law, in precedence order:

1. **While narration is active, the workbench does not speak.** `WorkbenchTab` passes `isNarrationActive: () => getNarration(bookKey)?.controller?.active ?? false` (`controller.ts get active()` = `player.state !== 'stopped'`). If a speak is requested during active narration, the player refuses with `voice-busy` and the control shows the muted notice (§7). Never preempt, never duck, never mix.
2. **When narration takes focus, workbench voice yields instantly.** `WorkbenchTab` subscribes once per book:

   ```ts
   useEffect(() => {
     const controller = getNarration(bookKey)?.controller;
     if (!controller) return;
     const onUnitChange = () => voiceRef.current?.stop();
     controller.addEventListener('unit-change', onUnitChange);
     return () => controller.removeEventListener('unit-change', onUnitChange);
   }, [bookKey, narrationAvailable]);
   ```

   `unit-change` fires at the start of every `playFrom` (`player.ts #emitUnitChange`), i.e. reliably at narration start, so a playing/paused workbench utterance is cut the moment the book starts reading. (`'stopped'`/`'book-ended'` need no handling: the workbench isn't speaking then, since it only speaks when narration was inactive.)
3. **Stop-on-new-turn.** `WorkbenchTab.send()` calls `voiceRef.current?.stop()` before appending the user block and starting the next turn (same honesty rule as `commitPartialIfAny`: a new sitting gesture silences the old voice). Also `stop()` in the tab's unmount cleanup.
4. **No global shortcuts.** Space/arrow keys stay with the narration layer (`useNarration.ts` keyboard routing through `useTTSControl`/`useBookShortcuts`); the voice control is reached by Tab like every other control. The workbench voice registers zero window-level key listeners.
5. **Tutor overlay coexistence:** `ProfessorVoice` (hey_prof overlay) and `WorkbenchVoicePlayer` are different surfaces on the same provider; they are not both reachable simultaneously in practice (overlay vs notebook tab). No coordination code; note it as accepted.

---

## 6. Playback UI — `WorkbenchTab.tsx` (C-owned; runs after A merges)

### 6.1 Component

New presentational piece in `WorkbenchTab.tsx` (same file, following the `VerdictChip`/`PageChip` pattern):

```tsx
const VoiceControl: React.FC<{
  block: TranscriptBlock;
  player: WorkbenchVoicePlayer;
  playerState: WorkbenchVoiceState;
  notice: WorkbenchVoiceErrorKind | null;
  onSpeak: () => void;
  onPause: () => void;
  onResume: () => void;
  onReplay: () => void;
  onDismissNotice: () => void;
}> = ...
```

Mounted in the professor-block article, after `<div className='wb-content'>`, before `<hr className='wb-sep'>`:

```tsx
{b.author === 'professor' && (
  <VoiceControl
    block={b}
    player={voicePlayer}
    playerState={voiceState}
    notice={voiceNotice?.blockId === b.id ? voiceNotice.kind : null}
    ...
  />
)}
```

(Asymmetric voice: user blocks never carry the control.)

### 6.2 Behavior

- **Idle, never heard:** a quiet ink button — `Read this aloud` (aria-label). Not `[VOICE]`-promoted.
- **Idle, heard before:** `Read this aloud` + a `Read again` affordance (replay re-synthesizes through the session cache; see §4.3).
- **`[VOICE]`-tagged (`block.voice?.requested`):** the button renders promoted (stamp accent, `wb-voice-promoted`) and carries the slip *"The professor asks that this be heard."* (`wb-slip`, hover-only, `aria-label` carries the words — the existing `Slip` pattern in `WorkbenchTab.tsx`).
- **Active block:** while `player.isActive(b.id)`: state `synthesizing` shows a `Speaking…` indicator with the `wb-dots` ornament (existing pattern from `BlockChips`); `playing` shows `Pause reading`; `paused` shows `Resume reading`. The button is `aria-pressed={state === 'playing'}` and the indicator text is part of the accessible name.
- **Busy (narration active):** the button is **not disabled** (a disabled control explains nothing) — pressing it shows the muted notice `voice-busy` under the block: *"The book is still reading aloud. The desk waits its turn."* with a quiet `Dismiss` (`ink-btn`, same pattern as the error block's Try again).
- **Unavailable:** `getSpeech()` null at press → sticky muted state on the control + notice `voice-unavailable`: *"The reading voice is away."* Control stays focusable (it can be re-armed by `reset()` when a speech identity appears).
- **Failed:** notice `voice-failed`: *"The professor's voice faltered. Nothing was lost."* + `Try again` (`ink-btn`).
- **Streaming placeholder:** no control on the in-flight partial block (there is nothing complete to speak). The control appears when the block commits.

### 6.3 Wiring in the tab

- One `WorkBenchVoicePlayer` per tab in a `useRef`, lazily constructed (the `useProfessor.ts:84-90` pattern):

  ```ts
  const getVoicePlayer = useCallback((): WorkbenchVoicePlayer => {
    voiceRef.current ??= new WorkbenchVoicePlayer({
      getSpeech: () => getNarration(bookKey)?.controller?.speech ?? null,
      isNarrationActive: () => getNarration(bookKey)?.controller?.active ?? false,
      onState: (s) => setVoiceState(s),
      onError: (kind) => setVoiceNotice({ blockId: voiceRef.current?.activeBlockId ?? null, kind }),
    });
    return voiceRef.current;
  }, [bookKey]);
  ```

  `getNarration` is already imported in `WorkbenchTab.tsx` (page-chip quote plumbing). `voiceState`/`voiceNotice` are `useState`; a `useEffect` on `blocks` calls `getVoicePlayer().reset()` when a narration session becomes available (so a late-loaded session un-mutes the controls).
- `send()` gains `voiceRef.current?.stop()` as its first statement.
- Unmount cleanup: `voiceRef.current?.stop()`.

### 6.4 Keyboard & a11y contract

- The control is a real `<button type='button'>`; focus-visible ring uses the existing `button.wb-chip:focus-visible` treatment (border/shadow via `var(--stamp)`).
- All state changes are textual and inside the button's accessible name (play/pause/resume/replay labels above) — no icon-only buttons.
- The notices are `role='note'` (informational; not `alert` — a refused speak is not an emergency).

### 6.5 CSS (append to `WorkbenchTab.css`, C-owned additive block)

Unlayered, existing vars only (`--stamp`, `--ink`, `--muted`, `--paper-light`, `--sage`, `--lift-shadow`):

```css
.wb-voice { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.wb-voice-btn { /* quiet ink button; inherits .wb-chip geometry via composited rules */ }
.wb-voice-btn:focus-visible { border-color: var(--stamp); box-shadow: 0 0 0 1px var(--stamp); }
.wb-voice-promoted { color: var(--stamp); border-color: var(--stamp); }
.wb-voice-speaking { color: var(--stamp); }
.wb-voice-muted { color: var(--muted); }
.wb-voice-notice {
  margin-top: 6px; padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--ink) 25%, transparent);
  background: var(--paper-light);
  color: var(--ink);
}
.wb-voice-notice .ink-btn { margin-left: 8px; }
```

No new colors, no dark-mode block (light mode only, campaign law 3), eink variant optional but not required.

---

## 7. Failure-mode copy — librarian string table

All via `_()` (campaign law 1). Exact strings (English source):

| Kind / state | `_()` string |
|---|---|
| play (idle) | `Read this aloud` |
| replay | `Read again` |
| pause | `Pause reading` |
| resume | `Resume reading` |
| synthesizing indicator | `Speaking…` |
| `[VOICE]` slip label | `The professor asks that this be heard.` |
| `voice-busy` notice | `The book is still reading aloud. The desk waits its turn.` |
| `voice-busy` dismiss | `Dismiss` |
| `voice-unavailable` notice | `The reading voice is away.` |
| `voice-failed` notice | `The professor's voice faltered. Nothing was lost.` |
| `voice-failed` retry | `Try again` |

`Dismiss` and `Try again` may reuse the existing literals if already present in the file's `_()` calls — reuse over re-adding. Provider messages, HTTP statuses, and server text (`qwen-tts failed (500): …`) go to the console via `nwarn` only, exactly as `ProfessorVoice` does — **never** to the eye.

---

## 8. Prompt addendum (additive-only, campaign law 4)

Append **one sentence** inside the `PROFESSOR_WORKBENCH_ADDENDUM` template literal (`prompt.ts`, A-owned; C edits after A merges — the edit is a pure append to the existing string, the `professor-prompt.test.ts` guard on the original text must still pass):

```
Spoken turns: when a turn is best heard rather than read — a pronunciation, a rhythm, a quoted voice — end it with [VOICE] on its own line; the desk offers a read-aloud control for it. Every [VOICE] turn must still carry the complete written answer.
```

No changes to `PROFESSOR_SYSTEM_PROMPT`, the tiered pack, or `composeWorkbench*` (voice metadata never enters the prompt).

---

## 9. Tests — new file `apps/readest-app/src/__tests__/services/workbench-voice.test.ts`

Follow the `narration-player.test.ts` precedent: a `FakeProvider implements SpeechProvider` (records `SpeechSynthesisRequest`s, can fail per text, returns `{ audio, boundaries: [] }`) and a `FakeSink implements AudioSink` (resolvable `play`, records `pause`/`resume`/`stop`). Mocking `/tts` itself is unnecessary — the player talks to the `SpeechProvider` interface, and the qwen provider is already integration-proven; do not stand up an HTTP mock.

1. **`speak()` drives idle → synthesizing → playing** and calls `synthesize` with the resolved voice id, `pitch: 0`, an `instruct`, and the text after tag/math preparation (math `$$…$$` verbalized, no `[VOICE]`/protocol text in the request).
2. **`pause()` / `resume()` round-trip:** `pause()` in `playing` → `paused`, sink `pause()` called; `resume()` → `playing`, sink `resume()` called; natural completion after resume → `idle`, `activeBlockId` null.
3. **`replay()` re-speaks the same block from the top** using the stored text; and the **session cache** is honored — a second `speak()` with unchanged content does not call `synthesize` again, while changed content busts the cache (one new synthesis).
4. **`stop()` mid-utterance (stop-on-new-turn):** playback cuts immediately, no further synthesis happens, state returns to `idle`; a `stop()` racing an in-flight `synthesize` discards its result (token discipline — no zombie playback).
5. **`getSpeech()` null → sticky `unavailable`:** `speak()` refuses without touching the provider, emits `voice-unavailable`; `reset()` after a speech identity appears returns to `idle` and a subsequent `speak()` succeeds.
6. **Narration-active refusal:** `isNarrationActive() === true` → `speak()` emits `voice-busy` and never calls the provider or the sink.
7. **Transient synthesis failure retries once, then `voice-failed`:** first `synthesize` throws generic `Error` (one retry), second throws `SpeechSynthesisPermanentError` → no second retry, `onError('voice-failed')`, state `idle`.
8. **Block metadata round-trip (transcript compat):** `commitProfessorBlock('…answer\n[VOICE]')` → `block.voice.requested === true`, display contains no `[VOICE]`; `serializeTranscript` → `parseTranscript` preserves `voice` (requested + written-back `voiceId`/`lastHeardAt`); a hand-written 2.1 transcript (no `voice` field, `version: 1`) parses and serializes unchanged.
9. **Tag parser contract:** `parseProfessorTags('Text.\n[VOICE]')` → `voice === true`, display stripped; `[VOICE]` inside an unterminated `$$…` shield still captured; `[0,1]` inside math untouched; `[voice]` lowercase passes through intact.
10. **Rate is read live:** `speak()` uses `speech.rate` from a `getSpeech()` snapshot at speak time (change the stub's rate between speaks; assert `sink.play` received the new rate).

Run: `npx vitest run src/__tests__/services/workbench-voice.test.ts` (+ existing `workbench-chat.test.ts` must stay green). Writer gate: `npx tsc --noEmit`, no new lint errors in touched files.

---

## 10. File-touch list (lane C)

| File | Change | Notes |
|---|---|---|
| `apps/readest-app/src/services/professor/workbenchVoice.ts` | **new** | The player (§4). |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx` | edit | `VoiceControl`, player ref/wiring, stop-on-new-turn in `send()`, narration `unit-change` yield effect, reset-on-session effect (§5, §6). |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.css` | edit (append) | `.wb-voice*` classes only (§6.5). |
| `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` | edit (A-owned, **additive after A merges**) | `TranscriptBlock.voice` field; optional `updateBlock` store helper (§3). |
| `apps/readest-app/src/services/professor/professorTags.ts` | edit (A-owned, **additive after A merges**) | `VOICE` in `PROTOCOL_TAG`, `voice?: boolean` on `ParsedProfessorMessage` (§3). |
| `apps/readest-app/src/services/professor/prompt.ts` | edit (A-owned, **additive after A merges**) | One sentence appended to `PROFESSOR_WORKBENCH_ADDENDUM` (§8). |
| `apps/readest-app/src/__tests__/services/workbench-voice.test.ts` | **new** | 10 cases (§9). |

**Read-only imports (no edits):** `services/professor/voice.ts` (`ProfessorSpeechSource`), `services/narration/player.ts` (`AudioSink`), `services/narration/webAudioSink.ts` (`WebAudioSink`), `services/narration/verbalize.ts` (`isVerbalizerReady`, `verbalizeInlineMath`), `services/narration/narrative.ts` (`doctorSpeakText`), `services/narration/speakMode.ts` (`getNarration`), `services/tts/providers/types.ts` (`SpeechSynthesisPermanentError`). **No new sidecar endpoints; no new settings; no edits under `services/narration/` or `services/tts/`.**

## 11. Open questions

1. **`[VOICE]` on non-final lines / multiple per turn:** parser takes the first; a second `[VOICE]` is idempotent (still `true`). Confirm acceptable — recommended yes, simplest contract.
2. **Long-block budget:** no per-block synthesis cap is specified; the 30 s timeout + retry is the only guard. If the owner later wants "speak only the first N sentences," that is a UI-layer truncation, not a player concern — defer.
3. **ElevenLabs rate/voice ride-along:** with provider `elevenlabs`, `controller.speech` already reflects it; the spec assumes the same local-first posture (qwen) and has no special handling. Confirm no owner objection.
