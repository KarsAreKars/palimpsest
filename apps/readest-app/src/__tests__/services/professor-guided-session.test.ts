/**
 * Guided session contract tests (Learning Engine Wave A — THE FORM's
 * first-class mode). Pins: the lifecycle (idle → measuring → planning →
 * teaching → practicing → reporting → done), pause/resume, the mastery
 * exit at 80% (A13), the erotetic default (professor-posed →
 * scaffold/worked-example, learner-asked → answer-now, C2), the state
 * read adjusting the first beat (A3), and the librarian-voice report.
 */
import { describe, expect, test } from 'vitest';
import {
  buildGuidedBeatPrompt,
  buildSessionReportMd,
  currentConcept,
  firstBeatAdjustment,
  guidedStance,
  idleSession,
  masteryExitReached,
  readStateFromLedger,
  sessionReducer,
  teachSequence,
  type GuidedSessionState,
  type SessionEvent,
} from '@/services/professor/guidedSession';
import { planRoute, type StudyRoute } from '@/services/professor/planRoute';
import type { ConceptState } from '@/services/professor/learner';
import {
  GUIDED_SESSION_ADDENDUM,
  PROFESSOR_GUIDED_SYSTEM_PROMPT,
  PROFESSOR_SYSTEM_PROMPT,
} from '@/services/professor/prompt';
import type { Stance } from '@/services/professor/stance';

const T = '2026-11-26T00:00:00Z';

const states: Record<string, ConceptState> = {
  softmax: { bloom: 4, asked: 2, last_ts: T, graded: ['pass', 'pass', 'pass', 'pass', 'pass'] },
  dot_product: { bloom: 2, asked: 1, last_ts: T, graded: ['pass', 'retry'] },
};

const route: StudyRoute = planRoute({
  goal: 'attention',
  conceptStates: states,
  seeds: [{ name: 'queries' }, { name: 'keys' }, { name: 'values' }],
});

const walk = (s: GuidedSessionState, ...events: SessionEvent[]): GuidedSessionState =>
  events.reduce(sessionReducer, s);

/** A session in teaching phase on the fixture route. */
const teachingSession = (): GuidedSessionState =>
  walk(
    idleSession(),
    { type: 'start', goal: 'attention' },
    { type: 'measured', stateRead: 'steady' },
    { type: 'planned', route },
  );

describe('the route and the teaching sequence', () => {
  test('the sequence is the route minus what the learner owns, goal last', () => {
    const seq = teachSequence(route);
    expect(seq.map((n) => n.name)).not.toContain('softmax'); // known — never re-drilled
    expect(seq[0]?.name).toBe('dot_product'); // the edge leads
    expect(seq[seq.length - 1]?.role).toBe('goal');
  });
});

describe('the session lifecycle', () => {
  test('start → measure → plan → teach → practice → report → done', () => {
    let s = idleSession();
    expect(s.phase).toBe('idle');

    s = sessionReducer(s, { type: 'start', goal: 'attention' });
    expect(s.phase).toBe('measuring');
    expect(s.goal).toBe('attention');

    s = sessionReducer(s, { type: 'measured', stateRead: 'defended' });
    expect(s.phase).toBe('planning');
    expect(s.stateRead).toBe('defended'); // the state read lands before any teaching

    s = sessionReducer(s, { type: 'planned', route });
    expect(s.phase).toBe('teaching');
    expect(currentConcept(s)?.name).toBe('dot_product');

    // Walk the road: each concept exits on a pass (the mastery exit).
    const seq = teachSequence(route);
    for (const node of seq) {
      expect(currentConcept(s)?.name).toBe(node.name);
      s = sessionReducer(s, { type: 'verdict', concept: node.name, verdict: 'pass' });
      s = sessionReducer(s, { type: 'nextConcept' });
    }
    expect(s.phase).toBe('practicing');

    s = sessionReducer(s, { type: 'practiceDone' });
    expect(s.phase).toBe('reporting');

    s = sessionReducer(s, { type: 'reportFiled' });
    expect(s.phase).toBe('done');
  });

  test('a route with nothing to teach goes straight to practice', () => {
    const walked: StudyRoute = {
      goal: 'g',
      goalLabel: 'g',
      nodes: [{ name: 'a', label: 'a', mastery: 'known', role: 'known' }],
    };
    const s = walk(
      idleSession(),
      { type: 'start', goal: 'g' },
      { type: 'measured', stateRead: 'steady' },
      { type: 'planned', route: walked },
    );
    expect(s.phase).toBe('practicing');
  });

  test('a session never starts over a live one; reset returns to rest', () => {
    const live = teachingSession();
    expect(sessionReducer(live, { type: 'start', goal: 'other' })).toBe(live);
    expect(sessionReducer(live, { type: 'reset' }).phase).toBe('idle');
  });

  test('the learner may leave at any time — the session reports, then rests', () => {
    const s = walk(teachingSession(), { type: 'exit' });
    expect(s.phase).toBe('reporting');
    expect(sessionReducer(s, { type: 'reportFiled' }).phase).toBe('done');
  });
});

