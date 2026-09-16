/**
 * DerivationSlip — the numbered folio (Workbench 2.x, s3 §7.1).
 *
 * A derivation enters the ledger as a numbered folio: step rows with the
 * desk's global ordinal (never the professor's numeral), the step's $$ math
 * typeset through the existing Streamdown path, the justification under it,
 * and the CAS verdict chips matched by step id. The whole-derivation goal
 * chip rides under the last step row. The learner-appended step renders
 * identically — a learner step is a step (compact form on their own block).
 *
 * Wiggly folio replay (folded 2.5, WIGGLYSTUFF Route C): a learner-invoked,
 * manually paced step-through over the persisted folio — ephemeral UI
 * state, never written back. The prior step stays up as a dimmed ghost;
 * the GOAL line is stamp-framed on the finale beat.
 */
import React, { useRef, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranscriptBlock, BlockCheck } from './workbenchChat';
import { Prose, Slip, VerdictChip } from './wbShared';

export type ReplayRowState = 'ghost' | 'active' | 'hidden';

/** A row before the active step is a dimmed ghost; the active step is
 *  lit; rows after it are hidden until their beat. */
export const replayRowState = (index: number, active: number): ReplayRowState =>
  index < active ? 'ghost' : index === active ? 'active' : 'hidden';

/** The finale beat: one past the last step — the framed GOAL. */
export const replayFramesGoal = (active: number, total: number): boolean => active === total;

/** The stamp frame the finale beat selects (the Q.E.D. gesture). */
export const REPLAY_GOAL_CLASS = 'wb-replay-goal';

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
  // Replay is ephemeral UI state over the persisted folio — never written back.
  const [replayStep, setReplayStep] = useState<number | null>(null); // null = full folio shown
  // Focus scope for the arrow keys (wigglystuff's opt-in: ←/→ fire only
  // once the controls hold focus, so reader keys are never stolen).
  const replayKeysRef = useRef<HTMLDivElement | null>(null);
  const d = block.derivation;
  const total = d?.steps.length ?? 0;
  const replaying = replayStep !== null;
  const goalBeat = replayStep !== null && replayFramesGoal(replayStep, total);
  if (!d || d.steps.length === 0) return null;
  const firstOrdinal = ordinalBase + 1;
  const verdicts = check?.status === 'done' ? check.verdicts : [];
  const goal =
    check?.status === 'done'
      ? check.goal
      : d.goalReached !== undefined
        ? { reached: d.goalReached, byStep: d.goalByStep }
        : undefined;

  const stepReplay = (next: number) => setReplayStep(Math.min(Math.max(next, 0), total)); // total = the framed GOAL beat

  const closeReplay = () => setReplayStep(null);

  // The replay owns its keys once open: stopPropagation keeps a bubbled
  // keydown from reaching sheet/window-level shortcut listeners (mirrors
  // the DeskComposer guard) — replay Escape must close the replay, not
  // dismiss the whole desk.
  const handleReplayKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (replayStep === null) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      if (replayStep === 0) closeReplay();
      else stepReplay(replayStep - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      if (replayStep < total) stepReplay(replayStep + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      stepReplay(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      stepReplay(total);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeReplay();
    }
  };

  return (
    <div className={`wb-derive${compact ? ' wb-derive-compact' : ''}`}>
      {!compact && (
        <p className='wb-derive-title'>
          {d.title
            ? _('DERIVATION {{n}} · {{title}}', { n: firstOrdinal, title: d.title })
            : _('DERIVATION {{n}}', { n: firstOrdinal })}
        </p>
      )}
      {!compact && total >= 2 && !replaying && (
        <button
          type='button'
          className='wb-chip wb-replay-btn'
          onClick={() => {
            setReplayStep(0);
            replayKeysRef.current?.focus();
          }}
        >
          {_('Step through this folio')}
        </button>
      )}
      {replaying && replayStep !== null && (
        <div className='wb-replay' ref={replayKeysRef} tabIndex={-1} onKeyDown={handleReplayKey}>
          <button
            type='button'
            className='wb-chip wb-replay-btn'
            onClick={() => (replayStep === 0 ? closeReplay() : stepReplay(replayStep - 1))}
          >
            {_(replayStep === 0 ? 'Close the replay' : 'Back one step')}
          </button>
          <button
            type='button'
            className='wb-chip wb-replay-btn'
            disabled={replayStep >= total}
            onClick={() => stepReplay(replayStep + 1)}
          >
            {_(replayStep >= total - 1 ? 'Frame the goal' : 'Ahead one step')}
          </button>
          <span className='wb-replay-count'>
            {_('Step {{n}} of {{total}}', { n: Math.min(replayStep + 1, total), total })}
          </span>
          <button type='button' className='wb-chip wb-replay-btn' onClick={closeReplay}>
            {_('Close the replay')}
          </button>
        </div>
      )}
      {d.steps.map((s, i) => {
        const verdict = verdicts.find((v) => v.id === s.id);
        const replayState = replaying && replayStep !== null ? replayRowState(i, replayStep) : null;
        const wearsGoal = goalBeat && (!d.goalLatex ? i === total - 1 : false);
        return (
          <div
            className={`wb-step-row${replayState ? ` wb-replay-${replayState}` : ''}${wearsGoal ? ` ${REPLAY_GOAL_CLASS}` : ''}`}
            key={s.id}
          >
            <span className='wb-step-no' aria-hidden='true'>
              {ordinalBase + i + 1}
            </span>
            <div className='wb-step-body'>
              <Prose text={`$$${s.latex}$$`} />
              {/* The finale suppresses the justification — the goal owns the eye. */}
              {s.justification && !goalBeat && (
                <span className='wb-step-justify'>{s.justification}</span>
              )}
            </div>
            {verdict && <VerdictChip verdict={verdict} />}
          </div>
        );
      })}
      {d.goalLatex && (
        <div className={`wb-goal-line${goalBeat ? ` ${REPLAY_GOAL_CLASS}` : ''}`}>
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
