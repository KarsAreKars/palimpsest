import './narration.css';
/**
 * NarrationControls — the narrator's transport, living in the reader
 * footer's right-hand cluster (where the round book controls sit), not as a
 * floating plate. Renders nothing until a narration session exists for this
 * book; the book keeps talking while the user navigates, and the controls
 * appear wherever the reader chrome does.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { getNarration, type NarrationEntry } from '@/services/narration/speakMode';
import { useNarrationSettings } from '@/services/narration/settings';

const SPEEDS = [0.8, 1, 1.25, 1.5, 2];
const VOICE_LABELS: Record<string, string> = {
  af_heart: 'HEART',
  am_adam: 'ADAM',
  af_bella: 'BELLA',
  af_nicole: 'NICOLE',
  am_michael: 'MICHAEL',
  bf_emma: 'EMMA',
  bm_george: 'GEORGE',
};

const PrevIcon = () => (
  <svg width='11' height='11' viewBox='0 0 12 12' fill='none' aria-hidden='true'>
    <path d='M9 2L4 6l5 4' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);
const NextIcon = () => (
  <svg width='11' height='11' viewBox='0 0 12 12' fill='none' aria-hidden='true'>
    <path d='M3 2l5 4-5 4' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);
const PlayIcon = () => (
  <svg width='11' height='11' viewBox='0 0 12 12' fill='none' aria-hidden='true'>
    <path d='M3.5 2v8l6-4-6-4z' fill='currentColor' />
  </svg>
);
const PauseIcon = () => (
  <svg width='11' height='11' viewBox='0 0 12 12' fill='none' aria-hidden='true'>
    <path d='M4 2v8M8 2v8' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
  </svg>
);

interface NarrationControlsProps {
  bookKey: string;
}

const NarrationControls: React.FC<NarrationControlsProps> = ({ bookKey }) => {
  const qwenVoiceId = useNarrationSettings((s) => s.qwenVoiceId);
  const setQwenVoiceId = useNarrationSettings((s) => s.setQwenVoiceId);
  const settingsRate = useNarrationSettings((s) => s.rate);
  const setSettingsRate = useNarrationSettings((s) => s.setRate);
  const _ = useTranslation().t;
  const [, force] = useState(0);
  const [entry, setEntry] = useState<NarrationEntry | undefined>(undefined);

  // Poll cheaply — 500ms while a session is live (playstate has no event),
  // 2s discovery otherwise.
  useEffect(() => {
    const sync = () => {
      const e = getNarration(bookKey);
      setEntry((prev) => (prev === e ? prev : e));
      force((n) => n + 1);
    };
    sync();
    const t = setInterval(sync, entry?.controller.active ? 500 : 2000);
    return () => clearInterval(t);
  }, [bookKey, entry]);

  const controller = entry?.controller;
  if (!controller?.active) return null;

  const rate = controller.player.rate ?? settingsRate;
  const voice = qwenVoiceId ?? 'af_heart';
  const playing = controller.playing;

  const cycleSpeed = () => {
    const next = SPEEDS.reduce(
      (best, s) => (s > rate && s < best ? s : best),
      SPEEDS[0]! <= rate ? Infinity : SPEEDS[0]!,
    );
    const target = next === Infinity ? SPEEDS[0]! : next;
    controller.setRate(target);
    setSettingsRate(target);
  };
  const cycleVoice = () => {
    const ids = Object.keys(VOICE_LABELS);
    const next = ids[(ids.indexOf(voice) + 1) % ids.length]!;
    setQwenVoiceId(next);
  };

  return (
    <span
      className='mx-1 flex items-center gap-1.5'
      data-testid='narration-controls'
      role='group'
      aria-label={_('Narration')}
    >
      {/* the speaking mark: one authored pulse while the book talks */}
      <span
        aria-hidden='true'
        className={clsx('ornament narration-glyph', !playing && 'narration-glyph--idle')}
      >
        ✳
      </span>
      <button
        type='button'
        onClick={cycleVoice}
        className='narration-chip'
        aria-label={_('Switch voice')}
        title={_('Voice (point of use — more in Integrations)')}
      >
        {VOICE_LABELS[voice] ?? voice.toUpperCase()}
      </button>
      <button
        type='button'
        onClick={cycleSpeed}
        className='narration-chip'
        aria-label={_('Change narration speed')}
      >
        {rate}×
      </button>
      <button
        type='button'
        className='narration-btn'
        aria-label={_('Previous sentence')}
        onClick={() => void controller.prev()}
      >
        <PrevIcon />
      </button>
      <button
        type='button'
        className='narration-btn narration-btn--ink'
        aria-label={playing ? _('Pause') : _('Play')}
        onClick={() => void controller.togglePlay()}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        type='button'
        className='narration-btn'
        aria-label={_('Next sentence')}
        onClick={() => void controller.next()}
      >
        <NextIcon />
      </button>
      <button
        type='button'
        className='narration-btn'
        aria-label={_('Stop narrating')}
        title={_('Stop narrating')}
        onClick={() => void controller.stop()}
      >
        ✕
      </button>
    </span>
  );
};

export default NarrationControls;
