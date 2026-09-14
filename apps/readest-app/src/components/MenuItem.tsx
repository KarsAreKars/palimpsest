import clsx from 'clsx';
import React from 'react';
import { IconType } from 'react-icons';
import { MdCheck } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface MenuItemProps {
  label: string;
  toggled?: boolean;
  description?: string;
  tooltip?: string;
  buttonClass?: string;
  labelClass?: string;
  shortcut?: string;
  disabled?: boolean;
  noIcon?: boolean;
  transient?: boolean;
  Icon?: React.ReactNode | IconType;
  iconClassName?: string;
  children?: React.ReactNode;
  siblings?: React.ReactNode;
  detailsOpen?: boolean;
  onClick?: () => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  label,
  toggled,
  description,
  tooltip,
  buttonClass,
  labelClass,
  shortcut,
  disabled,
  noIcon = false,
  transient = false,
  Icon,
  iconClassName,
  children,
  siblings,
  detailsOpen = false,
  onClick,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(16);
  const [isDetailsOpen, setIsDetailsOpen] = React.useState(detailsOpen);
  const IconType = Icon || (toggled !== undefined ? (toggled ? MdCheck : undefined) : undefined);

  const handleClick = () => {
    onClick?.();
    if (transient) {
      setIsDropdownOpen?.(false);
    }
  };

  const buttonContent = (
    <>
      <div className='flex w-full items-center justify-between'>
        <div className='flex min-w-0 items-center'>
          {!noIcon && (
            <span style={{ minWidth: `${iconSize}px` }}>
              {typeof IconType === 'function' ? (
                <IconType
                  className={clsx(disabled ? 'text-faint' : 'text-ink', iconClassName)}
                  size={iconSize}
                />
              ) : (
                IconType
              )}
            </span>
          )}
          <span
            className={clsx(
              'mx-2 flex-1 break-words text-pretty text-start text-base sm:text-sm',
              labelClass,
            )}
            style={{ minWidth: 0 }}
          >
            {label}
          </span>
        </div>
        {shortcut && (
          <kbd
            className={clsx(
              'border-ink/25 bg-paperlight hidden rounded-[2px] border sm:flex',
              'shrink-0 px-1.5 py-0.5 text-xs font-medium',
              disabled ? 'text-faint' : 'text-mutedink',
            )}
          >
            {shortcut}
          </kbd>
        )}
      </div>
      <div className='flex w-full'>
        {description && (
          <span
            className='text-mutedink mt-1 truncate text-start text-xs'
            style={{ minWidth: 0, paddingInlineStart: noIcon ? '0' : `${iconSize + 8}px` }}
          >
            {description}
          </span>
        )}
      </div>
    </>
  );

  if (children) {
    return (
      <ul className='m-0 p-0'>
        <li aria-label={label}>
          <details open={detailsOpen} onToggle={(e) => setIsDetailsOpen(e.currentTarget.open)}>
            <summary
              role='button'
              tabIndex={0}
              aria-expanded={isDetailsOpen}
              className={clsx(
                'hover:bg-paperlight text-ink cursor-pointer rounded-[2px] p-1 py-[10px] pr-3',
                disabled && 'pointer-events-none cursor-not-allowed text-faint',
                buttonClass,
              )}
              title={tooltip ? tooltip : ''}
            >
              {buttonContent}
            </summary>
            {children}
          </details>
        </li>
      </ul>
    );
  }

  return (
    <div className='flex'>
      <button
        role={disabled ? 'none' : 'menuitem'}
        aria-label={
          toggled !== undefined ? `${label} - ${toggled ? _('ON') : _('OFF')}` : undefined
        }
        aria-live={toggled === undefined ? 'polite' : 'off'}
        tabIndex={disabled ? -1 : 0}
        className={clsx(
          'hover:bg-paperlight text-ink flex w-full flex-col items-center justify-center rounded-[2px] p-1 py-[10px]',
          disabled && 'pointer-events-none text-faint',
          buttonClass,
        )}
        title={tooltip ? tooltip : ''}
        onClick={handleClick}
        disabled={disabled}
      >
        {buttonContent}
      </button>
      {siblings}
    </div>
  );
};

export default MenuItem;
