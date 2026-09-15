/**
 * The tutoring state machine — the learning loop's brain, pure and testable.
 *
 * Mirrors learner.ts's applyExchange discipline: one pure fold, no IO, no
 * clock reads except through the explicit `now` parameter. The UI/effects
 * layer owns rendering and side effects; this file owns pedagogy policy.
 *
 * Design contract (shadow-safe form):
 *  - STEP_BAD is a silent mark: the machine only counts, it never intervenes.
 *  - Unsolicited interventions (PAUSED_AT_ERROR) are voice-budgeted:
 *    max 1 per 10-minute window, max 3 per problem, window resets after
 *    windowMs. Student-initiated asks (ASK_HELP / ASK_REVEAL) are ALWAYS
 *    served and never touch the budget.
 *  - The rung climbs ONLY on ATTEMPT_COMMITTED — the anti-hint-abuse rule:
 *    no committed attempt, no climb, ever.
 *  - Reveal is never the end: RE_DERIVATION_PASSED forces a teachback, and
 *    the teachback is capped so a grinding student can't be held hostage.
 *  - Retests retire after 2 passes; a failed retest re-enters at rung 1.
 */
export type TutorState = 'watching' | 'hinted' | 'revealed' | 'discussing' | 'retesting';

export type TutorEvent =
  | { type: 'STEP_OK'; stepId: string }
  | { type: 'STEP_BAD'; stepId: string } // silent mark; machine just counts
  | { type: 'ASK_HELP'; stepId: string } // student-initiated: always served
  | { type: 'ASK_REVEAL'; stepId: string } // "just tell me"
  | { type: 'PAUSED_AT_ERROR'; stepId: string } // idle with unfixed error
  | { type: 'DECLARE_DONE' }
  | { type: 'ATTEMPT_COMMITTED'; stepId: string } // the climb gate
  | { type: 'HINT_ACKED' } // student responded to a hint
  | { type: 'RE_DERIVATION_PASSED' } // corrected step verified
  | { type: 'TEACHBACK_PASSED' }
  | { type: 'TEACHBACK_FAILED' }
  | { type: 'RETEST_DUE' }
  | { type: 'RETEST_PASSED' }
  | { type: 'RETEST_FAILED' }
  | { type: 'ABANDONED' };

export interface TutorSession {
  state: TutorState;
  problemId: string;
  currentRung: 0 | 1 | 2 | 3;
  stepFailures: Record<string, number>;
  misconceptionIds: string[]; // named this problem so far
  stuckSignals: number; // STEP_BAD retries on same step + ASK_REVEAL
  attemptsSinceHint: number;
  teachbackRounds: number;
  retestPasses: number;
  unsolicitedUsed: number; // voice budget: offers spent
  windowStartTs: number; // for the 1-per-10min budget
  lastInterventionTs: number;
  startedTs: number;
}

/** Voice budget: unsolicited offers are scarce on purpose. */
export const NOISE_BUDGET = {
  maxUnsolicitedPerWindow: 1,
  windowMs: 10 * 60 * 1000,
  maxPerProblem: 3,
  pauseMs: 60000,
  typingQuietMs: 20000,
} as const;

export function initTutorSession(problemId: string, now: number = Date.now()): TutorSession {
  return {
    state: 'watching',
    problemId,
    currentRung: 0,
    stepFailures: {},
    misconceptionIds: [],
    stuckSignals: 0,
    attemptsSinceHint: 0,
    teachbackRounds: 0,
    retestPasses: 0,
    unsolicitedUsed: 0,
    windowStartTs: now,
    lastInterventionTs: 0,
    startedTs: now,
  };
}

/** Silent mark shared by every state that counts STEP_BAD. */
function markStepBad(s: TutorSession, stepId: string): TutorSession {
  const failures = (s.stepFailures[stepId] ?? 0) + 1;
  return {
    ...s,
    stepFailures: { ...s.stepFailures, [stepId]: failures },
    // stuck only when a step is RE-failed: the first failure is exploration
    stuckSignals: failures > 1 ? s.stuckSignals + 1 : s.stuckSignals,
  };
}

/** Clear one step's failure record (the step got fixed). */
function clearStep(s: TutorSession, stepId: string): Record<string, number> {
  if (!(stepId in s.stepFailures)) return s.stepFailures;
  const stepFailures = { ...s.stepFailures };
  delete stepFailures[stepId];
  return stepFailures;
}

/** Roll the 1-per-window budget; returns whether an offer may be spent. */
function budgetAllows(s: TutorSession, now: number): { allowed: boolean; windowStartTs: number } {
  const windowStartTs = now - s.windowStartTs >= NOISE_BUDGET.windowMs ? now : s.windowStartTs;
  const windowUsed = windowStartTs === now ? 0 : s.unsolicitedUsed;
  const allowed =
    windowUsed < NOISE_BUDGET.maxUnsolicitedPerWindow &&
    s.unsolicitedUsed < NOISE_BUDGET.maxPerProblem;
  return { allowed, windowStartTs };
}

