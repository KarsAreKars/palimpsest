/**
 * StudyTab — the learning home (was "the notebook's third tab").
 *
 * Three resurfacing surfaces, per the Readwise/SuperMemo research: learning
 * sticks when the margins come BACK to you, weakest-first, as questions.
 *   1. Chapter session (OpenMAIC loop) — the Prof drafts 3–5 learning
 *      objectives from the current chapter, then quizzes you on them one
 *      at a time through the voice loop, stamping each [PASS]/[RETRY].
 *      Session end files a reflection report into the study notes.
 *   2. From your margins — your own highlights, newest first. GO jumps to
 *      the passage; QUIZ ME hands the excerpt to the Prof, who questions
 *      you on it one at a time (active recall, voice-native).
 *   3. Review queue — concept history from learner.json, weakest first
 *      (lowest Bloom, then most-asked), each with a Feynman review button.
 *   4. Study notes — notes.md exactly as the professor distilled it.
 *
 * Data loads when the tab opens and refreshes on the refresh button;
 * exchanges logged while the panel sits open appear on the next open.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PiGraduationCap, PiArrowsClockwise, PiSparkle } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getDir } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { getNarration } from '@/services/narration/speakMode';
import type { HpubManifest } from '@/services/narration';
import { StampButton } from '@/components/apothecary';
import {
  getProfessorAnnotations,
  subscribeProfessorAnnotations,
  type ProfessorAnnotationSet,
} from '@/services/professor/annotationBus';
import {
  buildSessionQuestion,
  buildSessionReportMd,
  extractSessionOutcome,
  generateChapterObjectives,
  getChapterText,
  type SessionObjective,
} from '@/services/professor/session';
import {
  loadLearner,
  appendExchange,
  appendNote,
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
    // chapter_session is the session-summary exchange, not a learnable
    // concept — it must not surface in the review queue with Bloom pips.
    .filter(([name]) => name !== 'uncategorized' && name !== 'chapter_session')
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

  // ── Chapter session (research-openmaic-2026.md ports #3–#5) ──────────────
  // Objectives are drafted once per chapter; the quiz itself runs entirely
  // through the Prof's voice loop. Verdicts come back as [PASS]/[RETRY]
  // annotation tags on the professor's annotation bus — the Study tab
  // subscribes and advances the checklist; no new channel, no new agents.
  const [objectives, setObjectives] = useState<SessionObjective[] | null>(null);
  const [chapterLabel, setChapterLabel] = useState('');
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sessionNote, setSessionNote] = useState('');
  // Refs mirror the session state so the bus subscription (bound once per
  // book) always reads the live values.
  const objectivesRef = useRef<SessionObjective[] | null>(null);
  const activeIdxRef = useRef<number | null>(null);
  const chapterLabelRef = useRef('');
  const awaitingVerdictRef = useRef(false);
  const lastSetRef = useRef<ProfessorAnnotationSet | null>(null);

  const setObjs = (objs: SessionObjective[] | null) => {
    objectivesRef.current = objs;
    setObjectives(objs);
  };
  const setIdx = (idx: number | null) => {
    activeIdxRef.current = idx;
    setActiveIdx(idx);
  };

  /** The chapter's text layer: live narration controller first, disk second. */
  const readChapterSource = useCallback(async (): Promise<{
    md: string;
    manifest: HpubManifest;
  } | null> => {
    const controller = getNarration(bookKey)?.controller;
    if (controller?.md && controller?.manifest) {
      return { md: controller.md, manifest: controller.manifest };
    }
    const book = getBookData(bookKey)?.book;
    if (!appService || !book) return null;
    try {
      const dir = getDir(book);
      const [md, rawManifest] = await Promise.all([
        appService.readFile(`${dir}/content.md`, 'Books', 'text'),
        appService.readFile(`${dir}/manifest.json`, 'Books', 'text'),
      ]);
      return { md: toText(md), manifest: JSON.parse(toText(rawManifest)) as HpubManifest };
    } catch {
      return null;
    }
  }, [bookKey, appService, getBookData]);

  const generateObjectives = useCallback(async () => {
    const aiSettings = useSettingsStore.getState().settings.aiSettings;
    if (!aiSettings?.enabled) {
      setSessionNote(_('No AI provider configured — connect one in Settings → AI to run a chapter session.'));
      return;
    }
    setGenerating(true);
    setSessionNote('');
    sessionEndedRef.current = false; // fresh session — the once-guard arms again
    try {
      const source = await readChapterSource();
      if (!source) {
        setSessionNote(_('The book\u2019s text layer is still being prepared — try again in a moment.'));
        return;
      }
      const page = (getBookProgress(bookKey)?.index ?? 0) + 1;
      const chapter = getChapterText({
        ...source,
        toc: getBookData(bookKey)?.bookDoc?.toc ?? [],
        page,
      });
      const list = await generateChapterObjectives({ chapter, aiSettings });
      if (!list) {
        setSessionNote(_('The Prof could not draft objectives from this chapter — try again.'));
        return;
      }
      chapterLabelRef.current = chapter.label;
      setChapterLabel(chapter.label);
      lastSetRef.current = getProfessorAnnotations(bookKey);
      setObjs(list.map((text) => ({ text, status: 'pending' as const })));
    } finally {
      setGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, readChapterSource, getBookData, _]);

  const askObjective = useCallback(
    (idx: number, objs: SessionObjective[]) => {
      const objective = objs[idx];
      if (!objective) return;
      setIdx(idx);
      awaitingVerdictRef.current = true;
      askProfessorFromUI(
        bookKey,
        buildSessionQuestion(objective.text, idx + 1, objs.length, chapterLabelRef.current),
      );
    },
    [bookKey],
  );

  /** Closing/synthesis: file the reflection report into notes.md and fold a
   *  summary exchange into learner.json via the existing record path. The
   *  per-question exchanges were already logged by the voice loop itself. */
  const sessionEndedRef = useRef(false);
  const endSession = useCallback(
    async (objs: SessionObjective[]) => {
      // Guard against double-fire: the verdict callback and the "End
      // session" button can both land in the same frame (button rendered
      // off stale activeIdx) — the report must append exactly once.
      if (sessionEndedRef.current) return;
      sessionEndedRef.current = true;
      setIdx(null);
      awaitingVerdictRef.current = false;
      const book = getBookData(bookKey)?.book;
      if (appService && book) {
        const page = (getBookProgress(bookKey)?.index ?? 0) + 1;
        const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const passed = objs.filter((o) => o.status === 'pass').length;
        try {
          await appendNote(
            appService,
            book,
            buildSessionReportMd({ chapterLabel: chapterLabelRef.current, objectives: objs, date, page }),
          );
          await appendExchange(appService, book, {
            ts: new Date().toISOString(),
            concept: 'chapter_session',
            page,
            question_kind: 'check-me',
            question: `Chapter session on ${chapterLabelRef.current}: ${passed}/${objs.length} objectives passed`,
            resolved: passed === objs.length,
          });
        } catch (e) {
          console.warn('[study] session report failed', e);
        }
      }
      setSessionNote(_('Session filed to your study notes.'));
      void reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, appService, getBookData, reload, _],
  );

  const askObjectiveRef = useRef(askObjective);
  askObjectiveRef.current = askObjective;
  const endSessionRef = useRef(endSession);
  endSessionRef.current = endSession;

  // Verdict intake: the Prof's completed answer (the strike — pending flips
  // false) carries the [PASS]/[RETRY] tag. Consume it once per set object,
  // stamp the current objective, and advance to the next pending one.
  useEffect(() => {
    const unsub = subscribeProfessorAnnotations(() => {
      if (!awaitingVerdictRef.current) return;
      const set = getProfessorAnnotations(bookKey);
      if (!set || set.pending || set === lastSetRef.current) return;
      const outcome = extractSessionOutcome(set.annotations);
      if (!outcome) return;
      lastSetRef.current = set;
      awaitingVerdictRef.current = false;
      const objs = objectivesRef.current;
      const idx = activeIdxRef.current;
      if (!objs || idx === null) return;
      const next = objs.map((o, i) =>
        i === idx
          ? { ...o, status: outcome.verdict, ...(outcome.takeaway ? { takeaway: outcome.takeaway } : {}) }
          : o,
      );
      setObjs(next);
      const nextIdx = next.findIndex((o) => o.status === 'pending');
      if (nextIdx === -1) {
        void endSessionRef.current(next);
      } else {
        askObjectiveRef.current(nextIdx, next);
      }
    });
    return unsub;
  }, [bookKey]);

  const startSession = () => {
    const objs = objectivesRef.current;
    if (!objs?.length) return;
    sessionEndedRef.current = false; // re-arm for a restarted session
    lastSetRef.current = getProfessorAnnotations(bookKey);
    askObjective(0, objs);
  };

  /** The Prof didn't stamp a verdict (or the reader wants to move on):
   *  advance without one — the report marks the objective honestly. */
  const skipObjective = () => {
    const objs = objectivesRef.current;
    const idx = activeIdxRef.current;
    if (!objs || idx === null) return;
    awaitingVerdictRef.current = false;
    const nextIdx = objs.findIndex((o, i) => i > idx && o.status === 'pending');
    if (nextIdx === -1) void endSession(objs);
    else askObjective(nextIdx, objs);
  };

  const sessionDone =
    objectives !== null && activeIdx === null && objectives.some((o) => o.status !== 'pending');

  const empty = queue.length === 0 && notes.trim().length === 0 && deck.length === 0;

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex items-center justify-between px-3 pt-2'>
        <span className='typed text-mutedink text-[9px]'>{_('YOUR MARGINS, BACK TO YOU')}</span>
        <div className='flex items-center gap-1'>
          {/* OpenMAIC-style chapter quiz, run entirely through the Prof's
              voice loop: one question at a time, graded answers. */}
          <button
            className='typed text-stamp hover:bg-[rgba(140,59,34,0.08)] rounded px-1.5 py-0.5 text-[9px] tracking-wider'
            onClick={() =>
              askProfessorFromUI(
                bookKey,
                'Quiz me on what I\u2019m reading. Run a 5-question spoken quiz on the material ' +
                  'around this page: one question at a time, wait for my answer after each, ' +
                  'grade each one briefly and specifically (what was right, what was missing), ' +
                  'then move to the next. Start with question one now.',
              )
            }
            aria-label={_('Chapter quiz')}
            title={_('Chapter quiz')}
          >
            {_('QUIZ ME')}
          </button>
          <button
            className='btn btn-ghost btn-xs'
            onClick={() => void reload()}
            aria-label={_('Refresh')}
            title={_('Refresh')}
          >
            <PiArrowsClockwise size={14} />
          </button>
        </div>
      </div>
      <div className='flex-grow overflow-y-auto px-3 pb-3'>
        {/* CHAPTER SESSION — the OpenMAIC learning loop: the chapter is the
            course, the Prof quizzes each objective through the voice loop. */}
        <p className='content font-size-base mt-1'>{_('Chapter session')}</p>
        {chapterLabel && (
          <p className='typed text-mutedink mt-0.5 text-[8.5px]'>{chapterLabel.toUpperCase()}</p>
        )}
        {objectives ? (
          <ol className='mt-1'>
            {objectives.map((o, i) => (
              <li key={i} className='border-ink bg-paperlight my-1.5 border px-2 py-1.5'>
                <div className='flex items-start gap-2'>
                  <span className='typed text-mutedink mt-0.5 text-[9px] leading-snug'>
                    {i + 1}.
                  </span>
                  <span className='flex-1 text-[13px] leading-snug'>{o.text}</span>
                  {o.status === 'pass' && (
                    <span className='text-stamp text-sm leading-none' title={_('Pass')}>
                      ✓
                    </span>
                  )}
                  {o.status === 'retry' && (
                    <span className='text-stamp text-sm leading-none' title={_('Retry')}>
                      ↻
                    </span>
                  )}
                </div>
                {i === activeIdx && (
                  <p className='typed text-stamp mt-1 text-[8.5px]'>
                    {_('THE PROF IS ASKING — ANSWER HIM AND HE STAMPS THE VERDICT')}
                  </p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className='typed text-mutedink mt-1 text-[9px] leading-relaxed'>
            {_(
              'THE CHAPTER IS THE COURSE. THE PROF DRAFTS 3–5 OBJECTIVES, THEN QUIZZES YOU ON EACH — ONE SPOKEN QUESTION AT A TIME.',
            )}
          </p>
        )}
        {sessionNote && (
          <p className='typed text-mutedink mt-1 text-[9px] leading-relaxed'>
            {sessionNote.toUpperCase()}
          </p>
        )}
        <div className='mt-1.5 flex flex-wrap gap-1.5'>
          {!objectives && (
            <StampButton onClick={() => void generateObjectives()} disabled={generating}>
              {generating ? _('Drafting…') : _('Generate objectives')}
            </StampButton>
          )}
          {objectives && activeIdx === null && !sessionDone && (
            <StampButton onClick={startSession}>{_('Start session')}</StampButton>
          )}
          {activeIdx !== null && (
            <>
              <StampButton onClick={skipObjective}>{_('Skip')}</StampButton>
              <StampButton onClick={() => void endSession(objectivesRef.current ?? [])}>
                {_('End session')}
              </StampButton>
            </>
          )}
          {sessionDone && (
            <StampButton
              onClick={() => {
                setObjs(null);
                setSessionNote('');
              }}
            >
              {_('New session')}
            </StampButton>
          )}
        </div>
        {empty ? (
          <div className='flex items-center justify-center py-6'>
            <EmptyState
              Icon={PiGraduationCap}
              label={_('Nothing to review yet')}
              hint={_(
                'Highlight as you read, or ask the professor something with ⌥Space — it all resurfaces here',
              )}
            />
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
};

export default StudyTab;
