import clsx from 'clsx';
import React, { useCallback, useEffect, useState } from 'react';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';
import { eventDispatcher } from '@/utils/event';
import { getBookDirFromLanguage } from '@/utils/book';
import { getPanelTopInset } from '@/utils/insets';
import { Overlay } from '@/components/Overlay';
import { saveSysSettings } from '@/helpers/settings';
import useShortcuts from '@/hooks/useShortcuts';
import {
  removeBookNoteOverlays,
  removeEmptyAnnotationPlaceholder,
} from '../../utils/annotatorUtil';
import StudyTab from './StudyTab';
import NotebookHeader from './Header';
import NotebookTabNavigation from './NotebookTabNavigation';
import type { NotebookTab } from '@/store/notebookStore';

const MIN_NOTEBOOK_WIDTH = 0.15;
// The workbench (math desk) asked for a wider panel: a derivation beside your
// working steps needs real width, so the drag range extends past the old
// 0.45 notes-era ceiling. Mobile behaviour is unchanged (full width).
const MAX_NOTEBOOK_WIDTH = 0.85;
const DEFAULT_NOTEBOOK_WIDTH_FRAC = 0.35;

const Notebook: React.FC = ({}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateAppTheme, safeAreaInsets, systemUIVisible, statusBarHeight } = useThemeStore();
  const { sideBarBookKey } = useSidebarStore();
  const { isNotebookVisible, isNotebookPinned, notebookActiveTab } = useNotebookStore();
  const { notebookWidthFrac, setNotebookWidthFrac } = useNotebookStore();
  const { notebookNewAnnotation, setNotebookPin } = useNotebookStore();
  const { getBookData, getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getViewsById, getViewSettings } = useReaderStore();
  const { setNotebookWidth, setNotebookVisible, toggleNotebookPin } = useNotebookStore();
  const { setNotebookNewAnnotation, setNotebookNewHighlightId } = useNotebookStore();
  const { setNotebookEditAnnotation, setNotebookActiveTab } = useNotebookStore();

  const isMobile = window.innerWidth < 640;
  const [isFullHeightInMobile, setIsFullHeightInMobile] = useState(isMobile);

  const {
    panelRef: notebookRef,
    overlayRef,
    panelHeight: notebookHeight,
    handleVerticalDragStart,
  } = useSwipeToDismiss(
    () => {
      setNotebookVisible(false);
      setIsFullHeightInMobile(isMobile);
    },
    (data) => setIsFullHeightInMobile(data.clientY < 44),
  );

  const onNavigateEvent = async () => {
    const { isNotebookPinned } = useNotebookStore.getState();
    if (!isNotebookPinned) {
      setNotebookVisible(false);
    }
  };

  const handleHideNotebook = useCallback(() => {
    if (!isNotebookPinned) {
      setNotebookVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotebookPinned]);

  useShortcuts({ onEscape: handleHideNotebook }, [handleHideNotebook]);

  useEffect(() => {
    if (isNotebookVisible) {
      updateAppTheme('base-200');
      overlayRef.current = document.querySelector('.overlay') as HTMLDivElement | null;
    } else {
      updateAppTheme('base-100');
      overlayRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotebookVisible]);

  useEffect(() => {
    setNotebookWidth(settings.globalReadSettings.notebookWidth);
    setNotebookPin(settings.globalReadSettings.isNotebookPinned);
    setNotebookVisible(settings.globalReadSettings.isNotebookPinned);
    // Settings from older builds may persist notebookActiveTab: 'spine' or
    // 'notes' (those tabs are gone — owner ruling 2026-11-25); the notebook
    // now lands on Study, the single Learn surface.
    setNotebookActiveTab('study');

    eventDispatcher.on('navigate', onNavigateEvent);
    return () => {
      eventDispatcher.off('navigate', onNavigateEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Width drag (M1): pointer events + pointer capture on the left-edge
  // handle; the panel is anchored right, so dragging LEFT widens it.
  // Fraction lives in notebookStore (clamped 0.15–0.85); dblclick resets.
  const handleWidthDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isMobile) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startFrac = useNotebookStore.getState().notebookWidthFrac;
      const onMove = (ev: PointerEvent) => {
        setNotebookWidthFrac(startFrac + (startX - ev.clientX) / window.innerWidth);
      };
      const onDone = () => handle.removeEventListener('pointermove', onMove);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onDone, { once: true });
      handle.addEventListener('pointercancel', onDone, { once: true });
    },
    [isMobile, setNotebookWidthFrac],
  );

  const handleWidthKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.02;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setNotebookWidthFrac(useNotebookStore.getState().notebookWidthFrac + step);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setNotebookWidthFrac(useNotebookStore.getState().notebookWidthFrac - step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setNotebookWidthFrac(DEFAULT_NOTEBOOK_WIDTH_FRAC);
    }
  };

  const handleTogglePin = () => {
    toggleNotebookPin();
    const globalReadSettings = settings.globalReadSettings;
    const newGlobalReadSettings = { ...globalReadSettings, isNotebookPinned: !isNotebookPinned };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
  };

  const handleTabChange = (tab: NotebookTab) => {
    setNotebookActiveTab(tab);
    const globalReadSettings = settings.globalReadSettings;
    const newGlobalReadSettings = { ...globalReadSettings, notebookActiveTab: tab };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
  };

  // Abandon a note-creation flow: tear down the empty highlight the "Annotate"
  // action eagerly created as the note anchor so it doesn't leak into the
  // booknotes list (#4791). A saved note carries text, so it survives the guard
  // in removeEmptyAnnotationPlaceholder; a restyled pre-existing highlight has no
  // tracked id and is left alone. `bookKey` is passed explicitly so the unmount/
  // book-switch cleanup targets the book the placeholder belongs to.
  const handleCancelNewAnnotation = useCallback(
    (bookKey: string | null) => {
      const { notebookNewHighlightId } = useNotebookStore.getState();
      if (bookKey && notebookNewHighlightId) {
        const config = getConfig(bookKey);
        const { booknotes: annotations = [] } = config || {};
        const placeholder = removeEmptyAnnotationPlaceholder(
          annotations,
          notebookNewHighlightId,
          Date.now(),
        );
        if (placeholder) {
          const views = getViewsById(bookKey.split('-')[0]!);
          views.forEach((view) => removeBookNoteOverlays(view, placeholder));
          const updatedConfig = updateBooknotes(bookKey, annotations);
          if (updatedConfig) {
            // Read settings fresh: this callback has stable identity (empty deps)
            // so a captured `settings` would go stale across saves.
            saveConfig(envConfig, bookKey, updatedConfig, useSettingsStore.getState().settings);
          }
        }
      }
      setNotebookNewHighlightId(null);
      setNotebookNewAnnotation(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The "Annotate" action keeps a placeholder highlight alive only while its
  // editor is on screen. The moment that creation flow stops being presented —
  // Cancel/Escape (selection cleared), the notebook closing, swipe-dismiss, or a
  // navigate — clean the placeholder up (#4791). Save clears the tracked id (and
  // the placeholder gains note text), so this no-ops for saved annotations.
  useEffect(() => {
    if (!(isNotebookVisible && notebookNewAnnotation)) {
      handleCancelNewAnnotation(sideBarBookKey);
    }
  }, [isNotebookVisible, notebookNewAnnotation, sideBarBookKey, handleCancelNewAnnotation]);

  // Switching books (notebook pinned, so it stays presented) or closing the
  // reader leaves the placeholder behind; clean it up against the book we are
  // leaving on the way out (#4791).
  useEffect(() => {
    return () => handleCancelNewAnnotation(sideBarBookKey);
  }, [sideBarBookKey, handleCancelNewAnnotation]);

  const handleClickOverlay = () => {
    setNotebookVisible(false);
    setNotebookNewAnnotation(null);
    setNotebookEditAnnotation(null);
  };

  // Notes/spine tabs are gone (owner ruling 2026-11-25): the save/edit-note
  // handlers and their search/empty state left with the tabs. The annotation
  // create/delete helpers above remain — the reader's highlight flow uses them.
  if (!sideBarBookKey) return null;

  const bookData = getBookData(sideBarBookKey);
  const viewSettings = getViewSettings(sideBarBookKey);
  if (!bookData || !bookData.bookDoc) {
    return null;
  }
  const { bookDoc } = bookData;
  const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);

  return isNotebookVisible ? (
    <>
      {!isNotebookPinned && (
        <Overlay
          className={clsx('z-[45]', viewSettings?.isEink ? '' : 'bg-black/50 sm:bg-black/20')}
          onDismiss={handleClickOverlay}
        />
      )}
      <div
        ref={notebookRef}
        className={clsx(
          'notebook-container paper-bg right-0 flex min-w-60 select-none flex-col',
          'full-height font-sans text-base font-normal transition-[padding-top] duration-300 sm:text-sm',
          'border-s border-[rgba(38,34,27,0.14)]',
          appService?.hasRoundedWindow && 'rounded-window-top-right rounded-window-bottom-right',
          isNotebookPinned ? 'z-20' : 'z-[45] shadow-2xl',
          !isNotebookPinned && viewSettings?.isEink && 'eink:border-ink',
        )}
        role='group'
        aria-label={_('Notebook')}
        dir={viewSettings?.rtl && languageDir === 'rtl' ? 'rtl' : 'ltr'}
        style={{
          width: isMobile ? '100%' : `${Math.round(notebookWidthFrac * 10000) / 100}%`,
          maxWidth: isMobile ? '100%' : `${MAX_NOTEBOOK_WIDTH * 100}%`,
          position: isMobile ? 'fixed' : isNotebookPinned ? 'relative' : 'absolute',
          paddingTop: `${getPanelTopInset({
            isMobile,
            isFullHeightInMobile,
            systemUIVisible,
            statusBarHeight,
            safeAreaInsets,
          })}px`,
        }}
      >
        <style jsx>{`
          @media (max-width: 640px) {
            .notebook-container {
              border-top-left-radius: 16px;
              border-top-right-radius: 16px;
            }
            .overlay {
              transition: opacity 0.3s ease-in-out;
            }
          }
        `}</style>
        <div
          className={clsx(
            'group absolute -left-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none',
            'flex-col items-center',
            isMobile && 'hidden',
          )}
          role='slider'
          tabIndex={0}
          aria-label={_('Resize Notebook')}
          aria-orientation='horizontal'
          aria-valuemin={Math.round(MIN_NOTEBOOK_WIDTH * 100)}
          aria-valuemax={Math.round(MAX_NOTEBOOK_WIDTH * 100)}
          aria-valuenow={Math.round(notebookWidthFrac * 100)}
          onPointerDown={handleWidthDragStart}
          onKeyDown={handleWidthKeyDown}
          onDoubleClick={() => setNotebookWidthFrac(DEFAULT_NOTEBOOK_WIDTH_FRAC)}
        >
          <div className='bg-ink/0 group-hover:bg-mutedink h-full w-0.5 transition-colors duration-150' />
        </div>
        <div className='flex-shrink-0'>
          {isMobile && (
            <div
              role='slider'
              tabIndex={0}
              aria-label={_('Resize Notebook')}
              aria-orientation='vertical'
              aria-valuenow={notebookHeight.current}
              className='drag-handle flex h-6 max-h-6 min-h-6 w-full cursor-row-resize items-center justify-center'
              onMouseDown={handleVerticalDragStart}
              onTouchStart={handleVerticalDragStart}
            >
              <div className='bg-ink/40 h-1 w-10 rounded-full'></div>
            </div>
          )}
          <NotebookHeader
            isPinned={isNotebookPinned}
            isSearchBarVisible={false}
            handleClose={() => setNotebookVisible(false)}
            handleTogglePin={handleTogglePin}
            handleToggleSearchBar={() => {}}
            showSearchButton={false}
          />
        </div>
        {notebookActiveTab === 'study' ? <StudyTab bookKey={sideBarBookKey} /> : null}
        <div
          className='flex-shrink-0'
          style={{
            paddingBottom: `${(safeAreaInsets?.bottom || 0) / 2}px`,
          }}
        >
          <NotebookTabNavigation activeTab={notebookActiveTab} onTabChange={handleTabChange} />
        </div>
      </div>
    </>
  ) : null;
};

export default Notebook;
