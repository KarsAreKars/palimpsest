/**
 * Web Audio implementation of the NarrationPlayer AudioSink.
 *
 * AudioBufferSourceNodes can't pause, so pause/resume is offset bookkeeping:
 * pause stops the source and records elapsed seconds (rate-adjusted); resume
 * starts a fresh source at that offset. The play() promise for a unit
 * resolves only on natural completion — stop() resolves it early so the
 * player's loop unblocks (the player guards with its play token).
 */
import type { AudioSink } from './player';

export class WebAudioSink implements AudioSink {
  #ctx: AudioContext;
  #buffer: AudioBuffer | null = null;
  #source: AudioBufferSourceNode | null = null;
  #rate = 1;
  #startedAt = 0;
  #offset = 0;
  #playing = false;
  #pendingResolve: (() => void) | null = null;

  constructor(ctx?: AudioContext) {
    this.#ctx = ctx ?? new AudioContext();
  }

  #startSource(offset: number): void {
    if (!this.#buffer) return;
    const source = this.#ctx.createBufferSource();
    source.buffer = this.#buffer;
    source.playbackRate.value = this.#rate;
    source.connect(this.#ctx.destination);
    source.onended = () => {
      // Only natural completion resolves the unit; stop()/pause() clear the
      // source reference first, so their onended is ignored here.
      if (this.#source === source) {
        this.#source = null;
        this.#playing = false;
        this.#offset = 0;
        this.#pendingResolve?.();
        this.#pendingResolve = null;
      }
    };
    this.#source = source;
    this.#startedAt = this.#ctx.currentTime;
    this.#playing = true;
    source.start(0, Math.min(offset, Math.max(this.#buffer.duration - 0.01, 0)));
  }

  async play(audio: ArrayBuffer, rate: number): Promise<void> {
    this.stop();
    if (this.#ctx.state === 'suspended') {
      await this.#ctx.resume().catch(() => {});
    }
    this.#buffer = await this.#ctx.decodeAudioData(audio.slice(0));
    this.#rate = rate;
    this.#offset = 0;
    return new Promise<void>((resolve) => {
      this.#pendingResolve = resolve;
      this.#startSource(0);
    });
  }

  /** Pause playback; returns seconds elapsed within the current buffer. */
  pause(): number {
    if (!this.#playing || !this.#source) return this.#offset;
    const elapsed = this.#offset + (this.#ctx.currentTime - this.#startedAt) * this.#rate;
    this.#offset = this.#buffer ? Math.min(elapsed, this.#buffer.duration) : elapsed;
    const source = this.#source;
    this.#source = null; // detach so its onended is ignored
    this.#playing = false;
    try {
      source.stop();
    } catch {}
    return this.#offset;
  }

  resume(): void {
    if (this.#playing || !this.#buffer) return;
    if (this.#offset >= this.#buffer.duration - 0.02) {
      // Paused at the very end: treat as natural completion.
      this.#offset = 0;
      this.#pendingResolve?.();
      this.#pendingResolve = null;
      return;
    }
    this.#startSource(this.#offset);
  }

  stop(): void {
    const source = this.#source;
    this.#source = null;
    this.#playing = false;
    this.#offset = 0;
    if (source) {
      try {
        source.stop();
      } catch {}
    }
    // Unblock the player's await; its token check discards the result.
    this.#pendingResolve?.();
    this.#pendingResolve = null;
  }
}
