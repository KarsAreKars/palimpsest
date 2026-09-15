/**
 * DerivationSlip — the numbered folio (Workbench 2.x, s3 §7.1).
 *
 * A derivation enters the ledger as a numbered folio: step rows with the
 * desk's global ordinal (never the professor's numeral), the step's $$ math
 * typeset through the existing Streamdown path, the justification under it,
 * and the CAS verdict chips matched by step id. The whole-derivation goal
 * chip rides under the last step row. The learner-appended step renders
 * identically — a learner step is a step (compact form on their own block).
 */
import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranscriptBlock, BlockCheck } from './workbenchChat';
import { Prose, Slip, VerdictChip } from './wbShared';

const DerivationSlip: React.FC<{
  block: TranscriptBlock;
  /** Steps already numbered before this folio — the ledger runs one ordinal
   *  across the whole transcript (derivationOrdinal base). */
  ordinalBase: number;
  check?: BlockCheck;
  /** Learner-appended steps on their own block: no folio header. */
  compact?: boolean;
}> = ({ block, ordinalBase, check, compact = false }) => {
  const _ = useTranslation();
  const d = block.derivation;
  if (!d || d.steps.length === 0) return null;
  const firstOrdinal = ordinalBase + 1;
  const verdicts = check?.status === 'done' ? check.verdicts : [];
  const goal =
    check?.status === 'done'
      ? check.goal
      : d.goalReached !== undefined
        ? { reached: d.goalReached, byStep: d.goalByStep }
        : undefined;
  return (
    <div className={`wb-derive${compact ? ' wb-derive-compact' : ''}`}>
      {!compact && (
        <p className='wb-derive-title'>
          {d.title
            ? _('DERIVATION {{n}} · {{title}}', { n: firstOrdinal, title: d.title })
            : _('DERIVATION {{n}}', { n: firstOrdinal })}
        </p>
      )}
      {d.steps.map((s, i) => {
        const verdict = verdicts.find((v) => v.id === s.id);
        return (
          <div className='wb-step-row' key={s.id}>
            <span className='wb-step-no' aria-hidden='true'>
              {ordinalBase + i + 1}
            </span>
            <div className='wb-step-body'>
              <Prose text={`$$${s.latex}$$`} />
              {s.justification && <span className='wb-step-justify'>{s.justification}</span>}
            </div>
            {verdict && <VerdictChip verdict={verdict} />}
          </div>
        );
      })}
      {d.goalLatex && (
        <div className='wb-goal-line'>
          <span className='wb-step-no'>{_('GOAL')}</span>
          <Prose text={`$$${d.goalLatex}$$`} />
        </div>
      )}
      {goal && (
        <div className='wb-chip-row'>
          <span
            className={`wb-chip ${goal.reached ? 'wb-chip-sage' : 'wb-chip-stamp'}`}
            role='img'
            aria-label={_(goal.reached ? 'Reaches the goal' : 'Does not reach the goal')}
          >
            <span aria-hidden='true'>{goal.reached ? '✓' : '✗'}</span>
            {_(goal.reached ? 'Reaches the goal' : 'Does not reach the goal')}
            <Slip>
              {_(
                goal.reached
                  ? 'The chain arrives where it set out to.'
                  : 'The chain does not arrive at the goal.',
              )}
            </Slip>
          </span>
        </div>
      )}
    </div>
  );
};

export default DerivationSlip;
