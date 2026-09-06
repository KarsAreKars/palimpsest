import React from 'react';
import clsx from 'clsx';

/**
 * StampButton — every action is typed. Primary = rubber-stamp outline in
 * stamp red (the ONLY accent, never decoration). `ink` = filled ink button
 * (the one allowed fill). Never rounded.
 */
interface StampButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'stamp' | 'ink';
}

const StampButton: React.FC<StampButtonProps> = ({
  variant = 'stamp',
  className,
  children,
  ...rest
}) => (
  <button className={clsx(variant === 'stamp' ? 'stamp-btn' : 'ink-btn', className)} {...rest}>
    {children}
  </button>
);

export default StampButton;
