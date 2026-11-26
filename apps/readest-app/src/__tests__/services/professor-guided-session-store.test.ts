/**
 * guidedSessionStore — controller regression tests (Wave A2). The state
 * machine itself is pinned in professor-guided-session.test.ts; this suite
 * pins the DRIVER the Wave A panel lacked, and the bugs the owner hit:
 *
 *   - the session survives the surface that opened it (the store, not a
 *     tab's useReducer — tab switch no longer wipes a live session);
 *   - the verdict intake is ordered and race-free (the professor's turn
 *     lands in the conversation first, then the verdict, then the
 *     advance — one onAnswer channel, no annotation-bus race);
 *   - PRACTICE CAN COMPLETE: the concept tag arrives on the full parsed
 *     list (Wave A read the bus set, where useProfessor strips concept/
 *     qkind — the stamped set never filled and the session never ended);
 *   - PAUSE BETWEEN ANSWER AND VERDICT NO LONGER WEDGES: the advance is
 *     recorded and runs on resume (Wave A dropped it and blocked re-ask);
 *   - text-to-text is the default: asks are silent unless voiceOn;
 *   - a stale stream after reset cannot append into a new session.
 *
 * The professor is simulated: asks are captured at the bridge; completing
 * one calls its onAnswer with prose + parsed tags, exactly as
 * useProfessor's onDone does.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProfessorAnnotation } from '@/services/professor/annotations';
import { buildConversation, teachSequence } from '@/services/professor/guidedSession';

// ── The bridge, captured ────────────────────────────────────────────────────
interface CapturedAsk {
  bookKey: string;
  question: string;
  opts: {
    system?: string;
    silent?: boolean;
    onAnswer?: (text: string, annotations: ProfessorAnnotation[]) => void;
    onError?: (message: string) => void;
  };
}
const asks: CapturedAsk[] = [];
vi.mock('@/services/professor/askBridge', () => ({
  askProfessorFromUI: (bookKey: string, question: string, opts: CapturedAsk['opts']) => {
    asks.push({ bookKey, question, opts });
  },
}));

// ── Stores + environment, stubbed ───────────────────────────────────────────
const fixtureBook = { hash: 'bk', title: 'Attention Is All You Need' };
const fixtureToc = [
  { label: 'Queries', index: 0 },
  { label: 'Keys', index: 1 },
];
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getBookData: () => ({ book: fixtureBook, bookDoc: { toc: fixtureToc } }),
    }),
  },
}));
vi.mock('@/store/readerProgressStore', () => ({
  getBookProgress: () => ({ index: 0 }),
}));
vi.mock('@/services/environment', () => ({
  default: { getAppService: async () => null },
}));

// ── The ledger, stubbed (empty — the conservative start) ────────────────────
vi.mock('@/services/professor/learner', async (importActual) => {
  const actual = await importActual<typeof import('@/services/professor/learner')>();
  return {
    ...actual,
    loadLearner: async () => actual.emptyLearner(),
    appendNote: async () => undefined,
    appendExchange: async () => undefined,
  };
});

import { useGuidedSessionStore } from '@/app/reader/components/notebook/guidedSessionStore';

const BK = 'bk';
const store = () => useGuidedSessionStore.getState();
const session = () => useGuidedSessionStore.getState().session;
const conversation = () => buildConversation(session());

/** Simulate the professor completing the Nth ask (0-based). */
const answer = (i: number, text: string, annotations: ProfessorAnnotation[] = []) => {
  const ask = asks[i];
  if (!ask?.opts.onAnswer) throw new Error(`ask ${i} has no onAnswer`);
  ask.opts.onAnswer(text, annotations);
};
const passTags = (concept: string): ProfessorAnnotation[] => [
  { kind: 'verdict', verdict: 'pass' },
  { kind: 'caption', text: 'the one-line takeaway' },
  { kind: 'concept', name: concept },
  { kind: 'qkind', qkind: 'check-me' },
];

