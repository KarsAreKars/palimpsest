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
import React, { useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  useNarrationSettings,
  MIN_NARRATION_RATE,
  MAX_NARRATION_RATE,
} from '@/services/narration/settings';
import { EdgeSpeechTTS } from '@/libs/edgeTTS';
import type { TTSVoice } from '@/services/tts/types';
import type { SettingsPanelPanelProp } from './SettingsDialog';
import QwenVoicePicker from './QwenVoicePicker';

const NarrationPanel: React.FC<SettingsPanelPanelProp> = ({ onRegisterReset }) => {
  const _ = useTranslation();
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
        <h3 className='mb-2 text-sm font-semibold'>{_('Narrator')}</h3>
        <p className='mb-3 text-xs text-mutedink'>
          {_(
            'The voice that reads your books aloud. Changes apply on the fly — your place is kept.',
          )}
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
              {_('Built-in voices — free (streams from Microsoft’s service)')}
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
            <span className='text-sm'>{_('ElevenLabs — premium voices, uses your API key')}</span>
          </label>
          {settings.provider === 'elevenlabs' && (
            <p className='mt-1 text-xs text-mutedink'>
              {_('The key and voice live under Settings → Integrations → ElevenLabs voice.')}
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
              {_('Qwen3-TTS + Kokoro — neural voices that run entirely on this device')}
            </span>
          </label>
        </div>
      </div>

      {settings.provider === 'edge' && (
        <div>
          <h3 className='mb-2 text-sm font-semibold'>{_('Built-in voice')}</h3>
          <select
            className='settings-select w-full max-w-xs'
            value={settings.edgeVoiceId ?? ''}
            onChange={(e) => settings.setEdgeVoiceId(e.target.value || null)}
            aria-label={_('Built-in narrator voice')}
          >
            <option value=''>{_('Automatic (per book language)')}</option>
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
          <h3 className='mb-2 text-sm font-semibold'>{_('Local neural voice')}</h3>
          <QwenVoicePicker />
          <p className='mt-1 text-xs text-mutedink'>
            {_(
              'Kokoro voices (Heart, Adam…) suit long-form listening; Qwen3 voices follow style instructions. If the narrator ever falls back to a built-in voice, the local voices are still warming up — try again in a moment.',
            )}
          </p>
        </div>
      )}

      <div>
        <h3 className='mb-2 text-sm font-semibold'>
          {_('Listening speed — {{rate}}×', { rate: settings.rate.toFixed(2) })}
        </h3>
        <input
          type='range'
          className='settings-range w-full max-w-xs'
          min={MIN_NARRATION_RATE}
          max={MAX_NARRATION_RATE}
          step={0.05}
          value={settings.rate}
          onChange={(e) => settings.setRate(Number(e.target.value))}
          aria-label={_('Narration speed')}
        />
        <p className='mt-1 text-xs text-mutedink'>
          {_('Applies from the next sentence; remembered across sessions.')}
        </p>
      </div>
    </div>
  );
};

export default NarrationPanel;
