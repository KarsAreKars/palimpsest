/**
 * DiagramSlip — the figure slip (Workbench 2.x, s3 §7.2).
 *
 * The professor-drawn SVG mounts as a figure with its claim printed
 * beneath it — the learn-visual self-check made visible (caption = claim,
 * the figure's accessible name names the claim). The SVG is sanitized at
 * RENDER time on every render (allowlist-only, see diagramSvg.ts §6.1).
 * A missing fence or an empty sanitize output renders the claim as honest
 * paper with a muted note — never an empty box, never a crash.
 */
import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { sanitizeDiagramSvg } from '@/services/professor/diagramSvg';
import type { TranscriptBlock } from './workbenchChat';
import { Prose } from './wbShared';

const DiagramSlip: React.FC<{ block: TranscriptBlock }> = ({ block }) => {
  const _ = useTranslation();
  const d = block.diagram;
  if (!d) return null;
  // Sanitize → render, in that order, every render (allowlist-only policy).
  const clean = sanitizeDiagramSvg(d.svg);
  if (!clean) {
    return (
      <div className='wb-figure-degraded'>
        <Prose text={d.claim} />
        <p className='wb-figure-missing'>{_('The figure could not be mounted.')}</p>
      </div>
    );
  }
  return (
    <figure className='wb-figure' role='img' aria-label={d.claim}>
      {/* eslint-disable-next-line react/no-danger -- sanitized by sanitizeDiagramSvg (diagramSvg.ts §6.1), allowlist-only */}
      <div className='wb-figure-svg' dangerouslySetInnerHTML={{ __html: clean }} />
      <figcaption className='wb-figure-caption'>{d.claim}</figcaption>
    </figure>
  );
};

export default DiagramSlip;