describe('pause and resume (free-mode interruption)', () => {
  test('a paused session holds its place — no silent advancement', () => {
    let s = teachingSession();
    s = sessionReducer(s, { type: 'pause' });
    expect(s.paused).toBe(true);
    // A late verdict is still evidence — it records, and the exit can fire.
    s = sessionReducer(s, { type: 'verdict', concept: 'dot_product', verdict: 'pass' });
    expect(s.graded['dot_product']).toEqual(['pass']);
    expect(s.exits).toContain('dot_product');
    // …but the session does not advance while paused.
    expect(sessionReducer(s, { type: 'nextConcept' })).toBe(s);
    expect(sessionReducer(s, { type: 'skipConcept' })).toBe(s);
    s = sessionReducer(s, { type: 'resume' });
    expect(s.paused).toBe(false);
    const advanced = sessionReducer(s, { type: 'nextConcept' });
    expect(advanced.conceptIdx).toBe(1);
  });
});

describe('the mastery exit (A13: stamp, say so, leave)', () => {
  test('the exit fires AT 80% of the in-session graded window', () => {
    let s = teachingSession();
    // A miss opens the window at 0% — the repair loop runs, no exit.
    s = sessionReducer(s, { type: 'verdict', concept: 'dot_product', verdict: 'retry' });
    expect(masteryExitReached(s, 'dot_product')).toBe(false);
    // 50%, 67%, 75% — forming, not yet held.
    s = sessionReducer(s, { type: 'verdict', concept: 'dot_product', verdict: 'pass' });
    expect(masteryExitReached(s, 'dot_product')).toBe(false);
    s = sessionReducer(s, { type: 'verdict', concept: 'dot_product', verdict: 'pass' });
    expect(masteryExitReached(s, 'dot_product')).toBe(false);
    s = sessionReducer(s, { type: 'verdict', concept: 'dot_product', verdict: 'pass' });
    expect(masteryExitReached(s, 'dot_product')).toBe(false);
    expect(s.exits).not.toContain('dot_product');
    // Window [retry, pass, pass, pass, pass] = 0.8 — the exit fires.
    s = sessionReducer(s, { type: 'verdict', concept: 'dot_product', verdict: 'pass' });
    expect(masteryExitReached(s, 'dot_product')).toBe(true);
    expect(s.exits).toContain('dot_product');
  });

  test('the exit is stamped once and never re-drilled', () => {
    let s = teachingSession();
    s = sessionReducer(s, { type: 'verdict', concept: 'dot_product', verdict: 'pass' });
    expect(s.exits).toEqual(['dot_product']);
    s = sessionReducer(s, { type: 'verdict', concept: 'dot_product', verdict: 'pass' });
    expect(s.exits).toEqual(['dot_product']);
  });

  test('skipping is the learner’s agency — recorded without blame', () => {
    let s = teachingSession();
    s = sessionReducer(s, { type: 'skipConcept' });
    expect(s.skipped).toEqual(['dot_product']);
    expect(s.conceptIdx).toBe(1);
    expect(s.exits).toEqual([]); // a skip is not a verdict
  });
});

describe('the erotetic default (C2 held)', () => {
  test('a question the learner asks is answered completely — answer-now, always', () => {
    expect(
      guidedStance({ initiation: 'asked', mastery: 'unknown', verdict: 'none', signal: 'none' }),
    ).toBe('answer-now');
    expect(
      guidedStance({ initiation: 'asked', mastery: 'known', verdict: 'pass', signal: 'stuck' }),
    ).toBe('answer-now');
  });

  test('a beat the professor poses is a trial — scaffold or worked-example, never answer-now', () => {
    expect(
      guidedStance({ initiation: 'posed', mastery: 'unknown', verdict: 'none', signal: 'none' }),
    ).toBe('scaffold-one-rung');
    expect(
      guidedStance({ initiation: 'posed', mastery: 'edge', verdict: 'retry', signal: 'none' }),
    ).toBe('worked-example');
    // The whole posed matrix: answer-now is unreachable for a posed beat.
    const masteries = ['unknown', 'edge', 'known'] as const;
    const verdicts = ['none', 'pass', 'retry'] as const;
    const signals = ['none', 'stuck', 'ask-answer'] as const;
    const posed: Stance[] = masteries.flatMap((mastery) =>
      verdicts.flatMap((verdict) =>
        signals.map((signal) => guidedStance({ initiation: 'posed', mastery, verdict, signal })),
      ),
    );
    expect(posed).not.toContain('answer-now');
  });
});