export function applyTutorEvent(
  s: TutorSession,
  e: TutorEvent,
  now: number = Date.now(),
): TutorSession {
  // --- Global transitions (valid from ANY state) ---------------------------
  switch (e.type) {
    case 'DECLARE_DONE':
      // Full-review mode: a fresh hinted session at rung 1, no climb credit.
      return {
        ...s,
        state: 'hinted',
        currentRung: 1,
        attemptsSinceHint: 0,
        lastInterventionTs: now,
      };
    case 'ABANDONED':
      // Student walked away: everything resets EXCEPT the misconceptions we
      // named (they describe the student, not this attempt) and startedTs.
      return {
        ...s,
        state: 'watching',
        currentRung: 0,
        stepFailures: {},
        stuckSignals: 0,
        attemptsSinceHint: 0,
        teachbackRounds: 0,
        retestPasses: 0,
        unsolicitedUsed: 0,
        windowStartTs: now,
        lastInterventionTs: now,
      };
    case 'ASK_HELP':
      // Student-initiated: always served, never budgeted.
      return {
        ...s,
        state: 'hinted',
        currentRung: 1,
        attemptsSinceHint: 0,
        lastInterventionTs: now,
      };
    case 'ASK_REVEAL':
      // "Just tell me" — served, and it IS a stuck signal.
      return {
        ...s,
        state: 'revealed',
        currentRung: 3,
        stuckSignals: s.stuckSignals + 1,
        lastInterventionTs: now,
      };
  }

  // --- State-scoped transitions --------------------------------------------
  switch (s.state) {
    case 'watching':
      switch (e.type) {
        case 'STEP_OK':
          return { ...s, stepFailures: clearStep(s, e.stepId) };
        case 'STEP_BAD':
          return markStepBad(s, e.stepId);
        case 'PAUSED_AT_ERROR': {
          const { allowed, windowStartTs } = budgetAllows(s, now);
          if (!allowed) return { ...s, windowStartTs }; // stays watching, silently
          return {
            ...s,
            state: 'hinted',
            currentRung: 1,
            attemptsSinceHint: 0,
            unsolicitedUsed: s.unsolicitedUsed + 1,
            windowStartTs,
            lastInterventionTs: now,
          };
        }
        default:
          return { ...s };
      }

    case 'hinted':
      switch (e.type) {
        case 'ATTEMPT_COMMITTED':
          // The climb gate: only a committed attempt earns a higher rung,
          // and the climb caps at rung 2 — rung 3 is reveal-only.
          return {
            ...s,
            attemptsSinceHint: s.attemptsSinceHint + 1,
            currentRung: Math.min(2, s.currentRung + 1) as 0 | 1 | 2 | 3,
          };
        case 'STEP_OK':
          // The committed attempt fixed the step: back to watching.
          return {
            ...s,
            state: 'watching',
            currentRung: 0,
            stepFailures: clearStep(s, e.stepId),
            attemptsSinceHint: 0,
          };
        case 'STEP_BAD':
          return markStepBad(s, e.stepId);
        case 'HINT_ACKED':
          return { ...s };
        default:
          return { ...s };
      }

    case 'revealed':
      switch (e.type) {
        case 'RE_DERIVATION_PASSED':
          // The re-derivation is the price of the reveal; now make them say it.
          return { ...s, state: 'discussing', teachbackRounds: 0 };
        case 'STEP_OK':
          return {
            ...s,
            state: 'watching',
            currentRung: 0,
            stepFailures: clearStep(s, e.stepId),
            attemptsSinceHint: 0,
          };
        case 'STEP_BAD':
          return markStepBad(s, e.stepId);
        default:
          return { ...s };
      }

    case 'discussing':
      switch (e.type) {
        case 'TEACHBACK_PASSED':
          return { ...s, state: 'retesting', retestPasses: 0 };
        case 'TEACHBACK_FAILED':
          // Cap at 2 rounds, then move on anyway — protect against grinding.
          if (s.teachbackRounds < 2) {
            return { ...s, teachbackRounds: s.teachbackRounds + 1 };
          }
          return { ...s, state: 'retesting' };
        default:
          return { ...s };
      }

    case 'retesting':
      switch (e.type) {
        case 'RETEST_PASSED': {
          const retestPasses = s.retestPasses + 1;
          if (retestPasses >= 2) {
            // Retired: two spaced passes is enough — back to watching.
            return { ...s, state: 'watching', currentRung: 0, retestPasses, attemptsSinceHint: 0 };
          }
          return { ...s, retestPasses };
        }
        case 'RETEST_FAILED':
          // Spaced retest failed: the misconception is live again, re-enter
          // at rung 1 (not a fresh reveal — they saw the answer once).
          return {
            ...s,
            state: 'hinted',
            currentRung: 1,
            attemptsSinceHint: 0,
            lastInterventionTs: now,
          };
        default:
          return { ...s };
      }
  }
}
