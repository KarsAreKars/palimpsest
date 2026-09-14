import clsx from 'clsx';
import React from 'react';
import { MdBookmarkBorder } from 'react-icons/md';
import { IoIosList } from 'react-icons/io';
import { PiNotePencil } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isForcedMobileLayout } from '../../utils/mobileLayout';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const forceMobileLayout = isForcedMobileLayout(appService?.isMobile);
  const isMobile = forceMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;
  // The chat 'history' tab died with the notebook AI tab (2026-09-06):
  // the Prof owns ask-the-book; its record lives in the margin + Study tab.
  const tabs = ['toc', 'annotations', 'bookmarks'];

  const getTabLabel = (tab: string) => {
    switch (tab) {
      case 'toc':
        return _('TOC');
      case 'annotations':
        return _('Annotate');
      case 'bookmarks':
        return _('Bookmark');
      default:
        return '';
    }
  };

  return (
    <div
      className={clsx(
        'bottom-tab flex min-h-[52px] w-full border-t border-[rgba(38,34,27,0.14)] bg-[rgba(38,34,27,0.05)]',
        appService?.hasRoundedWindow && 'rounded-window-bottom-left',
        isMobile && 'h-[65px]',
      )}
      dir='ltr'
    >
      {tabs.map((tab) => (
        <div
          key={tab}
          tabIndex={0}
          role='button'
          className={clsx(
            'relative m-1.5 flex-1 cursor-pointer rounded-[2px] p-2 transition-colors duration-200',
            activeTab === tab && 'bg-[rgba(38,34,27,0.07)]',
          )}
          onClick={() => onTabChange(tab)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTabChange(tab);
            }
          }}
          title={getTabLabel(tab)}
          aria-label={getTabLabel(tab)}
        >
          {/* the stamp mark: a 2px underline on the active tab */}
          {activeTab === tab && (
            <span className='bg-stamp absolute inset-x-4 top-0.5 h-[2px]' />
          )}
          <div className={clsx('flex h-6 items-center p-0', isMobile ? 'm-0.5' : 'm-0')}>
            <span className={clsx('mx-auto', activeTab === tab && 'text-stamp')}>
              {tab === 'toc' ? (
                <IoIosList />
              ) : tab === 'annotations' ? (
                <PiNotePencil />
              ) : (
                <MdBookmarkBorder />
              )}
            </span>
          </div>
          <div
            className={clsx(
              'typed text-center text-[7.5px] tracking-wider',
              activeTab === tab ? 'text-stamp' : 'text-mutedink',
            )}
          >
            {getTabLabel(tab).toUpperCase()}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TabNavigation;
