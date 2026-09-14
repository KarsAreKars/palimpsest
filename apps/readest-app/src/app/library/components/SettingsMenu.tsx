import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { PiGear } from 'react-icons/pi';

import { isTauriAppPlatform } from '@/services/environment';
import { setBackupDialogVisible } from '@/app/library/components/BackupWindow';
import { setCacheManagerDialogVisible } from '@/app/library/components/CacheManagerWindow';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { tauriHandleSetAlwaysOnTop, tauriHandleToggleFullScreen } from '@/utils/window';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import { setMigrateDataDirDialogVisible } from '@/app/library/components/MigrateDataWindow';
import { requestStoragePermission } from '@/utils/permission';
import { saveSysSettings } from '@/helpers/settings';
import {
  getBiometricStatus,
  getBiometryLabelKey,
  isBiometricSupported,
} from '@/services/biometric';
import { selectDirectory } from '@/utils/bridge';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import { type AppLockDialogMode, useAppLockStore } from '@/store/appLockStore';

interface SettingsMenuProps {
  onPullLibrary: (fullRefresh?: boolean, verbose?: boolean) => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({ onPullLibrary, setIsDropdownOpen }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettingsDialogOpen } = useSettingsStore();
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(settings.alwaysOnTop);
  const [isAlwaysShowStatusBar, setIsAlwaysShowStatusBar] = useState(settings.alwaysShowStatusBar);
  const [isOpenLastBooks, setIsOpenLastBooks] = useState(settings.openLastBooks);
  const [isAutoImportBooksOnOpen, setIsAutoImportBooksOnOpen] = useState(
    settings.autoImportBooksOnOpen,
  );
  const [savedBookCoverForLockScreen, setSavedBookCoverForLockScreen] = useState(
    settings.savedBookCoverForLockScreen || '',
  );
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [refreshMetadataProgress, setRefreshMetadataProgress] = useState('');
  const { openDialog: openAppLockDialogInStore } = useAppLockStore();
  const isPinEnabled = !!settings.pinCodeEnabled;
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometryLabelKey, setBiometryLabelKey] = useState('');
  const showBiometricToggle = !!appService?.isMobileApp && isPinEnabled && biometricAvailable;

  useEffect(() => {
    if (!isBiometricSupported(appService) || !isPinEnabled) return;
    let cancelled = false;
    void getBiometricStatus().then(({ available, biometryType }) => {
      if (cancelled) return;
      setBiometricAvailable(available);
      setBiometryLabelKey(getBiometryLabelKey(biometryType));
    });
    return () => {
      cancelled = true;
    };
  }, [appService, isPinEnabled]);

  const toggleBiometricUnlock = () => {
    void saveSysSettings(envConfig, 'biometricUnlockEnabled', !settings.biometricUnlockEnabled);
  };

  const openAppLockDialog = (mode: AppLockDialogMode) => {
    openAppLockDialogInStore(mode);
    setIsDropdownOpen?.(false);
  };
  const { setLibrary } = useLibraryStore();

  const showAboutReadest = () => {
    setAboutDialogVisible(true);
    setIsDropdownOpen?.(false);
  };

  const handleFullScreen = () => {
    tauriHandleToggleFullScreen();
    setIsDropdownOpen?.(false);
  };

  const toggleOpenInNewWindow = () => {
    saveSysSettings(envConfig, 'openBookInNewWindow', !settings.openBookInNewWindow);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysOnTop = () => {
    const newValue = !settings.alwaysOnTop;
    saveSysSettings(envConfig, 'alwaysOnTop', newValue);
    setIsAlwaysOnTop(newValue);
    tauriHandleSetAlwaysOnTop(newValue);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysShowStatusBar = () => {
    const newValue = !settings.alwaysShowStatusBar;
    saveSysSettings(envConfig, 'alwaysShowStatusBar', newValue);
    setIsAlwaysShowStatusBar(newValue);
  };

  const toggleAutoImportBooksOnOpen = () => {
    const newValue = !settings.autoImportBooksOnOpen;
    saveSysSettings(envConfig, 'autoImportBooksOnOpen', newValue);
    setIsAutoImportBooksOnOpen(newValue);
  };

  const toggleOpenLastBooks = () => {
    const newValue = !settings.openLastBooks;
    saveSysSettings(envConfig, 'openLastBooks', newValue);
    setIsOpenLastBooks(newValue);
  };

  const handleSetRootDir = () => {
    setMigrateDataDirDialogVisible(true);
    setIsDropdownOpen?.(false);
  };

  const handleBackupRestore = () => {
    setIsDropdownOpen?.(false);
    setBackupDialogVisible(true);
  };

  const handleManageCache = () => {
    setIsDropdownOpen?.(false);
    setCacheManagerDialogVisible(true);
  };

  const handleRefreshMetadata = async () => {
    if (!appService || isRefreshingMetadata) return;
    setIsRefreshingMetadata(true);
    setRefreshMetadataProgress(_('Loading library...'));
    try {
      const books = await appService.loadLibraryBooks();
      const activeBooks = books.filter((b) => !b.deletedAt);
      let refreshed = 0;
      for (let i = 0; i < activeBooks.length; i++) {
        setRefreshMetadataProgress(`${i + 1} / ${activeBooks.length}`);
        try {
          if (await appService.refreshBookMetadata(activeBooks[i]!)) {
            refreshed++;
          }
        } catch {
          // Skip books whose files can't be opened
        }
      }
      setLibrary(books);
      await appService.saveLibraryBooks(books);
      setRefreshMetadataProgress(_('{{count}} books refreshed', { count: refreshed }));
      onPullLibrary(true);
      setTimeout(() => {
        setIsRefreshingMetadata(false);
        setRefreshMetadataProgress('');
      }, 2000);
    } catch (error) {
      console.error('Failed to refresh metadata:', error);
      setRefreshMetadataProgress(_('Failed to refresh metadata'));
      setTimeout(() => {
        setIsRefreshingMetadata(false);
        setRefreshMetadataProgress('');
      }, 2000);
    }
  };

  const openSettingsDialog = () => {
    setIsDropdownOpen?.(false);
    setSettingsDialogOpen(true);
  };

  const handleSetSavedBookCoverForLockScreen = async () => {
    if (!(await requestStoragePermission())) return;

    const newValue = settings.savedBookCoverForLockScreen ? '' : 'default';
    if (newValue) {
      const response = await selectDirectory();
      if (response.path) {
        saveSysSettings(envConfig, 'savedBookCoverForLockScreenPath', response.path);
      }
    }
    saveSysSettings(envConfig, 'savedBookCoverForLockScreen', newValue);
    setSavedBookCoverForLockScreen(newValue);
  };

  // Librarian copy: the note names the behaviour, never the raw filename.
  const savedBookCoverDescription = _('The last cover is kept on this device.');

  return (
    <Menu
      className={clsx(
        'settings-menu dropdown-content no-triangle',
        'z-20 mt-2 max-w-[90vw]',
      )}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {isTauriAppPlatform() && (
        <MenuItem
          label={_('Auto Import on File Open')}
          toggled={isAutoImportBooksOnOpen}
          onClick={toggleAutoImportBooksOnOpen}
        />
      )}
      {isTauriAppPlatform() && (
        <MenuItem
          label={_('Open Last Book on Start')}
          toggled={isOpenLastBooks}
          onClick={toggleOpenLastBooks}
        />
      )}
      <hr aria-hidden='true' className='border-ink/15 my-1' />
      {appService?.hasWindow && (
        <MenuItem
          label={_('Open Book in New Window')}
          toggled={settings.openBookInNewWindow}
          onClick={toggleOpenInNewWindow}
        />
      )}
      {appService?.hasWindow && <MenuItem label={_('Fullscreen')} onClick={handleFullScreen} />}
      {appService?.hasWindow && (
        <MenuItem label={_('Always on Top')} toggled={isAlwaysOnTop} onClick={toggleAlwaysOnTop} />
      )}
      {appService?.isMobileApp && (
        <MenuItem
          label={_('Always Show Status Bar')}
          toggled={isAlwaysShowStatusBar}
          onClick={toggleAlwaysShowStatusBar}
        />
      )}
      {/* Paper only: the dark palette was removed — no theme toggle. */}
      <MenuItem label={_('Settings')} Icon={PiGear} onClick={openSettingsDialog} />
      <hr aria-hidden='true' className='border-ink/15 my-1' />
      <MenuItem label={_('Advanced Settings')}>
        <ul className='ms-0 flex flex-col ps-0 before:hidden'>
          <MenuItem label={_('Backup & Restore')} onClick={handleBackupRestore} />
          {appService?.canCustomizeRootDir && (
            <MenuItem label={_('Change Data Location')} onClick={handleSetRootDir} />
          )}
          <MenuItem
            label={_('Refresh Metadata')}
            description={refreshMetadataProgress}
            onClick={handleRefreshMetadata}
            disabled={isRefreshingMetadata}
          />
          {appService?.isMobileApp && (
            <MenuItem label={_('Manage Cache')} onClick={handleManageCache} />
          )}
          {!isPinEnabled && (
            <MenuItem
              label={_('Set PIN…')}
              tooltip={
                appService?.isMobileApp
                  ? _('Require a PIN (and biometrics, if available) to open Readest')
                  : _('Require a 4-digit PIN to open Readest')
              }
              onClick={() => openAppLockDialog('set')}
            />
          )}
          {isPinEnabled && (
            <MenuItem label={_('Change PIN…')} onClick={() => openAppLockDialog('change')} />
          )}
          {isPinEnabled && (
            <MenuItem label={_('Disable PIN…')} onClick={() => openAppLockDialog('disable')} />
          )}
          {showBiometricToggle && (
            <MenuItem
              label={_('Unlock with {{biometry}}', { biometry: _(biometryLabelKey) })}
              toggled={!!settings.biometricUnlockEnabled}
              onClick={toggleBiometricUnlock}
            />
          )}
          {appService?.isAndroidApp && (
            <MenuItem
              label={_('Save Book Cover')}
              tooltip={_('Auto-save last book cover')}
              description={savedBookCoverForLockScreen ? savedBookCoverDescription : ''}
              toggled={!!savedBookCoverForLockScreen}
              onClick={handleSetSavedBookCoverForLockScreen}
            />
          )}
        </ul>
      </MenuItem>
      <hr aria-hidden='true' className='border-ink/15 my-1' />
      <MenuItem label={_('About Readest')} onClick={showAboutReadest} />
    </Menu>
  );
};

export default SettingsMenu;
