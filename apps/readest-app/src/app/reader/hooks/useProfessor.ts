/**
 * useProfessor — HP-1 overlay session (hey_prof_integration_plan §8).
 *
 * Owns the overlay state machine (closed → open; idle → thinking →
 * answering), the ⌥Space push-to-talk keybinding, narration pause
 * coordination, context-pack assembly, and the streaming ask loop.
 *
 * Deliberately in-memory in HP-1: recent exchanges live in a module map per
 * book. Persistence to learner.json / notes.md lands with HP-3/HP-4.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getNarration } from '@/services/narration/speakMode';
import { getPageBlocks } from '@/services/narration';
import { getBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { buildContextPack, type ProfessorExchange } from '@/services/professor/contextPack';
import { askProfessor, distillNote } from '@/services/professor/tutor';
import {
  parseAnnotations,
  stripAnnotations,
  validateAnnotations,
  type ProfessorAnnotation,
} from '@/services/professor/annotations';
import {
  clearProfessorAnnotations,
  setProfessorAnnotations,
} from '@/services/professor/annotationBus';
import { ProfessorVoice } from '@/services/professor/voice';
import { PROF_ASK_EVENT } from '@/app/reader/components/notebook/StudyTab';
import {
  appendExchange,
  appendNote,
  emptyLearner,
  loadLearner,
  normalizeQKind,
  UNCATEGORIZED_CONCEPT,
  type LearnerState,
} from '@/services/professor/learner';

export type ProfessorPhase = 'idle' | 'thinking' | 'answering';

// Recent exchanges per book — continuity for follow-up questions ("why does
// THAT matter?"). Cap keeps the context pack small; learner.json (HP-4) is
// the durable memory across sessions.
const exchangesByBook = new Map<string, ProfessorExchange[]>();
const EXCHANGE_CAP = 4;

// Learner state per book, loaded lazily on the first ask and refreshed by
// every logged exchange. Feeds the context pack's concept history.
const learnerByBook = new Map<string, LearnerState>();

const getExchanges = (bookKey: string): ProfessorExchange[] => exchangesByBook.get(bookKey) ?? [];

const pushExchange = (bookKey: string, ex: ProfessorExchange): void => {
  const list = [...getExchanges(bookKey), ex].slice(-EXCHANGE_CAP);
  exchangesByBook.set(bookKey, list);
};

export const useProfessor = ({ bookKey }: { bookKey: string }) => {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ProfessorPhase>('idle');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const voiceRef = useRef<ProfessorVoice | null>(null);
  const askRef = useRef<(q: string) => Promise<void>>(async () => {});
  const getView = useReaderStore((s) => s.getView);
  const { appService } = useEnv();
  const getBookData = useBookDataStore((s) => s.getBookData);

  /** Lazily create the professor's voice, bound to the LIVE narration
   * controller lookup so voice hot-swaps and rebuilt sessions are picked
   * up on the next spoken sentence. */
  const getVoice = useCallback((): ProfessorVoice => {
    if (!voiceRef.current) {
      voiceRef.current = new ProfessorVoice({
        getSpeech: () => getNarration(bookKey)?.controller?.speech ?? null,
      });
    }
    return voiceRef.current;
  }, [bookKey]);

  /** Learner state for the context pack: cached per book, loaded once. */
  const getLearner = useCallback((): LearnerState => {
    const cached = learnerByBook.get(bookKey);
    if (cached) return cached;
    learnerByBook.set(bookKey, emptyLearner());
    const book = getBookData(bookKey)?.book;
    if (appService && book) {
      void loadLearner(appService, book)
        .then((state) => learnerByBook.set(bookKey, state))
        .catch(() => undefined);
    }
    return learnerByBook.get(bookKey)!;
  }, [bookKey, appService, getBookData]);

  // ⌥Space toggles the overlay (PTT shell; wake word comes in HP-4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.altKey && !e.repeat) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Cross-surface asks (HP-5): the Study tab's Feynman review button fires
  // a question through the normal loop — voice, pen, and logging included.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<{ bookKey?: string; question?: string }>).detail;
      if (detail?.bookKey !== bookKey || !detail.question) return;
      setOpen(true);
      void askRef.current(detail.question);
    };
    window.addEventListener(PROF_ASK_EVENT, onAsk);
    return () => window.removeEventListener(PROF_ASK_EVENT, onAsk);
  }, [bookKey]);

  // Narration coordination (plan §5): the book pauses while you talk to the
  // professor. Resume is manual in HP-1 — Space or the Speak button.
  useEffect(() => {
    if (!open) return;
    const controller = getNarration(bookKey)?.controller;
    if (controller?.playing) controller.player.pause();
  }, [open, bookKey]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    voiceRef.current?.stop();
    clearProfessorAnnotations(bookKey);
    setOpen(false);
    setPhase('idle');
    setAnswer('');
    setError(null);
  }, [bookKey]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) return;
      const controller = getNarration(bookKey)?.controller;
      if (!controller) {
        setError(
          'The professor is still preparing this book (no text layer yet). Try again once the book has finished importing.',
        );
        return;
      }
      const page = (getBookProgress(bookKey)?.index ?? 0) + 1;
      const pack = buildContextPack({
        md: controller.md,
        manifest: controller.manifest,
        page,
        currentUnit: controller.player.currentUnit,
        recentExchanges: getExchanges(bookKey),
        conceptStates: getLearner().concept_states,
      });

      abortRef.current?.abort();
      const aborter = new AbortController();
      abortRef.current = aborter;
      // Barge-in (plan §5): a new question silences the previous answer.
      const voice = getVoice();
      voice.stop();
      setPhase('thinking');
      setAnswer('');
      setError(null);

      const aiSettings = useSettingsStore.getState().settings.aiSettings;
      await askProfessor({
        question: q,
        pack,
        aiSettings,
        signal: aborter.signal,
        cb: {
          onToken: (t) => {
            setPhase('answering');
            setAnswer((prev) => prev + t);
            voice.push(t); // speaks at the first complete sentence
          },
          onDone: (full, meta) => {
            voice.finish();
            setPhase('idle');
            // The speech/display contract: the bubble and any future spoken
            // answer see ONLY stripped prose. The raw stream carries the
            // annotation tags; they are parsed here, validated against the
            // page's real blocks, and handed to the pen (ProfAnnotations).
            const cleaned = stripAnnotations(full);
            setAnswer(cleaned);
            pushExchange(bookKey, { q, a: cleaned });

            const parsed = parseAnnotations(full);
            const jump = parsed.find(
              (a): a is Extract<ProfessorAnnotation, { kind: 'page' }> => a.kind === 'page',
            );
            const targetPage =
              jump && jump.page <= controller.manifest.page_count ? jump.page : page;
            if (jump && targetPage === jump.page && jump.page !== page) {
              Promise.resolve(getView(bookKey)?.goTo?.(jump.page - 1)).catch(() => undefined);
            }
            const blocks = getPageBlocks(controller.manifest, targetPage);
            const annotations = validateAnnotations(parsed, blocks).filter(
              (a) => a.kind !== 'page' && a.kind !== 'concept' && a.kind !== 'qkind',
            );
            setProfessorAnnotations(bookKey, { page: targetPage, annotations });

            // HP-4 question log (plan §6): fold the exchange into
            // learner.json, refresh the cached concept history, then distill
            // the study note (plan §7). All fire-and-forget — the overlay
            // never waits on the log.
            const concept =
              parsed.find(
                (a): a is Extract<ProfessorAnnotation, { kind: 'concept' }> => a.kind === 'concept',
              )?.name ?? UNCATEGORIZED_CONCEPT;
            const qkind = normalizeQKind(
              parsed.find(
                (a): a is Extract<ProfessorAnnotation, { kind: 'qkind' }> => a.kind === 'qkind',
              )?.qkind,
            );
            const book = getBookData(bookKey)?.book;
            if (appService && book) {
              const ts = new Date();
              void appendExchange(appService, book, {
                ts: ts.toISOString(),
                concept,
                page: targetPage,
                question_kind: qkind,
                question: q,
                resolved: true, // settled by the NEXT exchange (learner.ts)
              })
                .then((state) => learnerByBook.set(bookKey, state))
                .catch((e) => console.warn('[professor] learner log failed', e));
              if (!meta.echo) {
                const date = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                void distillNote({
                  question: q,
                  answer: cleaned,
                  page: targetPage,
                  concept,
                  date,
                  aiSettings,
                })
                  .then((note) => (note ? appendNote(appService, book, note) : undefined))
                  .catch((e) => console.warn('[professor] note distillation failed', e));
              }
            }
          },
          onError: (message) => {
            voice.stop();
            setPhase('idle');
            setError(message);
          },
        },
      });
    },
    [bookKey, getVoice, getView, getLearner, appService, getBookData],
  );

  askRef.current = ask;

  return { open, phase, answer, error, ask, close };
};
