/**
 * DeskRail — the traffic-light spine of the Desk sheet (d3 §B).
 *
 * A fixed left-margin column bound to latestConceptMap: sage = known,
 * muted = edge, stamp = unknown. A second, fixed view over the same data
 * the in-transcript ConceptMapSlip renders — it parses no tags and writes
 * no state. Every chip with a threadId glides to the block where the
 * concept was last discussed; a null threadId is an inert, dimmed chip
 * (evidence, not a gate). Zero new strings: the rail speaks in the
 * catalogue's existing vocabulary (audit R12).
 *
 * Mount + scroll contract: DeskSheet provides onOpenThread, scoped to the
 * sheet's scroll element — the book underneath never scrolls (law 7).
 */
'use client';

import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { buildDeskRail, type ConceptMapData, type DeskShelf } from './workbenchChat';
import './DeskRail.css';

const SHELF_HEADS: Record<DeskShelf, string> = {
  known: 'KNOWN',
  edge: 'EDGE',
  unknown: 'UNKNOWN',
};

const DeskRail: React.FC<{
  map: ConceptMapData | null;
  onOpenThread: (threadId: string) => void;
}> = ({ map, onOpenThread }) => {
  const _ = useTranslation();
  const entries = buildDeskRail(map);
  const shelves: DeskShelf[] = ['known', 'edge', 'unknown'];
  return (
    <nav className='desk-rail' aria-label={_('The catalogue so far')}>
      {shelves.map((shelf) => {
        const rows = entries.filter((e) => e.shelf === shelf);
        return (
          <React.Fragment key={shelf}>
            <p className='desk-rail-head'>{_(SHELF_HEADS[shelf])}</p>
            {rows.length === 0 && (
              <span className='wb-map-empty'>{_('Nothing filed here yet')}</span>
            )}
            {rows.map((entry) =>
              entry.threadId ? (
                <button
                  key={entry.name}
                  type='button'
                  className={`wb-chip desk-rail-chip desk-rail-${shelf}`}
                  aria-label={_('Open the thread on {{concept}}', { concept: entry.name })}
                  onClick={() => onOpenThread(entry.threadId!)}
                >
                  {entry.name}
                </button>
              ) : (
                <span
                  key={entry.name}
                  className={`wb-chip desk-rail-chip desk-rail-${shelf} desk-rail-dim`}
                >
                  {entry.name}
                </span>
              ),
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export default DeskRail;
