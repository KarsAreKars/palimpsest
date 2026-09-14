import clsx from 'clsx';
import React, { useRef } from 'react';
import { FiSearch } from 'react-icons/fi';
import { MdOutlineMenu, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { MdArrowBackIosNew } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Dropdown from '@/components/Dropdown';
import BookMenu from './BookMenu';
import SidebarToggler from '../SidebarToggler';

const SidebarHeader: React.FC<{
  bookKey: string;
  isPinned: boolean;
  isSearchBarVisible: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleSearchBar: () => void;
}> = ({ bookKey, isPinned, isSearchBarVisible, onClose, onTogglePin, onToggleSearchBar }) => {
  const _ = useTranslation();
  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const iconSize15 = useResponsiveSize(15);
  const iconSize18 = useResponsiveSize(18);
  const iconSize22 = useResponsiveSize(22);

  return (
    <div
      ref={headerRef}
      className={clsx(
        'sidebar-header flex h-11 items-center justify-between border-b border-[rgba(38,34,27,0.12)] pe-2',
        isTrafficLightVisible ? 'ps-1.5 sm:ps-20' : 'ps-1.5',
      )}
      dir='ltr'
    >
      <div className='flex items-center gap-x-8'>
        <button
          title={_('Close')}
          onClick={onClose}
          className={'chrome-ghost rounded-full flex h-6 min-h-6 w-6 hover:bg-transparent sm:hidden'}
        >
          <MdArrowBackIosNew size={iconSize22} />
        </button>
        <div className='hidden sm:flex'>
          <SidebarToggler bookKey={bookKey} />
        </div>
      </div>
      <div className='flex min-w-24 max-w-32 items-center justify-between sm:size-[70%]'>
        <button
          title={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
          onClick={onToggleSearchBar}
          className={clsx(
            'chrome-ghost left-0 h-8 min-h-8 w-8 p-0',
            isSearchBarVisible ? 'bg-paperlight' : '',
          )}
        >
          <FiSearch size={iconSize18} className='text-ink' />
        </button>
        <Dropdown
          label={_('Book Menu')}
          showTooltip={false}
          className={clsx(
            window.innerWidth < 640 ? 'dropdown-end' : 'dropdown-center',
            'dropdown-bottom',
          )}
          menuClassName={clsx('no-triangle mt-1', window.innerWidth < 640 ? '' : '!relative')}
          buttonClassName='chrome-ghost h-8 min-h-8 w-8 p-0'
          containerClassName='h-8'
          toggleButton={<MdOutlineMenu className='fill-ink' />}
        >
          <BookMenu />
        </Dropdown>
        <div className='right-0 hidden h-8 w-8 items-center justify-center sm:flex'>
          <button
            title={isPinned ? _('Unpin Sidebar') : _('Pin Sidebar')}
            onClick={onTogglePin}
            className={clsx(
              'sidebar-pin-btn chrome-ghost rounded-full hidden h-6 min-h-6 w-6 sm:flex',
              isPinned ? 'bg-paperlight' : 'bg-paperlight/65',
            )}
          >
            {isPinned ? <MdPushPin size={iconSize15} /> : <MdOutlinePushPin size={iconSize15} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SidebarHeader;
