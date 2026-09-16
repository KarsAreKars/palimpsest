'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useDeskStore } from '@/store/deskStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { latestConceptMap, useWorkbenchChatStore } from '../notebook/workbenchChat';
import DeskRail from '../notebook/DeskRail';
import useShortcuts from '@/hooks/useShortcuts';

import DeskCanvas, { type DeskCanvasHandle } from './DeskCanvas';

import './desk.css';

/** Quiet paper fallback when the workbench desk crashes. */
const DeskFallback: React.FC = () => {
  const _ = useTranslation();
  return (
    <div className='flex flex-grow items-center justify-center px-3'>
      <div className='border-ink/25 bg-paperlight rounded-sm border px-4 py-6 text-center'>
        <p className='typed text-mutedink text-[9px] leading-relaxed'>
          {_('This desk is being restored.')}
        </p>
      </div>
    </div>
  );
};

class DeskErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { crashed: boolean }
> {
  override state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error('[desk] sheet crashed; sealed behind fallback', error);
  }
  override render() {
    return this.state.crashed ? <DeskFallback /> : this.props.children;
  }
}

export interface DeskSheetProps {
  /** The book this cell renders. The caller only mounts DeskSheet for the
   *  focused book (bookKey === sideBarBookKey), so this is the desk's book. */
  bookKey: string;
}

const DeskSheet: React.FC<DeskSheetProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { isDeskVisible, setDeskVisible } = useDeskStore();
  const sheetRef = useRef<HTMLDivElement>(null);
  const progress = useReaderStore((s) => s.getProgress(bookKey));
  const { getBookData } = useBookDataStore();
  const bookData = getBookData(bookKey);
  const [entered, setEntered] = useState(false);

  const handleDismiss = useCallback(() => setDeskVisible(false), [setDeskVisible]);
  useShortcuts({ onEscape: handleDismiss }, [handleDismiss]);

  // Entry slide (d1 §5.4): the sheet mounts already-visible, so the
  // translateY transition only runs once the open class lands on a rAF.
  useEffect(() => {
    if (!isDeskVisible) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [isDeskVisible]);

  // Focus trap + focus return (d1 §6.2)
  useEffect(() => {
    if (!isDeskVisible) return;
    const sheet = sheetRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sheet?.querySelector<HTMLElement>('[data-desk-initial-focus]')?.focus();
    return () => {
      const toggle = useDeskStore.getState().toggleElement;
      (toggle ?? previouslyFocused)?.focus?.();
    };
  }, [isDeskVisible]);

  // Tab cycling within the sheet only (single focus owner — law 8). The
  // book's chrome above the sheet (header z-10) stays reachable: the trap
  // queries within sheetRef and never touches it.
  const handleSheetKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const focusables = Array.from(
      sheet.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (focusables.length === 0) {
      event.preventDefault();
      sheet.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // The traffic-light rail (d3 §B): a second, fixed view over
  // latestConceptMap. The scroll root is the canvas's own scroll element —
  // the single scroll owner (audit R3); the book underneath must never
  // scroll (law 7); a stale threadId is a quiet no-op (the chip is
  // evidence, not a gate).
  const canvasRef = useRef<DeskCanvasHandle | null>(null);
  const railMap = useWorkbenchChatStore((s) => latestConceptMap(s.blocks[bookKey] ?? []));
  const handleOpenThread = useCallback((threadId: string) => {
    canvasRef.current?.scrollToBlock(threadId);
  }, []);

  if (!isDeskVisible || !bookData?.bookDoc || !bookData.book) return null;

  const bookLanguage = bookData.bookDoc.metadata.language;

  return (
    <div
      ref={sheetRef}
      className={clsx(
        'desk-sheet paper-bg',
        entered && 'desk-sheet-open',
        'absolute inset-0 z-[5] flex flex-col',
        appService?.hasRoundedWindow && 'rounded-window',
      )}
      role='dialog'
      aria-modal='true'
      aria-label={_('The Desk')}
      tabIndex={-1}
      onKeyDown={handleSheetKeyDown}
      // dir follows the book (Notebook.tsx:439 does the same via viewSettings)
      dir={typeof bookLanguage === 'string' && bookLanguage.startsWith('ar') ? 'rtl' : 'ltr'}
    >
      <div className='desk-scrim' aria-hidden='true' />
      <header className='desk-head border-ink/25 flex h-11 flex-none items-center border-b px-4'>
        <span className='plate-title text-ink line-clamp-1 flex-1 text-[15px]'>
          {bookData.book.title}
        </span>
        <span className='typed text-mutedink text-[9px] uppercase tracking-wider'>
          {progress ? _('Page {{page}}', { page: progress.page }) : ''}
        </span>
        <button
          type='button'
          data-desk-initial-focus
          className='chrome-ghost chrome-btn-icon h-8 min-h-8 w-8'
          aria-label={_('Close the Desk')}
          onClick={handleDismiss}
        >
          {/* inline 16px close hairline-x, stroke currentColor, matches the
              notebook Header close idiom */}
          <svg
            width='16'
            height='16'
            viewBox='0 0 16 16'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.4'
            aria-hidden='true'
          >
            <path d='M3 3l10 10M13 3L3 13' />
          </svg>
        </button>
      </header>
      <div className='desk-body min-h-0 flex-1'>
        {/* R3: .desk-stage is an overflow-hidden flex filler and the rail's
            positioning context; the canvas (DeskCanvas) is the single
            scroll owner. */}
        <div className='desk-stage h-full'>
          <DeskRail map={railMap} onOpenThread={handleOpenThread} />
          <DeskErrorBoundary>
            <DeskCanvas ref={canvasRef} bookKey={bookKey} />
          </DeskErrorBoundary>
        </div>
      </div>
    </div>
  );
};

export default DeskSheet;
