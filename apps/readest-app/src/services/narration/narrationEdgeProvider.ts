/**
 * Web-lane narration provider: synthesis via the same-origin
 * /api/tts/narration route (server-side Edge TTS with the headers browsers
 * can't send). The Tauri shell talks to Microsoft's endpoint directly; this
 * adapter exists because the plan's demo/development lane runs in a plain
 * browser where the direct WebSocket is rejected.
 */
import { EdgeSpeechTTS } from '@/libs/edgeTTS';
import type { TTSVoice } from '@/services/tts/types';
import type {
  SpeechProvider,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from '@/services/tts/providers/types';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

export class NarrationEdgeProvider implements SpeechProvider {
  readonly id = 'narration-edge';
  readonly label = 'Edge (narration relay)';
  readonly fallbackVoiceId = 'en-US-AriaNeural';
  readonly cacheable = false; // the NarrationPlayer keeps its own unit cache

  async init(): Promise<boolean> {
    try {
      const res = await fetch('/api/tts/narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'test', voice: this.fallbackVoiceId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    return EdgeSpeechTTS.voices;
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const res = await fetch('/api/tts/narration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: req.text, voice: req.voice, lang: req.lang }),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 400) {
        throw new SpeechSynthesisPermanentError(`narration TTS rejected: ${detail}`);
      }
      throw new Error(`narration TTS failed (${res.status}): ${detail}`);
    }
    // Callers own the buffer; fetch hands out a fresh one per response.
    return { audio: await res.arrayBuffer(), boundaries: [] };
  }
}
