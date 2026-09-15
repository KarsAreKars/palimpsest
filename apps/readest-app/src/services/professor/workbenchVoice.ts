/**
 * WorkbenchVoicePlayer — the desk's read-aloud (Workbench 2.x, s4).
 *
 * The professor's committed blocks are display markdown; the reader presses
 * to hear one, whole, on demand. This is a different machine from
 * ProfessorVoice (professor/voice.ts), which is a streaming barge-in engine
 * over token deltas — here we speak complete blocks with pause/resume/
 * replay, so we reuse its *interfaces* (ProfessorSpeechSource, AudioSink)
 * and the same WebAudioSink offset-bookkeeping, but own a small state
 * machine:
 *
 *   idle → synthesizing → playing ⇄ paused → idle (natural completion or
 *   stop()); any state → 'unavailable' (STICKY until reset()) when no
 *   speech identity exists this sitting.
 *
 * Laws (s4 §5 — the narration controller owns audio focus):
 *   - While narration is active, speak() refuses with 'voice-busy'.
 *   - When narration takes focus ('unit-change'), the tab calls stop().
 *   - A new speak() barge-ins the current one (play-token discipline,
 *     the #playToken lesson of narration/player.ts).
 *
 * Synthesis rides the book's own speech identity (HP-3): the tab passes
 * getSpeech: () => getNarration(bookKey)?.controller?.speech ?? null, so
 * voice id and rate come from narration settings — no new settings. Rate is
 * read at speak time and applied sink-side, so a Settings hot-swap applies
 * to the next playback and cached audio stays rate-independent.
 *
 * The transcript stores metadata only ({requested, voiceId?, lastHeardAt?});
 * audio is re-synthesized on replay, softened by a session-scoped in-memory
 * cache keyed blockId + contentHash (s4 §1.1, audit R10). Nothing touches
 * disk from this file.
 */
import type { SpeechSynthesisResult } from '@/services/tts/providers/types';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';
import type { AudioSink } from '@/services/narration/player';
import { WebAudioSink } from '@/services/narration/webAudioSink';
import { isVerbalizerReady, verbalizeDisplayEquation } from '@/services/narration/verbalize';
import { doctorSpeakText } from '@/services/narration/narrative';
import { nlog, nwarn } from '@/services/narration/log';
import type { ProfessorSpeechSource } from './voice';

// The 3-line flat-delivery instruct, duplicated LOCALLY per s4 §4.1 — the
// user-report lesson of 2026-09-03 ("still too expressive") lives in
// professor/voice.ts, which remains the source of truth; this lane does not
// edit that file.
const PROFESSOR_INSTRUCT =
  'A calm, flat, matter-of-fact tutor explaining something aloud. Plain, ' +
  'even, understated delivery with minimal expression. No excitement, no ' +
  'drama, no exclaiming — just clear, direct explanation.';

/** A hung provider socket must not wedge the desk — the 30 s lesson of
 *  narration/player.ts (SYNTH_TIMEOUT_MS) and professor/voice.ts. */
const SYNTH_TIMEOUT_MS = 30_000;

/** Display markdown → speakable prose. The block's protocol tags were
 *  consumed at commit time (commitProfessorBlock), but the display string
 *  still carries reading furniture that is not speech: [Page N] citations,
 *  emphasis markers, heading strokes, quote strokes. Display math is split
 *  off and spoken via the narration verbalizer, exactly as SpeechFeeder
 *  does for the tutor overlay; prose passes through the narrative-pass
 *  doctor (doctorSpeakText). */
