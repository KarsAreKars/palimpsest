import clsx from 'clsx';
import React, { useRef } from 'react';
import { FaChevronDown, FaSearch } from 'react-icons/fa';
import { MdManageSearch } from 'react-icons/md';
import { PiSelectionAll, PiSelectionAllFill } from 'react-icons/pi';
import { MdOutlineMenu } from 'react-icons/md';
import { IoMdCloseCircle } from 'react-icons/io';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { LibrarySearchConfig, LibrarySearchTarget } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import useShortcuts from '@/hooks/useShortcuts';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import SettingsMenu from './SettingsMenu';
import ImportMenu from './ImportMenu';
import LibrarySearchOptionsMenu from './LibrarySearchOptionsMenu';

interface LibraryHeaderProps {
  isSelectMode: boolean;
  isSelectAll: boolean;
  onPullLibrary: () => void;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportBookFromUrl?: () => void;
  onImportBookFromNovelUrl?: () => void;
  onOpenCatalogManager: () => void;
  onOpenFeeds: () => void;
  onToggleSelectMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  searchQuery: string;
  searchTarget: LibrarySearchTarget;
  searchConfig: LibrarySearchConfig;
  onSearchConfigChange: (config: LibrarySearchConfig) => void;
  onSearchQueryChange: (query: string) => void;
  onSearchTargetChange: (target: LibrarySearchTarget) => void;
}

