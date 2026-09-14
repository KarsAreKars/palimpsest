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
 */
const QwenVoicePicker: React.FC = () => {
  const settings = useNarrationSettings();
  const [voices, setVoices] = useState<TTSVoice[] | null>(null);
  useEffect(() => {
    let alive = true;
    new NarrationQwenProvider()
      .getAllVoices()
      .then((v) => alive && setVoices(v))
      .catch(() => alive && setVoices(null));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <select
      className='settings-select w-full max-w-xs'
      value={settings.qwenVoiceId ?? ''}
      onChange={(e) => settings.setQwenVoiceId(e.target.value || null)}
      aria-label='Qwen3-TTS narrator voice'
    >
      <option value=''>Vivian (default)</option>
      {(voices ?? [])
        .filter((v) => v.id !== 'Vivian')
        .map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
    </select>
  );
};

export default QwenVoicePicker;
