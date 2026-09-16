/**
 * useTranscriptPersistence — the desk document's load/save effects,
 * harvested verbatim from the retired notebook tab's L974–1023 (d2 §8, audit R7).
 *
 * One document, one owner: `${getDir(book)}/${WORKBENCH_TRANSCRIPT_FILENAME}`
 * via the AppService file API, scope 'Books'. Failure is a console.warn,
 * never a throw — a sitting continues in memory when the inkwell runs dry.
 * `parseTranscript` (placement-sanitizing since wave 3) is the only loader,
 * so the Desk and any older reader read and write the SAME document: an old
 * 2.x sidebar transcript becomes the sheet's document on first open.
 */
import { useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { getDir } from '@/utils/book';
import {
  WORKBENCH_TRANSCRIPT_FILENAME,
  parseTranscript,
  serializeTranscript,
  useWorkbenchChatStore,
} from '../notebook/workbenchChat';

const toText = (c: string | ArrayBuffer): string =>
  typeof c === 'string' ? c : new TextDecoder().decode(c);

export function useTranscriptPersistence(bookKey: string): {
  /** Gate: never save before the first load has settled. Informational —
   *  the save effect is gated on an internal ref so a load completion by
   *  itself does not trigger a write (verbatim 2.x behavior). */
  loaded: boolean;
  /** The restored sitting's book title — the canvas greets you once,
   *  quietly, per mount. null on a fresh sheet. */
  resumeNotice: string | null;
} {
  const { appService } = useEnv();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const blocks = useWorkbenchChatStore((s) => s.blocks[bookKey]);
  const setBlocks = useWorkbenchChatStore((s) => s.setBlocks);

  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  // Load: a restored sitting becomes the sheet's document.
  useEffect(() => {
    let alive = true;
    loadedRef.current = false;
    void (async () => {
      try {
        const book = getBookData(bookKey)?.book;
        if (appService && book) {
          const raw = await appService.readFile(
            `${getDir(book)}/${WORKBENCH_TRANSCRIPT_FILENAME}`,
            'Books',
            'text',
          );
          const parsed = parseTranscript(toText(raw));
          if (alive && parsed) {
            setBlocks(bookKey, parsed);
            if (parsed.length > 0) {
              // A restored sitting greets you once, quietly, per mount.
              setResumeNotice(getBookData(bookKey)?.book?.title ?? '');
            }
          }
        }
      } catch {
        // No saved sitting yet — a fresh sheet of paper is fine.
      } finally {
        if (alive) {
          loadedRef.current = true;
          setLoaded(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookKey, appService, getBookData, setBlocks]);

  // Save on every blocks change after the first load (d2 §8).
  useEffect(() => {
    if (!loadedRef.current) return;
    void (async () => {
      try {
        const book = getBookData(bookKey)?.book;
        if (!appService || !book) return;
        await appService.writeFile(
          `${getDir(book)}/${WORKBENCH_TRANSCRIPT_FILENAME}`,
          'Books',
          serializeTranscript(useWorkbenchChatStore.getState().blocks[bookKey] ?? []),
        );
      } catch (e) {
        // Persistence failure is a warn — the sitting continues in memory.
        console.warn('[workbench] transcript persist failed', e);
      }
    })();
  }, [blocks, bookKey, appService, getBookData]);

  return { loaded, resumeNotice };
}
