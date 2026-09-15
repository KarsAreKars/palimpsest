/**
 * Tutor state machine contract tests — the full transition matrix, the voice
 * budget, the climb gate (anti-hint-abuse), teachback cap, retest retire,
 * and purity (frozen input in, new object out, input untouched).
 */
import { describe, expect, it } from 'vitest';
import {
  applyTutorEvent,
  initTutorSession,
  NOISE_BUDGET,
  type TutorSession,
} from '@/services/professor/tutorMachine';

const T0 = 1_700_000_000_000;

const deepFreeze = <T>(o: T): T => {
  Object.values(o as Record<string, unknown>).forEach((v) => {
    if (v && typeof v === 'object') deepFreeze(v);
  });
  return Object.freeze(o);
};

describe('initTutorSession', () => {
  it('starts watching at rung 0 with all counters zeroed', () => {
    const s = initTutorSession('prob-1', T0);
    expect(s).toEqual({
      state: 'watching',
      problemId: 'prob-1',
      currentRung: 0,
      stepFailures: {},
      misconceptionIds: [],
      stuckSignals: 0,
      attemptsSinceHint: 0,
      teachbackRounds: 0,
      retestPasses: 0,
      unsolicitedUsed: 0,
      windowStartTs: T0,
      lastInterventionTs: 0,
      startedTs: T0,
    });
  });
});

describe('watching: silent marks and student asks', () => {
  it('STEP_BAD is a silent mark: first failure counts, no stuck signal', () => {
    const s = applyTutorEvent(initTutorSession('p', T0), { type: 'STEP_BAD', stepId: 's1' }, T0);
    expect(s.state).toBe('watching');
    expect(s.stepFailures).toEqual({ s1: 1 });
    expect(s.stuckSignals).toBe(0);
  });

  it('re-failing the same step raises a stuck signal; a new step does not', () => {
    let s = initTutorSession('p', T0);
    s = applyTutorEvent(s, { type: 'STEP_BAD', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'STEP_BAD', stepId: 's1' }, T0);
    expect(s.stepFailures['s1']).toBe(2);
    expect(s.stuckSignals).toBe(1);
    s = applyTutorEvent(s, { type: 'STEP_BAD', stepId: 's2' }, T0);
    expect(s.stepFailures).toEqual({ s1: 2, s2: 1 });
    expect(s.stuckSignals).toBe(1); // first failure of s2 is exploration, not stuck
  });

  it('STEP_OK clears that step’s failure record', () => {
    let s = initTutorSession('p', T0);
    s = applyTutorEvent(s, { type: 'STEP_BAD', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'STEP_BAD', stepId: 's2' }, T0);
    s = applyTutorEvent(s, { type: 'STEP_OK', stepId: 's1' }, T0);
    expect(s.state).toBe('watching');
    expect(s.stepFailures).toEqual({ s2: 1 });
  });

  it('ASK_HELP is always served, unbudgeted, at rung 1', () => {
    const s = applyTutorEvent(initTutorSession('p', T0), { type: 'ASK_HELP', stepId: 's1' }, T0);
    expect(s.state).toBe('hinted');
    expect(s.currentRung).toBe(1);
    expect(s.unsolicitedUsed).toBe(0);
  });

  it('ASK_REVEAL goes to revealed rung 3 and counts a stuck signal', () => {
    const s = applyTutorEvent(initTutorSession('p', T0), { type: 'ASK_REVEAL', stepId: 's1' }, T0);
    expect(s.state).toBe('revealed');
    expect(s.currentRung).toBe(3);
    expect(s.stuckSignals).toBe(1);
    expect(s.unsolicitedUsed).toBe(0);
  });
});

