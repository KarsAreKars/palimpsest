/**
 * NarrationBar — THE MiniPlayer (UX spec D). One component, two mounts:
 * the reader footer and the library bottom. Oak strip surface, cloth thumb,
 * one scrolling sentence, voice chip, speed chip, prev/play/next. The book
 * keeps talking while the user browses — leaving the reader never stops
 * audio (useNarration keeps the session; the library mount surfaces it).
 *
 * Driven by the narration registry (Palimpsest's own engine), not the
 * upstream ttsSessionManager — that system never lit up for local narration,
 * which is why the old bottom bar looked dead.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getActiveNarration,
  getNarration,
  type NarrationEntry,
} from '@/services/narration/speakMode';
import type { NarrationController } from '@/services/narration/controller';
import { useNarrationSettings } from '@/services/narration/settings';
import { ClothCover } from '@/components/apothecary';
import { navigateToReader } from '@/utils/nav';

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
  const [, force] = useState(0);
  const [entry, setEntry] = useState<NarrationEntry | undefined>(undefined);

  // Poll cheaply: the player has no playstate event, only unit-change et al.
  useEffect(() => {
    const sync = () => {
      const e = bookKey ? getNarration(bookKey) : getActiveNarration()?.entry;
      setEntry((prev) => (prev === e ? prev : e));
      force((n) => n + 1);
    };
    sync();
    const t = setInterval(sync, 500);
    return () => clearInterval(t);
  }, [bookKey]);

  const controller = entry?.controller;
  if (!controller?.active) return null;

  const playing = controller.playing;
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
      className='oak-shelf pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex h-11 items-center gap-3 px-3'
      style={{ boxShadow: '0 -5px 14px rgba(42,37,29,0.18)' }}
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

      <span className='text-paperlight min-w-0 flex-1 truncate text-[13px] italic opacity-95'>
        {sentenceOf(controller)}
      </span>

      <button
        type='button'
        onClick={cycleVoice}
        className='typed text-paperlight/80 hover:text-paperlight shrink-0 text-[9px]'
        aria-label='Switch voice'
        title='Voice (point of use — more in Connectors)'
      >
        {VOICE_LABELS[voice] ?? voice.toUpperCase()}
      </button>
      <button
        type='button'
        onClick={cycleSpeed}
        className='typed text-paperlight/80 hover:text-paperlight shrink-0 text-[9px]'
        aria-label='Change narration speed'
      >
        {rate}×
      </button>

      <div className='flex shrink-0 items-center gap-1'>
        <button
          type='button'
          className='text-paperlight/80 hover:text-paperlight px-1.5 text-base'
          aria-label='Previous sentence'
          onClick={() => void controller.prev()}
        >
          ⏮
        </button>
        <button
          type='button'
          className='text-paperlight px-1.5 text-lg'
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => void controller.togglePlay()}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          type='button'
          className='text-paperlight/80 hover:text-paperlight px-1.5 text-base'
          aria-label='Next sentence'
          onClick={() => void controller.next()}
        >
          ⏭
        </button>
        <button
          type='button'
          className='typed text-paperlight/60 hover:text-paperlight px-1.5 text-[9px]'
          aria-label='Stop narration'
          onClick={() => controller.stop()}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default NarrationBar;
