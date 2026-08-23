/**
 * ProfessorVoice — the spoken half of the voice loop (hey_prof plan §5).
 *
 * The professor's answer streams in as LLM token deltas with annotation DSL
 * tags interleaved. This module turns that stream into speech with
 * audiobook-grade behavior:
 *
 *   - Speech starts at the FIRST COMPLETE SENTENCE, not at end-of-stream —
 *     perceived latency is one sentence, not one answer.
 *   - DSL tags never reach the synthesizer (contract-tested): the stream is
 *     stripped incrementally, and a trailing partial tag ("...see [POI") is
 *     held back until its ']' arrives.
 *   - Barge-in: stop() halts playback, drops the queue, and resets the
 *     feeder. Asking a new question mid-answer is the primary trigger.
 *   - Provider/voice/rate are read from the book's NarrationController at
 *     pump time, so a Settings voice hot-swap applies to the next sentence.
 *
 * The pure stream machinery (splitCompleteSentences, holdPartialTag,
 * SpeechFeeder) is separated from the audio machinery (ProfessorVoice) so
 * the leak-proof guarantees are unit-testable without a synthesizer.
 */
import type { SpeechProvider, SpeechSynthesisResult } from '@/services/tts/providers/types';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';
import type { AudioSink } from '@/services/narration/player';
import { WebAudioSink } from '@/services/narration/webAudioSink';
import { isVerbalizerReady, verbalizeInlineMath } from '@/services/narration/verbalize';
import { stripAnnotationTags } from './annotations';
import { nlog, nwarn } from '@/services/narration/log';

// ---------------------------------------------------------------------------
// Pure stream machinery (contract-tested)
// ---------------------------------------------------------------------------

// A sentence ends at ., !, or ? followed by whitespace or end-of-text —
// except a dot between digits (3.14) and after a short honorific/initial
// ("Dr.", "e.g." is intentionally NOT excepted: reading "e.g." as a
// sentence end is harmless, the pause sounds natural).
const HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'vs', 'jr', 'sr', 'fig']);

const isBoundary = (text: string, i: number): boolean => {
  const ch = text[i]!;
  if (ch !== '.' && ch !== '!' && ch !== '?') return false;
  const next = text[i + 1];
  if (next !== undefined && !/\s/.test(next) && next !== '"' && next !== "'" && next !== ')')
    return false;
  if (ch === '.') {
    const prev = text[i - 1];
    const after = text[i + 1];
    if (prev && /\d/.test(prev) && after && /\d/.test(after)) return false; // decimal
    // Single capital letter + dot = an initial ("A. Turing"): not a boundary.
    if (prev && /[A-Z]/.test(prev) && (i < 2 || /[\s(]/.test(text[i - 2]!))) return false;
    const word = text
      .slice(Math.max(0, i - 12), i)
      .match(/([A-Za-z]+)\.*$/)?.[1]
      ?.toLowerCase();
    if (word && HONORIFICS.has(word)) return false;
  }
  return true;
};

/**
 * Split `text` into complete sentences plus the incomplete tail (`rest`).
 * Operates on already tag-stripped text.
 */
export const splitCompleteSentences = (text: string): { sentences: string[]; rest: string } => {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!isBoundary(text, i)) continue;
    // Consume closing quote/paren that belongs to this sentence.
    let end = i + 1;
    while (end < text.length && ['"', "'", ')'].includes(text[end]!)) end++;
    // Only a boundary if whitespace or EOS follows the closers.
    const after = text[end];
    if (after !== undefined && !/\s/.test(after)) continue;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  return { sentences, rest: text.slice(start) };
};

/**
 * Streaming guard: if the raw stream ends inside a possible DSL tag
 * ("...see [POI"), hold the fragment back. A '[' that has no matching ']'
 * after it is unsafe to strip-and-speak — it might become a tag.
 */
export const holdPartialTag = (raw: string): { safe: string; held: string } => {
  const open = raw.lastIndexOf('[');
  if (open === -1) return { safe: raw, held: '' };
  const close = raw.lastIndexOf(']');
  if (close > open) return { safe: raw, held: '' };
  // A '[' followed by a newline can't be a DSL tag (tags are single-line);
  // and a '[' with a space right after it is ordinary prose bracketing.
  const frag = raw.slice(open);
  if (frag.includes('\n') || frag.startsWith('[ ')) return { safe: raw, held: '' };
  return { safe: raw.slice(0, open), held: frag };
};

/**
 * Incremental answer stream → speakable sentences. Feed raw token deltas
 * (tags and all); receive clean sentences ready for the synthesizer.
 * Offsets are tracked against the stripped-safe text, so held-back partial
 * tags are re-examined on every delta.
 */
export class SpeechFeeder {
  #raw = '';
  #spokenUpTo = 0; // offset into stripAnnotationTags(holdPartialTag(raw).safe)

