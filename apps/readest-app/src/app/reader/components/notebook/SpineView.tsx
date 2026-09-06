/**
 * SpineView — the notebook's default tab (UX spec B): a vertical filmstrip
 * of ONLY the pages you touched. Each cell is a page card on the oak rail:
 * typed page label, the quote/note you left, ink counts. Tap → jump.
 *
 * A map of your thinking, not a note list — writing happens in the margins
 * (the Prof's notes live there too); the Spine is the index.
 *
 * TODO(spine): real page thumbnails. The render pipeline (foliate/PDF.js
 * canvas) can snapshot visited pages into a thumb cache; cells already
 * reserve the slot. Ink badges stand in until then.
 */
import React, { useMemo } from 'react';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { BookNote } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

interface SpineViewProps {
  bookKey: string;
}

interface TouchedPage {
  page: number;
  notes: BookNote[];
}

const SpineView: React.FC<SpineViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getConfig } = useBookDataStore();

  const pages = useMemo<TouchedPage[]>(() => {
    const { booknotes = [] } = getConfig(bookKey) ?? {};
    const byPage = new Map<number, BookNote[]>();
    for (const n of booknotes) {
      if (typeof n.page !== 'number') continue;
      const list = byPage.get(n.page) ?? [];
      list.push(n);
      byPage.set(n.page, list);
    }
    return [...byPage.entries()]
      .map(([page, notes]) => ({ page, notes }))
      .sort((a, b) => a.page - b.page);
  }, [getConfig, bookKey]);

  const jump = (note: BookNote) => {
    eventDispatcher.dispatch('navigate', { bookKey, cfi: note.cfi });
  };

  if (pages.length === 0) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-2 px-6 text-center'>
        <p className='typed text-mutedink text-[10px] leading-relaxed'>
          {_('Nothing touched yet.')}
          <br />
          {_('Highlight a line or ask the Prof — those pages will appear here.')}
        </p>
      </div>
    );
  }

  return (
    <div className='h-full overflow-y-auto pb-4'>
      <p className='typed text-mutedink px-4 pb-2 pt-3 text-[9px]'>
        {_('The Spine — pages you touched')}
      </p>
      <div className='flex flex-col gap-0 px-3'>
        {pages.map(({ page, notes }) => (
          <div key={page} className='relative'>
            {/* page card */}
            <div className='border-ink bg-paperlight relative z-10 mx-1 mb-[-4px] border p-2 shadow-[var(--lift-shadow)]'>
              <div className='flex items-baseline justify-between gap-2'>
                <span className='typed text-ink text-[10px]'>P. {page}</span>
                <span className='typed text-mutedink text-[8.5px]'>
                  {notes.length === 1
                    ? _('1 mark')
                    : _('{{count}} marks', { count: notes.length })}
                </span>
              </div>
              <div className='bg-ink my-1.5 h-px w-full opacity-60' />
              <div className='flex flex-col gap-1.5'>
                {notes.slice(0, 3).map((n) => (
                  <button
                    key={n.id}
                    type='button'
                    onClick={() => jump(n)}
                    className='hover:bg-paper group -m-1 p-1 text-left'
                  >
                    {n.text ? (
                      <p className='text-ink line-clamp-2 text-[12px] italic leading-snug'>
                        “{n.text}”
                      </p>
                    ) : null}
                    {n.note ? (
                      <p className='text-mutedink line-clamp-2 text-[11.5px] leading-snug'>
                        {n.note}
                      </p>
                    ) : null}
                  </button>
                ))}
                {notes.length > 3 && (
                  <span className='typed text-mutedink text-[8.5px]'>
                    + {notes.length - 3} {_('more')}
                  </span>
                )}
              </div>
            </div>
            {/* the oak rail the card rests on */}
            <div className='oak-shelf mb-3 h-[10px] w-full' />
          </div>
        ))}
      </div>
    </div>
  );
};

export default SpineView;
