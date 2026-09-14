'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { StampButton, PaperField } from '@/components/apothecary';
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import {
  isAiConfigComplete,
  nextBeat,
  prevBeat,
  shouldInstallSampleBook,
  shouldShowOnboarding,
  testChatCompletion,
  type OnboardingAiConfig,
  type OnboardingBeat,
} from '@/services/onboarding/onboardingState';
import {
  completeOnboarding,
  installSampleBook,
  runVoiceBootstrap,
  saveOnboardingAiConfig,
} from '@/services/onboarding/onboardingService';

import './onboarding.css';

const HEALTH_URL = 'http://127.0.0.1:8737/health';
const aiFetch = getAIFetch();

type VoiceStatus = 'checking' | 'offline' | 'online';
type BootstrapState = 'idle' | 'running' | 'done' | 'error';

// Raw English keys; rendered through _() so every user-facing string is
// translatable. The beat labels stay typed (plate-num) on screen.
const BEAT_LABELS: Array<{ beat: OnboardingBeat; labelKey: string }> = [
  { beat: 'welcome', labelKey: 'Welcome' },
  { beat: 'voice', labelKey: 'Voice Engine' },
  { beat: 'ai', labelKey: "The Prof's Brain" },
];

// Raw English keys; rendered through _().
const PITCHES = [
  {
    labelKey: 'Narration',
    bodyKey:
      'Every book narrates itself. Free neural voices, generated on-device. Nothing to buy, nothing to subscribe to.',
  },
  {
    labelKey: 'The Prof',
    bodyKey: 'Ask him anything about the page. He answers aloud — and points at the passage.',
  },
  {
    labelKey: 'Chapter Sessions',
    bodyKey:
      'The notebook turns your chapter into objectives, quizzes you aloud, and files a study report. The Feynman review queue resurfaces what you learned.',
  },
];

/**
 * First-run onboarding, presented as a numbered plate in the antiquarian
 * catalogue. Shows when settings lack the `onboarded` flag; sets it on
 * completion or explicit skip. Never narrates from here — Beat 2 only
 * verifies the voice engine answers /health.
 */
