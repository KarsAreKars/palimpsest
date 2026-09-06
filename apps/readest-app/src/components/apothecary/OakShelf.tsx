import React from 'react';
import clsx from 'clsx';

/**
 * OakShelf — the plank. Books and panels SIT on wood; they never float on
 * plain paper. Render as the strip under a book row, or as a rail (Spine)
 * or bar surface (MiniPlayer). `lip` adds the front edge below the plank.
 */
interface OakShelfProps {
  className?: string;
  children?: React.ReactNode;
  /** front edge thickness under the plank (px). 0 = flat rail. */
  lip?: number;
}

const OakShelf: React.FC<OakShelfProps> = ({ className, children, lip = 10 }) => (
  <div className={clsx('relative', className)}>
    <div className='oak-shelf h-[14px] w-full' />
    {lip > 0 && (
      <div
        className='w-full'
        style={{
          height: lip,
          background: 'linear-gradient(180deg, var(--oak-dark), #5e4a30)',
          boxShadow: '0 6px 10px rgba(42,37,29,0.16)',
        }}
      />
    )}
    {children}
  </div>
);

export default OakShelf;
