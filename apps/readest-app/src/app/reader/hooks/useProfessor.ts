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
import { getBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { buildContextPack, type ProfessorExchange } from '@/services/professor/contextPack';
import { askProfessor } from '@/services/professor/tutor';

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
    setOpen(false);
    setPhase('idle');
    setAnswer('');
    setError(null);
  }, []);

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
          },
          onDone: (full) => {
            setPhase('idle');
            pushExchange(bookKey, { q, a: full });
          },
          onError: (message) => {
            setPhase('idle');
            setError(message);
          },
        },
      });
    },
    [bookKey],
  );

  return { open, phase, answer, error, ask, close };
};
