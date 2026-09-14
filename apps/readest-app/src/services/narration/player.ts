/**
 * NarrationPlayer — audiobook-grade playback of narration.jsonl.
 *
 * This is the narration-driven counterpart to TTSController (plan §7,
 * keep-but-rewire): for books carrying a text layer, playback is driven by
 * the spoken script — every unit knows its page and MD span — instead of
 * foliate's parsed PDF text (whose math extraction is the flaw this product
 * exists to fix).
 *
 * Architecture: the player talks to a SpeechProvider (plan §5's Narrator
 * interface: edge-tts default, ElevenLabs premium) and an AudioSink. It owns
 * scheduling only: prefetch depth, skip-silent-units, next/prev, rate.
 * Rate is a playout concern (sink-side), never sent to the provider, so
 * cached audio stays rate-independent.
 *
 * Emits 'unit-change' CustomEvents ({ unit, index }) — the reader turns the
 * PDF to unit.page and drives follow-along highlight from it.
 */
import type { NarrationUnit } from './index';
import type { SpeechProvider, SpeechSynthesisResult } from '@/services/tts/providers/types';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';
import { nlog, nwarn } from './log';

export interface AudioSink {
  /** Play a buffer to completion; resolves when playback ends naturally. */
  play(audio: ArrayBuffer, rate: number): Promise<void>;
  /** Pause playback; returns seconds elapsed in the current buffer. */
  pause(): number;
  resume(): void;
  stop(): void;
}

export interface NarrationPlayerOptions {
  provider: SpeechProvider;
  sink: AudioSink;
  voice: string;
  lang?: string;
  pitch?: number;
  /** How many units ahead to synthesize while one plays (plan §5). */
  prefetchDepth?: number;
}

type PlayerState = 'stopped' | 'playing' | 'paused';

export class NarrationPlayer extends EventTarget {
  #provider: SpeechProvider;
  #sink: AudioSink;
  #voice: string;
  #lang: string;
  #pitch: number;
  #prefetchDepth: number;

  #units: NarrationUnit[] = [];
  #index = 0;
  #state: PlayerState = 'stopped';
  #rate = 1;
  #playToken = 0; // invalidates in-flight async work on stop/jump
  #audioCache = new Map<number, Promise<SpeechSynthesisResult>>();

  constructor(opts: NarrationPlayerOptions) {
    super();
    this.#provider = opts.provider;
    this.#sink = opts.sink;
    this.#voice = opts.voice;
    this.#lang = opts.lang ?? 'en';
    this.#pitch = opts.pitch ?? 0;
    this.#prefetchDepth = opts.prefetchDepth ?? 2;
  }

  get state(): PlayerState {
    return this.#state;
  }

  /** Engine identity for the professor voice loop (HP-3): the professor
   * speaks through the same provider/voice the book reads with. */
  get provider(): SpeechProvider {
    return this.#provider;
  }

  get voice(): string {
    return this.#voice;
  }

  get lang(): string {
    return this.#lang;
  }

  get currentUnit(): NarrationUnit | null {
    return this.#units[this.#index] ?? null;
  }

  get currentIndex(): number {
    return this.#index;
  }

  get length(): number {
    return this.#units.length;
  }

  /** Units with nothing to say are transparent to the listener. */
  static isSpeakable(unit: NarrationUnit | undefined): unit is NarrationUnit {
    return !!unit && typeof unit.speak === 'string' && unit.speak.trim().length > 0;
  }

  load(units: NarrationUnit[]): void {
    this.stop();
    this.#units = units;
    this.#index = 0;
    this.#audioCache.clear();
  }

  /** A wedged provider connection must not stall playback forever. */
  static SYNTH_TIMEOUT_MS = 30_000;

