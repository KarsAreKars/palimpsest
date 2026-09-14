import * as React from 'react';
import clsx from 'clsx';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { navigateToLogin } from '@/utils/nav';

interface LibraryEmptyStateProps {
  onImport: (anchor: HTMLElement) => void;
}

const LibraryEmptyState: React.FC<LibraryEmptyStateProps> = ({ onImport }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const router = useAppRouter();
  const isMobile = appService?.isMobile ?? false;

  return (
    <div className='text-center'>
      <div className='flex max-w-md flex-col items-center'>
        <span className='ornament mb-6' aria-hidden='true'>
          ✳
        </span>
        <h1 className='plate-title mb-3 text-2xl'>{_('The shelf awaits its first volume')}</h1>
        <p className='plate-meta mb-12 text-pretty leading-relaxed'>
          {isMobile
            ? _('Pick a book from your device to add it to the catalogue.')
            : _('Drop a book anywhere on this window, or pick one from your computer.')}
        </p>
        <div className='flex w-full max-w-xs flex-col gap-3'>
          <button
            type='button'
            aria-haspopup='menu'
            className='stamp-btn h-11 min-h-11 rounded-[2px]'
            onClick={(event) => onImport(event.currentTarget)}
          >
            {_('Import Books')}
          </button>
          {/* TODO: add a 'Browse free catalogs' secondary action that opens the
              OPDS dialog (handleShowOPDSDialog) once we settle on placement. */}
          {!user && (
            <button
              type='button'
              className={clsx(
                'text-ink/70 hover:text-ink mt-1 py-2 text-sm font-medium',
                'underline underline-offset-4',
                'focus-visible:text-ink focus-visible:outline-none',
              )}
              onClick={() => navigateToLogin(router)}
            >
              {_('Sign in to sync your library')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LibraryEmptyState;