describe('the state read (A3) — latent, before the lesson', () => {
  test('an empty ledger reads steady — begin conservatively', () => {
    expect(readStateFromLedger({})).toBe('steady');
  });

  test('stuck re-asking with no graded pass reads defended', () => {
    expect(
      readStateFromLedger({
        softmax: { bloom: 1, asked: 3, last_ts: T, graded: ['retry', 'retry'] },
      }),
    ).toBe('defended');
  });

  test('many concepts touched, none ever checked, reads rushed', () => {
    const skimmed: Record<string, ConceptState> = {};
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      skimmed[name] = { bloom: 2, asked: 1, last_ts: T };
    }
    expect(readStateFromLedger(skimmed)).toBe('rushed');
  });

  test('the state read adjusts the FIRST beat — state-repair before content-repair', () => {
    expect(firstBeatAdjustment('defended').move).toBe('shrink-step');
    expect(firstBeatAdjustment('rushed').move).toBe('lower-stakes');
    expect(firstBeatAdjustment('bored').move).toBe('change-angle');
    expect(firstBeatAdjustment('steady').move).toBe('none');
    const first = buildGuidedBeatPrompt({
      goal: 'attention',
      route,
      conceptIdx: 0,
      stateRead: 'defended',
    });
    expect(first).toContain(firstBeatAdjustment('defended').line);
    const later = buildGuidedBeatPrompt({
      goal: 'attention',
      route,
      conceptIdx: 1,
      stateRead: 'defended',
    });
    expect(later).not.toContain(firstBeatAdjustment('defended').line);
  });
});

describe('the teach beat — a trial, not a lecture', () => {
  test('the beat prompt carries the erotetic contract and the verdict contract', () => {
    const prompt = buildGuidedBeatPrompt({
      goal: 'attention',
      route,
      conceptIdx: 0,
      stateRead: 'steady',
    });
    expect(prompt).toContain('trial, not a lecture');
    expect(prompt).toContain('generate the idea myself');
    expect(prompt).toContain('[PASS]');
    expect(prompt).toContain('[RETRY]');
    expect(prompt).toContain('[CAPTION:');
    expect(prompt).toContain('[CONCEPT:dot_product][QKIND:check-me]');
    // C2: an asked question is answered completely, then the trial resumes.
    expect(prompt).toContain('answer it completely and immediately');
  });

  test('no beat past the end of the road', () => {
    expect(
      buildGuidedBeatPrompt({ goal: 'attention', route, conceptIdx: 99, stateRead: 'steady' }),
    ).toBeNull();
  });
});

describe('the session report — librarian voice, no machinery', () => {
  const finished = walk(
    teachingSession(),
    { type: 'verdict', concept: 'dot_product', verdict: 'pass' },
    { type: 'nextConcept' },
    { type: 'skipConcept' },
  );

  test('what took hold, what is forming, what waits, what is next', () => {
    const md = buildSessionReportMd(finished, { date: 'Nov 26', page: 12, dueCount: 3 });
    expect(md).toContain('guided session — attention');
    expect(md).toContain('Taking hold: dot product');
    expect(md).toContain('Waiting its turn:');
    expect(md).toContain('Next time, the road picks up at');
    expect(md).toContain('due back on the desk');
  });

  test('no machinery talk, no scores, no streaks', () => {
    const md = buildSessionReportMd(finished, { date: 'Nov 26', page: 12 });
    expect(md).not.toMatch(/FSRS|streak|score|XP|80%|queue|dashboard/i);
  });
});

describe('the guided-session prompt section', () => {
  test('the erotetic method is encoded — and it never gates a learner question', () => {
    expect(GUIDED_SESSION_ADDENDUM).toContain('trials, not lectures');
    expect(GUIDED_SESSION_ADDENDUM).toContain('answer it completely and immediately');
    expect(GUIDED_SESSION_ADDENDUM).toContain('it never gates them');
    expect(GUIDED_SESSION_ADDENDUM).toContain('generate the idea before you reveal it');
  });

  test('the mentor doctrine is encoded', () => {
    expect(GUIDED_SESSION_ADDENDUM).toContain('Withhold until ready');
    expect(GUIDED_SESSION_ADDENDUM).toContain('Believe before evidence');
    expect(GUIDED_SESSION_ADDENDUM).toContain('never lie about the current state');
    expect(GUIDED_SESSION_ADDENDUM).toContain('Know when to leave');
    expect(GUIDED_SESSION_ADDENDUM).toContain('Teach the person');
    expect(GUIDED_SESSION_ADDENDUM).toContain('Respect their agency');
  });

  test('the guided prompt composes the persona additively', () => {
    expect(PROFESSOR_GUIDED_SYSTEM_PROMPT).toContain(PROFESSOR_SYSTEM_PROMPT);
    expect(PROFESSOR_GUIDED_SYSTEM_PROMPT).toContain(GUIDED_SESSION_ADDENDUM);
    expect(PROFESSOR_SYSTEM_PROMPT).not.toContain('GUIDED SESSION');
  });
});
