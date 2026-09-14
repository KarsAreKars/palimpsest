import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { checkForAppUpdates, checkAppReleaseNotes } from '@/helpers/updater';
import { parseWebViewInfo } from '@/utils/ua';
import { getAppVersion } from '@/utils/version';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import SupportLinks from './SupportLinks';
import LegalLinks from './LegalLinks';
import Dialog from './Dialog';
import Link from './Link';

export const setAboutDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('about_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

type UpdateStatus = 'checking' | 'updating' | 'updated' | 'error';

export const AboutWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [browserInfo, setBrowserInfo] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setBrowserInfo(parseWebViewInfo(appService));

    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('about_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const hasUpdate = await checkForAppUpdates(_, false, settings.updateChannel);
      if (hasUpdate) {
        handleClose();
      } else {
        setUpdateStatus('updated');
      }
    } catch (error) {
      console.info('Error checking for updates:', error);
      setUpdateStatus('error');
    }
  };

  const handleShowRecentUpdates = async () => {
    const hasNotes = await checkAppReleaseNotes(false);
    if (hasNotes) {
      handleClose();
    } else {
      setUpdateStatus('error');
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setUpdateStatus(null);
  };

  const versionInfo = `${_('Version {{version}}', { version: getAppVersion() })} (${browserInfo})`;

  // Mobile users can't select the version string to paste it into a bug
  // report, so the label itself copies it.
  const handleCopyVersion = async () => {
    const copied = await writeTextToClipboard(versionInfo);
    if (!copied) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to clipboard'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });
  };

  return (
    <Dialog
      id='about_window'
      isOpen={isOpen}
      title={_('About Palimpsest')}
      onClose={handleClose}
      boxClassName='sm:!w-[480px] sm:!max-w-screen-sm sm:h-auto'
    >
      {isOpen && (
        <div className='about-content flex flex-col items-center justify-center gap-4 pb-10 sm:pb-0'>
          <div className='flex flex-1 flex-col items-center justify-end gap-2 px-8 py-2'>
            <div className='mb-2 mt-6'>
              <Image src='/icon.png' alt='App Logo' className='h-20 w-20' width={64} height={64} />
            </div>
            <div className='flex select-text flex-col items-center'>
              <h2 className='display-title mb-2 text-2xl font-bold'>{_('Palimpsest')}</h2>
              <button
                type='button'
                title={_('Copy')}
                className='text-mutedink text-center text-sm'
                onClick={handleCopyVersion}
              >
                {versionInfo}
              </button>
            </div>
            <div className='my-1 h-5'>
              {!updateStatus && (
                <button
                  className='stamp-btn cursor-pointer p-1 text-xs'
                  onClick={appService?.hasUpdater ? handleCheckUpdate : handleShowRecentUpdates}
                >
                  {_('Check Update')}
                </button>
              )}
              {updateStatus === 'updated' && (
                <p className='text-mutedink mt-2 text-xs'>{_('Already the latest version')}</p>
              )}
              {updateStatus === 'checking' && (
                <p className='text-mutedink mt-2 text-xs'>{_('Checking for updates...')}</p>
              )}
              {updateStatus === 'error' && (
                <p className='text-stamp mt-2 text-xs'>{_('Error checking for updates')}</p>
              )}
            </div>
          </div>

          <hr
            aria-hidden='true'
            className='my-12 w-full sm:my-4'
            style={{
              border: 'none',
              borderTop: '1px solid color-mix(in srgb, var(--ink) 25%, transparent)',
            }}
          />

          <div
            className='flex flex-1 flex-col items-center justify-start gap-2 px-4 text-center'
            dir='ltr'
          >
            <p className='text-mutedink text-sm'>
              {_('© {{year}} Bilingify LLC. All rights reserved.', {
                year: new Date().getFullYear(),
              })}
            </p>

            <p className='text-mutedink text-xs'>
              {_('This software is licensed under the')}{' '}
              <Link
                href='https://www.gnu.org/licenses/agpl-3.0.html'
                className='text-stamp underline'
              >
                {_('GNU Affero General Public License v3.0')}
              </Link>
              .{' '}
              {_(
                'You are free to use, modify, and distribute this software under the terms of the AGPL v3 license. Please see the license for more details.',
              )}
            </p>
            <p className='text-mutedink text-xs'>
              {_('Source code is available at')}{' '}
              <Link href='https://github.com/readest/readest' className='text-stamp underline'>
                {_('GitHub')}
              </Link>
              .
            </p>

            <LegalLinks />
          </div>
          <SupportLinks />
        </div>
      )}
    </Dialog>
  );
};