describe('watching: the unsolicited voice budget', () => {
  const backToWatching = (s: TutorSession, t: number): TutorSession =>
    applyTutorEvent(s, { type: 'STEP_OK', stepId: 's1' }, t);

  it('first PAUSED_AT_ERROR within a window is budgeted into hinted rung 1', () => {
    const s = applyTutorEvent(
      initTutorSession('p', T0),
      { type: 'PAUSED_AT_ERROR', stepId: 's1' },
      T0 + 1000,
    );
    expect(s.state).toBe('hinted');
    expect(s.currentRung).toBe(1);
    expect(s.unsolicitedUsed).toBe(1);
  });

  it('2nd/3rd/4th PAUSED_AT_ERROR in the same window stay watching (budget exhausted)', () => {
    let s = initTutorSession('p', T0);
    s = applyTutorEvent(s, { type: 'PAUSED_AT_ERROR', stepId: 's1' }, T0 + 1000);
    expect(s.state).toBe('hinted');
    for (let i = 2; i <= 4; i++) {
      s = backToWatching(s, T0 + i * 1000);
      expect(s.state).toBe('watching');
      s = applyTutorEvent(s, { type: 'PAUSED_AT_ERROR', stepId: 's1' }, T0 + i * 1000);
      expect(s.state).toBe('watching'); // stays watching: 1 per window
      expect(s.unsolicitedUsed).toBe(1);
    }
  });

  it('the window resets after windowMs: a new offer is allowed', () => {
    let s = initTutorSession('p', T0);
    s = applyTutorEvent(s, { type: 'PAUSED_AT_ERROR', stepId: 's1' }, T0);
    expect(s.state).toBe('hinted');
    s = backToWatching(s, T0 + 1000);
    s = applyTutorEvent(
      s,
      { type: 'PAUSED_AT_ERROR', stepId: 's1' },
      T0 + NOISE_BUDGET.windowMs + 1,
    );
    expect(s.state).toBe('hinted');
    expect(s.unsolicitedUsed).toBe(2);
    expect(s.windowStartTs).toBe(T0 + NOISE_BUDGET.windowMs + 1);
  });

  it('maxPerProblem caps lifetime offers even across fresh windows', () => {
    let s = initTutorSession('p', T0);
    for (let i = 0; i < 3; i++) {
      const t = T0 + i * (NOISE_BUDGET.windowMs + 1);
      s = applyTutorEvent(s, { type: 'PAUSED_AT_ERROR', stepId: 's1' }, t);
      expect(s.state).toBe('hinted');
      s = backToWatching(s, t + 1);
    }
    expect(s.unsolicitedUsed).toBe(3);
    const t4 = T0 + 4 * (NOISE_BUDGET.windowMs + 1);
    s = applyTutorEvent(s, { type: 'PAUSED_AT_ERROR', stepId: 's1' }, t4);
    expect(s.state).toBe('watching'); // lifetime cap: 3 per problem
  });

  it('student asks ignore the budget even after it is exhausted', () => {
    let s = initTutorSession('p', T0);
    s = applyTutorEvent(s, { type: 'PAUSED_AT_ERROR', stepId: 's1' }, T0); // spends the window
    s = backToWatching(s, T0 + 1);
    s = applyTutorEvent(s, { type: 'ASK_HELP', stepId: 's1' }, T0 + 2);
    expect(s.state).toBe('hinted');
  });
});

describe('hinted: the climb gate', () => {
  const hinted = (): TutorSession =>
    applyTutorEvent(initTutorSession('p', T0), { type: 'ASK_HELP', stepId: 's1' }, T0);

  it('ATTEMPT_COMMITTED increments attemptsSinceHint and climbs the rung', () => {
    const s = applyTutorEvent(hinted(), { type: 'ATTEMPT_COMMITTED', stepId: 's1' }, T0);
    expect(s.state).toBe('hinted');
    expect(s.attemptsSinceHint).toBe(1);
    expect(s.currentRung).toBe(2);
  });

  it('the climb caps at rung 2 — rung 3 is reveal-only', () => {
    let s = hinted();
    s = applyTutorEvent(s, { type: 'ATTEMPT_COMMITTED', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'ATTEMPT_COMMITTED', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'ATTEMPT_COMMITTED', stepId: 's1' }, T0);
    expect(s.currentRung).toBe(2);
    expect(s.attemptsSinceHint).toBe(3);
    expect(s.state).toBe('hinted');
  });

  it('anti-hint-abuse: STEP_BAD alone never climbs the rung', () => {
    let s = hinted();
    s = applyTutorEvent(s, { type: 'STEP_BAD', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'STEP_BAD', stepId: 's1' }, T0);
    expect(s.state).toBe('hinted');
    expect(s.currentRung).toBe(1);
    expect(s.attemptsSinceHint).toBe(0);
  });

  it('STEP_OK on the failing step returns to watching and clears it', () => {
    let s = hinted();
    s = applyTutorEvent(s, { type: 'STEP_BAD', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'ATTEMPT_COMMITTED', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'STEP_OK', stepId: 's1' }, T0);
    expect(s.state).toBe('watching');
    expect(s.currentRung).toBe(0);
    expect(s.stepFailures).toEqual({});
    expect(s.attemptsSinceHint).toBe(0);
  });

  it('ASK_REVEAL from hinted goes to revealed', () => {
    const s = applyTutorEvent(hinted(), { type: 'ASK_REVEAL', stepId: 's1' }, T0);
    expect(s.state).toBe('revealed');
    expect(s.currentRung).toBe(3);
  });
});

