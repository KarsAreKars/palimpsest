import React from 'react';
import { TbLayoutSidebar, TbLayoutSidebarFilled } from 'react-icons/tb';

import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface SidebarTogglerProps {
  bookKey: string;
}

const SidebarToggler: React.FC<SidebarTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  const { sideBarBookKey, isSideBarVisible, setSideBarBookKey, toggleSideBar } = useSidebarStore();
  const handleToggleSidebar = () => {
    if (sideBarBookKey === bookKey) {
      toggleSideBar();
    } else {
      setSideBarBookKey(bookKey);
      if (!isSideBarVisible) toggleSideBar();
    }
  };
  return (
    <Button
      icon={
        sideBarBookKey === bookKey && isSideBarVisible ? (
          <TbLayoutSidebarFilled size={iconSize18} className='text-ink' />
        ) : (
          <TbLayoutSidebar size={iconSize18} className='text-ink' />
        )
      }
      onClick={handleToggleSidebar}
      label={_('Toggle Sidebar')}
    />
  );
};

export default SidebarToggler;
