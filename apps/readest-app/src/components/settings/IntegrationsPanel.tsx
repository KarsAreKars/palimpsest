import './settings.css';
import React, { useEffect, useState } from 'react';
import { RiGraduationCapLine, RiMicLine, RiUserVoiceLine } from 'react-icons/ri';
import { PiCheckCircle, PiWarningCircle, PiSpinner } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';
import { useNarrationSettings } from '@/services/narration/settings';
import { ElevenLabsProvider, type ElevenLabsQuota } from '@/services/tts/providers/elevenlabs';
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import type { TTSVoice } from '@/services/tts/types';
import SubPageHeader from './SubPageHeader';
import QwenVoicePicker from './QwenVoicePicker';
import { BoxedList, NavigationRow, SectionTitle, SettingLabel, SettingsRow } from './primitives';

type SubPage = 'prof' | 'elevenlabs' | 'voice' | null;

/**
 * Integrations panel — AI providers only (PRODUCT.md: Integrations = AI
 * only). Two inline sub-pages, both using the existing NavigationRow →
 * sub-page pattern:
 *
 *   · The Prof — the AI tutor's endpoint (LLM base URL, key, model)
 *   · ElevenLabs — premium narration voices
 *
 * Upstream sync/cloud/share integrations (KOReader, BookOrbit, Readwise,
 * Hardcover, OPDS, Audiobookshelf, Send-to-Readest, LocalSend, WebDAV,
 * Google Drive, S3, OneDrive, iCloud, Readest Cloud, Discord) are removed
 * from the product surface; their form components stay in the tree, dormant.
 */
const IntegrationsPanel: React.FC = () => {
  const _ = useTranslation();
  const { settings, requestedSubPage, setRequestedSubPage } = useSettingsStore();

  const [subPage, setSubPage] = useState<SubPage>(null);

  // Android Back / Esc: when an integrations sub-page is open, intercept
  // and step back to the integrations list instead of letting <Dialog>'s
  // listener close the whole Settings dialog.
  useKeyDownActions({
    enabled: subPage !== null,
    onCancel: () => setSubPage(null),
  });

  // Deep-link consumption: recognised values match the SubPage union.
  useEffect(() => {
    if (!requestedSubPage) return;
    if (requestedSubPage === 'prof' || requestedSubPage === 'elevenlabs') {
      setSubPage(requestedSubPage);
    }
    setRequestedSubPage(null);
  }, [requestedSubPage, setRequestedSubPage]);

  const narration = useNarrationSettings();

  if (subPage === 'prof')
    return (
      <div className='my-4 w-full'>
        <ProfEndpointForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'elevenlabs')
    return (
      <div className='my-4 w-full'>
        <ElevenLabsForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'voice')
    return (
      <div className='my-4 w-full'>
        <LocalVoiceForm onBack={() => setSubPage(null)} />
      </div>
    );

  const aiSettings: AISettings = settings.aiSettings ?? DEFAULT_AI_SETTINGS;
  const profStatus = aiSettings.enabled
    ? aiSettings.openrouterModel || aiSettings.ollamaModel || _('Connected')
    : _('Not connected');
  const elevenlabsStatus = narration.elevenlabsApiKey
    ? narration.elevenlabsVoiceId
      ? _('Connected')
      : _('Key saved')
    : _('Not connected');

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full px-4'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Integrations')}</h2>
        <p className='text-ink/70 text-sm leading-relaxed'>
          {_(
            'The services that power the Prof and the narrator. Everything else stays on this device.',
          )}
        </p>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.ai'>
        <SectionTitle className='mb-2'>{_('AI')}</SectionTitle>
        <div className='settings-card eink-bordered overflow-hidden'>
          <div className='divide-ink divide-y'>
            <NavigationRow
              icon={RiGraduationCapLine}
              title={_('The Prof — AI tutor')}
              status={profStatus}
              onClick={() => setSubPage('prof')}
            />
            <NavigationRow
              icon={RiMicLine}
              title={_('ElevenLabs voice')}
              status={elevenlabsStatus}
              onClick={() => setSubPage('elevenlabs')}
            />
            <NavigationRow
              icon={RiUserVoiceLine}
              title={_('Narrator voice')}
              status={narration.qwenVoiceId ?? _('Heart (default)')}
              onClick={() => setSubPage('voice')}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * The Prof's endpoint — the LLM the tutor talks to. Same settings-store
 * keys as the full AIPanel (aiSettings.*); this is the compact production
 * surface for the OpenAI-compatible provider the Prof actually uses.
 */
