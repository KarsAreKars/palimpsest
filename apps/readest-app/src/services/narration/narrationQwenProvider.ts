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
// of truth when it's up. Kokoro leads — those voices suit long-form
// listening (the server's own default is Kokoro Heart).
const STATIC_VOICES: TTSVoice[] = [
  { id: 'af_heart', name: 'Heart — Kokoro (warm female)', lang: 'en' },
  { id: 'am_adam', name: 'Adam — Kokoro (clear male)', lang: 'en' },
  { id: 'af_bella', name: 'Bella — Kokoro (bright female)', lang: 'en' },
  { id: 'af_nicole', name: 'Nicole — Kokoro (soft female)', lang: 'en' },
  { id: 'am_michael', name: 'Michael — Kokoro (calm male)', lang: 'en' },
  { id: 'bf_emma', name: 'Emma — Kokoro (British female)', lang: 'en' },
  { id: 'bm_george', name: 'George — Kokoro (British male)', lang: 'en' },
  { id: 'vivian', name: 'Vivian (warm female)', lang: 'en' },
  { id: 'serena', name: 'Serena (soft female)', lang: 'en' },
  { id: 'ryan', name: 'Ryan (clear male)', lang: 'en' },
  { id: 'aiden', name: 'Aiden (deep male)', lang: 'en' },
  { id: 'eric', name: 'Eric (mellow male)', lang: 'en' },
  { id: 'dylan', name: 'Dylan (bright male)', lang: 'en' },
  { id: 'storyteller', name: 'The Storyteller — elderly British male (clone)', lang: 'en' },
  { id: 'librarian', name: 'The Librarian — middle-aged British female (clone)', lang: 'en' },
];

// Half-dead-server watchdog (2026-09-14): the stdlib server answers /health
// forever, but its MLX stack can die under it (every generation EPIPEs —
// seen after a sleep/wake cycle) and the controller can't see that from a
// health probe. Two consecutive synthesis failures ask the app to restart
// the server; a success resets the count. Rate-limited: one restart a
// minute, and only the Tauri lane can actually invoke — elsewhere this is
// a no-op and the controller's Edge fallback covers the outage.
let consecutiveFailures = 0;
let restartInFlight: Promise<unknown> | null = null;
let lastRestartAt = 0;

function noteSynthesisFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures < 2 || restartInFlight) return;
  if (Date.now() - lastRestartAt < 60_000) return;
  lastRestartAt = Date.now();
  restartInFlight = import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('restart_voice_server'))
    .catch(() => undefined)
    .finally(() => {
      restartInFlight = null;
    });
}

function noteSynthesisSuccess(): void {
  consecutiveFailures = 0;
}

export class NarrationQwenProvider implements SpeechProvider {
  readonly id = 'qwen-local';
  readonly label = 'Qwen3-TTS (local)';
  readonly fallbackVoiceId = 'af_heart';
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
      body: JSON.stringify({
        text: req.text,
        voice: req.voice,
        // Per-request instruct override (the server supports it; absent =
        // the pinned ear-approved default in qwen_server.py).
        ...(req.instruct ? { instruct: req.instruct } : {}),
      }),
      signal,
    }).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      noteSynthesisFailure();
      throw e;
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // 400s are the caller's fault (bad text) — not a sick server.
      if (res.status === 400) {
        throw new SpeechSynthesisPermanentError(`qwen-tts rejected: ${detail}`);
      }
      noteSynthesisFailure();
      throw new Error(`qwen-tts failed (${res.status}): ${detail}`);
    }
    // Callers own the buffer; fetch hands out a fresh one per response.
    const audio = await res.arrayBuffer();
    noteSynthesisSuccess();
    return { audio, boundaries: [] };
  }
}