const prepareSpeakText = (raw: string): string => {
  const stripped = raw
    .replace(/\[Page \d+\]/g, '') // citation anchors are chips, not words
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^>[ \t]?/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .replace(/`([^`]*)`/g, '$1');
  const parts = stripped.split(/(\$\$[\s\S]*?\$\$)/g);
  const prepared = parts
    .map((part, i) => {
      if (i % 2 === 1) {
        const latex = part.replace(/^\$\$|\$\$$/g, '').trim();
        if (!latex) return '';
        // Guard exactly as SpeechFeeder does: before the verbalizer's SRE +
        // temml are loaded, latexToSpeech returns '' and would silently
        // delete the math from the spoken answer.
        return isVerbalizerReady() ? verbalizeDisplayEquation(latex) : `Equation: ${latex}.`;
      }
      return doctorSpeakText(part);
    })
    .filter(Boolean)
    .join(' ');
  return prepared.replace(/\s{2,}/g, ' ').trim();
};

/** The same cheap content hash WorkbenchTab.tsx uses for silent-check
 *  skipping, duplicated here (s4 §4.3 — it is not exported from the tab). */
const contentHash = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
};

export type WorkbenchVoiceState = 'idle' | 'synthesizing' | 'playing' | 'paused' | 'unavailable';

/** Error kinds — the UI maps each to fixed librarian copy and never shows
 *  the raw provider message (the WorkbenchErrorKind contract of
 *  workbenchSession.ts). */
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
  #getSpeech: () => ProfessorSpeechSource | null;
  #isNarrationActive: () => boolean;
  #sink: AudioSink;
  #onState?: (state: WorkbenchVoiceState) => void;
  #onError?: (kind: WorkbenchVoiceErrorKind) => void;

  #state: WorkbenchVoiceState = 'idle';
  #token = 0; // invalidates in-flight async work across stop()/new speak()
  #activeBlockId: string | null = null;
  #lastText = new Map<string, string>(); // blockId → text, for replay()
  #cache = new Map<string, Promise<SpeechSynthesisResult>>();

  constructor(opts: WorkbenchVoiceOptions) {
    this.#getSpeech = opts.getSpeech;
    this.#isNarrationActive = opts.isNarrationActive;
    this.#sink = opts.sink ?? new WebAudioSink();
    this.#onState = opts.onState;
    this.#onError = opts.onError;
  }

  get state(): WorkbenchVoiceState {
    return this.#state;
  }

  /** The block currently playing/paused (or being spoken for), else null. */
  get activeBlockId(): string | null {
    return this.#activeBlockId;
  }

  /** True while this block is the active one and playback is live. */
  isActive(blockId: string): boolean {
    return (
      this.#activeBlockId === blockId &&
      (this.#state === 'synthesizing' || this.#state === 'playing' || this.#state === 'paused')
    );
  }

  /**
   * Synthesize (or reuse the session cache) and play one complete block.
   * Speaking another block first stops the current one. Resolves with the
   * speech identity used on NATURAL completion (the tab writes voiceId +
   * lastHeardAt back into the transcript then); resolves null on refusal,
   * stop, or failure.
   */
  async speak(blockId: string, text: string): Promise<ProfessorSpeechSource | null> {
    this.#activeBlockId = blockId; // refusals still report which block asked
    if (this.#state === 'unavailable') {
      this.#onError?.('voice-unavailable');
      return null;
    }
    if (this.#isNarrationActive()) {
      // The narration controller owns audio focus — never preempt, never
      // duck (s4 §5 law 1).
      this.#onError?.('voice-busy');
      return null;
    }
    const speech = this.#getSpeech();
    if (!speech) {
      // Sticky: the desk cannot speak this sitting, so the control stays
      // muted rather than failing on every press. reset() re-arms it.
      this.#setState('unavailable');
      this.#onError?.('voice-unavailable');
      return null;
    }
    // Barge-in: one playback at a time. Anything in flight is invalidated
    // before the new utterance starts.
    this.#token += 1;
    const token = this.#token;
    this.#sink.stop();
    this.#lastText.set(blockId, text);
    const key = `${blockId}:${contentHash(text)}`;
    this.#setState('synthesizing');
    const cached = this.#cache.get(key);
    const request = cached ?? this.#track(key, () => this.#synthesize(speech, text, token));
    try {
      const result = await request;
      if (token !== this.#token) return null; // barged in mid-synthesis
      this.#setState('playing');
      await this.#sink.play(result.audio, speech.rate);
      if (token !== this.#token) return null; // barged in mid-utterance
      this.#complete();
      return speech;
    } catch (error) {
      if (token !== this.#token) return null; // a stop() raced the failure
      // Both attempts exhausted (#synthesize retries once; permanent
      // errors skip the retry). The raw provider detail is debug-only.
      nwarn('workbench voice: synthesis failed', error);
      this.#complete();
      this.#onError?.('voice-failed');
      return null;
    }
  }

  /** Same utterance from the top: replay(blockId) === speak(blockId, the
   *  text last given for blockId). */
  replay(blockId: string): Promise<ProfessorSpeechSource | null> {
    const text = this.#lastText.get(blockId);
    if (text === undefined) return Promise.resolve(null);
    return this.speak(blockId, text);
  }

  /** Pause the active utterance (sink offset bookkeeping). */
  pause(): void {
    if (this.#state !== 'playing') return;
    this.#sink.pause();
    this.#setState('paused');
  }

  /** Resume a paused utterance. */
  resume(): void {
    if (this.#state !== 'paused') return;
    this.#sink.resume();
    this.#setState('playing');
  }

  /** Barge-in: silence now, drop the in-flight cache entry's consumer,
   *  return to idle. Called on stop-on-new-turn and when narration takes
   *  focus. */
  stop(): void {
    this.#token += 1;
    this.#sink.stop();
    this.#activeBlockId = null;
    if (this.#state !== 'unavailable') this.#setState('idle');
  }

  /** Called when a speech identity appears (narration session loaded
   *  late), clearing the sticky 'unavailable' state. */
  reset(): void {
    this.#token += 1;
    this.#sink.stop();
    this.#activeBlockId = null;
    if (this.#state === 'unavailable') this.#setState('idle');
  }

  #setState(state: WorkbenchVoiceState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#onState?.(state);
  }

  #complete(): void {
    this.#activeBlockId = null;
    this.#setState('idle');
    nlog('workbench voice: utterance complete');
  }

  /** Cache a fresh request; a settled failure is evicted so the next
   *  attempt is a fresh request (the narration player's pattern). */
  #track(key: string, make: () => Promise<SpeechSynthesisResult>): Promise<SpeechSynthesisResult> {
    const pending = make();
    pending.catch(() => {
      if (this.#cache.get(key) === pending) this.#cache.delete(key);
    });
    this.#cache.set(key, pending);
    return pending;
  }

  async #synthesize(
    speech: ProfessorSpeechSource,
    rawText: string,
    token: number,
  ): Promise<SpeechSynthesisResult> {
    const text = prepareSpeakText(rawText);
    const request = () =>
      speech.provider.synthesize(
        { lang: speech.lang, text, voice: speech.voice, pitch: 0, instruct: PROFESSOR_INSTRUCT },
        AbortSignal.timeout(SYNTH_TIMEOUT_MS),
      );
    try {
      return await request();
    } catch (firstError) {
      if (firstError instanceof SpeechSynthesisPermanentError || token !== this.#token)
        throw firstError;
      nwarn('workbench voice: synthesis failed, retrying once', firstError);
      return request();
    }
  }
}
