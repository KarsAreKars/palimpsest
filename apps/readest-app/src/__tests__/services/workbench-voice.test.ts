/**
 * workbenchVoice — contract tests for the desk's read-aloud player (s4 §9).
 *
 * The player talks to the SpeechProvider interface (the sidecar /tts is
 * integration-proven via the qwen provider — mocking HTTP is unnecessary,
 * per s4 §9), so a FakeProvider records requests and can fail per text,
 * and a FakeSink resolves playout manually. The transcript round-trip
 * cases run against the real workbenchChat store module.
 */
import { describe, expect, test, vi } from 'vitest';
import { WorkbenchVoicePlayer } from '@/services/professor/workbenchVoice';
import type { AudioSink } from '@/services/narration/player';
import type { ProfessorSpeechSource } from '@/services/professor/voice';
import type {
  SpeechProvider,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from '@/services/tts/providers/types';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';
import {
  commitProfessorBlock,
  parseTranscript,
  serializeTranscript,
} from '@/app/reader/components/notebook/workbenchChat';
import { parseProfessorTags } from '@/services/professor/professorTags';

class FakeProvider implements SpeechProvider {
  readonly id = 'fake';
  readonly label = 'Fake';
  requests: SpeechSynthesisRequest[] = [];
  private failures = new Map<string, Error[]>();

  /** The next synthesize() of `text` throws `error` (FIFO per text). */
  queueFailure(text: string, error: Error): void {
    this.failures.set(text, [...(this.failures.get(text) ?? []), error]);
  }

  async init() {
    return true;
  }
  async getAllVoices() {
    return [];
  }
  async synthesize(req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
    this.requests.push(req);
    const queue = this.failures.get(req.text);
    const failure = queue?.shift();
    if (failure) throw failure;
    return { audio: new TextEncoder().encode(req.text).buffer as ArrayBuffer, boundaries: [] };
  }
}

class FakeSink implements AudioSink {
  played: ArrayBuffer[] = [];
  rates: number[] = [];
  pauses = 0;
  resumes = 0;
  stops = 0;
  autoComplete = true;
  private resolveCurrent: (() => void) | null = null;

  play(audio: ArrayBuffer, rate: number): Promise<void> {
    this.played.push(audio);
    this.rates.push(rate);
    return new Promise<void>((resolve) => {
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

  finishCurrent(): void {
    this.resolveCurrent?.();
    this.resolveCurrent = null;
  }

  pause(): number {
    this.pauses += 1;
    return 0;
  }
  resume(): void {
    this.resumes += 1;
  }
  stop(): void {
    this.stops += 1;
    this.resolveCurrent?.();
    this.resolveCurrent = null;
  }
}

const decode = (buf: ArrayBuffer): string => new TextDecoder().decode(buf);

interface Env {
  provider: FakeProvider;
  sink: FakeSink;
  player: WorkbenchVoicePlayer;
  states: string[];
  errors: string[];
  setSpeech: (speech: ProfessorSpeechSource | null) => void;
}

const makeEnv = (opts: { isNarrationActive?: () => boolean; autoComplete?: boolean } = {}): Env => {
  const provider = new FakeProvider();
  const sink = new FakeSink();
  sink.autoComplete = opts.autoComplete ?? true;
  const states: string[] = [];
  const errors: string[] = [];
  let speech: ProfessorSpeechSource | null = {
    provider,
    voice: 'af_heart',
    lang: 'en',
    rate: 1,
  };
  const player = new WorkbenchVoicePlayer({
    getSpeech: () => speech,
    isNarrationActive: opts.isNarrationActive ?? (() => false),
    sink,
    onState: (s) => states.push(s),
    onError: (k) => errors.push(k),
  });
  return {
    provider,
    sink,
    player,
    states,
    errors,
    setSpeech: (s) => {
      speech = s;
    },
  };
};

describe('WorkbenchVoicePlayer', () => {
  test('1. speak() drives idle → synthesizing → playing with the resolved voice + flat instruct', async () => {
    const env = makeEnv();
    const pending = env.player.speak('b1', 'So it goes.');
    expect(env.player.state).toBe('synthesizing');
    const speech = await pending;
    expect(speech?.voice).toBe('af_heart');
    expect(env.provider.requests).toHaveLength(1);
    const req = env.provider.requests[0]!;
    expect(req.voice).toBe('af_heart');
    expect(req.lang).toBe('en');
    expect(req.pitch).toBe(0);
    expect(typeof req.instruct).toBe('string');
    expect(req.instruct).toContain('calm');
    expect(env.sink.played).toHaveLength(1);
    expect(decode(env.sink.played[0]!)).toBe('So it goes.');
    expect(env.states).toEqual(['synthesizing', 'playing', 'idle']);
    expect(env.player.state).toBe('idle');
    expect(env.player.activeBlockId).toBeNull();
  });

  test('1b. display math is verbalized, never sent raw to the synthesizer', async () => {
    const env = makeEnv();
    await env.player.speak('b1', 'The square $$x^2 + 1$$ is always positive.');
    const req = env.provider.requests[0]!;
    // The verbalizer is not initialised in tests — the guarded fallback
    // announces the equation instead of emitting raw $$…$$ or deleting it.
    expect(req.text).not.toContain('$$');
    expect(req.text).toContain('Equation: x^2 + 1.');
    expect(req.text).toContain('always positive');
  });

  test('2. pause() / resume() round-trip through the sink offset bookkeeping', async () => {
    const env = makeEnv({ autoComplete: false });
    const pending = env.player.speak('b1', 'Hold on a moment.');
    await vi.waitFor(() => expect(env.player.state).toBe('playing'));
    env.player.pause();
    expect(env.player.state).toBe('paused');
    expect(env.sink.pauses).toBe(1);
    env.player.resume();
    expect(env.player.state).toBe('playing');
    expect(env.sink.resumes).toBe(1);
    env.sink.finishCurrent(); // natural completion
    await pending;
    expect(env.player.state).toBe('idle');
    expect(env.player.activeBlockId).toBeNull();
    expect(env.states).toEqual(['synthesizing', 'playing', 'paused', 'playing', 'idle']);
  });

  test('3. replay re-speaks from the top; unchanged content hits the session cache, changed content busts it', async () => {
    const env = makeEnv();
    await env.player.speak('b1', 'First answer.');
    expect(env.provider.requests).toHaveLength(1);
    await env.player.replay('b1');
    expect(env.provider.requests).toHaveLength(1); // session cache honored
    await env.player.speak('b1', 'First answer, edited.');
    expect(env.provider.requests).toHaveLength(2); // content hash busts
    await env.player.speak('b1', 'First answer, edited.');
    expect(env.provider.requests).toHaveLength(2); // settled success stays cached
  });

  test('4. stop() mid-utterance cuts playback; a stop racing in-flight synthesis discards its result (token discipline)', async () => {
    const env = makeEnv({ autoComplete: false });
    const first = env.player.speak('b1', 'A long spoken answer.');
    await vi.waitFor(() => expect(env.player.state).toBe('playing'));
    env.player.stop();
    expect(env.player.state).toBe('idle');
    await first;
    expect(env.sink.played).toHaveLength(1);
    expect(env.provider.requests).toHaveLength(1); // no further synthesis
    // Now race stop() against an in-flight synthesize: the zombie result
    // must never reach the sink.
    const second = env.player.speak('b2', 'Another answer.');
    expect(env.player.state).toBe('synthesizing');
    env.player.stop();
    const result = await second;
    expect(result).toBeNull();
    expect(env.player.state).toBe('idle');
    expect(env.sink.played).toHaveLength(1);
  });

  test('5. getSpeech() null → sticky unavailable; reset() after a speech identity appears re-arms', async () => {
    const env = makeEnv();
    env.setSpeech(null);
    const refused = await env.player.speak('b1', 'Hello there.');
    expect(refused).toBeNull();
    expect(env.provider.requests).toHaveLength(0); // provider never touched
    expect(env.errors).toEqual(['voice-unavailable']);
    expect(env.player.state).toBe('unavailable');
    // Sticky: further presses refuse without re-probing.
    await env.player.speak('b2', 'Anyone there?');
    expect(env.provider.requests).toHaveLength(0);
    expect(env.errors).toEqual(['voice-unavailable', 'voice-unavailable']);
    // A narration session arriving late un-mutes the desk.
    env.player.reset();
    expect(env.player.state).toBe('idle');
    env.setSpeech({ provider: env.provider, voice: 'af_heart', lang: 'en', rate: 1 });
    const heard = await env.player.speak('b1', 'Hello there.');
    expect(heard).not.toBeNull();
    expect(env.provider.requests).toHaveLength(1);
    expect(env.player.state).toBe('idle');
  });

  test('6. narration-active refusal: voice-busy, provider and sink untouched', async () => {
    const env = makeEnv({ isNarrationActive: () => true });
    const refused = await env.player.speak('b1', 'May I speak?');
    expect(refused).toBeNull();
    expect(env.errors).toEqual(['voice-busy']);
    expect(env.provider.requests).toHaveLength(0);
    expect(env.sink.played).toHaveLength(0);
    expect(env.player.state).toBe('idle'); // not sticky — narration may finish
  });

  test('7. transient failure retries once; a permanent failure on the retry skips further retries → voice-failed', async () => {
    const env = makeEnv();
    env.provider.queueFailure('Faltering answer.', new Error('socket hangup'));
    env.provider.queueFailure('Faltering answer.', new SpeechSynthesisPermanentError('bad voice'));
    const failed = await env.player.speak('b1', 'Faltering answer.');
    expect(failed).toBeNull();
    expect(env.provider.requests).toHaveLength(2); // exactly one retry
    expect(env.errors).toEqual(['voice-failed']);
    expect(env.player.state).toBe('idle');
    expect(env.player.activeBlockId).toBeNull();
    // The settled failure was evicted — the next press is a fresh request.
    const retried = await env.player.speak('b1', 'Faltering answer.');
    expect(env.provider.requests).toHaveLength(3);
    expect(retried).not.toBeNull();
  });

  test('10. rate is read live at speak time (replay of cached audio rides the new rate)', async () => {
    const env = makeEnv();
    await env.player.speak('b1', 'First.');
    env.setSpeech({ provider: env.provider, voice: 'af_heart', lang: 'en', rate: 1.5 });
    await env.player.speak('b2', 'Second.');
    expect(env.sink.rates).toEqual([1, 1.5]);
    await env.player.replay('b1'); // cache hit — no new synthesis…
    expect(env.provider.requests).toHaveLength(2);
    expect(env.sink.rates).toEqual([1, 1.5, 1.5]); // …but the new rate applies
  });

  test('11. unit-change yield: the moment narration takes focus, workbench playback stops', async () => {
    // The tab wires controller 'unit-change' → player.stop() (s4 §5 law 2;
    // controller.ts re-dispatches unit-change at every playFrom). Reproduce
    // that wiring against a stand-in EventTarget: playback must cut the
    // instant a new narration unit starts.
    const controller = new EventTarget();
    const env = makeEnv({ autoComplete: false });
    controller.addEventListener('unit-change', () => env.player.stop());
    const pending = env.player.speak('b1', 'A spoken answer.');
    await vi.waitFor(() => expect(env.player.state).toBe('playing'));
    controller.dispatchEvent(new CustomEvent('unit-change'));
    expect(env.player.state).toBe('idle');
    await pending;
    expect(env.sink.stops).toBeGreaterThan(0);
    expect(env.sink.played).toHaveLength(1); // no zombie playback
  });
});

describe('voice transcript metadata (s4 §3, audit R10)', () => {
  test('8. [VOICE] commits to metadata; the transcript round-trips it; a 2.1 transcript loads unchanged', () => {
    const block = commitProfessorBlock('The answer is 4.\n[VOICE]');
    expect(block.voice?.requested).toBe(true);
    expect(block.content).not.toContain('[VOICE]');
    // The playback write-back (s4 §4.4) flows through the same document.
    block.voice = {
      requested: block.voice?.requested ?? false,
      voiceId: 'af_heart',
      lastHeardAt: '2026-09-15T12:00:00.000Z',
    };
    const parsed = parseTranscript(serializeTranscript([block]));
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.voice).toEqual({
      requested: true,
      voiceId: 'af_heart',
      lastHeardAt: '2026-09-15T12:00:00.000Z',
    });
    // A hand-written 2.1 transcript (no voice field, version 1) parses and
    // serializes unchanged — campaign non-negotiable 5.
    const legacy = JSON.stringify({
      version: 1,
      savedAt: '2026-09-01T00:00:00.000Z',
      blocks: [
        { id: 'old1', author: 'professor', content: 'Old answer.', at: '2026-09-01T00:00:00.000Z' },
      ],
    });
    const legacyParsed = parseTranscript(legacy);
    expect(legacyParsed).toHaveLength(1);
    expect(legacyParsed?.[0]?.voice).toBeUndefined();
    expect(parseTranscript(serializeTranscript(legacyParsed!))?.[0]?.content).toBe('Old answer.');
  });

  test('9. [VOICE] parse contract: idempotent, captured inside an unterminated $$ shield, math and lowercase untouched', () => {
    const single = parseProfessorTags('Hear the rhythm.\n[VOICE]');
    expect(single.voice).toBe(true);
    expect(single.display).not.toContain('[VOICE]');
    // Multiple [VOICE] per turn: first wins, idempotent (s4 §11 Q1).
    const twice = parseProfessorTags('Hear it.\n[VOICE]\n[VOICE]');
    expect(twice.voice).toBe(true);
    // Captured even inside an unterminated $$ shield (protocol pass 1).
    const shielded = parseProfessorTags('$$x^2 + 1\n[VOICE]');
    expect(shielded.voice).toBe(true);
    // But [0,1] inside math and a lowercase [voice] pass through intact.
    const math = parseProfessorTags('The interval $$[0,1]$$ is closed.');
    expect(math.voice).toBeUndefined();
    expect(math.display).toContain('[0,1]');
    const lower = parseProfessorTags('He said [voice] softly.');
    expect(lower.voice).toBeUndefined();
    expect(lower.display).toContain('[voice]');
  });
});
