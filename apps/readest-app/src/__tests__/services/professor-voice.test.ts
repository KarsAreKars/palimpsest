/**
 * HP-3 contract tests — the voice loop's leak-proof guarantees.
 *
 * Acceptance criterion (hey_prof plan §9): "Tags never leak into spoken
 * audio." These tests pin the pure stream machinery (sentence splitting,
 * partial-tag holding, the incremental feeder) plus the ProfessorVoice
 * pump's behavior with a fake provider/sink: order, barge-in, and the
 * exact text that reaches the synthesizer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  splitCompleteSentences,
  holdPartialTag,
  SpeechFeeder,
  ProfessorVoice,
} from '@/services/professor/voice';
import type { SpeechProvider, SpeechSynthesisResult } from '@/services/tts/providers/types';
import type { AudioSink } from '@/services/narration/player';

// --- splitCompleteSentences -------------------------------------------------

describe('splitCompleteSentences', () => {
  it('splits on terminal punctuation followed by whitespace', () => {
    const { sentences, rest } = splitCompleteSentences(
      'One ring to rule them all. One ring to find',
    );
    expect(sentences).toEqual(['One ring to rule them all.']);
    expect(rest).toBe(' One ring to find');
  });

  it('handles ! and ? and closing quotes', () => {
    const { sentences } = splitCompleteSentences('Really? Yes! She said "no." And left.');
    expect(sentences).toEqual(['Really?', 'Yes!', 'She said "no."', 'And left.']);
  });

  it('does not split decimals', () => {
    const { sentences, rest } = splitCompleteSentences('The value is 3.14159 exactly.');
    expect(sentences).toEqual(['The value is 3.14159 exactly.']);
    expect(rest).toBe('');
  });

  it('does not split honorifics or initials', () => {
    const { sentences } = splitCompleteSentences('Dr. Turing met Prof. Church. They talked.');
    expect(sentences).toEqual(['Dr. Turing met Prof. Church.', 'They talked.']);
  });

  it('returns everything as rest when no boundary exists', () => {
    const { sentences, rest } = splitCompleteSentences('still going');
    expect(sentences).toEqual([]);
    expect(rest).toBe('still going');
  });
});

// --- holdPartialTag ----------------------------------------------------------

describe('holdPartialTag', () => {
  it('passes through text with no bracket', () => {
    expect(holdPartialTag('plain text.')).toEqual({ safe: 'plain text.', held: '' });
  });

  it('passes through complete tags', () => {
    const raw = 'Look [POINT:block:/page/0/Text/1] here.';
    expect(holdPartialTag(raw)).toEqual({ safe: raw, held: '' });
  });

  it('holds a trailing partial tag', () => {
    expect(holdPartialTag('see this [POI')).toEqual({ safe: 'see this ', held: '[POI' });
    expect(holdPartialTag('see this [POINT:block:/pag')).toEqual({
      safe: 'see this ',
      held: '[POINT:block:/pag',
    });
  });

  it('does not hold brackets followed by a newline (not a DSL tag)', () => {
    const raw = 'list [\nitem';
    expect(holdPartialTag(raw).safe).toBe(raw);
  });
});

// --- SpeechFeeder ------------------------------------------------------------

describe('SpeechFeeder', () => {
  it('emits a sentence as soon as it completes, mid-stream', () => {
    const f = new SpeechFeeder();
    expect(f.push('The empty inter')).toEqual([]);
    expect(f.push('section means no common element. That is the')).toEqual([
      'The empty intersection means no common element.',
    ]);
    expect(f.finish()).toEqual(['That is the']);
  });

  it('NEVER leaks tags into spoken text, even split across tokens', () => {
    const f = new SpeechFeeder();
    const spoken: string[] = [];
    const deltas = [
      'Look at this. [PO',
      'INT:block:/page/0/Text/1] See how the rows ',
      'relate. [CAPTION:kernel of truth] And so.',
    ];
    for (const d of deltas) spoken.push(...f.push(d));
    spoken.push(...f.finish());
    expect(spoken).toEqual(['Look at this.', 'See how the rows relate.', 'And so.']);
    for (const s of spoken) expect(s).not.toMatch(/\[|\]/);
  });

  it('drops tag-only output cleanly', () => {
    const f = new SpeechFeeder();
    expect(f.push('[PAGE:12][POINT:block:x]')).toEqual([]);
    expect(f.finish()).toEqual([]);
  });

  it('holds and re-examines a partial tag across many deltas', () => {
    const f = new SpeechFeeder();
    expect(f.push('Wait [H')).toEqual([]);
    expect(f.push('IGH')).toEqual([]);
    expect(f.push('LIGHT:block:x] done here.')).toEqual(['Wait done here.']);
  });
});

// --- ProfessorVoice (fake provider + sink) -----------------------------------

class FakeProvider implements SpeechProvider {
  readonly id = 'fake';
  readonly label = 'Fake';
  spokenTexts: string[] = [];
  async init() {
    return true;
  }
  async getAllVoices() {
    return [];
  }
  async synthesize(req: { text: string }): Promise<SpeechSynthesisResult> {
    this.spokenTexts.push(req.text);
    return { audio: new ArrayBuffer(8), boundaries: [] };
  }
}

class FakeSink implements AudioSink {
  played: number = 0;
  stopped: number = 0;
  play(): Promise<void> {
    this.played++;
    return Promise.resolve();
  }
  pause(): number {
    return 0;
  }
  resume(): void {}
  stop(): void {
    this.stopped++;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ProfessorVoice', () => {
  let provider: FakeProvider;
  let sink: FakeSink;
  let voice: ProfessorVoice;

  beforeEach(() => {
    provider = new FakeProvider();
    sink = new FakeSink();
    voice = new ProfessorVoice({
      getSpeech: () => ({ provider, voice: 'v', lang: 'en', rate: 1 }),
      sink,
    });
  });

  it('speaks complete sentences in order as the answer streams', async () => {
    voice.push('First idea. Sec');
    voice.push('ond idea. Third');
    voice.finish();
    await flush();
    expect(provider.spokenTexts).toEqual(['First idea.', 'Second idea.', 'Third']);
  });

  it('acceptance: no DSL syntax ever reaches the synthesizer', async () => {
    voice.push('See [POINT:block:/page/0/Text/1] this block. [CAPTION:key idea] Done.');
    voice.finish();
    await flush();
    expect(provider.spokenTexts.length).toBeGreaterThan(0);
    for (const t of provider.spokenTexts) expect(t).not.toMatch(/\[|\]|POINT|CAPTION/);
  });

  it('barge-in: stop() silences playback and resets for the next answer', async () => {
    voice.push('Old answer here.');
    voice.stop();
    expect(sink.stopped).toBeGreaterThan(0);
    voice.push('New answer now.');
    voice.finish();
    await flush();
    // The first sentence's synthesis was already in flight when the barge-in
    // landed (its audio is discarded, never played). What matters: the queue
    // was dropped and ONLY the new answer's sentences are synthesized after.
    expect(provider.spokenTexts).toEqual(['Old answer here.', 'New answer now.']);
  });

  it('stays silent when there is no narration session', async () => {
    const silent = new ProfessorVoice({ getSpeech: () => null, sink });
    silent.push('Nobody hears this.');
    silent.finish();
    await flush();
    expect(provider.spokenTexts).toEqual([]);
  });
});
