/**
 * Stance decision table tests (Wave 3, audit Ruling 4; TUTORRL_DEEPDIVE §5).
 * One test per state row, plus the non-negotiables: an asked question
 * ALWAYS answers (R1), a posed check ladders, a stuck signal releases only
 * with a failed attempt behind it (§16 + #21), direct telling is
 * first-class (Ruling 5 #8). Also pins the prompt integration: the system
 * prompt carries the rendered table, and the desk hands the matching row
 * down per turn.
 */
import { describe, expect, it } from 'vitest';
import {
  decideStance,
  matchingRow,
  renderStanceLine,
  renderStanceTable,
  signalOf,
  STANCE_ROWS,
  type StanceInput,
} from '@/services/professor/stance';
import {
  PROFESSOR_SYSTEM_PROMPT,
  PROFESSOR_WORKBENCH_SYSTEM_PROMPT,
} from '@/services/professor/prompt';
import { composeWorkbenchTurnMessage } from '@/services/professor/workbenchSession';
import type { LearnerState } from '@/services/professor/learner';
import type { ProfessorContextPack } from '@/services/professor/contextPack';
import {
  nextAttemptImproved,
  noteStanceOutcome,
  resetStanceOutcomes,
  stanceOutcomeRates,
} from '@/services/professor/telemetry';

const base: StanceInput = {
  initiation: 'posed',
  mastery: 'unknown',
  verdict: 'none',
  signal: 'none',
};

describe('signalOf — the learner’s words this turn', () => {
  it('detects the stuck family', () => {
    expect(signalOf("I don't know")).toBe('stuck');
    expect(signalOf('i do not know')).toBe('stuck');
    expect(signalOf('I have no idea')).toBe('stuck');
    expect(signalOf('no idea')).toBe('stuck');
    expect(signalOf("I'm stuck")).toBe('stuck');
  });

  it('detects an explicit ask for the answer', () => {
    expect(signalOf('just tell me')).toBe('ask-answer');
    expect(signalOf('ok just tell me the answer please')).toBe('ask-answer');
    expect(signalOf("what's the answer?")).toBe('ask-answer');
  });

  it('an ask-for-the-answer outranks stuck when both appear', () => {
    expect(signalOf("I don't know, just tell me")).toBe('ask-answer');
  });

  it('ordinary words signal nothing', () => {
    expect(signalOf('I subtract 3 from both sides')).toBe('none');
    expect(signalOf('why does that work?')).toBe('none');
  });
});

describe('the table — one test per row', () => {
  it('row 1: an asked question is answered — ALWAYS, whatever else is true (R1)', () => {
    expect(decideStance({ ...base, initiation: 'asked' })).toBe('answer-now');
    expect(decideStance({ ...base, initiation: 'asked', signal: 'stuck' })).toBe('answer-now');
    expect(decideStance({ ...base, initiation: 'asked', signal: 'ask-answer' })).toBe('answer-now');
    expect(decideStance({ ...base, initiation: 'asked', verdict: 'retry' })).toBe('answer-now');
    expect(decideStance({ ...base, initiation: 'asked', probeLevel: 6 })).toBe('answer-now');
  });

  it('row 2: an explicit "just tell me" on a posed check releases with warmth (R1)', () => {
    expect(decideStance({ ...base, signal: 'ask-answer' })).toBe('reveal-with-warmth');
  });

  it('row 3: stuck WITH a failed attempt behind it bottoms out (§16 — the stuck signal releases)', () => {
    expect(decideStance({ ...base, signal: 'stuck', verdict: 'retry' })).toBe('reveal-with-warmth');
  });

  it('row 4: a first "I don’t know" earns the smallest cue — never past rung 1 (#21)', () => {
    expect(decideStance({ ...base, signal: 'stuck' })).toBe('scaffold-one-rung');
    expect(decideStance({ ...base, signal: 'stuck', verdict: 'pass' })).toBe('scaffold-one-rung');
  });

  it('row 5: a failed attempt gets the smallest worked piece at the divergence (TutorRL)', () => {
    expect(decideStance({ ...base, verdict: 'retry' })).toBe('worked-example');
  });

  it('row 6: a passed check is confirmed, then raised one level (TutorRL)', () => {
    expect(decideStance({ ...base, verdict: 'pass' })).toBe('socratic');
  });

  it('row 7: a profile that asks to be probed climbs (R2)', () => {
    expect(decideStance({ ...base, probeLevel: 5 })).toBe('socratic');
    expect(decideStance({ ...base, probeLevel: 6 })).toBe('socratic');
  });

  it('row 8: a profile that asks to be led gets the demonstration (R2)', () => {
    expect(decideStance({ ...base, probeLevel: 1 })).toBe('worked-example');
    expect(decideStance({ ...base, probeLevel: 2 })).toBe('worked-example');
  });

  it('row 9: the Wave 2 ledger’s "known" fades the scaffold — raise stakes, never re-teach', () => {
    expect(decideStance({ ...base, mastery: 'known' })).toBe('socratic');
  });

  it('row 10 (default): a posed check with no attempt earns the smallest hint first (§16)', () => {
    expect(decideStance(base)).toBe('scaffold-one-rung');
    expect(decideStance({ ...base, probeLevel: 3 })).toBe('scaffold-one-rung');
    expect(decideStance({ ...base, probeLevel: 4 })).toBe('scaffold-one-rung');
    expect(decideStance({ ...base, mastery: 'edge' })).toBe('scaffold-one-rung');
  });

  it('the table is total and first-match-wins', () => {
    // Every reachable state lands on a row.
    const states: StanceInput[] = [];
    for (const initiation of ['asked', 'posed'] as const)
      for (const mastery of ['unknown', 'edge', 'known'] as const)
        for (const verdict of ['none', 'pass', 'retry'] as const)
          for (const signal of ['none', 'stuck', 'ask-answer'] as const)
            for (const probeLevel of [undefined, 1, 3, 6])
              states.push({ initiation, mastery, verdict, signal, probeLevel });
    for (const s of states) {
      expect(STANCE_ROWS).toContainEqual(matchingRow(s));
      expect(decideStance(s)).toBe(matchingRow(s).stance);
    }
  });
});

