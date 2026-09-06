import React from 'react';
import clsx from 'clsx';

/**
 * TypedLabel — the cream apothecary label. ONE object used everywhere a
 * book is named: library covers, MiniPlayer, Spine cells. paperLight fill,
 * hairline ink border, title in Special Elite, hairline rule, author below.
 */
interface TypedLabelProps {
  title: string;
  author?: string;
  className?: string;
}

const TypedLabel: React.FC<TypedLabelProps> = ({ title, author, className }) => (
  <div
    className={clsx(
      'border-ink bg-paperlight flex flex-col items-stretch border px-2 py-1.5',
      className,
    )}
  >
    <span className='typed text-ink line-clamp-2 text-[9.5px] leading-snug'>{title}</span>
    {author ? (
      <>
        <div className='bg-ink my-1 h-px w-full opacity-70' />
        <span className='typed text-mutedink line-clamp-1 text-[8.5px]'>{author}</span>
      </>
    ) : null}
  </div>
);

export default TypedLabel;