const ProfEndpointForm: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const aiSettings: AISettings = settings.aiSettings ?? DEFAULT_AI_SETTINGS;

  const [enabled, setEnabled] = useState(aiSettings.enabled);
  const [baseUrl, setBaseUrl] = useState(
    aiSettings.openrouterBaseUrl ?? DEFAULT_AI_SETTINGS.openrouterBaseUrl ?? '',
  );
  const [apiKey, setApiKey] = useState(aiSettings.openrouterApiKey ?? '');
  const [model, setModel] = useState(aiSettings.openrouterModel ?? '');
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const saveAiSetting = async (key: keyof AISettings, value: AISettings[keyof AISettings]) => {
    const current = settings;
    if (!current) return;
    const nextAi: AISettings = { ...(current.aiSettings ?? DEFAULT_AI_SETTINGS), [key]: value };
    const next = { ...current, aiSettings: nextAi };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  useEffect(() => {
    if (enabled !== aiSettings.enabled) void saveAiSetting('enabled', enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useEffect(() => {
    if (baseUrl !== (aiSettings.openrouterBaseUrl ?? ''))
      void saveAiSetting('openrouterBaseUrl', baseUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);
  useEffect(() => {
    if (apiKey !== (aiSettings.openrouterApiKey ?? ''))
      void saveAiSetting('openrouterApiKey', apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);
  useEffect(() => {
    if (model !== (aiSettings.openrouterModel ?? '')) void saveAiSetting('openrouterModel', model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const testConnection = async () => {
    setStatus('testing');
    setErrorMessage('');
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      });
      if (res.ok) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(_('The endpoint answered, but refused the request. Check the key.'));
      }
    } catch {
      setStatus('error');
      setErrorMessage(_('Could not reach the endpoint. Check the address.'));
    }
  };

  const disabledSection = !enabled ? 'opacity-50 pointer-events-none select-none' : '';

  return (
    <div className='w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('The Prof — AI tutor')}
        description={_('The endpoint the Prof asks questions on your behalf. OpenAI-compatible.')}
        onBack={onBack}
      />

      <BoxedList title={_('Tutor')}>
        <SettingsRow label={_('Enable the Prof')} asLabel>
          <input
            type='checkbox'
            className='settings-check'
            checked={enabled}
            onChange={() => setEnabled(!enabled)}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Endpoint')} className={disabledSection}>
        <div className='flex flex-col gap-2 py-3 pe-4'>
          <SettingLabel>{_('Base URL')}</SettingLabel>
          <input
            type='text'
            className='paper-field w-full'
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder='https://openrouter.ai/api/v1'
            disabled={!enabled}
          />
        </div>
        <div className='flex flex-col gap-2 py-3 pe-4'>
          <SettingLabel>{_('API key')}</SettingLabel>
          <input
            type='password'
            className='paper-field w-full'
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder='sk-…'
            disabled={!enabled}
            autoComplete='off'
          />
        </div>
        <div className='flex flex-col gap-2 py-3 pe-4'>
          <SettingLabel>{_('Model')}</SettingLabel>
          <input
            type='text'
            className='paper-field w-full'
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder='openai/gpt-4o-mini'
            disabled={!enabled}
          />
          <span className='text-mutedink text-xs'>
            {_('The exact model id the endpoint expects, e.g. openai/gpt-4o-mini or kimi-k3.')}
          </span>
        </div>
      </BoxedList>

      <BoxedList title={_('Connection')} className={disabledSection}>
        <div className='flex min-h-14 items-center justify-between gap-3 pe-4'>
          <button
            className='stamp-btn settings-btn-sm'
            onClick={testConnection}
            disabled={!enabled || status === 'testing'}
          >
            {status === 'testing' ? _('Checking…') : _('Test connection')}
          </button>
          <div>
            {status === 'success' && (
              <span className='settings-success flex items-center gap-1 text-sm'>
                <PiCheckCircle className='size-4 shrink-0' />
                {_('Connected')}
              </span>
            )}
            {status === 'error' && (
              <span className='text-stamp flex items-center gap-1 text-sm'>
                <PiWarningCircle className='size-4 shrink-0' />
                {errorMessage || _('Failed')}
              </span>
            )}
          </div>
        </div>
      </BoxedList>
    </div>
  );
};

/**
 * ElevenLabs — premium narration voices. Same narration-settings store keys
 * as the former NarrationPanel section (elevenlabsApiKey / VoiceId / Tier);
 * lives here so the Narration tab can stay about the local voice engine.
 */
const ElevenLabsForm: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const _ = useTranslation();
  const settings = useNarrationSettings();
  const [keyDraft, setKeyDraft] = useState(settings.elevenlabsApiKey);
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [quota, setQuota] = useState<ElevenLabsQuota | null>(null);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'checking' | 'ok' | 'bad'>(
    settings.elevenlabsApiKey ? 'ok' : 'idle',
  );
  // Set when a stored key fails to restore its voice library — without this
  // the Voice box vanished with no explanation ("it's not showing").
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // A stored key must restore its voice library on mount — otherwise the
  // Voice box stays hidden until the user re-Connects every single time.
  useEffect(() => {
    const stored = settings.elevenlabsApiKey;
    if (!stored) return;
    let alive = true;
    const provider = new ElevenLabsProvider({
      apiKey: stored,
      tier: settings.elevenlabsTier,
      fetchImpl: getAIFetch(),
    });
    provider
      .init()
      .then(async (ok) => {
        if (!alive) return;
        if (!ok) {
          setKeyStatus('bad');
          setRestoreError(_('Saved key was not accepted — reconnect it.'));
          return;
        }
        const [voiceList, q] = await Promise.all([provider.getAllVoices(), provider.getQuota()]);
        if (!alive) return;
        setVoices(voiceList);
        setQuota(q);
        setRestoreError(null);
        if (!useNarrationSettings.getState().elevenlabsVoiceId && voiceList[0]) {
          useNarrationSettings.getState().setElevenlabsVoiceId(voiceList[0].id);
        }
      })
      .catch(() => {
        if (!alive) return;
        setRestoreError(_('Could not reach ElevenLabs — check your connection.'));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateKey = async () => {
    const key = keyDraft.trim();
    if (!key) return;
    setKeyStatus('checking');
    const provider = new ElevenLabsProvider({
      apiKey: key,
      tier: settings.elevenlabsTier,
      fetchImpl: getAIFetch(),
    });
    const ok = await provider.init();
    if (!ok) {
      setKeyStatus('bad');
      setVoices([]);
      setQuota(null);
      return;
    }
    settings.setElevenlabsApiKey(key);
    setKeyStatus('ok');
    const [voiceList, q] = await Promise.all([provider.getAllVoices(), provider.getQuota()]);
    setVoices(voiceList);
    setQuota(q);
    if (!settings.elevenlabsVoiceId && voiceList[0]) {
      settings.setElevenlabsVoiceId(voiceList[0].id);
    }
  };

  return (
    <div className='w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('ElevenLabs voice')}
        description={_('Premium voices for the narrator, billed to your ElevenLabs account.')}
        onBack={onBack}
      />

      <BoxedList title={_('API key')}>
        <div className='flex flex-col gap-2 py-3 pe-4'>
          <div className='flex w-full items-center gap-2'>
            <input
              type='password'
              className='paper-field w-full'
              placeholder='sk_…'
              aria-label={_('ElevenLabs API key')}
              value={keyDraft}
              onChange={(e) => {
                setKeyDraft(e.target.value);
                setKeyStatus('idle');
              }}
            />
            <button
              type='button'
              className='stamp-btn settings-btn-sm shrink-0'
              disabled={!keyDraft.trim() || keyStatus === 'checking'}
              onClick={validateKey}
            >
              {keyStatus === 'checking' ? (
                <PiSpinner className='size-4 animate-spin' />
              ) : (
                _('Connect')
              )}
            </button>
          </div>
          {keyStatus === 'ok' && (
            <span className='settings-success flex items-center gap-1 text-sm'>
              <PiCheckCircle className='size-4 shrink-0' />
              {_('Connected — voice library loaded.')}
            </span>
          )}
          {keyStatus === 'bad' && (
            <span className='text-stamp flex items-center gap-1 text-sm'>
              <PiWarningCircle className='size-4 shrink-0' />
              {_('Could not connect. Check the key and your connection.')}
            </span>
          )}
          {restoreError && keyStatus !== 'bad' && (
            <span className='text-stamp flex items-center gap-1 text-sm'>
              <PiWarningCircle className='size-4 shrink-0' />
              {restoreError}
            </span>
          )}
          <span className='text-mutedink text-xs'>
            {_('Stored locally on this device. Audio is cached, so re-listening never re-bills.')}
          </span>
        </div>
      </BoxedList>

      {voices.length > 0 && (
        <BoxedList title={_('Voice')}>
          <div className='flex flex-col gap-2 py-3 pe-4'>
            <select
              className='settings-select bg-paper text-ink w-full'
              value={settings.elevenlabsVoiceId ?? ''}
              onChange={(e) => settings.setElevenlabsVoiceId(e.target.value || null)}
              aria-label={_('ElevenLabs voice')}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </BoxedList>
      )}

      <BoxedList title={_('Model tier')}>
        <div className='flex flex-col gap-2 py-3 pe-4'>
          {(
            [
              ['flash', _('Flash — fastest; best for click-to-speak and skipping')],
              ['turbo', _('Turbo — balanced')],
              ['quality', _('Multilingual v2 — highest quality; best for long listens')],
            ] as const
          ).map(([tier, label]) => (
            <label key={tier} className='flex cursor-pointer items-center gap-2'>
              <input
                type='radio'
                name='elevenlabs-tier'
                className='settings-check'
                checked={settings.elevenlabsTier === tier}
                onChange={() => settings.setElevenlabsTier(tier)}
              />
              <span className='text-sm'>{label}</span>
            </label>
          ))}
        </div>
      </BoxedList>

      {quota && (
        <p className='text-mutedink px-4 text-xs'>
          {_('Character usage: {{used}} / {{limit}} this cycle.', {
            used: quota.used.toLocaleString(),
            limit: quota.limit.toLocaleString(),
          })}
        </p>
      )}
    </div>
  );
};

/**
 * The local narrator's voice — Qwen3-TTS + Kokoro, served by the bundled
 * voice server. Same narration-settings key as the Narration tab picker
 * (qwenVoiceId); this copy exists because Integrations is where readers
 * look for the voice dropdown.
 */
const LocalVoiceForm: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const _ = useTranslation();
  return (
    <div className='w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Narrator voice')}
        description={_('The voice that reads your books aloud, served locally.')}
        onBack={onBack}
      />

      <BoxedList title={_('Voice')}>
        <div className='flex flex-col gap-2 py-3 pe-4'>
          <QwenVoicePicker />
        </div>
      </BoxedList>

      <p className='text-mutedink px-4 text-xs'>
        {_(
          'Kokoro voices (Heart, Adam…) suit long-form listening; Qwen3 voices follow style cues. Changes apply on the fly — your place is kept. A speaker chip in the reader footer cycles voices too.',
        )}
      </p>
    </div>
  );
};

export default IntegrationsPanel;
