/**
 * Narration settings (master plan §5 — Settings → Narration).
 *
 * Global narrator preferences: which provider reads books, which voice, how
 * fast. Persisted to localStorage so both lanes (web dev, Tauri) share the
 * code path. The ElevenLabs key lives here on the web lane; on Tauri it
 * should move to the OS keychain (Tauri keyring plugin is already in the
 * tree) — flagged as a hardening TODO before any public build.
 *
 * Per-book voice override (plan §5) layers on top later; this store is the
 * global default the NarrationController reads at session load.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ElevenLabsModelTier } from '@/services/tts/providers/elevenlabs';

export type NarrationProviderId = 'edge' | 'elevenlabs' | 'qwen-local';

export interface NarrationSettingsState {
  provider: NarrationProviderId;
  /** Built-in Edge/system voice id (null = provider default per language). */
  edgeVoiceId: string | null;
  elevenlabsApiKey: string;
  elevenlabsVoiceId: string | null;
  /** Local Qwen3-TTS voice id (A9); null = server default (Vivian). */
  qwenVoiceId: string | null;
  /** flash = low latency (default; click-to-speak wants speed), quality = long listens. */
  elevenlabsTier: ElevenLabsModelTier;
  /** Playback rate, remembered across sessions (per-book memory comes later). */
  rate: number;

  setProvider(provider: NarrationProviderId): void;
  setEdgeVoiceId(id: string | null): void;
  setElevenlabsApiKey(key: string): void;
  setElevenlabsVoiceId(id: string | null): void;
  setQwenVoiceId(id: string | null): void;
  setElevenlabsTier(tier: ElevenLabsModelTier): void;
  setRate(rate: number): void;
}

export const MIN_NARRATION_RATE = 0.5;
export const MAX_NARRATION_RATE = 3;

export const useNarrationSettings = create<NarrationSettingsState>()(
  persist(
    (set) => ({
      provider: 'edge',
      edgeVoiceId: null,
      elevenlabsApiKey: '',
      elevenlabsVoiceId: null,
      qwenVoiceId: null,
      elevenlabsTier: 'flash',
      rate: 1,

      setProvider: (provider) => set({ provider }),
      setEdgeVoiceId: (edgeVoiceId) => set({ edgeVoiceId }),
      setElevenlabsApiKey: (elevenlabsApiKey) => set({ elevenlabsApiKey }),
      setElevenlabsVoiceId: (elevenlabsVoiceId) => set({ elevenlabsVoiceId }),
      setQwenVoiceId: (qwenVoiceId) => set({ qwenVoiceId }),
      setElevenlabsTier: (elevenlabsTier) => set({ elevenlabsTier }),
      setRate: (rate) =>
        set({ rate: Math.min(MAX_NARRATION_RATE, Math.max(MIN_NARRATION_RATE, rate)) }),
    }),
    {
      name: 'palimpsest-narration-settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
