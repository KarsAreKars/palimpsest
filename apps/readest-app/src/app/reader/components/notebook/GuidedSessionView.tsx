/**
 * GuidedSessionView — the guided session as a full-screen conversation
 * (Wave A2; THE FORM §2's guided mode, owner ruling: full-screen like the
 * desk, text-to-text, a scrollable back-and-forth).
 *
 * The view is a chat UI over the existing state machine: the session
 * lives in guidedSessionStore (the controller) and the beat log IS the
 * conversation — buildConversation renders it, nothing else. Professor
 * turns on the left (his questions, verdicts, repairs — the desk's Prose
 * pipeline: markdown + math), learner turns on the right. The header
 * carries the goal, the route as a thin progress strip, and the session
 * controls (voice opt-in, pause, exit). The composer is text: Enter
 * sends, Shift+Enter breaks the line.
 *
 * Scroll policy is the desk's own: pinned-follow with the 24px threshold
 * (deskGeometry's shouldFollow) — new turns glide to the bottom only
 * while pinned; scrolling up stays put; one quiet chip offers the way
 * back. No yank.
 *
 * Mounted beside DeskSheet in BooksGrid; visible only while the store's
 * mode is 'guided' (the Study tab's Free/Guided toggle). Escape or the
 * close button returns to free mode — the session holds its place.
 */
'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiPaperPlaneRight, PiSpeakerHigh, PiSpeakerSlash } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import useShortcuts from '@/hooks/useShortcuts';
import { useEnv } from '@/context/EnvContext';
import {
  buildConversation,
  currentConcept,
  teachSequence,
} from '@/services/professor/guidedSession';
import { shouldFollow } from '../desk/deskGeometry';
import { Prose } from './wbShared';
import { useGuidedSessionStore } from './guidedSessionStore';

import './guidedSession.css';

/** The route as a thin strip: one segment per concept on the road —
 *  settled, current, skipped, waiting. */
const RouteStrip: React.FC = () => {
  const session = useGuidedSessionStore((s) => s.session);
  if (!session.route || session.phase === 'practicing' || session.phase === 'reporting') {
    return null;
  }
  const seq = teachSequence(session.route);
  if (seq.length === 0) return null;
  return (
    <div className='gs-route' aria-hidden='true'>
      {seq.map((n, i) => {
        const settled = session.exits.includes(n.name);
        const current = i === session.conceptIdx && session.phase === 'teaching';
        const skipped = session.skipped.includes(n.name);
        return (
          <span
            key={n.name}
            className={clsx(
              'gs-route-seg',
              settled && 'gs-route-settled',
              current && 'gs-route-current',
              skipped && 'gs-route-skipped',
            )}
          />
        );
      })}
    </div>
  );
};

