import clsx from 'clsx';
import React, { useEffect } from 'react';
import { FaHeadphones } from 'react-icons/fa6';
import { RiArrowLeftSLine, RiArrowRightSLine } from 'react-icons/ri';
import { RiArrowGoBackLine, RiArrowGoForwardLine } from 'react-icons/ri';
import { RiArrowLeftDoubleLine, RiArrowRightDoubleLine } from 'react-icons/ri';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getNarration } from '@/services/narration/speakMode';
import type { FooterBarChildProps } from './types';
import { getNavigationIcon } from './utils';
import Button from '@/components/Button';
import PageJumpInput from './PageJumpInput';

const DesktopFooterBar: React.FC<FooterBarChildProps> = ({
  bookKey,
  gridInsets,
  progressValid,
  navigationHandlers,
  forceMobileLayout,
  onSpeakText,
}) => {
  const _ = useTranslation();
  const { getView, getViewState, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const viewState = getViewState(bookKey);
  const viewSettings = getViewSettings(bookKey);

  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;

  // UX spec E: when narration owns the plain arrow keys, say so — typed,
  // muted, discoverable. The session registers ASYNC (the text layer loads
  // in the background), so poll for it — a one-shot mount lookup missed it
  // every time (review fix #2).
  const [narrationOwnsKeys, setNarrationOwnsKeys] = React.useState(false);
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const attach = () => {
      const entry = getNarration(bookKey);
      if (!entry) return false;
      const sync = () => setNarrationOwnsKeys(entry.controller.active);
      sync();
      entry.controller.addEventListener('unit-change', sync);
      entry.controller.addEventListener('stopped', sync);
      cleanup = () => {
        entry.controller.removeEventListener('unit-change', sync);
        entry.controller.removeEventListener('stopped', sync);
      };
      return true;
    };
    if (attach()) return cleanup;
    const poll = setInterval(() => {
      if (attach()) clearInterval(poll);
    }, 1500);
    return () => {
      clearInterval(poll);
      cleanup?.();
    };
  }, [bookKey]);

  return (
    <div
      className={clsx(
        'hidden h-8 w-full items-center gap-x-4 overflow-x-auto px-4',
        !forceMobileLayout && 'sm:flex',
      )}
      style={{
        bottom: isMobile ? `${gridInsets.bottom * 0.33}px` : '0px',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      {!viewSettings?.showPaginationButtons && (
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowLeftDoubleLine />,
            <RiArrowRightDoubleLine />,
          )}
          onClick={navigationHandlers.onPrevSection}
          label={_('Previous Section')}
        />
      )}
      {!viewSettings?.showPaginationButtons && (
        <Button
          icon={getNavigationIcon(viewSettings?.rtl, <RiArrowLeftSLine />, <RiArrowRightSLine />)}
          onClick={navigationHandlers.onPrevPage}
          label={_('Previous Page')}
        />
      )}
      <Button
        icon={getNavigationIcon(viewSettings?.rtl, <RiArrowGoBackLine />, <RiArrowGoForwardLine />)}
        onClick={navigationHandlers.onGoBack}
        label={_('Go Back')}
        disabled={!view?.history.canGoBack}
      />
      <Button
        icon={getNavigationIcon(viewSettings?.rtl, <RiArrowGoForwardLine />, <RiArrowGoBackLine />)}
        onClick={navigationHandlers.onGoForward}
        label={_('Go Forward')}
        disabled={!view?.history.canGoForward}
      />
      {progressValid && <PageJumpInput bookKey={bookKey} className='mx-2 text-sm' />}
      {narrationOwnsKeys && (
        <span className='typed text-mutedink hidden whitespace-nowrap text-[8.5px] md:inline'>
          ← → SKIP SENTENCES · SHIFT FOR PAGES
        </span>
      )}
      {/* The old % scrubber is gone (2026-09-06): page arrows, the page-jump
          field and the Spine own navigation now; the slider was the one
          control that lied in a PDF (percent ≠ page). */}
      <div className='min-w-0 flex-1' />
      <Button
        icon={<FaHeadphones className={viewState?.ttsEnabled ? 'text-blue-500' : ''} />}
        onClick={onSpeakText!}
        label={_('Speak')}
      />
      {!viewSettings?.showPaginationButtons && (
        <Button
          icon={getNavigationIcon(viewSettings?.rtl, <RiArrowRightSLine />, <RiArrowLeftSLine />)}
          onClick={navigationHandlers.onNextPage}
          label={_('Next Page')}
        />
      )}
      {!viewSettings?.showPaginationButtons && (
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowRightDoubleLine />,
            <RiArrowLeftDoubleLine />,
          )}
          onClick={navigationHandlers.onNextSection}
          label={_('Next Section')}
        />
      )}
    </div>
  );
};

export default DesktopFooterBar;
