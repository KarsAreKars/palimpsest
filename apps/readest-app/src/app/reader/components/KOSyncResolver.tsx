import clsx from 'clsx';
import React from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { SectionTitle } from '@/components/settings/primitives';
import { SyncDetails } from '../hooks/useKOSync';

interface KOSyncConflictResolverProps {
  details: SyncDetails | null;
  onResolveWithLocal: () => void;
  onResolveWithRemote: () => void;
  onClose: () => void;
}

const KOSyncConflictResolver: React.FC<KOSyncConflictResolverProps> = ({
  details,
  onResolveWithLocal,
  onResolveWithRemote,
  onClose,
}) => {
  const _ = useTranslation();

  if (!details) return null;

  const remoteDeviceName = details.remote.device || _('another device');

  return (
    <Dialog isOpen={true} onClose={onClose} title={_('Sync Conflict')}>
      <p className='text-ink/70 mb-5 mt-1 px-1 text-center text-sm leading-relaxed'>
        {_('Reading progress on this device differs from "{{deviceName}}".', {
          deviceName: remoteDeviceName,
        })}
      </p>
      <div className='flex flex-col gap-2.5'>
        <button
          type='button'
          onClick={onResolveWithLocal}
          className={clsx(
            'eink-bordered group',
            'flex w-full items-start gap-3 rounded-[2px] text-left',
            'border-ink/15 bg-paper border px-4 py-3.5',
            'transition-colors duration-150',
            'hover:border-ink/20 hover:bg-paperlight/60',
            'active:bg-paperlight/80',
            'focus-visible:ring-stamp/15 focus-visible:outline-none focus-visible:ring-2',
          )}
        >
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            {/* SectionTitle gives the caseless-language size bump for free.
                `as='span'` because this lives inside a button, not as a
                document heading; opacity override expresses the
                "secondary on this surface" relationship. */}
            <SectionTitle as='span' className='!text-ink/55 !ps-0'>
              {_('This device')}
            </SectionTitle>
            <span className='line-clamp-2 text-sm font-medium leading-snug'>
              {details.local.preview}
            </span>
          </div>
        </button>
        <button
          type='button'
          onClick={onResolveWithRemote}
          className={clsx(
            'bg-stamp text-paperlight group',
            'h-auto min-h-0 w-full justify-start gap-3',
            'rounded-[2px] border-0 px-4 py-3.5 text-left font-normal normal-case',
            'transition-colors duration-150 hover:bg-stamp/90',
            'focus-visible:ring-stamp/40 focus-visible:outline-none focus-visible:ring-2',
          )}
        >
          <div className='flex min-w-0 flex-1 flex-col items-start gap-1'>
            {/* On the primary-color button background the default
                /65 token would clash; opacity-75 inherits the button's
                contrast color and dims it uniformly. */}
            <SectionTitle as='span' className='!ps-0 !text-current opacity-75'>
              {remoteDeviceName}
            </SectionTitle>
            <span className='line-clamp-2 text-sm font-medium leading-snug'>
              {details.remote.preview}
            </span>
          </div>
        </button>
      </div>
    </Dialog>
  );
};

export default KOSyncConflictResolver;