const OnboardingOverlay: React.FC = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();

  const [open, setOpen] = useState(false);
  const [beat, setBeat] = useState<OnboardingBeat>('welcome');

  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('checking');
  const [bootstrap, setBootstrap] = useState<BootstrapState>('idle');
  const [bootLines, setBootLines] = useState<string[]>([]);
  const bootLogRef = useRef<HTMLDivElement>(null);

  const [aiConfig, setAiConfig] = useState<OnboardingAiConfig>({
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
  });
  const [testState, setTestState] = useState<'idle' | 'testing' | 'pass' | 'fail'>('idle');
  const [saved, setSaved] = useState(false);

  // Reveal only once real settings have loaded (the store starts life as {}).
  useEffect(() => {
    if (shouldShowOnboarding(settings)) setOpen(true);
  }, [settings]);

  // First run: place the bundled sample book on the shelf through the
  // regular import path. Once-ever — the marker survives deletion.
  useEffect(() => {
    if (appService && shouldInstallSampleBook(settings)) {
      void installSampleBook(envConfig, appService);
    }
  }, [appService, settings, envConfig]);

  const checkHealth = useCallback(async () => {
    try {
      const res = await aiFetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
      setVoiceStatus(res.ok ? 'online' : 'offline');
    } catch {
      setVoiceStatus('offline');
    }
  }, []);

  // Voice-engine status line polls while the beat is on screen.
  useEffect(() => {
    if (!open || beat !== 'voice') return;
    void checkHealth();
    const id = setInterval(() => void checkHealth(), 3000);
    return () => clearInterval(id);
  }, [open, beat, checkHealth, bootstrap]);

  useEffect(() => {
    bootLogRef.current?.scrollTo({ top: bootLogRef.current.scrollHeight });
  }, [bootLines]);

  const finish = useCallback(async () => {
    setOpen(false);
    await completeOnboarding(envConfig);
  }, [envConfig]);

  const startBootstrap = useCallback(async () => {
    setBootstrap('running');
    setBootLines([]);
    try {
      await runVoiceBootstrap(async (line) => {
        setBootLines((prev) => [...prev, line]);
      });
      setBootstrap('done');
    } catch {
      setBootLines((prev) => [
        ...prev,
        _('Setup did not finish — you can retry or skip and set up later.'),
      ]);
      setBootstrap('error');
    }
    await checkHealth();
  }, [checkHealth]);

  const handleTest = useCallback(async () => {
    setTestState('testing');
    const ok = await testChatCompletion(aiFetch, aiConfig);
    setTestState(ok ? 'pass' : 'fail');
  }, [aiConfig]);

  const handleSaveAi = useCallback(async () => {
    if (!isAiConfigComplete(aiConfig)) return;
    await saveOnboardingAiConfig(envConfig, aiConfig);
    setSaved(true);
  }, [aiConfig, envConfig]);

  if (!open) return null;

  const isFinal = beat === 'open';
  const beatIndex = BEAT_LABELS.findIndex((x) => x.beat === beat);

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-label={_('Palimpsest setup')}
      className='onboarding-scrim fixed inset-0 z-[100] flex items-center justify-center p-4'
    >
      <div className='onboarding-sheet plate plate-notch relative flex max-h-[90vh] w-[min(94vw,580px)] flex-col px-6 py-6 sm:px-9 sm:py-8'>
        <button
          onClick={() => void finish()}
          className='plate-meta typed hover:text-stamp absolute top-4 right-5 transition-colors'
        >
          {_("Skip setup")}
        </button>

        {/* plate numbers for the three beats, joined by a hairline rule */}
        <div className='mb-6 flex items-center gap-3 pe-12'>
          {BEAT_LABELS.map(({ beat: b, labelKey }, i) => {
            const active = i === beatIndex;
            const past = i < beatIndex;
            return (
              <React.Fragment key={b}>
                {i > 0 && <hr className='catalog-rule min-w-4 flex-1' aria-hidden='true' />}
                <span
                  className={clsx(
                    'plate-num whitespace-nowrap',
                    active && 'text-stamp',
                    past && 'text-ink',
                  )}
                >
                  № {i + 1} — {_(labelKey)}
                </span>
              </React.Fragment>
            );
          })}
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto pe-1'>
          {beat === 'welcome' && (
            <div>
              <h1 className='onboarding-beat-title text-[clamp(20px,3.4vw,30px)] leading-tight'>
                {_('The book that reads aloud')}
              </h1>
              <p className='text-mutedink mt-2 text-[15px] italic'>
                {_('Palimpsest turns your library into a conversation. Three things to know:')}
              </p>
              <div className='mt-5 grid gap-3 sm:grid-cols-3'>
                {PITCHES.map((pitch) => (
                  <div key={pitch.labelKey} className='plate flex flex-col p-3 pt-4'>
                    <span className='plate-title text-[13px] leading-snug'>{_(pitch.labelKey)}</span>
                    <span className='ornament my-2' aria-hidden='true'>
                      ✳
                    </span>
                    <p className='text-ink text-[13px] leading-snug'>{_(pitch.bodyKey)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {beat === 'voice' && (
            <div>
              <h2 className='onboarding-beat-title text-2xl'>{_('Voice Engine')}</h2>
              <p className='text-mutedink mt-2 text-[15px] italic'>
                {_('Free neural narration, on-device. No account, no subscription.')}
              </p>
              <div className='plate mt-4 p-3 pt-4'>
                {voiceStatus === 'checking' && (
                  <p className='typed text-mutedink text-[11px]'>{_('CHECKING THE VOICE ENGINE…')}</p>
                )}
                {voiceStatus === 'online' && (
                  <p className='typed text-stamp text-[11px]'>{_('VOICES READY')}</p>
                )}
                {voiceStatus === 'offline' && bootstrap !== 'running' && (
                  <div className='flex items-center justify-between gap-3'>
                    <p className='typed text-ink text-[11px]'>{_('VOICES OFFLINE')}</p>
                    <StampButton onClick={() => void startBootstrap()}>
                      {_('Start voice setup')}
                    </StampButton>
                  </div>
                )}
                {(bootstrap === 'running' || bootLines.length > 0) && (
                  <div>
                    <div
                      ref={bootLogRef}
                      className='mt-2 max-h-32 overflow-y-auto border-t border-dashed border-ink/40 pt-2'
                    >
                      {bootLines.map((line, i) => (
                        <p key={i} className='typed text-mutedink text-[11px] leading-relaxed'>
                          {line}
                        </p>
                      ))}
                    </div>
                    {bootstrap === 'running' && (
                      <div
                        className='progress-track mt-2 overflow-hidden'
                        role='progressbar'
                        aria-label={_('Voice setup in progress')}
                      >
                        <div className='onboarding-progress-indeterminate progress-fill w-1/3' />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {voiceStatus === 'offline' && bootstrap === 'idle' && (
                <p className='typed text-mutedink mt-3 text-[9px]'>
                  {_('SETUP IS ONE CLICK — MODELS DOWNLOAD ON FIRST NARRATION, NOT NOW.')}
                </p>
              )}
            </div>
          )}

          {beat === 'ai' && (
            <div>
              <h2 className='onboarding-beat-title text-2xl'>{_("The Prof's Brain")}</h2>
              <p className='text-mutedink mt-2 text-[15px] italic'>
                {_('The Prof answers questions about the page, aloud. Any OpenAI-compatible key works — or add one later in Settings.')}
              </p>
              <div className='mt-4 flex flex-col gap-2.5'>
                <PaperField
                  type='password'
                  autoComplete='off'
                  placeholder={_('API KEY — SK-…')}
                  value={aiConfig.apiKey}
                  onChange={(e) => {
                    setAiConfig((c) => ({ ...c, apiKey: e.target.value }));
                    setTestState('idle');
                    setSaved(false);
                  }}
                  className='w-full text-sm'
                />
                <PaperField
                  placeholder={_('BASE URL')}
                  value={aiConfig.baseUrl}
                  onChange={(e) => {
                    setAiConfig((c) => ({ ...c, baseUrl: e.target.value }));
                    setTestState('idle');
                    setSaved(false);
                  }}
                  className='w-full text-sm'
                />
                <PaperField
                  placeholder={_('MODEL — OPTIONAL')}
                  value={aiConfig.model}
                  onChange={(e) => {
                    setAiConfig((c) => ({ ...c, model: e.target.value }));
                    setTestState('idle');
                    setSaved(false);
                  }}
                  className='w-full text-sm'
                />
                <p className='plate-meta ps-4'>
                  {_('Any OpenAI-compatible key works. Leave the model blank to use the default.')}
                </p>
              </div>
              <div className='mt-3 flex items-center gap-3'>
                <StampButton
                  onClick={() => void handleTest()}
                  disabled={!isAiConfigComplete(aiConfig)}
                >
                  {_('Test')}
                </StampButton>
                {testState === 'testing' && (
                  <span className='typed text-mutedink text-[10px]'>{_('TESTING…')}</span>
                )}
                {testState === 'pass' && (
                  <span className='typed text-stamp border-stamp border px-2 py-0.5 text-[10px]'>
                    {_('TEST PASS')}
                  </span>
                )}
                {testState === 'fail' && (
                  <span className='typed border border-dashed border-ink/60 px-2 py-0.5 text-[10px] text-ink'>
                    {_('TEST FAIL — CHECK KEY AND URL')}
                  </span>
                )}
              </div>
            </div>
          )}

          {isFinal && (
            <div className='flex flex-col items-center py-4 text-center'>
              <span className='ornament' aria-hidden='true'>
                ✦
              </span>
              <p className='plate-title mt-3 text-xl'>{_('All set')}</p>
              <p className='text-ink mt-3 max-w-sm text-[16px] leading-snug'>
                {_('Your first book is already on the shelf. Open it, press play — it reads to you. Ask the Prof anything.')}
              </p>
              <StampButton className='mt-6' onClick={() => void finish()}>
                {_('Open your first book')}
              </StampButton>
            </div>
          )}
        </div>

        {!isFinal && (
          <div className='mt-6 pt-4'>
            <hr className='catalog-rule mb-4' aria-hidden='true' />
            <div className='flex items-center justify-between'>
              <div>
                {beat !== 'welcome' && (
                  <StampButton variant='ink' onClick={() => setBeat((b) => prevBeat(b))}>
                    {_('← Back')}
                  </StampButton>
                )}
              </div>
              <div className='flex items-center gap-4'>
                {beat === 'ai' && (
                  <button
                    onClick={() => setBeat('open')}
                    className='plate-meta typed hover:text-stamp transition-colors'
                  >
                    {_("Add later in Settings")}
                  </button>
                )}
                {beat === 'ai' ? (
                  <StampButton
                    variant={saved ? 'stamp' : 'ink'}
                    onClick={() => void handleSaveAi()}
                    disabled={!isAiConfigComplete(aiConfig)}
                  >
                    {saved ? _('Saved') : _('Save')}
                  </StampButton>
                ) : null}
                {beat !== 'ai' && (
                  <StampButton onClick={() => setBeat((b) => nextBeat(b))}>
                    {beat === 'welcome' ? _('Set up voices') : _('Continue')}
                  </StampButton>
                )}
                {beat === 'ai' && (
                  <StampButton onClick={() => setBeat('open')}>{_('Continue')}</StampButton>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OnboardingOverlay;
