import { describe, it, expect, vi } from 'vitest';
import { ElevenLabsProvider, ELEVENLABS_MODEL_IDS } from '@/services/tts/providers/elevenlabs';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

const makeFetch = (handler: (url: string, init?: RequestInit) => Response) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch;

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ElevenLabsProvider', () => {
  it('requires an API key', () => {
    expect(() => new ElevenLabsProvider({ apiKey: '' })).toThrow(/key/i);
  });

  it('maps the voice library to TTSVoice entries', async () => {
    const provider = new ElevenLabsProvider({
      apiKey: 'sk_test',
      fetchImpl: makeFetch(() => okJson({ voices: [{ voice_id: 'abc123', name: 'Rachel' }] })),
    });
    const voices = await provider.getAllVoices();
    expect(voices).toEqual([{ id: 'abc123', name: 'Rachel', lang: 'en' }]);
  });

  it('sends the tier model id and text to the stream endpoint', async () => {
    let seen: { url: string; body?: string; key?: string } | null = null;
    const provider = new ElevenLabsProvider({
      apiKey: 'sk_test',
      tier: 'quality',
      fetchImpl: makeFetch((url, init) => {
        seen = {
          url,
          body: String(init?.body),
          key: (init?.headers as Record<string, string> | undefined)?.['xi-api-key'],
        };
        return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
      }),
    });
    const result = await provider.synthesize(
      { lang: 'en', text: 'Let A be a ring.', voice: 'abc123', pitch: 0 },
      new AbortController().signal,
    );
    expect(seen!.url).toContain('/text-to-speech/abc123/stream');
    expect(seen!.key).toBe('sk_test');
    expect(JSON.parse(seen!.body!)).toEqual({
      text: 'Let A be a ring.',
      model_id: ELEVENLABS_MODEL_IDS.quality,
    });
    expect(result.audio.byteLength).toBe(3);
    expect(result.boundaries).toEqual([]);
  });

  it('treats 401 as permanent (bad key never succeeds on retry)', async () => {
    const provider = new ElevenLabsProvider({
      apiKey: 'sk_bad',
      fetchImpl: makeFetch(() => new Response('unauthorized', { status: 401 })),
    });
    await expect(
      provider.synthesize(
        { lang: 'en', text: 'x', voice: 'abc', pitch: 0 },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
  });

  it('treats 429 as transient (rate limit — the player may retry)', async () => {
    const provider = new ElevenLabsProvider({
      apiKey: 'sk_test',
      fetchImpl: makeFetch(() => new Response('slow down', { status: 429 })),
    });
    await expect(
      provider.synthesize(
        { lang: 'en', text: 'x', voice: 'abc', pitch: 0 },
        new AbortController().signal,
      ),
    ).rejects.not.toBeInstanceOf(SpeechSynthesisPermanentError);
  });

  it('parses subscription quota for the cost line', async () => {
    const provider = new ElevenLabsProvider({
      apiKey: 'sk_test',
      fetchImpl: makeFetch(() => okJson({ character_count: 1200, character_limit: 10000 })),
    });
    expect(await provider.getQuota()).toEqual({ used: 1200, limit: 10000 });
  });
});
