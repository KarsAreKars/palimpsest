import clsx from 'clsx';
import React from 'react';
import { PiNotePencil, PiGraduationCap, PiBooks } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { NotebookTab } from '@/store/notebookStore';

interface NotebookTabNavigationProps {
  activeTab: NotebookTab;
  onTabChange: (tab: NotebookTab) => void;
}

const NotebookTabNavigation: React.FC<NotebookTabNavigationProps> = ({
  activeTab,
  onTabChange,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  // The AI chat tab is gone (2026-09-06): the Prof owns ask-the-book, and the
  // assistant-ui runtime crashed the notebook outright. Three learning
  // surfaces, always visible — notes must not hide behind an AI flag again.
  const tabs: NotebookTab[] = ['spine', 'notes', 'study'];

  const getTabLabel = (tab: NotebookTab) => {
    switch (tab) {
      case 'spine':
        return _('Spine');
      case 'notes':
        return _('Notes');
      case 'study':
        return _('Study');
      default:
        return '';
    }
  };

  const getTabIcon = (tab: NotebookTab) => {
    switch (tab) {
      case 'spine':
        return <PiBooks className='mx-auto' size={20} />;
      case 'notes':
        return <PiNotePencil className='mx-auto' size={20} />;
      case 'study':
        return <PiGraduationCap className='mx-auto' size={20} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={clsx(
        'bottom-tab flex min-h-[52px] w-full border-t border-[rgba(38,34,27,0.14)] bg-[rgba(38,34,27,0.05)]',
        appService?.hasRoundedWindow && 'rounded-window-bottom-right',
      )}
      dir='ltr'
    >
      {tabs.map((tab) => (
        <div
          key={tab}
          tabIndex={0}
          role='button'
          className={clsx(
            'relative m-1.5 flex-1 cursor-pointer rounded-sm p-2 transition-colors duration-200',
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
          {activeTab === tab && (
            <span className='bg-stamp absolute inset-x-4 top-0.5 h-[2px] rounded-full' />
          )}
          <div className='m-0 flex h-6 items-center p-0'>
            <span className={clsx('mx-auto', activeTab === tab && 'text-stamp')}>
              {getTabIcon(tab)}
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

export default NotebookTabNavigation;