const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  isSelectMode,
  isSelectAll,
  onPullLibrary,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onImportBookFromNovelUrl,
  onOpenCatalogManager,
  onOpenFeeds,
  onToggleSelectMode,
  onSelectAll,
  onDeselectAll,
  searchQuery,
  searchTarget,
  searchConfig,
  onSearchConfigChange,
  onSearchQueryChange,
  onSearchTargetChange,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const { currentBookshelf } = useLibraryStore();

  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const { safeAreaInsets: insets } = useThemeStore();

  useShortcuts({
    onToggleSelectMode,
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchQueryChange(e.target.value);
  };

  const windowButtonVisible = appService?.hasWindowBar && !isTrafficLightVisible;
  const currentBooksCount = currentBookshelf.length;

  if (!insets) return null;

  const isMobile = appService?.isMobile || window.innerWidth <= 640;

  return (
    <div
      ref={headerRef}
      className={clsx(
        'titlebar z-10 flex h-[52px] w-full items-center py-2 pr-4 sm:h-[44px]',
        windowButtonVisible ? 'sm:pr-4' : 'sm:pr-6',
        isTrafficLightVisible ? 'pl-16' : 'pl-0 sm:pl-2',
      )}
      style={{
        marginTop: appService?.hasSafeAreaInset
          ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
          : '0px',
      }}
    >
      <div className='relative flex w-full items-center'>
        <div className='catalogue-masthead-wordmark exclude-title-bar-mousedown flex shrink-0 items-center ps-4'>
          <span className='font-display'>Palimpsest</span>
        </div>
        <div className='exclude-title-bar-mousedown relative flex min-w-0 flex-1 items-center px-4'>
          <div className='relative mx-auto h-9 w-full max-w-xl sm:h-7'>
            {/* The icon doubles as the mode indicator and toggle: magnifier
                for book search, full-text glyph for content search. */}
            <div className='absolute inset-y-0 start-0 z-10 flex items-center'>
              <button
                type='button'
                aria-pressed={searchTarget === 'text'}
                aria-label={searchTarget === 'text' ? _('Full Text Search') : _('Search Books')}
                title={searchTarget === 'text' ? _('Full Text Search') : _('Search Books')}
                className={clsx(
                  'text-mutedink hover:text-ink',
                  'not-eink:transition-colors ms-2.5 flex h-7 min-h-7 items-center justify-center',
                  'touch-target w-8 rounded-full bg-transparent duration-150',
                )}
                onClick={() => onSearchTargetChange(searchTarget === 'text' ? 'books' : 'text')}
              >
                {searchTarget === 'text' ? (
                  <MdManageSearch className='h-5 w-5 -translate-y-[1px]' />
                ) : (
                  <FaSearch className='h-3.5 w-3.5' />
                )}
              </button>
            </div>
            <input
              type='text'
              value={searchQuery}
              placeholder={
                searchTarget === 'text'
                  ? _('Search contents in {{count}} Book(s)...', { count: currentBooksCount })
                  : currentBooksCount > 1
                    ? _('Search in {{count}} Book(s)...', {
                        count: currentBooksCount,
                      })
                    : _('Search Books...')
              }
              onChange={handleSearchChange}
              spellCheck='false'
              className={clsx(
                'search-input paper-field h-9 w-full pe-10 ps-11',
                'truncate text-sm',
              )}
            />
            {searchQuery && (
              <button
                type='button'
                onClick={() => onSearchQueryChange('')}
                className={clsx(
                  'text-mutedink hover:text-ink absolute inset-y-0 z-10 flex items-center',
                  searchTarget === 'text' ? 'end-10' : 'end-2',
                )}
                aria-label={_('Clear Search')}
              >
                <IoMdCloseCircle className='h-4 w-4' />
              </button>
            )}
            {searchTarget === 'text' && (
              <div
                className={clsx(
                  'not-eink:bg-paperlight/70 not-eink:hover:bg-paperlight not-eink:transition-colors',
                  'absolute end-0 flex h-full w-9 items-center justify-center rounded-e-full duration-150',
                )}
              >
                <Dropdown
                  label={_('Search Options')}
                  className='dropdown-bottom dropdown-end'
                  menuClassName='no-triangle mt-1'
                  buttonClassName={clsx(
                    'chrome-ghost h-full min-h-0 w-9 rounded-none rounded-e-full p-0',
                    '!bg-transparent hover:!bg-transparent',
                  )}
                  toggleButton={
                    <FaChevronDown role='none' className='text-mutedink h-3 w-3' />
                  }
                >
                  <LibrarySearchOptionsMenu
                    config={searchConfig}
                    onConfigChange={onSearchConfigChange}
                  />
                </Dropdown>
              </div>
            )}
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-x-2 pe-4 sm:gap-x-4'>
          {searchTarget !== 'text' && (
            <>
              <Dropdown
                label={_('Import Books')}
                className={clsx(
                  'exclude-title-bar-mousedown dropdown-bottom dropdown-end cursor-pointer',
                )}
                buttonClassName='p-0 min-h-0 flex touch-target items-center justify-center !bg-transparent'
                toggleButton={
                  <span className='stamp-btn flex items-center gap-1' role='none'>
                    {_('+ Add Book')}
                  </span>
                }
              >
                <ImportMenu
                  onImportBooksFromFiles={onImportBooksFromFiles}
                  onImportBooksFromDirectory={onImportBooksFromDirectory}
                  onImportBookFromUrl={onImportBookFromUrl}
                  onImportBookFromNovelUrl={onImportBookFromNovelUrl}
                  onOpenCatalogManager={onOpenCatalogManager}
                  onOpenFeeds={onOpenFeeds}
                />
              </Dropdown>
              {isMobile ? null : (
                <button
                  onClick={onToggleSelectMode}
                  aria-label={_('Select Books')}
                  title={_('Select Books')}
                  className='h-6'
                >
                  {isSelectMode ? (
                    <PiSelectionAllFill role='button' className='text-mutedink h-6 w-6' />
                  ) : (
                    <PiSelectionAll role='button' className='text-mutedink h-6 w-6' />
                  )}
                </button>
              )}
            </>
          )}
        </div>
        {isSelectMode ? (
          <div
            className={clsx(
              'flex h-full items-center',
              'w-max-[72px] w-min-[72px] sm:w-max-[80px] sm:w-min-[80px]',
            )}
          >
            <button
              onClick={isSelectAll ? onDeselectAll : onSelectAll}
              className='chrome-ghost text-ink/85 h-8 min-h-8 w-[72px] p-0 sm:w-[80px]'
              aria-label={isSelectAll ? _('Deselect') : _('Select All')}
            >
              <span className='font-sans text-base font-normal sm:text-sm whitespace-nowrap truncate'>
                {isSelectAll ? _('Deselect') : _('Select All')}
              </span>
            </button>
          </div>
        ) : (
          <div className='flex h-full items-center gap-x-2 sm:gap-x-4'>
            <Dropdown
              label={_('Settings Menu')}
              className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
              buttonClassName='chrome-ghost h-8 min-h-8 w-8 p-0'
              toggleButton={<MdOutlineMenu role='none' size={18} />}
            >
              <SettingsMenu onPullLibrary={onPullLibrary} />
            </Dropdown>
            {appService?.hasWindowBar && (
              <WindowButtons
                headerRef={headerRef}
                showMinimize={windowButtonVisible}
                showMaximize={windowButtonVisible}
                showClose={windowButtonVisible}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LibraryHeader;