describe('revealed → discussing → retesting', () => {
  const revealed = (): TutorSession =>
    applyTutorEvent(initTutorSession('p', T0), { type: 'ASK_REVEAL', stepId: 's1' }, T0);

  it('RE_DERIVATION_PASSED moves to discussing with zero rounds', () => {
    const s = applyTutorEvent(revealed(), { type: 'RE_DERIVATION_PASSED' }, T0);
    expect(s.state).toBe('discussing');
    expect(s.teachbackRounds).toBe(0);
  });

  it('teachback: two failed rounds stay, the third moves on (grinding cap)', () => {
    let s = applyTutorEvent(revealed(), { type: 'RE_DERIVATION_PASSED' }, T0);
    s = applyTutorEvent(s, { type: 'TEACHBACK_FAILED' }, T0);
    expect(s.state).toBe('discussing');
    expect(s.teachbackRounds).toBe(1);
    s = applyTutorEvent(s, { type: 'TEACHBACK_FAILED' }, T0);
    expect(s.state).toBe('discussing');
    expect(s.teachbackRounds).toBe(2);
    s = applyTutorEvent(s, { type: 'TEACHBACK_FAILED' }, T0);
    expect(s.state).toBe('retesting'); // cap: never a fourth round
  });

  it('TEACHBACK_PASSED moves to retesting with zero passes', () => {
    let s = applyTutorEvent(revealed(), { type: 'RE_DERIVATION_PASSED' }, T0);
    s = applyTutorEvent(s, { type: 'TEACHBACK_PASSED' }, T0);
    expect(s.state).toBe('retesting');
    expect(s.retestPasses).toBe(0);
  });
});

describe('retesting', () => {
  const retesting = (): TutorSession => {
    let s = applyTutorEvent(initTutorSession('p', T0), { type: 'ASK_REVEAL', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'RE_DERIVATION_PASSED' }, T0);
    s = applyTutorEvent(s, { type: 'TEACHBACK_PASSED' }, T0);
    return s;
  };

  it('one pass stays retesting with passes=1; the second retires to watching', () => {
    let s = retesting();
    s = applyTutorEvent(s, { type: 'RETEST_PASSED' }, T0);
    expect(s.state).toBe('retesting');
    expect(s.retestPasses).toBe(1);
    s = applyTutorEvent(s, { type: 'RETEST_PASSED' }, T0);
    expect(s.state).toBe('watching'); // retired
    expect(s.retestPasses).toBe(2);
    expect(s.currentRung).toBe(0);
  });

  it('a failed retest re-enters at hinted rung 1', () => {
    const s = applyTutorEvent(retesting(), { type: 'RETEST_FAILED' }, T0);
    expect(s.state).toBe('hinted');
    expect(s.currentRung).toBe(1);
    expect(s.attemptsSinceHint).toBe(0);
  });
});

describe('global transitions', () => {
  it('DECLARE_DONE from any state gives a fresh hinted full-review at rung 1', () => {
    let s = applyTutorEvent(initTutorSession('p', T0), { type: 'ASK_REVEAL', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'DECLARE_DONE' }, T0);
    expect(s.state).toBe('hinted');
    expect(s.currentRung).toBe(1);
    expect(s.attemptsSinceHint).toBe(0);
  });

  it('ABANDONED resets everything except misconceptionIds and startedTs', () => {
    let s: TutorSession = {
      ...initTutorSession('p', T0),
      misconceptionIds: ['alg.frac_add_numerator'],
    };
    s = applyTutorEvent(s, { type: 'ASK_REVEAL', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'STEP_BAD', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'ABANDONED' }, T0 + 5000);
    expect(s.state).toBe('watching');
    expect(s.currentRung).toBe(0);
    expect(s.stepFailures).toEqual({});
    expect(s.stuckSignals).toBe(0);
    expect(s.attemptsSinceHint).toBe(0);
    expect(s.teachbackRounds).toBe(0);
    expect(s.retestPasses).toBe(0);
    expect(s.unsolicitedUsed).toBe(0);
    expect(s.misconceptionIds).toEqual(['alg.frac_add_numerator']);
    expect(s.startedTs).toBe(T0);
  });

  it('ASK_HELP is always served, even mid-retesting', () => {
    let s = applyTutorEvent(initTutorSession('p', T0), { type: 'ASK_REVEAL', stepId: 's1' }, T0);
    s = applyTutorEvent(s, { type: 'RE_DERIVATION_PASSED' }, T0);
    s = applyTutorEvent(s, { type: 'TEACHBACK_PASSED' }, T0);
    s = applyTutorEvent(s, { type: 'ASK_HELP', stepId: 's1' }, T0);
    expect(s.state).toBe('hinted');
    expect(s.currentRung).toBe(1);
  });
});

describe('purity', () => {
  it('applyTutorEvent never mutates its input (deep-frozen) and returns a new object', () => {
    const input = deepFreeze(initTutorSession('p', T0));
    const out = applyTutorEvent(input, { type: 'STEP_BAD', stepId: 's1' }, T0);
    expect(out).not.toBe(input);
    expect(out.stepFailures).not.toBe(input.stepFailures);
    expect(input.stepFailures).toEqual({});
    expect(out.stepFailures).toEqual({ s1: 1 });
  });
});
