import { describe, expect, it } from 'vitest';
import { NarrationPlayer, type AudioSink } from '@/services/narration/player';
import type {
  SpeechProvider,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from '@/services/tts/providers/types';
import type { NarrationUnit } from '@/services/narration';

class FakeProvider implements SpeechProvider {
  readonly id = 'fake';
  readonly label = 'Fake';
  requests: SpeechSynthesisRequest[] = [];
  failOn = new Set<string>();

  async init() {
    return true;
  }
  async getAllVoices() {
    return [];
  }
  async synthesize(req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
    this.requests.push(req);
    if (this.failOn.has(req.text)) throw new Error('synthesis failed');
    return { audio: new TextEncoder().encode(req.text).buffer as ArrayBuffer, boundaries: [] };
  }
}

class FakeSink implements AudioSink {
  played: string[] = [];
  autoComplete = true;
  private resolveCurrent: (() => void) | null = null;

  play(audio: ArrayBuffer): Promise<void> {
    this.played.push(new TextDecoder().decode(audio));
    return new Promise((resolve) => {
      this.resolveCurrent = resolve;
      if (this.autoComplete) {
        queueMicrotask(() => {
          if (this.resolveCurrent === resolve) {
            this.resolveCurrent = null;
            resolve();
          }
        });
      }
    });
  }
  finishCurrent() {
    this.resolveCurrent?.();
    this.resolveCurrent = null;
  }
  pause() {
    return 0;
  }
  resume() {}
  stop() {
    this.resolveCurrent?.();
    this.resolveCurrent = null;
  }
}

const speakUnit = (unit: number, speak: string): NarrationUnit => ({
  unit,
  md_start: unit * 100,
  md_end: unit * 100 + 50,
  page: unit + 1,
  kind: 'prose',
  speak,
});
const skipUnit = (unit: number): NarrationUnit => ({
  unit,
  md_start: unit * 100,
  md_end: unit * 100 + 50,
  page: unit + 1,
  kind: 'skip',
});

const makePlayer = (units: NarrationUnit[]) => {
  const provider = new FakeProvider();
  const sink = new FakeSink();
  const player = new NarrationPlayer({ provider, sink, voice: 'en-test', prefetchDepth: 2 });
  player.load(units);
  return { player, provider, sink };
};

describe('NarrationPlayer', () => {
  it('plays speakable units in order, transparently skipping silent ones', async () => {
    const units = [
      speakUnit(0, 'First.'),
      skipUnit(1),
      speakUnit(2, 'Second.'),
      speakUnit(3, 'Third.'),
    ];
    const { player, sink } = makePlayer(units);

    await player.playFrom(0);

    expect(sink.played).toEqual(['First.', 'Second.', 'Third.']);
    expect(player.state).toBe('stopped');
  });

  it('emits unit-change with the current unit for page-turn/highlight', async () => {
    const units = [speakUnit(0, 'One.'), speakUnit(1, 'Two.')];
    const { player } = makePlayer(units);
    const seen: number[] = [];
    player.addEventListener('unit-change', (e) => {
      seen.push((e as CustomEvent<{ index: number }>).detail.index);
    });

    await player.playFrom(0);
    expect(seen).toEqual([0, 1]);
  });

  it('skips a unit whose synthesis permanently fails', async () => {
    const units = [speakUnit(0, 'One.'), speakUnit(1, 'Broken.'), speakUnit(2, 'Three.')];
    const { player, provider, sink } = makePlayer(units);
    provider.failOn.add('Broken.');

    await player.playFrom(0);
    expect(sink.played).toEqual(['One.', 'Three.']);
  });

  it('next() and prev() move between speakable units', async () => {
    const units = [speakUnit(0, 'One.'), skipUnit(1), speakUnit(2, 'Two.'), speakUnit(3, 'Three.')];
    const { player, sink } = makePlayer(units);
    sink.autoComplete = false;

    const done = player.playFrom(0);
    await new Promise((r) => setTimeout(r, 0)); // let 'One.' reach the sink
    expect(sink.played).toEqual(['One.']);

    // next() jumps past the silent unit to 'Two.' and streams forward.
    const nextDone = player.next();
    await new Promise((r) => setTimeout(r, 0));
    expect(sink.played).toEqual(['One.', 'Two.']);
    sink.finishCurrent();
    await new Promise((r) => setTimeout(r, 0));
    expect(sink.played).toEqual(['One.', 'Two.', 'Three.']);
    sink.finishCurrent();
    await nextDone;
    await done;

    // prev() from 'Three.' (the current unit at book end) lands on 'Two.',
    // skipping the silent unit in between. Playback then streams forward by
    // design; stop after confirming the landing unit.
    sink.played.length = 0;
    const prevDone = player.prev();
    await new Promise((r) => setTimeout(r, 0));
    expect(sink.played).toEqual(['Two.']);
    player.stop();
    await prevDone;
  });

  it('prefetches upcoming units while one plays', async () => {
    const units = [
      speakUnit(0, 'One.'),
      speakUnit(1, 'Two.'),
      speakUnit(2, 'Three.'),
      speakUnit(3, 'Four.'),
    ];
    const { player, provider } = makePlayer(units);

    await player.playFrom(0);
    // By the end, every unit was synthesized exactly once (cached).
    const texts = provider.requests.map((r) => r.text);
    expect(new Set(texts).size).toBe(4);
    expect(provider.requests.filter((r) => r.text === 'Two.').length).toBe(1);
  });

  it('stop() halts playback immediately', async () => {
    const units = [speakUnit(0, 'One.'), speakUnit(1, 'Two.')];
    const { player, sink } = makePlayer(units);
    const done = player.playFrom(0);
    player.stop();
    await done;
    expect(player.state).toBe('stopped');
    expect(sink.played.length).toBeLessThanOrEqual(1);
  });
});