describe('rendering — the prompt carries the table, the turn carries the row', () => {
  it('renderStanceTable numbers every row and names every stance', () => {
    const table = renderStanceTable();
    expect(table).toContain('1.');
    expect(table).toContain(`${STANCE_ROWS.length}.`);
    for (const stance of [
      'answer-now',
      'worked-example',
      'scaffold-one-rung',
      'socratic',
      'reveal-with-warmth',
    ]) {
      expect(table).toContain(stance);
    }
  });

  it('renderStanceLine names the SAME stance decideStance picks', () => {
    const input: StanceInput = { ...base, signal: 'stuck', verdict: 'retry' };
    expect(renderStanceLine(input)).toContain(decideStance(input));
  });

  it('the system prompt carries the rendered table; the rungs survive as vocabulary', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).toContain(renderStanceTable());
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('Rung 0');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('Rung 3');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain("the table's, not your discretion");
    // The pinned Wave 1 contract lines survive.
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('answered immediately and completely');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('never a gate on their questions');
    // The old prose decision is gone — the table decides now.
    expect(PROFESSOR_SYSTEM_PROMPT).not.toContain('Climb one rung per exchange');
    expect(PROFESSOR_SYSTEM_PROMPT).not.toContain('Release is decided from the learner');
  });

  it('the workbench addendum defers to the table', () => {
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain('the decision table chooses the move');
  });
});

describe('the desk hands the matching row down per turn', () => {
  const pack = {
    blocks: [],
    recent_exchanges: [],
    concept_states: {},
  } as unknown as ProfessorContextPack;
  const learnerWith = (graded: Array<'pass' | 'retry'>): LearnerState => ({
    exchanges: [],
    concept_states: {
      radicals: { bloom: 2, asked: 2, last_ts: '2026-11-25T00:00:00Z', graded },
    },
  });
  const posedHistory = [
    {
      id: 'b1',
      author: 'professor' as const,
      content:
        'Work this step: what is the radical of (x)? Take a try.\n[CONCEPT:radicals]\n[QKIND:check-me]',
      at: '2026-11-25T10:00:00Z',
    },
  ];

  it('posed check + failed attempt + "I don’t know" → reveal-with-warmth (row 3)', () => {
    const msg = composeWorkbenchTurnMessage({
      pack,
      page: 1,
      history: posedHistory,
      userContent: "I don't know",
      learner: learnerWith(['retry']),
    });
    expect(msg).toContain('This turn’s stance, from the decision table');
    expect(msg).toContain('reveal-with-warmth');
  });

  it('posed check + first "I don’t know" → scaffold-one-rung (row 4)', () => {
    const msg = composeWorkbenchTurnMessage({
      pack,
      page: 1,
      history: posedHistory,
      userContent: "I don't know",
      learner: learnerWith([]),
    });
    expect(msg).toContain('scaffold-one-rung');
  });

  it('a side question mid-check is ASKED → answer-now (R1)', () => {
    const msg = composeWorkbenchTurnMessage({
      pack,
      page: 1,
      history: posedHistory,
      userContent: 'side question — is a radical ideal the same as a prime ideal?',
      learner: learnerWith(['retry']),
    });
    expect(msg).toContain('answer-now');
  });

  it('the profile’s probe preference rides into the row (R2)', () => {
    const msg = composeWorkbenchTurnMessage({
      pack,
      page: 1,
      history: posedHistory,
      userContent: 'hmm',
      learner: learnerWith([]),
      profile: { probe_level: 6 },
    });
    expect(msg).toContain('socratic');
  });
});

describe('telemetry — the r_sol proxy (a number, not machinery talk)', () => {
  it('improvement is: failed before, passed after', () => {
    expect(nextAttemptImproved('retry', 'pass')).toBe(true);
    expect(nextAttemptImproved('retry', 'retry')).toBe(false);
    expect(nextAttemptImproved('pass', 'pass')).toBe(false);
  });

  it('rates accumulate per stance', () => {
    resetStanceOutcomes();
    noteStanceOutcome('scaffold-one-rung', true);
    noteStanceOutcome('scaffold-one-rung', false);
    noteStanceOutcome('worked-example', true);
    const rates = stanceOutcomeRates();
    expect(rates['scaffold-one-rung']).toEqual({ n: 2, improved: 1, rate: 0.5 });
    expect(rates['worked-example']).toEqual({ n: 1, improved: 1, rate: 1 });
    resetStanceOutcomes();
    expect(stanceOutcomeRates()).toEqual({});
  });
});
