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
import { buildContextPack, type ProfessorExchange } from '@/services/professor/contextPack';
import { askProfessor } from '@/services/professor/tutor';
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

export type ProfessorPhase = 'idle' | 'thinking' | 'answering';

// Recent exchanges per book — continuity for follow-up questions ("why does
// THAT matter?"). Cap keeps the context pack small; distillation into
// notes.md (HP-4) replaces this with durable memory.
const exchangesByBook = new Map<string, ProfessorExchange[]>();
const EXCHANGE_CAP = 4;

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
  const getView = useReaderStore((s) => s.getView);

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
          onDone: (full) => {
            voice.finish();
            setPhase('idle');
            // The speech/display contract: the bubble and any future spoken
            // answer see ONLY stripped prose. The raw stream carries the
            // annotation tags; they are parsed here, validated against the
            // page's real blocks, and handed to the pen (ProfAnnotations).
            const cleaned = stripAnnotations(full);
            setAnswer(cleaned);
            pushExchange(bookKey, { q, a: cleaned });

            const jump = parseAnnotations(full).find(
              (a): a is Extract<ProfessorAnnotation, { kind: 'page' }> => a.kind === 'page',
            );
            const targetPage =
              jump && jump.page <= controller.manifest.page_count ? jump.page : page;
            if (jump && targetPage === jump.page && jump.page !== page) {
              Promise.resolve(getView(bookKey)?.goTo?.(jump.page - 1)).catch(() => undefined);
            }
            const blocks = getPageBlocks(controller.manifest, targetPage);
            const annotations = validateAnnotations(parseAnnotations(full), blocks).filter(
              (a) => a.kind !== 'page',
            );
            setProfessorAnnotations(bookKey, { page: targetPage, annotations });
          },
          onError: (message) => {
            voice.stop();
            setPhase('idle');
            setError(message);
          },
        },
      });
    },
    [bookKey, getVoice, getView],
  );

  return { open, phase, answer, error, ask, close };
};