const GuidedSessionView: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const mode = useGuidedSessionStore((s) => s.mode);
  const session = useGuidedSessionStore((s) => s.session);
  const voiceOn = useGuidedSessionStore((s) => s.voiceOn);
  const note = useGuidedSessionStore((s) => s.note);
  const [goalDraft, setGoalDraft] = useState('');
  const [composer, setComposer] = useState('');

  const visible = mode === 'guided';
  const live =
    session.phase === 'teaching' ||
    session.phase === 'practicing' ||
    session.phase === 'measuring' ||
    session.phase === 'planning' ||
    session.phase === 'reporting';

  const exit = useCallback(
    () => useGuidedSessionStore.getState().setMode(bookKey, 'free'),
    [bookKey],
  );
  useShortcuts({ onEscape: exit }, [exit]);

  // ── Scroll policy (the desk's 24px pin, reused) ──────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [growth, setGrowth] = useState(false);
  const turns = buildConversation(session);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const follow = shouldFollow(el.scrollTop, el.scrollHeight, el.clientHeight, pinnedRef.current);
    pinnedRef.current = follow;
    setPinned(follow);
    if (follow) setGrowth(false);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setGrowth(true); // unpinned, and the paper grew — offer the way back
    }
  }, [turns.length, session.phase]);

  const scrollToBottomAndRepin = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    pinnedRef.current = true;
    setPinned(true);
    setGrowth(false);
  };

  // Mount/rest at the bottom, pinned.
  useEffect(() => {
    if (!visible) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
    setGrowth(false);
  }, [visible]);

  // Focus trap is the desk's (DeskSheet); here focus simply lands in the
  // composer on open — the session is a conversation.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (visible && live) composerRef.current?.focus();
  }, [visible, live]);

  if (!visible) return null;

  const store = useGuidedSessionStore.getState();
  const node = currentConcept(session);
  const canCompose =
    !session.paused && (session.phase === 'teaching' || session.phase === 'practicing');

  const send = () => {
    const text = composer.trim();
    if (!text || !canCompose) return;
    setComposer('');
    store.answer(bookKey, text);
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // The session composer owns its keys — global shortcuts (⌥Space, page
    // turns, narration) must never fire while typing here (owner report:
    // "when I type smth the option command ask prof things comes up").
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const statusLine = session.paused
    ? _('THE SESSION HOLDS — COME BACK WHEN YOU ARE READY.')
    : session.phase === 'teaching' && node
      ? _('A TRIAL ON {{concept}} — ANSWER HIM AND HE STAMPS THE VERDICT', {
          concept: node.label.toUpperCase(),
        })
      : session.phase === 'practicing'
        ? _('PRACTICE — THE QUEUE, ONE CHECK AT A TIME.')
        : '';

  return (
    <div
      className={clsx('gs-sheet paper-bg', 'absolute inset-0 z-[6] flex flex-col')}
      role='dialog'
      aria-modal='true'
      aria-label={_('Guided Session')}
      dir='ltr'
    >
      <header className='desk-head border-ink/25 flex h-11 flex-none items-center gap-3 border-b px-4'>
        <span className='plate-title text-ink line-clamp-1 text-[15px]'>
          {session.goal ? _('The road to {{goal}}', { goal: session.goal }) : _('Guided session')}
        </span>
        <RouteStrip />
        <span className='flex-1' />
        {live && (
          <button
            type='button'
            className='chrome-ghost chrome-btn-icon h-8 min-h-8 w-8'
            aria-label={voiceOn ? _('Mute the professor') : _('Hear the professor')}
            aria-pressed={voiceOn}
            title={voiceOn ? _('Voice on') : _('Voice off — text only')}
            onClick={() => store.setVoiceOn(!voiceOn)}
          >
            {voiceOn ? <PiSpeakerHigh size={16} /> : <PiSpeakerSlash size={16} />}
          </button>
        )}
        {(session.phase === 'teaching' || session.phase === 'practicing') && (
          <button
            type='button'
            className='typed text-mutedink hover:text-ink rounded px-2 py-1 text-[10px] tracking-wider'
            onClick={() => (session.paused ? store.resume(bookKey) : store.pause())}
          >
            {session.paused ? _('RESUME') : _('PAUSE')}
          </button>
        )}
        <button
          type='button'
          className='chrome-ghost chrome-btn-icon h-8 min-h-8 w-8'
          aria-label={_('Back to the desk')}
          onClick={exit}
        >
          <svg
            width='16'
            height='16'
            viewBox='0 0 16 16'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.4'
            aria-hidden='true'
          >
            <path d='M3 3l10 10M13 3L3 13' />
          </svg>
        </button>
      </header>

      {/* The conversation — the beat log, in order. */}
      <div ref={scrollRef} className='gs-scroll min-h-0 flex-1' onScroll={handleScroll}>
        <div className='gs-thread'>
          {turns.length === 0 && session.phase === 'idle' && (
            <div className='gs-start'>
              <p className='content font-size-base'>{_('Guided session')}</p>
              <p className='typed text-mutedink mt-1 text-[9px] leading-relaxed'>
                {_(
                  'THE PROF TAKES THE LEAD: A GOAL, A ROUTE, A RHYTHM. TRIALS, NOT LECTURES. YOU MAY PAUSE OR LEAVE AT ANY TIME.',
                )}
              </p>
              <input
                className='border-ink bg-paperlight mt-3 w-full max-w-md border px-2 py-1.5 text-[13px] italic outline-none placeholder:text-mutedink/70'
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void store.begin(bookKey, goalDraft);
                }}
                placeholder={_('What do you want to understand?')}
                aria-label={_('Session goal')}
                data-desk-initial-focus
              />
              <p className='typed text-mutedink mt-1 text-[8.5px] leading-relaxed'>
                {_('LEAVE IT BLANK AND THE PROF READS THE BOOK FOR THE GOAL.')}
              </p>
              <button
                type='button'
                className='stamp-btn mt-3'
                disabled={!appService}
                onClick={() => void store.begin(bookKey, goalDraft)}
              >
                {_('Begin')}
              </button>
            </div>
          )}
          {turns.map((t, i) => (
            <div
              key={`${t.at}-${i}`}
              className={clsx(
                'gs-turn',
                t.speaker === 'learner' ? 'gs-turn-learner' : 'gs-turn-prof',
              )}
            >
              <span className='typed gs-turn-who'>
                {t.speaker === 'learner' ? _('YOU') : _('THE PROF')}
                {t.verdict && (
                  <span
                    className={clsx('gs-verdict', t.verdict === 'pass' ? 'gs-pass' : 'gs-retry')}
                  >
                    {t.verdict === 'pass' ? ' ✓' : ' ↻'}
                  </span>
                )}
              </span>
              <div className='gs-turn-body select-text'>
                {t.text.trim() ? (
                  t.speaker === 'professor' ? (
                    <Prose text={t.text} />
                  ) : (
                    <span className='whitespace-pre-wrap'>{t.text}</span>
                  )
                ) : t.concept ? (
                  <span className='text-mutedink'>{t.concept.replace(/_/g, ' ')}</span>
                ) : null}
              </div>
            </div>
          ))}
          {note && session.phase === 'done' && (
            <p className='typed text-mutedink text-[9px] leading-relaxed'>{note.toUpperCase()}</p>
          )}
          {session.phase === 'done' && (
            <div className='mt-2 flex gap-2'>
              <button type='button' className='stamp-btn' onClick={() => store.reset()}>
                {_('New session')}
              </button>
              <button type='button' className='stamp-btn' onClick={exit}>
                {_('Back to the desk')}
              </button>
            </div>
          )}
        </div>
        {!pinned && growth && (
          <button type='button' className='wb-scroll-chip' onClick={scrollToBottomAndRepin}>
            {_('New words below')}
          </button>
        )}
      </div>

      {/* The composer — text-to-text. Enter sends; Shift+Enter breaks. */}
      {live && (
        <div className='gs-composer border-ink/25 flex-none border-t px-4 py-3'>
          {statusLine && <p className='gs-status'>{statusLine}</p>}
          {session.phase === 'teaching' && !session.paused && (
            <div className='mb-1 flex justify-end'>
              <button
                type='button'
                className='typed text-mutedink hover:text-ink text-[9px] tracking-wider'
                onClick={() => store.skip(bookKey)}
              >
                {_('SKIP THIS CONCEPT')}
              </button>
            </div>
          )}
          <div className='flex items-end gap-2'>
            <textarea
              ref={composerRef}
              className='gs-input border-ink bg-paperlight flex-1 resize-none border px-2 py-1.5 text-[13px] outline-none placeholder:text-mutedink/70'
              rows={2}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={
                session.paused
                  ? _('The session holds — ask him anything, or resume.')
                  : _('Answer the trial — or ask him anything. Answers are always free.')
              }
              aria-label={_('Your answer')}
              disabled={!canCompose && !session.paused}
            />
            <button
              type='button'
              className='chrome-ghost chrome-btn-icon h-8 min-h-8 w-8 flex-none'
              aria-label={_('Send')}
              disabled={!composer.trim() || (!canCompose && !session.paused)}
              onClick={send}
            >
              <PiPaperPlaneRight size={16} />
            </button>
          </div>
          {(session.phase === 'teaching' || session.phase === 'practicing') && (
            <div className='mt-1 flex justify-end'>
              <button
                type='button'
                className='typed text-mutedink hover:text-ink text-[9px] tracking-wider'
                onClick={() => void store.end(bookKey, 'ended')}
              >
                {_('END SESSION')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GuidedSessionView;