beforeEach(() => {
  asks.length = 0;
  useGuidedSessionStore.getState().reset();
  useGuidedSessionStore.setState({ mode: 'free', voiceOn: false });
});

describe('begin — measure (latent), plan (the route), the first trial', () => {
  test('the session opens in teaching with the route note as the first turn', async () => {
    await store().begin(BK, 'attention');
    expect(session().phase).toBe('teaching');
    expect(session().goal).toBe('attention');
    expect(session().route).not.toBeNull();
    // The route: the book's seeds + the goal, nothing owned (empty ledger).
    expect(teachSequence(session().route!).map((n) => n.name)).toEqual([
      'queries',
      'keys',
      'attention',
    ]);
    // The erotetic opening: the route note, then his first question.
    const turns = conversation();
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ speaker: 'professor', kind: 'note' });
    expect(turns[0]!.text).toContain('the road to attention');
    expect(asks).toHaveLength(1);
    expect(asks[0]!.question).toContain('Guided session on "attention"');
    expect(asks[0]!.question).toContain('a trial, not a lecture');
    // Text-to-text by default: the ask is silent, the guided doctrine rides.
    expect(asks[0]!.opts.silent).toBe(true);
    expect(asks[0]!.opts.system).toContain('GUIDED SESSION');
  });

  test('voice is opt-in: the speaker toggle un-silences later asks', async () => {
    useGuidedSessionStore.setState({ voiceOn: true });
    await store().begin(BK, 'attention');
    expect(asks[0]!.opts.silent).toBe(false);
  });

  test('begin never fires over a live session', async () => {
    await store().begin(BK, 'attention');
    await store().begin(BK, 'something else');
    expect(asks).toHaveLength(1);
    expect(session().goal).toBe('attention');
  });
});

describe('the beat — question, answer, verdict, advance (in order)', () => {
  test('a graded pass lands as turns in order and moves the machine', async () => {
    await store().begin(BK, 'attention');
    answer(0, 'What does a query do?'); // his trial
    store().answer(BK, 'It looks things up.'); // your attempt
    expect(conversation().map((t) => t.speaker)).toEqual(['professor', 'professor', 'learner']);
    answer(1, 'Exactly — a lookup. [PASS]', passTags('queries')); // his verdict
    const turns = conversation();
    expect(turns.map((t) => t.kind)).toEqual(['note', 'trial', 'note', 'verdict', 'note']);
    expect(turns[3]).toMatchObject({ speaker: 'professor', verdict: 'pass' });
    // One pass = 100% of the window → the mastery exit fires (A13) and he
    // says so, in his voice, before the next trial.
    expect(session().exits).toContain('queries');
    expect(turns[4]!.text).toContain("You've got this");
    expect(asks).toHaveLength(3); // the next trial posed
    expect(session().conceptIdx).toBe(1);
    answer(2, 'And a key?');
    expect(conversation().at(-1)).toMatchObject({ kind: 'trial', text: 'And a key?' });
  });

  test('a free question mid-trial is answered without moving the machine (C2)', async () => {
    await store().begin(BK, 'attention');
    answer(0, 'What does a query do?');
    store().answer(BK, 'wait — what is a key, exactly?');
    answer(1, 'A key is what a query matches against.'); // no verdict tags
    expect(session().conceptIdx).toBe(0);
    expect(session().graded).toEqual({});
    expect(asks).toHaveLength(2); // nothing re-asked; the trial still stands
    expect(conversation().at(-1)).toMatchObject({ speaker: 'professor', kind: 'trial' });
  });

  test('a retry earns one re-ask, never an instant advance', async () => {
    await store().begin(BK, 'attention');
    answer(0, 'What does a query do?');
    store().answer(BK, 'no idea');
    answer(1, 'Not yet. [RETRY]', [
      { kind: 'verdict', verdict: 'retry' },
      { kind: 'concept', name: 'queries' },
    ]);
    expect(session().conceptIdx).toBe(0); // held
    expect(asks).toHaveLength(3); // the retry re-ask
    expect(asks[2]!.question).toContain('another go');
  });
});

