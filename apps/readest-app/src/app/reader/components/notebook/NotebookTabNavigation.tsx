import clsx from 'clsx';
import React from 'react';
import { PiNotePencil, PiRobot, PiGraduationCap, PiBooks } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
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
  const { settings } = useSettingsStore();
  const aiEnabled = settings?.aiSettings?.enabled ?? false;

  // Study is always available: the review queue and notes.md exist even
  // before any AI provider is configured (echo-tutor exchanges log too).
  const tabs: NotebookTab[] = aiEnabled ? ['spine', 'notes', 'ai', 'study'] : ['spine', 'study'];

  const getTabLabel = (tab: NotebookTab) => {
    switch (tab) {
      case 'spine':
        return _('Spine');
      case 'notes':
        return _('Notes');
      case 'ai':
        return _('AI');
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
      case 'ai':
        return <PiRobot className='mx-auto' size={20} />;
      case 'study':
        return <PiGraduationCap className='mx-auto' size={20} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200/20 flex min-h-[52px] w-full border-t',
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
            'm-1.5 flex-1 cursor-pointer rounded-lg p-2 transition-colors duration-200',
            activeTab === tab && 'bg-base-300/85',
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
          <div className='m-0 flex h-6 items-center p-0'>{getTabIcon(tab)}</div>
        </div>
      ))}
    </div>
  );
};

export default NotebookTabNavigation;
