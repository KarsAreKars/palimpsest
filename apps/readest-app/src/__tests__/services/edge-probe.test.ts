import { describe, expect, it } from 'vitest';
import { EdgeSpeechTTS } from '@/libs/edgeTTS';

describe('edge TTS live probe', () => {
  it('synthesizes a test utterance over wss', async () => {
    const tts = new EdgeSpeechTTS('https');
    const res = await tts.create({
      lang: 'en',
      text: 'test',
      voice: 'en-US-AriaNeural',
      rate: 1.0,
      pitch: 1.0,
    });
    expect(res.status).toBeLessThan(400);
  }, 30_000);
});