  #request(text: string): Promise<SpeechSynthesisResult> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException('synthesis timeout', 'TimeoutError')),
      NarrationPlayer.SYNTH_TIMEOUT_MS,
    );
    return this.#provider
      .synthesize(
        { lang: this.#lang, text, voice: this.#voice, pitch: this.#pitch },
        controller.signal,
      )
      .finally(() => clearTimeout(timer));
  }

  #synthesize(index: number, overrideText?: string): Promise<SpeechSynthesisResult> {
    // Click-to-speak entry utterances are one-offs (a sentence fragment from
    // the clicked word onward): never cached, keyed to nothing.
    if (overrideText !== undefined) {
      return this.#request(overrideText);
    }
    let cached = this.#audioCache.get(index);
    if (!cached) {
      cached = this.#request(this.#units[index]!.speak!);
      this.#audioCache.set(index, cached);
      cached.catch(() => this.#audioCache.delete(index)); // failures aren't sticky
    }
    return cached;
  }

  #prefetch(fromIndex: number): void {
    let count = 0;
    for (let i = fromIndex + 1; i < this.#units.length && count < this.#prefetchDepth; i++) {
      if (NarrationPlayer.isSpeakable(this.#units[i])) {
        void this.#synthesize(i).catch(() => {});
        count++;
      }
    }
  }

  #emitUnitChange(): void {
    this.dispatchEvent(
      new CustomEvent('unit-change', {
        detail: { unit: this.currentUnit, index: this.#index },
      }),
    );
  }

  /** Next index at/after `from` that has audio to play. */
  #nextSpeakable(from: number, direction: 1 | -1): number | null {
    for (let i = from; i >= 0 && i < this.#units.length; i += direction) {
      if (NarrationPlayer.isSpeakable(this.#units[i])) return i;
    }
    return null;
  }

  /**
   * Play starting at (or just after) unit `index`. Lands on the first
   * speakable unit at/after index; streams forward from there.
   * `opts.firstSpeakText` replaces the first unit's speak text (the
   * click-to-speak entry fragment starting at the clicked word).
   */
  async playFrom(index: number, opts?: { firstSpeakText?: string }): Promise<void> {
    const token = ++this.#playToken;
    this.#sink.stop();
    this.dispatchEvent(new CustomEvent('resume')); // unblock any paused wait loop
    let start = this.#nextSpeakable(index, 1);
    if (start === null) {
      this.#state = 'stopped';
      return;
    }
    this.#state = 'playing';
    this.#index = start;

    // Circuit breaker: an engine that fails EVERY unit (e.g. the voice
    // server answering 500s) must stop the reading, not sprint through the
    // book in silence — the pre-breaker behavior was the "runaway train".
    let consecutiveFailures = 0;
    let i = start;
    while (i < this.#units.length && token === this.#playToken) {
      const speakable = this.#nextSpeakable(i, 1);
      if (speakable === null) break;
      i = speakable;
      this.#index = i;
      this.#emitUnitChange();
      this.#prefetch(i);
      let result: SpeechSynthesisResult;
      const synthesize = () => this.#synthesize(i, i === start ? opts?.firstSpeakText : undefined);
      try {
        result = await synthesize();
      } catch (firstError) {
        // One immediate retry absorbs a transient provider wedge (e.g. a
        // relay connection that hung until the timeout aborted it); cache
        // eviction in #synthesize guarantees the retry is a fresh request.
        // Permanent errors and stale tokens skip the unit at once.
        if (firstError instanceof SpeechSynthesisPermanentError || token !== this.#playToken) {
          nwarn(`narration unit ${i} synthesis failed, skipping`, firstError);
          if (++consecutiveFailures >= 3) {
            nwarn('narration: stopping — the voice engine is failing every unit', firstError);
            this.#state = 'stopped';
            return;
          }
          i++;
          continue;
        }
        nwarn(`narration unit ${i} synthesis failed, retrying once`, firstError);
        try {
          result = await synthesize();
        } catch (secondError) {
          nwarn(`narration unit ${i} synthesis failed twice, skipping`, secondError);
          if (++consecutiveFailures >= 3) {
            nwarn('narration: stopping — the voice engine is failing every unit', secondError);
            this.#state = 'stopped';
            return;
          }
          i++;
          continue;
        }
      }
      if (token !== this.#playToken) return; // jumped or stopped mid-synthesis
      consecutiveFailures = 0; // a spoken unit resets the breaker
      nlog(`narration: audio unit ${i} — ${result.audio.byteLength} bytes`);
      if (this.state === 'paused') {
        // Pause arrived while synthesizing: wait for resume via play loop.
        await new Promise<void>((resolve) => {
          const onResume = () => {
            this.removeEventListener('resume', onResume);
            resolve();
          };
          this.addEventListener('resume', onResume);
          if (this.state !== 'paused') {
            this.removeEventListener('resume', onResume);
            resolve();
          }
        });
        if (token !== this.#playToken) return;
      }
      // Narrative-pass prosody (plan §4): player-side silence around the
      // unit — provider-independent, rate-independent, free.
      const prosody = this.#units[i]!.prosody;
      if (prosody?.pause_before_ms) {
        await new Promise((r) => setTimeout(r, prosody.pause_before_ms));
        if (token !== this.#playToken) return;
      }
      await this.#sink.play(result.audio, this.#rate);
      if (prosody?.pause_after_ms && token === this.#playToken) {
        await new Promise((r) => setTimeout(r, prosody.pause_after_ms));
      }
      if (token === this.#playToken) {
        nlog(`narration: played unit ${i} to completion`);
      }
      if (token !== this.#playToken) return; // stopped or jumped during playback
      // Keep RAM flat on multi-hour listens: a played unit never re-buffers
      // (backward seeks just re-synthesize); only the prefetch window stays.
      for (const key of this.#audioCache.keys()) {
        if (key < i) this.#audioCache.delete(key);
      }
      i++;
    }
    if (token === this.#playToken) {
      this.#state = 'stopped';
      this.dispatchEvent(new CustomEvent('book-ended'));
    }
  }

  pause(): void {
    nlog(`narration: control pause() — state=${this.#state} unit=${this.#index}`);
    if (this.#state !== 'playing') return;
    this.#state = 'paused';
    this.#sink.pause();
  }

  resume(): void {
    nlog(`narration: control resume() — state=${this.#state} unit=${this.#index}`);
    if (this.#state !== 'paused') return;
    this.#state = 'playing';
    this.#sink.resume();
    this.dispatchEvent(new CustomEvent('resume'));
  }

  stop(): void {
    nlog(`narration: control stop() — state=${this.#state} unit=${this.#index}`);
    this.#playToken++;
    this.#state = 'stopped';
    this.#sink.stop();
    this.dispatchEvent(new CustomEvent('resume')); // unblock any paused wait loop
  }

  /** Skip to the next speakable unit (plan §5: → next sentence). */
  async next(): Promise<void> {
    nlog(`narration: control next() — state=${this.#state} unit=${this.#index}`);
    const target = this.#nextSpeakable(this.#index + 1, 1);
    if (target !== null) await this.playFrom(target);
  }

  /** Back to the previous speakable unit (plan §5: ← previous sentence). */
  async prev(): Promise<void> {
    nlog(`narration: control prev() — state=${this.#state} unit=${this.#index}`);
    const target = this.#nextSpeakable(this.#index - 1, -1);
    if (target !== null) await this.playFrom(target);
  }

  setRate(rate: number): void {
    // Applies from the next unit; in-flight audio keeps its rate (v1 policy).
    this.#rate = rate;
  }

  get rate(): number {
    return this.#rate;
  }
}
