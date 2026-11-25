/**
 * studentSim — the offline learner simulator (StudentSim, Palimpsest-style).
 * Pure scorer: train from graded history, reward stances, predict best.
 */
import { describe, expect, test } from 'vitest';

import {
  eventsFromLedger,
  predictBestStance,
  stanceReward,
  trainStudentSim,
} from '@/services/professor/studentSim';
import type { Stance } from '@/services/professor/stance';
import type { ConceptState } from '@/services/professor/learner';

describe('trainStudentSim', () => {
  test('computes per-stance improvement rates from history', () => {
    const sim = trainStudentSim([
      { concept: 'x', stance: 'scaffold-one-rung', improved: true },
      { concept: 'x', stance: 'scaffold-one-rung', improved: false },
      { concept: 'x', stance: 'worked-example', improved: true },
    ]);
    expect(sim.gradedCount).toBe(3);
    const scaffold = sim.effects.find((e) => e.stance === 'scaffold-one-rung')!;
    expect(scaffold.attempts).toBe(2);
    expect(scaffold.improvedRate).toBeCloseTo(0.5);
  });
});

describe('stanceReward', () => {
  test('uses direct evidence once there are >=3 attempts', () => {
    const sim = trainStudentSim([
      { concept: 'a', stance: 'socratic', improved: true },
      { concept: 'a', stance: 'socratic', improved: true },
      { concept: 'a', stance: 'socratic', improved: true },
    ]);
    expect(stanceReward(sim, 'socratic')).toBe(1);
  });

  test('falls back to the overall rate on thin evidence (<3 attempts)', () => {
    const sim = trainStudentSim([
      { concept: 'a', stance: 'reveal-with-warmth', improved: true },
      { concept: 'b', stance: 'scaffold-one-rung', improved: false },
    ]);
    // reveal has only 1 direct attempt — falls back to overall (0.5)
    expect(stanceReward(sim, 'reveal-with-warmth')).toBeCloseTo(0.5);
  });
});

describe('predictBestStance', () => {
  test('picks the stance with the best measured reward on this learner', () => {
    const sim = trainStudentSim([
      { concept: 'a', stance: 'worked-example', improved: true },
      { concept: 'a', stance: 'worked-example', improved: true },
      { concept: 'a', stance: 'worked-example', improved: true },
      { concept: 'a', stance: 'socratic', improved: false },
      { concept: 'a', stance: 'socratic', improved: false },
      { concept: 'a', stance: 'socratic', improved: true },
    ]);
    const candidates: Stance[] = ['worked-example', 'socratic', 'scaffold-one-rung'];
    expect(predictBestStance(sim, candidates)).toBe('worked-example');
  });
});

describe('eventsFromLedger', () => {
  const state = (graded: Array<'pass' | 'retry'>): ConceptState => ({
    bloom: 3,
    asked: 4,
    last_ts: '2026-01-01T00:00:00Z',
    graded,
  });

  test('builds before/after events from graded pairs', () => {
    const events = eventsFromLedger(
      { attention: state(['retry', 'pass', 'pass']) },
      () => 'scaffold-one-rung',
    );
    // 2 pairs: retry->pass (improved), pass->pass (improved)
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.improved)).toBe(true);
  });

  test('skips concepts with <2 graded outcomes', () => {
    const events = eventsFromLedger({ thin: state(['pass']) }, () => 'answer-now');
    expect(events).toHaveLength(0);
  });
});
