import React, { useEffect, useState } from 'react';
import { useNarrationSettings } from '@/services/narration/settings';
import { NarrationQwenProvider } from '@/services/narration/narrationQwenProvider';
import type { TTSVoice } from '@/services/tts/types';

/**
 * Voice list straight from the local Qwen server (falls back to the
 * curated static list when it's down). Kept tiny on purpose — the panel
 * is a picker, not a dashboard.
 *
 * Shared by Settings → Narration and Settings → Integrations → Narrator
 * voice so the dropdown lives where readers expect it either way.
 *
 * Kokoro voices lead the list: they suit long-form listening (the
 * server default, Heart, is Kokoro too). Picking a voice here implies
 * the local provider — the dropdown must never be a no-op because the
 * provider radio elsewhere still says Edge (2026-09-14 dogfood: the
 * reader heard Edge's Natasha no matter what they picked).
 */
const KOKORO_PREFIXES = ['af_', 'am_', 'bf_', 'bm_'];
const CLONE_IDS = ['storyteller', 'librarian'];

function sortVoices(voices: TTSVoice[]): TTSVoice[] {
  const rank = (v: TTSVoice) =>
    KOKORO_PREFIXES.some((p) => v.id.startsWith(p)) ? 0 : CLONE_IDS.includes(v.id) ? 2 : 1;
  return [...voices].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

const QwenVoicePicker: React.FC = () => {
  const settings = useNarrationSettings();
  const [voices, setVoices] = useState<TTSVoice[] | null>(null);
  useEffect(() => {
    let alive = true;
    new NarrationQwenProvider()
      .getAllVoices()
      .then((v) => alive && setVoices(sortVoices(v)))
      .catch(() => alive && setVoices(null));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <select
      className='settings-select w-full max-w-xs'
      value={settings.qwenVoiceId ?? ''}
      onChange={(e) => {
        // Choosing a voice IS choosing the local narrator — flip the
        // provider so the pick takes effect instead of silently routing
        // to Edge because the provider radio was never touched.
        settings.setProvider('qwen-local');
        settings.setQwenVoiceId(e.target.value || null);
      }}
      aria-label='Narrator voice'
    >
      <option value=''>Heart — Kokoro (default)</option>
      {(voices ?? [])
        // af_heart is the server default, covered by the placeholder row.
        .filter((v) => v.id !== 'af_heart')
        .map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
    </select>
  );
};

export default QwenVoicePicker;
