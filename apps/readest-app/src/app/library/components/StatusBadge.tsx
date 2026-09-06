import clsx from 'clsx';
import type { ReadingStatus } from '@/types/book';

interface StatusBadgeProps {
  status?: ReadingStatus;
  children: React.ReactNode;
  className?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, children, className }) => {
  if (status !== 'finished' && status !== 'unread' && status !== 'abandoned') return null;

  return (
    <span
      className={clsx(
        'typed inline-flex h-4 items-center justify-center px-1',
        'text-[8.5px] leading-none',
        // Apothecary: stamps, not pills. FINISHED earns the stamp red
        // (the accent's sanctioned use: stamps/seals); the rest are ink
        // hairline outlines.
        status === 'finished' && 'border-[1.25px] border-stamp text-stamp',
        status === 'unread' && 'border border-ink text-ink',
        status === 'abandoned' && 'border border-mutedink text-mutedink',
        className,
      )}
      role='status'
    >
      <span className='relative top-[0.5px]'>{children}</span>
    </span>
  );
};

export default StatusBadge;
