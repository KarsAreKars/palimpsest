import './settings.css';
/**
 * Settings → Narration (master plan §5).
 *
 * The voice tab for the Palimpsest narration layer: which provider reads
 * your books (built-in Edge voices, free, or ElevenLabs with your own key),
 * which voice, which model tier, and the default listening speed.
 * Distinct from the upstream TTS tab, which configures the legacy
 * parse-the-PDF reader speech path.
 */
import React, { useEffect, useState } from 'react';
import {
  useNarrationSettings,
  MIN_NARRATION_RATE,
  MAX_NARRATION_RATE,
} from '@/services/narration/settings';
import { EdgeSpeechTTS } from '@/libs/edgeTTS';
import { NarrationQwenProvider } from '@/services/narration/narrationQwenProvider';
import type { TTSVoice } from '@/services/tts/types';
import type { SettingsPanelPanelProp } from './SettingsDialog';

const NarrationPanel: React.FC<SettingsPanelPanelProp> = ({ onRegisterReset }) => {
  const settings = useNarrationSettings();

  useEffect(() => {
    onRegisterReset(() => {
      settings.setProvider('edge');
      settings.setEdgeVoiceId(null);
      settings.setElevenlabsApiKey('');
      settings.setElevenlabsVoiceId(null);
      settings.setElevenlabsTier('flash');
      settings.setRate(1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edgeVoices: TTSVoice[] = EdgeSpeechTTS.voices;

  return (
    <div className='flex flex-col gap-6 px-4 py-4'>
      <div>
        <h3 className='mb-2 text-sm font-semibold'>Narrator</h3>
        <p className='mb-3 text-xs text-ink/60'>
          The voice that reads your books aloud. Changes apply on the fly — your place is kept.
        </p>
        <div className='flex flex-col gap-2'>
          <label className='flex cursor-pointer items-center gap-2'>
            <input
              type='radio'
              name='narration-provider'
              className='settings-check'
              checked={settings.provider === 'edge'}
              onChange={() => settings.setProvider('edge')}
            />
            <span className='text-sm'>
              Built-in voices — free (streams from Microsoft’s service)
            </span>
          </label>
          <label className='flex cursor-pointer items-center gap-2'>
            <input
              type='radio'
              name='narration-provider'
              className='settings-check'
              checked={settings.provider === 'elevenlabs'}
              onChange={() => settings.setProvider('elevenlabs')}
            />
            <span className='text-sm'>ElevenLabs — premium voices, uses your API key</span>
          </label>
          {settings.provider === 'elevenlabs' && (
            <p className='mt-1 text-xs text-ink/60'>
              The key and voice live under Settings → Integrations → ElevenLabs voice.
            </p>
          )}
          <label className='flex cursor-pointer items-center gap-2'>
            <input
              type='radio'
              name='narration-provider'
              className='settings-check'
              checked={settings.provider === 'qwen-local'}
              onChange={() => settings.setProvider('qwen-local')}
            />
            <span className='text-sm'>
              Qwen3-TTS + Kokoro — local neural voices, offline (needs the local server)
            </span>
          </label>
        </div>
      </div>

      {settings.provider === 'edge' && (
        <div>
          <h3 className='mb-2 text-sm font-semibold'>Built-in voice</h3>
          <select
            className='settings-select w-full max-w-xs'
            value={settings.edgeVoiceId ?? ''}
            onChange={(e) => settings.setEdgeVoiceId(e.target.value || null)}
            aria-label='Built-in narrator voice'
          >
            <option value=''>Automatic (per book language)</option>
            {edgeVoices
              .filter((v) => v.id.startsWith('en'))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {settings.provider === 'qwen-local' && (
        <div>
          <h3 className='mb-2 text-sm font-semibold'>Local neural voice</h3>
          <QwenVoicePicker />
          <p className='mt-1 text-xs text-ink/50'>
            Kokoro voices (Heart, Adam…) are the long-form pick; Qwen3 voices follow style
            instructions. Runs on your Mac via the local server (port 8737). If narration silently
            uses a built-in voice instead, the server isn't running.
          </p>
        </div>
      )}

      <div>
        <h3 className='mb-2 text-sm font-semibold'>
          Listening speed — {settings.rate.toFixed(2)}×
        </h3>
        <input
          type='range'
          className='settings-range w-full max-w-xs'
          min={MIN_NARRATION_RATE}
          max={MAX_NARRATION_RATE}
          step={0.05}
          value={settings.rate}
          onChange={(e) => settings.setRate(Number(e.target.value))}
          aria-label='Narration speed'
        />
        <p className='mt-1 text-xs text-ink/50'>
          Applies from the next sentence; remembered across sessions.
        </p>
      </div>
    </div>
  );
};

export default NarrationPanel;

/** Voice list straight from the local Qwen server (falls back to the
 *  curated static list when it's down). Kept tiny on purpose — the panel
 *  is a picker, not a dashboard. */
function QwenVoicePicker() {
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
}
