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
import { useNarrationSettings } from '@/services/narration/settings';
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
  // Last narration page we positioned the view on. In two-page spread mode a
  // goTo into the visible spread emits no relocate, so the progress store's
  // index never catches up to the spoken page — without this ref the turn
  // guard would re-navigate on every unit of the same page (history spam).
  const lastTurnedPageRef = useRef<number | null>(null);
  // Set by the session-lifecycle effect; invoked by the settings effect to
  // hot-swap provider/voice mid-session without losing the reader's place.
  const rebuildRef = useRef<(() => Promise<void>) | null>(null);
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
      console.info('narration: unit', unit.unit, 'page', unit.page, unit.kind);
      if (unit.page === lastTurnedPageRef.current) {
        highlightUnit(unit);
        return;
      }
      lastTurnedPageRef.current = unit.page;
      const view = getView(bookKey);
      const currentIndex = getBookProgress(bookKey)?.index;
      if (view && currentIndex !== undefined && currentIndex !== unit.page - 1) {
        // Canonical fixed-layout navigation (same call PageJumpInput makes):
        // view-level goTo resolves the index, pushes history, and emits the
        // relocate event that updates the progress store.
        console.info('narration: page-turn follow —', currentIndex + 1, '→', unit.page);
        Promise.resolve(view.goTo(unit.page - 1)).catch((err) =>
          console.warn('narration: page-turn follow failed', err),
        );
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
      const controller = await NarrationController.load(appService, book).catch((e) => {
        console.warn('narration: session load failed', e);
        return null;
      });
      if (cancelled || !controller) return;
      controllerRef.current = controller;
      controller.addEventListener('unit-change', onUnitChange);
      controller.addEventListener('book-ended', onEnded);
      controller.addEventListener('stopped', onEnded);
      registerNarration(bookKey, { controller, speakMode: false });
      setAvailable(true);
      console.info('narration: session ready —', controller.units.length, 'units');
      // Test/demo hook: lets the e2e harness await narration readiness.
      (window as unknown as Record<string, unknown>)['__palimpsestNarrationReady'] = bookKey;
      // Test/demo hook: direct controller access for acceptance probes.
      (window as unknown as Record<string, unknown>)['__palimpsestNarration'] = controller;
    })();

    // Hot-swap the voice/provider mid-session (settings → Narration). The
    // provider is baked in at load time, so a change means tear down +
    // reload — but the reader's place and play state carry over.
    rebuildRef.current = async () => {
      const old = controllerRef.current;
      if (!old) return;
      const currentUnit = old.player.currentUnit;
      const unitIdx = currentUnit ? old.units.findIndex((u) => u.unit === currentUnit.unit) : -1;
      const wasPlaying = old.playing;
      const wasPaused = old.paused;
      old.stop();
      unregisterNarration(bookKey);
      controllerRef.current = null;
      const controller = await NarrationController.load(appService, book).catch((e) => {
        console.warn('narration: session reload failed', e);
        return null;
      });
      if (cancelled || !controller) {
        setAvailable(false);
        return;
      }
      controllerRef.current = controller;
      controller.addEventListener('unit-change', onUnitChange);
      controller.addEventListener('book-ended', onEnded);
      controller.addEventListener('stopped', onEnded);
      registerNarration(bookKey, { controller, speakMode: false });
      (window as unknown as Record<string, unknown>)['__palimpsestNarration'] = controller;
      console.info('narration: session rebuilt with new voice settings');
      if (unitIdx >= 0 && (wasPlaying || wasPaused)) {
        setNarrationSpeakMode(bookKey, true);
        await controller.player.playFrom(unitIdx).catch(() => undefined);
        if (wasPaused) controller.player.pause();
      }
    };

    return () => {
      cancelled = true;
      rebuildRef.current = null;
      unregisterNarration(bookKey);
      controllerRef.current?.stop();
      controllerRef.current = null;
      setAvailable(false);
    };
  }, [bookKey, appService, getBookData, getView]);

  // ── live settings: voice/provider changes rebuild the session ─────────────
  useEffect(() => {
    if (!available) return undefined;
    return useNarrationSettings.subscribe((state, prev) => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (state.rate !== prev.rate) controller.player.setRate(state.rate);
      const voiceFieldsChanged =
        state.provider !== prev.provider ||
        state.elevenlabsApiKey !== prev.elevenlabsApiKey ||
        state.elevenlabsVoiceId !== prev.elevenlabsVoiceId ||
        state.elevenlabsTier !== prev.elevenlabsTier ||
        state.edgeVoiceId !== prev.edgeVoiceId;
      if (voiceFieldsChanged) void rebuildRef.current?.();
    });
  }, [available]);

  // ── click-to-speak ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!available) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; bookKey?: string; page?: number; word?: string };
      if (data?.type !== 'narration-word-click' || data.bookKey !== bookKey) return;
      const controller = controllerRef.current;
      if (!controller || !data.page || !data.word) return;
      setNarrationSpeakMode(bookKey, true);
      console.info('narration: click-to-speak — page', data.page, JSON.stringify(data.word));
      void controller.startFromWord(data.page, data.word);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bookKey, available]);

  // Keyboard controls (plan §5) route through the app's unified shortcut
  // layer: Space → onTTSPlayPause → tts-toggle-play (delegated to narration
  // in useTTSControl); arrows → goLeft/goRight in useBookShortcuts (narration
  // sentence skip while a session is active). Covers window and iframe keys.

  return { narrationAvailable: available, narrationController: controllerRef.current };
};
