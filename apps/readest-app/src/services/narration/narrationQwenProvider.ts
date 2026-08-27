/**
 * Local Qwen3-TTS narration provider (A9).
 *
 * Talks to the localhost qwen_server.py wrapper (mlx-audio, Apple Silicon):
 * open-weights Qwen3-TTS narrating fully offline — no key, no cloud, no
 * per-book cost. The server is a plain HTTP loopback service the user (or a
 * launcher) starts once; when it's unreachable this provider fails init and
 * the controller falls back to Edge — a book that reads in a worse voice
 * beats a book that doesn't read.
 *
 * Transport rides getAIFetch() so the Tauri webview's CSP/preflight never
 * enters the picture (same reasoning as the AI providers).
 */
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import type { TTSVoice } from '@/services/tts/types';
import type {
  SpeechProvider,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from '@/services/tts/providers/types';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

const DEFAULT_BASE = 'http://127.0.0.1:8737';

// Shown if the server is down at voice-list time; the server is the source
// of truth when it's up.
const STATIC_VOICES: TTSVoice[] = [
  { id: 'Vivian', name: 'Vivian (warm female)', lang: 'en' },
  { id: 'Serena', name: 'Serena (soft female)', lang: 'en' },
  { id: 'Chelsie', name: 'Chelsie (clear female)', lang: 'en' },
  { id: 'Ethan', name: 'Ethan (warm male)', lang: 'en' },
  { id: 'Ryan', name: 'Ryan (clear male)', lang: 'en' },
  { id: 'Aiden', name: 'Aiden (deep male)', lang: 'en' },
];

export class NarrationQwenProvider implements SpeechProvider {
  readonly id = 'qwen-local';
  readonly label = 'Qwen3-TTS (local)';
  readonly fallbackVoiceId = 'Vivian';
  readonly cacheable = true; // local + deterministic-ish; the player caches per unit anyway

  #base: string;
  #fetch: typeof fetch;

  constructor(opts: { baseUrl?: string } = {}) {
    this.#base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.#fetch = getAIFetch();
  }

  async init(): Promise<boolean> {
    try {
      const res = await this.#fetch(`${this.#base}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    try {
      const res = await this.#fetch(`${this.#base}/voices`);
      if (!res.ok) return STATIC_VOICES;
      const data = (await res.json()) as { voices?: { id: string; label: string }[] };
      const voices = (data.voices ?? []).map((v) => ({ id: v.id, name: v.label, lang: 'en' }));
      return voices.length ? voices : STATIC_VOICES;
    } catch {
      return STATIC_VOICES;
    }
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const res = await this.#fetch(`${this.#base}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: req.text, voice: req.voice }),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 400) {
        throw new SpeechSynthesisPermanentError(`qwen-tts rejected: ${detail}`);
      }
      throw new Error(`qwen-tts failed (${res.status}): ${detail}`);
    }
    // Callers own the buffer; fetch hands out a fresh one per response.
    return { audio: await res.arrayBuffer(), boundaries: [] };
  }
}
