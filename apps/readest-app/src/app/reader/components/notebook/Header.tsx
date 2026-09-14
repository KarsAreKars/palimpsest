import clsx from 'clsx';
import React from 'react';

import { FiSearch } from 'react-icons/fi';
import { RiQuillPenLine } from 'react-icons/ri';
import { MdArrowBackIosNew, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const NotebookHeader: React.FC<{
  isPinned: boolean;
  isSearchBarVisible: boolean;
  handleClose: () => void;
  handleTogglePin: () => void;
  handleToggleSearchBar: () => void;
  showSearchButton?: boolean;
}> = ({
  isPinned,
  isSearchBarVisible,
  handleClose,
  handleTogglePin,
  handleToggleSearchBar,
  showSearchButton = true,
}) => {
  const _ = useTranslation();
  const iconSize15 = useResponsiveSize(15);
  const iconSize18 = useResponsiveSize(18);
  return (
    <div className='notebook-header relative flex h-11 items-center px-3' dir='ltr'>
      <div className='absolute inset-0 z-[-1] flex items-center justify-center space-x-2'>
        <RiQuillPenLine size={iconSize18} />
        <div className='notebook-title hidden text-sm font-medium sm:flex'>{_('Notebook')}</div>
      </div>
      <div className='flex w-full items-center gap-x-4'>
        <button
          title={isPinned ? _('Unpin Notebook') : _('Pin Notebook')}
          onClick={handleTogglePin}
          className={clsx(
            'hidden h-6 min-h-6 w-6 items-center justify-center rounded-full sm:flex',
            'focus-visible:outline-offset-2 focus-visible:outline-stamp focus-visible:outline-2',
            isPinned ? 'bg-[rgba(38,34,27,0.12)]' : 'bg-[rgba(38,34,27,0.06)]',
          )}
        >
          {isPinned ? <MdPushPin size={iconSize15} /> : <MdOutlinePushPin size={iconSize15} />}
        </button>
        <button
          title={_('Close')}
          onClick={handleClose}
          className={'flex h-6 min-h-6 w-6 items-center justify-center rounded-full sm:hidden'}
        >
          <MdArrowBackIosNew />
        </button>
      </div>
      {showSearchButton && (
        <div className='flex items-center justify-end gap-x-4'>
          <button
            title={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
            onClick={handleToggleSearchBar}
            className={clsx(
              'flex h-8 min-h-8 w-8 items-center justify-center p-0',
              'focus-visible:outline-offset-2 focus-visible:outline-stamp focus-visible:outline-2',
              isSearchBarVisible && 'bg-[rgba(38,34,27,0.12)]',
            )}
          >
            <FiSearch size={iconSize18} />
          </button>
        </div>
      )}
    </div>
  );
};

export default NotebookHeader;
