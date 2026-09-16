/**
 * wbShared — the shared presentational pieces of the workbench transcript
 * (audit R5). Prose, Slip, and VerdictChip were extracted UNCHANGED
 * (byte-identical props, markup, and class names) from the retired notebook
 * tab so the block renderers (DerivationSlip, DiagramSlip, DeskCanvas, and
 * later waves' controls) import them without reaching into a default-exported
 * tab. Pure move; no behavioral edit.
 */
import React from 'react';
import { Streamdown } from 'streamdown';
import { math as streamdownMath } from '@streamdown/math';

import { useTranslation } from '@/hooks/useTranslation';
import type { CheckStepVerdict } from '@/services/professor/mathCheck';

export const Prose: React.FC<{ text: string }> = ({ text }) => (
  <div className='wb-prose select-text'>
    <Streamdown
      remarkPlugins={[streamdownMath.remarkPlugin]}
      rehypePlugins={[streamdownMath.rehypePlugin]}
    >
      {text}
    </Streamdown>
  </div>
);

/** The paper slip under a chip (hover-only; the aria-label carries the same
 *  words for everyone else). */
export const Slip: React.FC<{ children: React.ReactNode; label?: string }> = ({
  children,
  label,
}) => (
  <span className='wb-slip' aria-hidden='true'>
    {label && <span className='wb-slip-label'>{label}</span>}
    <span className='wb-slip-quote'>{children}</span>
  </span>
);

export const VerdictChip: React.FC<{ verdict: CheckStepVerdict }> = ({ verdict }) => {
  const _ = useTranslation();
  const cx = verdict.counterexample;
  const assigns = cx
    ? Object.entries(cx.assignments)
        .map(([k, val]) => `${k} = ${String(val)}`)
        .join(', ')
    : '';
  const counterexampleCopy = cx
    ? assigns
      ? _('For {{assigns}}, the left side reads {{prev}} while this line reads {{step}}.', {
          assigns,
          prev: cx.prevValue,
          step: cx.stepValue,
        })
      : _('The left side reads {{prev}} while this line reads {{step}}.', {
          prev: cx.prevValue,
          step: cx.stepValue,
        })
    : '';

  let glyph = '◌';
  let tone = 'wb-chip-muted';
  let label = _('Unmarked');
  let tip: string = _('The professor will take a moment.');
  if (verdict.status === 'parse_error') {
    label = _('Parse error');
    tip = _('Could not read this line as math.');
  } else {
    switch (verdict.verdict) {
      case 'equivalent':
      case 'equivalent_same_roots':
        glyph = '✓';
        tone = 'wb-chip-sage';
        label = _('Checks out');
        tip = _('This line checks out.');
        break;
      case 'implied_forward':
      case 'implied_backward':
        glyph = '✓';
        tone = 'wb-chip-sage';
        label = _('Holds in one direction');
        tip = _('This line holds in one direction.');
        break;
      case 'not_equivalent':
        glyph = '✗';
        tone = 'wb-chip-stamp';
        label = _('Does not follow');
        tip = counterexampleCopy || label;
        break;
      default:
        break;
    }
  }
  return (
    <span
      className={`wb-chip ${tone}${verdict.status === 'parse_error' ? ' wb-chip-parse' : ''}`}
      role='img'
      aria-label={label}
    >
      <span aria-hidden='true'>{glyph}</span>
      {tip && <Slip>{tip}</Slip>}
    </span>
  );
};