  /** Returns newly speakable sentences introduced by this delta. */
  push(delta: string): string[] {
    this.#raw += delta;
    const { safe } = holdPartialTag(this.#raw);
    const stripped = stripAnnotationTags(safe);
    const segment = stripped.slice(this.#spokenUpTo);
    const { sentences, rest } = splitCompleteSentences(segment);
    this.#spokenUpTo += segment.length - rest.length;
    return sentences.map((s) => this.#verbalize(s)).filter((s) => s.length > 0);
  }

  /** End of stream: flush everything still held as the final utterance(s). */
  finish(): string[] {
    const stripped = stripAnnotationTags(this.#raw); // stream is complete — no holding
    const tail = stripped.slice(this.#spokenUpTo);
    this.#spokenUpTo = stripped.length;
    const { sentences, rest } = splitCompleteSentences(tail);
    const last = rest.trim();
    const all = last ? [...sentences, last] : sentences;
    return all.map((s) => this.#verbalize(s)).filter((s) => s.length > 0);
  }

  #verbalize(sentence: string): string {
    // Whitespace collapse happens HERE, at emission — never inside the
    // offset-tracked stream (a mid-stream collapse would break the prefix
    // property that keeps #spokenUpTo valid).
    const s = sentence.replace(/\s{2,}/g, ' ').trim();
    if (!s) return '';
    // Inline math → spoken English when the verbalizer is live; otherwise
    // keep the raw text (professor answers are mostly prose).
    return isVerbalizerReady() ? verbalizeInlineMath(s) : s;
  }
}

// ---------------------------------------------------------------------------
// Audio machinery
// ---------------------------------------------------------------------------

export interface ProfessorSpeechSource {
  provider: SpeechProvider;
  voice: string;
  lang: string;
  rate: number;
}

export interface ProfessorVoiceOptions {
  /** Read at pump time so Settings hot-swaps apply to the next sentence. */
  getSpeech: () => ProfessorSpeechSource | null;
  sink?: AudioSink;
}

export class ProfessorVoice {
  #getSpeech: () => ProfessorSpeechSource | null;
  #sink: AudioSink;
  #feeder = new SpeechFeeder();
  #queue: string[] = [];
  #token = 0;
  #pumping = false;

  constructor(opts: ProfessorVoiceOptions) {
    this.#getSpeech = opts.getSpeech;
    this.#sink = opts.sink ?? new WebAudioSink();
  }

  get speaking(): boolean {
    return this.#pumping || this.#queue.length > 0;
  }

  /** Stream delta from the LLM (raw, tags included). */
  push(delta: string): void {
    for (const s of this.#feeder.push(delta)) this.#enqueue(s);
  }

  /** Stream complete — flush the tail. */
  finish(): void {
    for (const s of this.#feeder.finish()) this.#enqueue(s);
  }

  /** Barge-in: silence now, drop everything queued, reset for a new answer. */
  stop(): void {
    this.#token++;
    this.#queue = [];
    this.#feeder = new SpeechFeeder();
    this.#sink.stop();
    nlog('professor voice: stop (barge-in)');
  }

  #enqueue(sentence: string): void {
    this.#queue.push(sentence);
    void this.#pump();
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    const token = this.#token;
    try {
      while (this.#queue.length > 0 && token === this.#token) {
        const speech = this.#getSpeech();
        if (!speech) {
          nwarn('professor voice: no narration session — dropping spoken answer');
          this.#queue = [];
          return;
        }
        const text = this.#queue.shift()!;
        const result = await this.#synthesize(speech, text, token);
        if (!result || token !== this.#token) return;
        nlog(`professor voice: speaking ${text.length} chars`);
        await this.#sink.play(result.audio, speech.rate);
        if (token !== this.#token) return; // barged in mid-utterance
      }
    } finally {
      // Always release the flag and re-kick if work arrived while a stale
      // generation was exiting — otherwise a stop() racing a push() wedges
      // the queue with #pumping stuck true.
      this.#pumping = false;
      if (this.#queue.length > 0) void this.#pump();
    }
  }

  async #synthesize(
    speech: ProfessorSpeechSource,
    text: string,
    token: number,
  ): Promise<SpeechSynthesisResult | null> {
    const request = () =>
      speech.provider.synthesize(
        { lang: speech.lang, text, voice: speech.voice, pitch: 0 },
        new AbortController().signal,
      );
    try {
      return await request();
    } catch (firstError) {
      if (firstError instanceof SpeechSynthesisPermanentError || token !== this.#token) {
        nwarn('professor voice: synthesis failed permanently, skipping sentence', firstError);
        return null;
      }
      nwarn('professor voice: synthesis failed, retrying once', firstError);
      try {
        return await request();
      } catch (secondError) {
        nwarn('professor voice: synthesis failed twice, skipping sentence', secondError);
        return null;
      }
    }
  }
}
