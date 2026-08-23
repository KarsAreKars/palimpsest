/**
 * StudyTab — the notebook's third tab (HP-5, hey_prof plan §7 + §8).
 *
 * Two halves:
 *   1. Review queue — the concept history from learner.json, weakest first
 *      (lowest Bloom, then most-asked). Each row offers a Feynman review:
 *      one click sends the professor a check-me session request through the
 *      normal ask loop (voice, pen, logging all ride along).
 *   2. Study notes — notes.md exactly as the professor distilled it,
 *      rendered as markdown. This is the speed-revision surface: everything
 *      the reader ever asked, in their own words.
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

  const startReview = (concept: string) => {
    const pretty = concept.replace(/_/g, ' ');
    askProfessorFromUI(
      bookKey,
      `Feynman review: I want to check whether I actually understand "${pretty}". ` +
        'Ask me to explain it back in my own words, wait for my attempt, then correct what I get wrong. ' +
        'Start by asking me the question now.',
    );
  };

  const empty = queue.length === 0 && notes.trim().length === 0;

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex items-center justify-between px-3 pt-2'>
        <span className='font-size-xs text-base-content/60'>{_('Your study log')}</span>
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
              'Ask the professor something with ⌥Space — your exchanges become study notes here',
            )}
          />
        </div>
      ) : (
        <div className='flex-grow overflow-y-auto px-3 pb-3'>
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