describe('regression: pause between answer and verdict no longer wedges', () => {
  test('the advance waits for resume and then runs', async () => {
    await store().begin(BK, 'attention');
    answer(0, 'What does a query do?');
    store().answer(BK, 'It looks things up.');
    store().pause();
    answer(1, 'Exactly. [PASS]', passTags('queries')); // verdict lands while paused
    // Evidence filed (the exit still counts), but the place is held.
    expect(session().paused).toBe(true);
    expect(session().exits).toContain('queries');
    expect(session().conceptIdx).toBe(0);
    expect(asks).toHaveLength(2); // no silent advancement
    store().resume(BK);
    expect(session().paused).toBe(false);
    expect(session().conceptIdx).toBe(1); // the advance ran on resume
    expect(asks).toHaveLength(3); // the next trial posed
  });
});

describe('regression: practice completes and files the report', () => {
  test('all queue concepts stamped → reporting → done, the report his final turn', async () => {
    await store().begin(BK, 'attention');
    // Walk the road quickly: pass each concept (one pass exits at 80%).
    answer(0, 'trial 1');
    store().answer(BK, 'a1');
    answer(1, 'yes. [PASS]', passTags('queries'));
    answer(2, 'trial 2');
    store().answer(BK, 'a2');
    answer(3, 'yes. [PASS]', passTags('keys'));
    answer(4, 'trial 3');
    store().answer(BK, 'a3');
    answer(5, 'yes. [PASS]', passTags('attention'));
    // The road is walked → practice begins.
    expect(session().phase).toBe('practicing');
    const practiceAsk = asks.at(-1)!;
    expect(practiceAsk.question).toContain('Practice round');
    // The queue (empty ledger): the route's nodes, due first (none due).
    answer(asks.length - 1, 'Check one: what is a query?'); // his first question
    for (const concept of ['queries', 'keys', 'attention']) {
      store().answer(BK, 'my attempt');
      answer(asks.length - 1, 'Graded. [PASS]', passTags(concept));
    }
    await vi.waitFor(() => expect(session().phase).toBe('done'));
    expect(store().report).toContain('guided session — attention');
    expect(store().note).toContain('filed');
    // The report is his final message in the conversation.
    const last = conversation().at(-1)!;
    expect(last.speaker).toBe('professor');
    expect(last.text).toContain('Taking hold:');
  });
});

describe('regression: the session survives its surfaces', () => {
  test('mode free pauses (the view closes); guided resumes — nothing lost', async () => {
    await store().begin(BK, 'attention');
    answer(0, 'What does a query do?');
    const before = conversation().length;
    store().setMode(BK, 'free'); // the view closes; the session holds
    expect(session().paused).toBe(true);
    expect(session().phase).toBe('teaching');
    store().setMode(BK, 'guided'); // back to the conversation
    expect(session().paused).toBe(false);
    expect(conversation().length).toBe(before); // nothing re-asked, nothing lost
  });

  test('a failed stream says so in the conversation and keeps the place', async () => {
    await store().begin(BK, 'attention');
    asks[0]!.opts.onError?.('network');
    const last = conversation().at(-1)!;
    expect(last).toMatchObject({ speaker: 'professor', kind: 'note' });
    expect(last.text).toContain('line went quiet');
    expect(session().phase).toBe('teaching'); // the session holds
    expect(session().conceptIdx).toBe(0);
  });

  test('reset rests the machine and drops a stale stream (the generation guard)', async () => {
    await store().begin(BK, 'attention');
    store().reset();
    expect(session().phase).toBe('idle');
    expect(conversation()).toEqual([]);
    answer(0, 'A late answer from the abandoned session.'); // must not land
    expect(conversation()).toEqual([]);
  });
});
