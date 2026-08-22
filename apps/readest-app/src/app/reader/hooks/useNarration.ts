/**
 * useNarration — the reader-side narration session (Palimpsest).
 *
 * Loads the book's spoken script (narration.jsonl + manifest + content.md)
 * into a NarrationController, registers it in the speak-mode registry, and
 * wires the reader surface:
 *   - 'narration-word-click' messages (from FoliateViewer's iframe click
 *     interception) → start reading at the clicked word
 *   - unit-change → PDF page turn + sentence highlight on the text layer
 *   - Space / ArrowRight / ArrowLeft → pause/resume / next / previous
 *     sentence, for both main-window and iframe-originated keys
 *
 * When no narration exists for the book (extraction pending, plain web
 * import), this hook is inert and the upstream TTS path is untouched.
 */
import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { getBookProgress } from '@/store/readerProgressStore';
import { NarrationController } from '@/services/narration/controller';
import {
  registerNarration,
  unregisterNarration,
  setNarrationSpeakMode,
} from '@/services/narration/speakMode';
import { applyUnitHighlight, clearUnitHighlight } from '@/services/narration/highlight';
import type { NarrationUnit } from '@/services/narration';

interface SectionContent {
  index?: number;
  doc?: Document;
}

export const useNarration = ({ bookKey }: { bookKey: string }) => {
  const { appService } = useEnv();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const controllerRef = useRef<NarrationController | null>(null);
  const [available, setAvailable] = useState(false);

  // ── session lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const book = getBookData(bookKey)?.book;
    if (!appService || !book) return;

    const highlightUnit = (unit: NarrationUnit) => {
      const view = getView(bookKey);
      const contents = (view?.renderer?.getContents?.() ?? []) as SectionContent[];
      const controller = controllerRef.current;
      if (!controller) return;
      // Clear highlight on any rendered page, then mark the current unit's.
      for (const c of contents) if (c.doc) clearUnitHighlight(c.doc);
      const target = contents.find((c) => c.index === (unit.page ?? 0) - 1);
      if (target?.doc) {
        applyUnitHighlight(target.doc, controller.md.slice(unit.md_start, unit.md_end));
      }
    };

    const onUnitChange = (e: Event) => {
      const unit = (e as CustomEvent<{ unit: NarrationUnit | null }>).detail?.unit;
      if (!unit?.page) return;
      const view = getView(bookKey);
      const currentIndex = getBookProgress(bookKey)?.index;
      if (view && currentIndex !== undefined && currentIndex !== unit.page - 1) {
        void view.renderer?.goTo?.({ index: unit.page - 1 });
        // Let the target page render before highlighting into its text layer.
        setTimeout(() => highlightUnit(unit), 350);
      } else {
        highlightUnit(unit);
      }
    };

    const onEnded = () => {
      setNarrationSpeakMode(bookKey, false);
      const view = getView(bookKey);
      const contents = (view?.renderer?.getContents?.() ?? []) as SectionContent[];
      for (const c of contents) if (c.doc) clearUnitHighlight(c.doc);
    };

    (async () => {
      const controller = await NarrationController.load(appService, book).catch(() => null);
      if (cancelled || !controller) return;
      controllerRef.current = controller;
      controller.addEventListener('unit-change', onUnitChange);
      controller.addEventListener('book-ended', onEnded);
      controller.addEventListener('stopped', onEnded);
      registerNarration(bookKey, { controller, speakMode: false });
      setAvailable(true);
    })();

    return () => {
      cancelled = true;
      unregisterNarration(bookKey);
      controllerRef.current?.stop();
      controllerRef.current = null;
      setAvailable(false);
    };
  }, [bookKey, appService, getBookData, getView]);

  // ── click-to-speak ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!available) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; bookKey?: string; page?: number; word?: string };
      if (data?.type !== 'narration-word-click' || data.bookKey !== bookKey) return;
      const controller = controllerRef.current;
      if (!controller || !data.page || !data.word) return;
      setNarrationSpeakMode(bookKey, true);
      void controller.startFromWord(data.page, data.word);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bookKey, available]);

  // ── keyboard controls (plan §5) ───────────────────────────────────────────
  useEffect(() => {
    if (!available) return;
    const handle = (key: string, preventDefault?: () => void) => {
      const controller = controllerRef.current;
      if (!controller?.active) return;
      if (key === ' ') {
        preventDefault?.();
        void controller.togglePlay();
      } else if (key === 'ArrowRight') {
        preventDefault?.();
        void controller.next();
      } else if (key === 'ArrowLeft') {
        preventDefault?.();
        void controller.prev();
      }
    };
    const onKeydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      handle(e.key, () => e.preventDefault());
    };
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; bookKey?: string; key?: string };
      if (data?.type !== 'iframe-keydown' || data.bookKey !== bookKey) return;
      if (data.key) handle(data.key);
    };
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('message', onMessage);
    };
  }, [bookKey, available]);

  return { narrationAvailable: available, narrationController: controllerRef.current };
};
