import React, { forwardRef } from 'react';
import clsx from 'clsx';

/**
 * PaperField — the only input shape: a fully rounded pill, paperLight fill,
 * 1px ink border, stamp-red focus ring. Placeholder is typed.
 */
interface PaperFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const PaperField = forwardRef<HTMLInputElement, PaperFieldProps>(({ className, ...rest }, ref) => (
  <input ref={ref} className={clsx('paper-field', className)} {...rest} />
));
PaperField.displayName = 'PaperField';

export default PaperField;
