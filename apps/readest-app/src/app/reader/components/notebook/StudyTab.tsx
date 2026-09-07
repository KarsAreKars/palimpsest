/**
 * StudyTab — the learning home (was "the notebook's third tab").
 *
 * Three resurfacing surfaces, per the Readwise/SuperMemo research: learning
 * sticks when the margins come BACK to you, weakest-first, as questions.
 *   1. From your margins — your own highlights, newest first. GO jumps to
 *      the passage; QUIZ ME hands the excerpt to the Prof, who questions
 *      you on it one at a time (active recall, voice-native).
 *   2. Review queue — concept history from learner.json, weakest first
 *      (lowest Bloom, then most-asked), each with a Feynman review button.
 *   3. Study notes — notes.md exactly as the professor distilled it.
 *
 * Data loads when the tab opens and refreshes on the refresh button;
 * exchanges logged while the panel sits open appear on the next open.
 */
import React, { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PiGraduationCap, PiArrowsClockwise, PiSparkle } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getDir } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import {
  loadLearner,
  NOTES_FILENAME,
  STUCK_THRESHOLD,
  type LearnerState,
} from '@/services/professor/learner';
import EmptyState from '../EmptyState';

export const PROF_ASK_EVENT = 'palimpsest-prof-ask';

/** Fire a professor question from anywhere; useProfessor owns the loop. */
export const askProfessorFromUI = (bookKey: string, question: string): void => {
  window.dispatchEvent(new CustomEvent(PROF_ASK_EVENT, { detail: { bookKey, question } }));
};

const toText = (c: string | ArrayBuffer): string =>
  typeof c === 'string' ? c : new TextDecoder().decode(c);

const BloomPips: React.FC<{ level: number }> = ({ level }) => (
  <span className='inline-flex gap-0.5' title={`Bloom level ${level}/6`}>
    {Array.from({ length: 6 }, (_, i) => (
      <span
        key={i}
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          i < level ? 'bg-amber-500' : 'bg-base-content/20'
        }`}
      />
    ))}
  </span>
);

const StudyTab: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const getBookData = useBookDataStore((s) => s.getBookData);
  // Reactive: highlights land while the tab is open and resurface at once.
  const booknotes = useBookDataStore((s) => s.booksData[bookKey]?.config?.booknotes);
  const [learner, setLearner] = useState<LearnerState | null>(null);
  const [notes, setNotes] = useState('');

  const reload = useCallback(async () => {
    const book = getBookData(bookKey)?.book;
    if (!appService || !book) return;
    setLearner(await loadLearner(appService, book));
    try {
      setNotes(
        toText(await appService.readFile(`${getDir(book)}/${NOTES_FILENAME}`, 'Books', 'text')),
      );
    } catch {
      setNotes('');
    }
  }, [bookKey, appService, getBookData]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const queue = Object.entries(learner?.concept_states ?? {})
    .filter(([name]) => name !== 'uncategorized')
    .sort((a, b) => a[1].bloom - b[1].bloom || b[1].asked - a[1].asked);

  // The resurfacing deck: your highlights, newest first. Highlights carry
  // `text` (the excerpt); pure margin notes without an excerpt still resurface
  // via their note text.
  const deck = (booknotes ?? [])
    .filter((n) => !n.deletedAt && (n.text?.trim() || n.note?.trim()))
    .slice()
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
      new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())
    .slice(0, 12);

  const goTo = (cfi?: string) => {
    if (cfi) void eventDispatcher.dispatch('navigate', { bookKey, cfi });
  };

  const quizMe = (excerpt: string, page?: number) => {
    askProfessorFromUI(
      bookKey,
      `Quiz me on this passage I highlighted${page ? ` (page ${page})` : ''}: "${excerpt.slice(0, 600)}". ` +
        'Ask me one question at a time about what it means and why it matters. ' +
        'Wait for each answer before asking the next. Start now.',
    );
  };

  const startReview = (concept: string) => {
    const pretty = concept.replace(/_/g, ' ');
    askProfessorFromUI(
      bookKey,
      `Feynman review: I want to check whether I actually understand "${pretty}". ` +
        'Ask me to explain it back in my own words, wait for my attempt, then correct what I get wrong. ' +
        'Start by asking me the question now.',
    );
  };

  const empty = queue.length === 0 && notes.trim().length === 0 && deck.length === 0;

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex items-center justify-between px-3 pt-2'>
        <span className='typed text-mutedink text-[9px]'>{_('YOUR MARGINS, BACK TO YOU')}</span>
        <button
          className='btn btn-ghost btn-xs'
          onClick={() => void reload()}
          aria-label={_('Refresh')}
          title={_('Refresh')}
        >
          <PiArrowsClockwise size={14} />
        </button>
      </div>
      {empty ? (
        <div className='flex flex-grow items-center justify-center overflow-y-auto px-3'>
          <EmptyState
            Icon={PiGraduationCap}
            label={_('Nothing to review yet')}
            hint={_(
              'Highlight as you read, or ask the professor something with ⌥Space — it all resurfaces here',
            )}
          />
        </div>
      ) : (
        <div className='flex-grow overflow-y-auto px-3 pb-3'>
          {deck.length > 0 && (
            <>
              <p className='content font-size-base mt-1'>{_('From your margins')}</p>
              <ul>
                {deck.map((n) => {
                  const excerpt = (n.text || n.note || '').trim();
                  return (
                    <li
                      key={n.id}
                      className='border-base-300 bg-base-100 my-2 rounded-lg border p-2.5'
                    >
                      <p className='line-clamp-3 text-[13px] italic'>{excerpt}</p>
                      <div className='mt-1.5 flex items-center justify-between'>
                        <button
                          className='typed text-mutedink hover:text-ink text-[9px]'
                          onClick={() => goTo(n.cfi)}
                        >
                          {typeof n.page === 'number' ? `P. ${n.page + 1}` : _('GO')}
                        </button>
                        <button
                          className='btn btn-outline btn-xs gap-1'
                          onClick={() => quizMe(excerpt, typeof n.page === 'number' ? n.page + 1 : undefined)}
                        >
                          <PiSparkle size={12} />
                          {_('Quiz me')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {queue.length > 0 && (
            <>
              <p className='content font-size-base mt-1'>{_('Review queue')}</p>
              <ul>
                {queue.map(([name, s]) => (
                  <li
                    key={name}
                    className='border-base-300 bg-base-100 my-2 rounded-lg border p-2.5'
                  >
                    <div className='flex items-center justify-between gap-2'>
                      <span className='text-sm font-medium'>{name.replace(/_/g, ' ')}</span>
                      <BloomPips level={s.bloom} />
                    </div>
                    <div className='mt-1.5 flex items-center justify-between'>
                      <span className='font-size-xs text-base-content/60'>
                        {s.asked >= STUCK_THRESHOLD
                          ? _('asked {{count}}x — stuck, switch it up', { count: s.asked })
                          : _('asked {{count}}x', { count: s.asked })}
                      </span>
                      <button
                        className='btn btn-outline btn-xs gap-1'
                        onClick={() => startReview(name)}
                      >
                        <PiSparkle size={12} />
                        {_('Feynman review')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {notes.trim().length > 0 && (
            <>
              <p className='content font-size-base mt-3'>{_('Study notes')}</p>
              <div className='prose prose-sm font-size-xs mt-1 max-w-none select-text'>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default StudyTab;
