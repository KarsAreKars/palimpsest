/**
 * NarrationBar — THE MiniPlayer (UX spec D). One component, two mounts:
 * the reader footer and the library bottom. The bar is a floating
 * catalogue plate: hairline double rule, typed chips, stamp transport.
 * The book keeps talking while the user browses — leaving the reader never
 * stops audio (useNarration keeps the session; the library mount surfaces it).
 *
 * Driven by the narration registry (Palimpsest's own engine), not the
 * upstream ttsSessionManager — that system never lit up for local narration,
 * which is why the old bottom bar looked dead.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  getActiveNarration,
  getNarration,
  type NarrationEntry,
} from '@/services/narration/speakMode';
import type { NarrationController } from '@/services/narration/controller';
import { useNarrationSettings } from '@/services/narration/settings';
import { ClothCover } from '@/components/apothecary';
import { navigateToReader } from '@/utils/nav';
import './narration.css';

const SPEEDS = [0.8, 1, 1.25, 1.5, 2];
const VOICE_LABELS: Record<string, string> = {
  af_heart: 'HEART',
  am_adam: 'ADAM',
  af_bella: 'BELLA',
  af_nicole: 'NICOLE',
  am_michael: 'MICHAEL',
  bf_emma: 'EMMA',
  bm_george: 'GEORGE',
  vivian: 'VIVIAN',
  serena: 'SERENA',
  ryan: 'RYAN',
  aiden: 'AIDEN',
  eric: 'ERIC',
  dylan: 'DYLAN',
};

const sentenceOf = (c: NarrationController): string => {
  const u = c.player.currentUnit;
  if (!u) return '';
  const raw = u.speak ?? c.md.slice(u.md_start, u.md_end);
  return raw
    .replace(/[#*_`$\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const fmtClock = (totalSec: number): string => {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/* Transport glyphs — drawn, never emoji. fill=currentColor so the
   stamp hover inversion flips them with the button. */
const PrevIcon = () => (
  <svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
    <path d='M19 20 9 12l10-8v16z' />
    <path d='M5 19V5' />
  </svg>
);
const NextIcon = () => (
  <svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
    <path d='m5 4 10 8-10 8V4z' />
    <path d='M19 5v14' />
  </svg>
);
const PlayIcon = () => (
  <svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
    <polygon points='6 3 20 12 6 21 6 3' />
  </svg>
);
const PauseIcon = () => (
  <svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
    <rect x='6' y='4' width='4' height='16' />
    <rect x='14' y='4' width='4' height='16' />
  </svg>
);

interface NarrationBarProps {
  /** Reader mount passes its bookKey; library mount omits it and follows
      whichever session is live. */
  bookKey?: string;
  bookTitle?: string;
  bookAuthor?: string;
}

const NarrationBar: React.FC<NarrationBarProps> = ({ bookKey, bookTitle, bookAuthor }) => {
  const router = useRouter();
  const qwenVoiceId = useNarrationSettings((s) => s.qwenVoiceId);
  const setQwenVoiceId = useNarrationSettings((s) => s.setQwenVoiceId);
  const settingsRate = useNarrationSettings((s) => s.rate);
  const setSettingsRate = useNarrationSettings((s) => s.setRate);
  const _ = useTranslation().t;
  const [, force] = useState(0);
  const [entry, setEntry] = useState<NarrationEntry | undefined>(undefined);
  // The cataloguer's clock: seconds this session has actually been
  // speaking, shown plate-num style beside the glyph. Local to the bar —
  // the player schedules audio, not wall time.
  const [elapsed, setElapsed] = useState(0);

  // Poll cheaply — but only as fast as the situation merits: 500ms while a
  // session is live (playstate has no event), 2s discovery otherwise
  // (review fix #3: a flat 500ms forever burned timers on an idle library).
  useEffect(() => {
    const sync = () => {
      const e = bookKey ? getNarration(bookKey) : getActiveNarration()?.entry;
      setEntry((prev) => (prev === e ? prev : e));
      force((n) => n + 1);
    };
    sync();
    const t = setInterval(sync, entry?.controller.active ? 500 : 2000);
    return () => clearInterval(t);
  }, [bookKey, entry]);

  const controller = entry?.controller;

  // A new session starts a new plate: the clock resets with it.
  useEffect(() => {
    setElapsed(0);
  }, [controller]);

  // One tick per spoken second; pauses hold the reading.
  const playing = controller?.playing ?? false;
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [playing]);

  if (!controller?.active) return null;

  const rate = controller.player.rate ?? settingsRate;
  const voice = qwenVoiceId ?? 'af_heart';

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
    <div
      className='plate narration-bar pointer-events-auto fixed inset-x-3 bottom-3 z-50 flex h-12 items-center gap-3 px-4'
      data-testid='narration-bar'
      role='region'
      aria-label='Now narrating'
    >
      <button
        type='button'
        className='h-9 w-7 shrink-0'
        aria-label={bookKey ? 'Reopen book' : 'Open book'}
        onClick={() => {
          const key = bookKey ?? getActiveNarration()?.bookKey;
          const hash = key?.split('-')[0];
          if (hash) navigateToReader(router, [hash]);
        }}
      >
        <ClothCover title={bookTitle ?? '…'} author={bookAuthor} size='sm' />
      </button>

      {/* the speaking mark: one authored pulse while the book talks,
          a still glyph while it waits */}
      <span
        aria-hidden='true'
        className={clsx('ornament narration-glyph shrink-0', !playing && 'narration-glyph--idle')}
      >
        ✳
      </span>
      <span className='plate-num shrink-0 tabular-nums' aria-label='Time narrating'>
        {fmtClock(elapsed)}
      </span>

      <span className='text-ink min-w-0 flex-1 truncate text-[13px] italic opacity-95'>
        {sentenceOf(controller)}
      </span>

      <button
        type='button'
        onClick={cycleVoice}
        className='narration-chip shrink-0'
        aria-label='Switch voice'
        title={_('Voice (point of use — more in Integrations)')}
      >
        {VOICE_LABELS[voice] ?? voice.toUpperCase()}
      </button>
      <button
        type='button'
        onClick={cycleSpeed}
        className='narration-chip shrink-0'
        aria-label='Change narration speed'
      >
        {rate}×
      </button>

      <div className='flex shrink-0 items-center gap-1.5'>
        <button
          type='button'
          className='narration-btn'
          aria-label='Previous sentence'
          onClick={() => void controller.prev()}
        >
          <PrevIcon />
        </button>
        <button
          type='button'
          className='narration-btn narration-btn--ink'
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => void controller.togglePlay()}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type='button'
          className='narration-btn'
          aria-label='Next sentence'
          onClick={() => void controller.next()}
        >
          <NextIcon />
        </button>
        <button
          type='button'
          className='narration-btn'
          aria-label='Stop narration'
          title='Stop'
          onClick={() => controller.stop()}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default NarrationBar;
