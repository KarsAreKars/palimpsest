import React, { useEffect, useRef } from 'react';
import { LuLampDesk } from 'react-icons/lu';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useDeskStore } from '@/store/deskStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface DeskTogglerProps {
  bookKey: string;
}

const DeskToggler: React.FC<DeskTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isDeskVisible, toggleDesk, setDeskVisible } = useDeskStore();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const iconSize18 = useResponsiveSize(18);

  useEffect(() => {
    useDeskStore.getState().setToggleElement(buttonRef.current);
    return () => useDeskStore.getState().setToggleElement(null);
  }, []);

  const handleToggleDesk = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    if (sideBarBookKey === bookKey) {
      toggleDesk();
    } else {
      setSideBarBookKey(bookKey);
      if (!isDeskVisible) setDeskVisible(true);
    }
  };

  const isActive = sideBarBookKey === bookKey && isDeskVisible;

  return (
    <span ref={buttonRef} className='contents'>
      <Button
        icon={<LuLampDesk size={iconSize18} className={isActive ? 'text-stamp' : 'text-ink'} />}
        onClick={handleToggleDesk}
        label={isActive ? _('Close the Desk') : _('Open the Desk')}
      />
    </span>
  );
};

export default DeskToggler;
