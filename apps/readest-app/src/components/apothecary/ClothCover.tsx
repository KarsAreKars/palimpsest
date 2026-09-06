import React from 'react';
import clsx from 'clsx';
import TypedLabel from './TypedLabel';

/**
 * ClothCover — books are flat cloth rects with a cream typed label.
 * The cloth color is hashed from the title so a book keeps its color
 * forever, across sessions and surfaces. No cover art: the label IS
 * the cover. Books cast a soft lift shadow — they sit on oak.
 */

const CLOTHS = ['moss', 'basalt', 'oxblood', 'kraft', 'walnut', 'sage'] as const;
export type Cloth = (typeof CLOTHS)[number];

export const clothForTitle = (title: string): Cloth => {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return CLOTHS[h % CLOTHS.length]!;
};

interface ClothCoverProps {
  title: string;
  author?: string;
  /** 'lg' = library spine-up book; 'sm' = MiniPlayer / Spine thumb */
  size?: 'lg' | 'sm';
  className?: string;
}

const ClothCover: React.FC<ClothCoverProps> = ({ title, author, size = 'lg', className }) => {
  const cloth = clothForTitle(title);
  return (
    <div
      className={clsx(
        `cloth-${cloth}`,
        'relative flex flex-col justify-center',
        'shadow-[0_5px_14px_rgba(42,37,29,0.18)]',
        size === 'lg' ? 'aspect-[3/4] w-full p-[12%]' : 'h-full w-full p-[6%]',
        className,
      )}
    >
      {/* cloth weave hint: faint vertical threads */}
      <div
        className='pointer-events-none absolute inset-0 opacity-[0.06]'
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, #000 0, #000 1px, transparent 1px, transparent 3px)',
        }}
      />
      <TypedLabel title={title} author={author} />
    </div>
  );
};

export default ClothCover;
