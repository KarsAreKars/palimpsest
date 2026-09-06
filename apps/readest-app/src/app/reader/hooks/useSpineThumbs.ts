/**
 * useSpineThumbs — capture a thumbnail whenever a *touched* page is on
 * screen (UX spec B). Watches the booknote count; when a note's page is
 * currently rendered, snapshots its canvas into the thumb cache. Pages
 * touched while off-screen get caught the next time they're visible with
 * the notebook open — capture is opportunistic by design.
 */
import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { capturePageThumb } from '@/services/thumbs/pageThumbs';

interface SectionContent {
  index?: number;
  doc?: Document;
}

export const useSpineThumbs = ({ bookKey }: { bookKey: string }) => {
  const { appService } = useEnv();
  const getView = useReaderStore((s) => s.getView);
  const noteCount = useBookDataStore(
    (s) =>
      s.booksData[bookKey]?.config?.booknotes?.filter(
        (n) => typeof n.page === 'number' && !n.deletedAt,
      ).length ?? 0,
  );
  // Session-local dedupe: never capture the same page twice per mount.
  const captured = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!appService || noteCount === 0) return;
    const config = useBookDataStore.getState().booksData[bookKey]?.config;
    const notes = (config?.booknotes ?? []).filter(
      (n) => typeof n.page === 'number' && !n.deletedAt,
    );
    const view = getView(bookKey);
    const contents = (view?.renderer?.getContents?.() ?? []) as SectionContent[];
    const bookHash = bookKey.split('-')[0]!;
    for (const note of notes) {
      const page = note.page!;
      if (captured.current.has(page)) continue;
      const section = contents.find((c) => c.index === page - 1);
      if (section?.doc) {
        captured.current.add(page);
        void capturePageThumb(appService, bookHash, page, section.doc);
      }
    }
  }, [noteCount, appService, bookKey, getView]);
};
