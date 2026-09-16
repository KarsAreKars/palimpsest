/**
 * workbench-replay — the wiggly folio replay's pure predicates (d3 C1,
 * cases 8-9). The state machine itself is ephemeral UI over the persisted
 * folio; what the contract pins is the row-state mapping and the finale
 * (goal-frame) beat, testable without DOM.
 */
import { describe, expect, test } from 'vitest';
import {
  REPLAY_GOAL_CLASS,
  replayFramesGoal,
  replayRowState,
} from '@/app/reader/components/notebook/DerivationSlip';

describe('replayRowState', () => {
  test('rows before the active step ghost, the active step lights, later rows hide', () => {
    expect(replayRowState(0, 0)).toBe('active');
    expect(replayRowState(0, 2)).toBe('ghost');
    expect(replayRowState(1, 2)).toBe('ghost');
    expect(replayRowState(2, 2)).toBe('active');
    expect(replayRowState(2, 1)).toBe('hidden');
    expect(replayRowState(3, 0)).toBe('hidden');
  });
});

describe('the goal beat', () => {
  test('replayFramesGoal is true only on the finale beat (active === total)', () => {
    const total = 3;
    expect(replayFramesGoal(3, total)).toBe(true);
    expect(replayFramesGoal(2, total)).toBe(false);
    expect(replayFramesGoal(0, total)).toBe(false);
    expect(replayFramesGoal(4, total)).toBe(false);
  });

  test('the finale frame class is pinned (the stamp-framed Q.E.D. gesture)', () => {
    expect(REPLAY_GOAL_CLASS).toBe('wb-replay-goal');
  });
});
