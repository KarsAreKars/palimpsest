import clsx from 'clsx';
import React from 'react';
import { MdErrorOutline, MdInsertDriveFile } from 'react-icons/md';

import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';

export interface FailedImport {
  filename: string;
  errorMessage: string;
}

interface FailedImportsDialogProps {
  failedImports: FailedImport[];
  onClose: () => void;
}

const FailedImportsDialog: React.FC<FailedImportsDialogProps> = ({ failedImports, onClose }) => {
  const _ = useTranslation();

  const uniqueErrors = Array.from(
    new Set(failedImports.map((f) => f.errorMessage).filter(Boolean)),
  );
  const sharedError = uniqueErrors.length === 1 ? uniqueErrors[0] : null;
  const subtitle = sharedError ?? _('Some files could not be added to your library.');

  return (
    <Dialog
      isOpen
      title={_('Failed to import {{count}} books', { count: failedImports.length })}
      onClose={onClose}
      boxClassName='sm:min-w-[440px] sm:max-w-[460px] sm:!h-auto sm:max-h-[80%]'
      contentClassName='!my-0 !px-5 !pt-0 !pb-4 !flex-grow-0'
    >
      <div className='flex flex-col gap-3'>
        <div
          className={clsx(
            'flex items-center gap-3 rounded-[2px]',
            'bg-stamp/8 text-ink border-stamp/15 border px-3.5 py-2.5',
          )}
        >
          <MdErrorOutline className='text-stamp h-5 w-5 flex-shrink-0' aria-hidden='true' />
          <p className='text-[0.85em] leading-snug'>{subtitle}</p>
        </div>

        <ul
          className={clsx(
            'bg-paperlight/40 border-ink/20 flex flex-col rounded-[2px] border',
            'divide-ink/15 divide-y',
          )}
        >
          {failedImports.map((item, index) => (
            <li key={`${item.filename}-${index}`} className='flex items-center gap-2.5 px-3 py-2'>
              <MdInsertDriveFile
                className='text-ink/40 h-4 w-4 flex-shrink-0'
                aria-hidden='true'
              />
              <div className='flex min-w-0 flex-1 flex-col'>
                <span className='break-all text-[0.9em] font-medium leading-snug'>
                  {item.filename}
                </span>
                {!sharedError && item.errorMessage && (
                  <span className='text-ink/55 break-words text-[0.78em] leading-snug'>
                    {item.errorMessage}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className='flex justify-end pt-1'>
          <button
            type='button'
            className='ink-btn chrome-ghost-sm min-w-24 rounded-[2px]'
            onClick={onClose}
          >
            {_('OK')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default FailedImportsDialog;
