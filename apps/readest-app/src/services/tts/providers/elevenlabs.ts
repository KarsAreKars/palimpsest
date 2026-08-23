/**
 * ElevenLabs narration provider (master plan §5 — the premium Narrator tier
 * behind the SpeechProvider seam).
 *
 * v2-family models only, per the plan: flash/turbo for low-latency
 * click-to-speak, multilingual_v2 for settle-in quality. Rate is never sent
 * (playout-side, per the provider contract), so cached audio stays
 * rate-independent. Word boundaries are omitted — narration highlights at
 * unit (sentence) level; the with-timestamps endpoint can add them later.
 *
 * Cost transparency: `getQuota()` surfaces the subscription character usage
 * for the settings panel. Cached audio never re-bills; the player cache and
 * the hash-keyed audio store (plan §5) sit above this provider.
 */
import type { TTSVoice } from '../types';
import type { SpeechProvider, SpeechSynthesisRequest, SpeechSynthesisResult } from './types';
import { SpeechSynthesisPermanentError } from './types';

export type ElevenLabsModelTier = 'flash' | 'turbo' | 'quality';

export const ELEVENLABS_MODEL_IDS: Record<ElevenLabsModelTier, string> = {
  flash: 'eleven_flash_v2_5',
  turbo: 'eleven_turbo_v2_5',
  quality: 'eleven_multilingual_v2',
};

const API_BASE = 'https://api.elevenlabs.io/v1';

export interface ElevenLabsQuota {
  used: number;
  limit: number;
}

export class ElevenLabsProvider implements SpeechProvider {
  readonly id = 'elevenlabs';
  readonly label = 'ElevenLabs';
  readonly cacheable = true;

  #apiKey: string;
  #tier: ElevenLabsModelTier;
  #fetch: typeof fetch;

  constructor(opts: {
    apiKey: string;
    tier?: ElevenLabsModelTier;
    fetchImpl?: typeof fetch;
  }) {
    if (!opts.apiKey) throw new Error('ElevenLabs API key required');
    this.#apiKey = opts.apiKey;
    this.#tier = opts.tier ?? 'flash';
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  get modelId(): string {
    return ELEVENLABS_MODEL_IDS[this.#tier];
  }

  async init(): Promise<boolean> {
    try {
      const res = await this.#fetch(`${API_BASE}/voices`, {
        headers: { 'xi-api-key': this.#apiKey },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    const res = await this.#fetch(`${API_BASE}/voices`, {
      headers: { 'xi-api-key': this.#apiKey },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      voices?: Array<{ voice_id: string; name?: string }>;
    };
    // v2 models are multilingual; report 'en' so language filtering by the
    // book's primary language keeps them (they read any supported language).
    return (json.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name ?? v.voice_id,
      lang: 'en',
    }));
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const res = await this.#fetch(
      `${API_BASE}/text-to-speech/${encodeURIComponent(req.voice)}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.#apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: req.text, model_id: this.modelId }),
        signal,
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // 400/404 (bad request/voice) and 401 (bad key) can never succeed on
      // retry → permanent. 429 (rate/quota) and 5xx are transient — the
      // player's retry-once applies.
      if (res.status === 400 || res.status === 401 || res.status === 404) {
        throw new SpeechSynthesisPermanentError(
          `ElevenLabs rejected the request (${res.status}): ${detail}`,
        );
      }
      throw new Error(`ElevenLabs synthesis failed (${res.status}): ${detail}`);
    }
    return { audio: await res.arrayBuffer(), boundaries: [] };
  }

  /** Subscription character usage, for the settings panel's cost line. */
  async getQuota(): Promise<ElevenLabsQuota | null> {
    try {
      const res = await this.#fetch(`${API_BASE}/user/subscription`, {
        headers: { 'xi-api-key': this.#apiKey },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        character_count?: number;
        character_limit?: number;
      };
      if (typeof json.character_count !== 'number' || typeof json.character_limit !== 'number') {
        return null;
      }
      return { used: json.character_count, limit: json.character_limit };
    } catch {
      return null;
    }
  }
}
