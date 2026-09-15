import { describe, test, expect, beforeEach } from 'vitest';
import {
  applyWorkbenchOp,
  emptySession,
  latexHash,
  newStepId,
  useWorkbenchStore,
  WorkbenchAnchor,
  WorkbenchOp,
  WorkbenchSession,
} from '@/store/workbenchStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let opCounter = 0;
const BASE_TS = Date.parse('2026-01-01T00:00:00.000Z');

/** Build a well-formed op with deterministic ordering timestamps. */
const mkOp = (over: Partial<WorkbenchOp> & Pick<WorkbenchOp, 'type' | 'stepId'>): WorkbenchOp => {
  opCounter += 1;
  return {
    opId: `op_test_${opCounter}`,
    sessionId: 'wb_bk1',
    actor: 'user',
    at: new Date(BASE_TS + opCounter * 1000).toISOString(),
    ...over,
  };
};

const mkAnchor = (over: Partial<WorkbenchAnchor> = {}): WorkbenchAnchor => ({
  page: 3,
  mdSpan: [10, 42],
  quote: 'Let x be a nilpotent element',
  ...over,
});

/** Deep-freeze so any reducer mutation throws (strict purity check). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

const frozenEmpty = (bookKey = 'bk1'): WorkbenchSession => deepFreeze(emptySession(bookKey));

/** Insert one step via the reducer and return the new session. */
const insertStep = (
  session: WorkbenchSession,
  stepId: string,
  actor: 'user' | 'professor' = 'user',
  latex = `x_{${stepId}}`,
  over: Partial<WorkbenchOp> = {},
): WorkbenchSession =>
  applyWorkbenchOp(
    session,
    mkOp({ type: 'step.insert', stepId, actor, latex, plain: `plain ${latex}`, ...over }),
  );

beforeEach(() => {
  opCounter = 0;
  useWorkbenchStore.setState({ sessions: {} });
});

// ---------------------------------------------------------------------------
// latexHash / emptySession / ids
// ---------------------------------------------------------------------------

describe('latexHash', () => {
  test('prefixes with h1: and is stable', () => {
    expect(latexHash('x^2 + y^2 = z^2')).toMatch(/^h1:[0-9a-f]{8}$/);
    expect(latexHash('x^2 + y^2 = z^2')).toBe(latexHash('x^2 + y^2 = z^2'));
  });

  test('differs for different latex', () => {
    expect(latexHash('x')).not.toBe(latexHash('y'));
  });

  test('handles empty string', () => {
    expect(latexHash('')).toBe(latexHash(''));
  });
});

describe('emptySession', () => {
  test('builds a session keyed by bookKey', () => {
    const s = emptySession('moby-dick');
    expect(s.sessionId).toBe('wb_moby-dick');
    expect(s.bookKey).toBe('moby-dick');
    expect(s.steps).toEqual([]);
    expect(s.opLog).toEqual([]);
    expect(Date.parse(s.createdAt)).not.toBeNaN();
    expect(s.updatedAt).toBe(s.createdAt);
  });

  test('newStepId uses st_ prefix with unique values', () => {
    const a = newStepId();
    const b = newStepId();
    expect(a).toMatch(/^st_[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Reducer: step.insert
// ---------------------------------------------------------------------------

describe('applyWorkbenchOp: step.insert', () => {
  test('user insert appends a draft step with empty noteIds', () => {
    const s0 = frozenEmpty();
    const s1 = insertStep(s0, 'st_a');
    const step = s1.steps[0]!;
    expect(step).toMatchObject({
      stepId: 'st_a',
      latex: 'x_{st_a}',
      plain: 'plain x_{st_a}',
      author: 'user',
      state: 'draft',
      noteIds: [],
    });
    expect(step.anchor).toBeUndefined();
    expect(s1.opLog).toHaveLength(1);
    expect(s1.opLog[0]!.type).toBe('step.insert');
    expect(s1.updatedAt).toBe(s1.opLog[0]!.at);
  });

  test('professor insert appends a final step', () => {
    const s1 = insertStep(frozenEmpty(), 'st_a', 'professor');
    expect(s1.steps[0]!.author).toBe('professor');
    expect(s1.steps[0]!.state).toBe('final');
  });

  test('insert with toIndex inserts at position, without toIndex appends', () => {
    let s = frozenEmpty();
    s = insertStep(s, 'st_a');
    s = insertStep(s, 'st_b');
    s = applyWorkbenchOp(s, mkOp({ type: 'step.insert', stepId: 'st_c', toIndex: 1, latex: 'c' }));
    expect(s.steps.map((x) => x.stepId)).toEqual(['st_a', 'st_c', 'st_b']);
    s = insertStep(s, 'st_d');
    expect(s.steps.map((x) => x.stepId)).toEqual(['st_a', 'st_c', 'st_b', 'st_d']);
  });

  test('insert with out-of-range toIndex clamps into bounds', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    s = applyWorkbenchOp(s, mkOp({ type: 'step.insert', stepId: 'st_b', toIndex: 99, latex: 'b' }));
    expect(s.steps.map((x) => x.stepId)).toEqual(['st_a', 'st_b']);
    s = applyWorkbenchOp(s, mkOp({ type: 'step.insert', stepId: 'st_c', toIndex: -5, latex: 'c' }));
    expect(s.steps.map((x) => x.stepId)).toEqual(['st_c', 'st_a', 'st_b']);
  });

  test('professor insert with an existing stepId becomes a PROPOSED update, never an overwrite', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user', 'user latex');
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'step.insert', actor: 'professor', stepId: 'st_a', latex: 'prof latex' }),
    );
    expect(s.steps[0]!.latex).toBe('user latex'); // original latex survives
    expect(s.steps[0]!.state).toBe('proposed');
    expect(s.opLog).toHaveLength(2);
    expect(s.opLog[1]!.latex).toBe('prof latex'); // the proposal is on the op
  });

  test('user insert with a duplicate stepId is a no-op and is not logged', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user', 'first');
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.insert', stepId: 'st_a', latex: 'second' }));
    expect(s).toBe(before);
    expect(s.steps[0]!.latex).toBe('first');
    expect(s.opLog).toHaveLength(1);
  });

  test('insert carries the anchor when provided', () => {
    const anchor = mkAnchor();
    let s = frozenEmpty();
    s = applyWorkbenchOp(s, mkOp({ type: 'step.insert', stepId: 'st_a', latex: 'a', anchor }));
    expect(s.steps[0]!.anchor).toEqual(anchor);
  });
});

// ---------------------------------------------------------------------------
// Reducer: step.update
// ---------------------------------------------------------------------------

describe('applyWorkbenchOp: step.update', () => {
  test('user update sets latex/plain, bumps updatedAt, preserves anchor', () => {
    let s = frozenEmpty();
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'step.insert', stepId: 'st_a', latex: 'a', anchor: mkAnchor() }),
    );
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'step.update', stepId: 'st_a', latex: 'a2', plain: 'plain a2' }),
    );
    const step = s.steps[0]!;
    expect(step.latex).toBe('a2');
    expect(step.plain).toBe('plain a2');
    expect(step.anchor).toEqual(mkAnchor()); // preserved on edit
    expect(s.updatedAt).toBe(s.opLog[1]!.at);
  });

  test('update on a missing step is a no-op', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.update', stepId: 'st_nope', latex: 'x' }));
    expect(s).toBe(before);
    expect(s.opLog).toHaveLength(1);
  });

  test('professor update on a USER step sets proposed; user latex stays visible', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user', 'user latex');
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'step.update', actor: 'professor', stepId: 'st_a', latex: 'prof proposal' }),
    );
    expect(s.steps[0]!.latex).toBe('user latex'); // not overwritten
    expect(s.steps[0]!.state).toBe('proposed');
    expect(s.opLog[1]!).toMatchObject({ actor: 'professor', latex: 'prof proposal' });
  });

  test('professor update on a PROFESSOR step applies directly', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'professor', 'v1');
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'step.update', actor: 'professor', stepId: 'st_a', latex: 'v2' }),
    );
    expect(s.steps[0]!.latex).toBe('v2');
    expect(s.steps[0]!.state).toBe('final');
  });

  test('user update on their own step applies directly', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user', 'v1');
    s = applyWorkbenchOp(s, mkOp({ type: 'step.update', stepId: 'st_a', latex: 'v2' }));
    expect(s.steps[0]!.latex).toBe('v2');
    expect(s.steps[0]!.state).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
// Reducer: step.delete
// ---------------------------------------------------------------------------

describe('applyWorkbenchOp: step.delete', () => {
  test('author-matched delete removes the step and logs the op', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user');
    s = insertStep(s, 'st_b', 'professor');
    s = applyWorkbenchOp(s, mkOp({ type: 'step.delete', stepId: 'st_a' }));
    expect(s.steps.map((x) => x.stepId)).toEqual(['st_b']);
    s = applyWorkbenchOp(s, mkOp({ type: 'step.delete', actor: 'professor', stepId: 'st_b' }));
    expect(s.steps).toEqual([]);
    expect(s.opLog.filter((o) => o.type === 'step.delete')).toHaveLength(2);
  });

  test('professor delete on a user step is rejected (no proposed-delete state)', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user');
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.delete', actor: 'professor', stepId: 'st_a' }));
    expect(s).toBe(before);
    expect(s.steps).toHaveLength(1);
    expect(s.opLog.filter((o) => o.type === 'step.delete')).toHaveLength(0);
  });

  test('user delete on a professor step is rejected', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'professor');
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.delete', stepId: 'st_a' }));
    expect(s).toBe(before);
    expect(s.steps).toHaveLength(1);
  });

  test('delete of a missing step is a no-op', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.delete', stepId: 'st_ghost' }));
    expect(s).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Reducer: step.reorder
// ---------------------------------------------------------------------------

describe('applyWorkbenchOp: step.reorder', () => {
  const threeSteps = (): WorkbenchSession => {
    let s = frozenEmpty();
    s = insertStep(s, 'st_a');
    s = insertStep(s, 'st_b');
    s = insertStep(s, 'st_c');
    return s;
  };

  test('moves a step within bounds', () => {
    let s = threeSteps();
    s = applyWorkbenchOp(s, mkOp({ type: 'step.reorder', stepId: 'st_a', toIndex: 2 }));
    expect(s.steps.map((x) => x.stepId)).toEqual(['st_b', 'st_c', 'st_a']);
  });

  test('reorder toIndex equal to length is out of bounds (no-op)', () => {
    let s = threeSteps();
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.reorder', stepId: 'st_a', toIndex: 3 }));
    expect(s).toBe(before);
  });

  test('negative toIndex is a no-op', () => {
    let s = threeSteps();
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.reorder', stepId: 'st_c', toIndex: -1 }));
    expect(s).toBe(before);
  });

  test('non-integer toIndex is a no-op', () => {
    let s = threeSteps();
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.reorder', stepId: 'st_c', toIndex: 1.5 }));
    expect(s).toBe(before);
  });

  test('reordering a missing step is a no-op', () => {
    let s = threeSteps();
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.reorder', stepId: 'st_ghost', toIndex: 0 }));
    expect(s).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Reducer: anchors
// ---------------------------------------------------------------------------

describe('applyWorkbenchOp: anchor.attach / anchor.detach', () => {
  test('attach sets the anchor; detach removes it', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const anchor = mkAnchor({ page: 7 });
    s = applyWorkbenchOp(s, mkOp({ type: 'anchor.attach', stepId: 'st_a', anchor }));
    expect(s.steps[0]!.anchor).toEqual(anchor);
    s = applyWorkbenchOp(s, mkOp({ type: 'anchor.detach', stepId: 'st_a' }));
    expect(s.steps[0]!.anchor).toBeUndefined();
    expect('anchor' in s.steps[0]!).toBe(false);
  });

  test('attach without an anchor payload is a no-op', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'anchor.attach', stepId: 'st_a' }));
    expect(s).toBe(before);
  });

  test('anchor ops on a missing step are no-ops', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'anchor.attach', stepId: 'st_ghost', anchor: mkAnchor() }),
    );
    s = applyWorkbenchOp(s, mkOp({ type: 'anchor.detach', stepId: 'st_ghost' }));
    expect(s).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Reducer: suggest.accept / suggest.reject
// ---------------------------------------------------------------------------

describe('applyWorkbenchOp: suggest.accept / suggest.reject', () => {
  const proposedSetup = (): WorkbenchSession => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user', 'user latex');
    s = applyWorkbenchOp(
      s,
      mkOp({
        type: 'step.update',
        actor: 'professor',
        stepId: 'st_a',
        latex: 'prof proposal v1',
        plain: 'v1',
      }),
    );
    s = applyWorkbenchOp(
      s,
      mkOp({
        type: 'step.update',
        actor: 'professor',
        stepId: 'st_a',
        latex: 'prof proposal v2',
        plain: 'v2',
      }),
    );
    return s;
  };

  test('accept (user) applies the NEWEST professor proposal and sets final', () => {
    let s = proposedSetup();
    expect(s.steps[0]!.state).toBe('proposed');
    s = applyWorkbenchOp(s, mkOp({ type: 'suggest.accept', stepId: 'st_a' }));
    expect(s.steps[0]!.latex).toBe('prof proposal v2');
    expect(s.steps[0]!.plain).toBe('v2');
    expect(s.steps[0]!.state).toBe('final');
  });

  test('accept by the professor is rejected', () => {
    let s = proposedSetup();
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'suggest.accept', actor: 'professor', stepId: 'st_a' }));
    expect(s).toBe(before);
    expect(s.steps[0]!.latex).toBe('user latex');
  });

  test('accept with no proposal in the log is a no-op', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user', 'user latex');
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'step.update', actor: 'professor', stepId: 'st_a', latex: 'p' }),
    );
    // wipe the log to simulate a state set externally
    const noLog: WorkbenchSession = deepFreeze({ ...s, opLog: [] });
    const before = noLog;
    const after = applyWorkbenchOp(noLog, mkOp({ type: 'suggest.accept', stepId: 'st_a' }));
    expect(after).toBe(before);
  });

  test('accept accepts a proposal that came from a professor insert-collision', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user', 'user latex');
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'step.insert', actor: 'professor', stepId: 'st_a', latex: 'inserted proposal' }),
    );
    expect(s.steps[0]!.state).toBe('proposed');
    s = applyWorkbenchOp(s, mkOp({ type: 'suggest.accept', stepId: 'st_a' }));
    expect(s.steps[0]!.latex).toBe('inserted proposal');
    expect(s.steps[0]!.state).toBe('final');
  });

  test('reject (user) on a user step returns it to draft with user latex intact', () => {
    let s = proposedSetup();
    s = applyWorkbenchOp(s, mkOp({ type: 'suggest.reject', stepId: 'st_a' }));
    expect(s.steps[0]!.state).toBe('draft');
    expect(s.steps[0]!.latex).toBe('user latex');
  });

  test('reject on a professor step is a no-op', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'professor', 'prof latex');
    // professor insert-collision puts even a professor step into proposed
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'step.insert', actor: 'professor', stepId: 'st_a', latex: 'p2' }),
    );
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'suggest.reject', stepId: 'st_a' }));
    expect(s).toBe(before);
    expect(s.steps[0]!.state).toBe('proposed');
  });

  test('accept/reject on a non-proposed step is a no-op', () => {
    let s = insertStep(frozenEmpty(), 'st_a', 'user');
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'suggest.accept', stepId: 'st_a' }));
    s = applyWorkbenchOp(s, mkOp({ type: 'suggest.reject', stepId: 'st_a' }));
    expect(s).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Reducer: step.annotate
// ---------------------------------------------------------------------------

describe('applyWorkbenchOp: step.annotate', () => {
  test('appends note ids, accumulating in order', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    s = applyWorkbenchOp(s, mkOp({ type: 'step.annotate', stepId: 'st_a', note: 'note-1' }));
    s = applyWorkbenchOp(s, mkOp({ type: 'step.annotate', stepId: 'st_a', note: 'note-2' }));
    expect(s.steps[0]!.noteIds).toEqual(['note-1', 'note-2']);
  });

  test('annotate without a note payload is a no-op', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.annotate', stepId: 'st_a' }));
    expect(s).toBe(before);
    s = applyWorkbenchOp(s, mkOp({ type: 'step.annotate', stepId: 'st_a', note: '' }));
    expect(s.steps[0]!.noteIds).toEqual([]);
  });

  test('annotate on a missing step is a no-op', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(s, mkOp({ type: 'step.annotate', stepId: 'st_ghost', note: 'note-1' }));
    expect(s).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Reducer: malformed / unknown ops + purity
// ---------------------------------------------------------------------------

describe('applyWorkbenchOp: malformed ops are honest no-ops', () => {
  test('unknown op type returns the session unchanged', () => {
    const s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    const bad = { ...s.opLog[0]!, type: 'step.explode' } as unknown as WorkbenchOp;
    const after = applyWorkbenchOp(s, bad);
    expect(after).toBe(before);
  });

  test('op for a different session is rejected', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(
      s,
      mkOp({ type: 'step.update', stepId: 'st_a', sessionId: 'wb_other', latex: 'x' }),
    );
    expect(s).toBe(before);
  });

  test('op with a non-ISO timestamp is rejected', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(s, { ...mkOp({ type: 'step.update', stepId: 'st_a' }), at: 'not-a-date' });
    expect(s).toBe(before);
  });

  test('op with a malformed anchor is rejected', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(s, {
      ...mkOp({ type: 'anchor.attach', stepId: 'st_a' }),
      anchor: { page: 'three' } as unknown as WorkbenchAnchor,
    });
    expect(s).toBe(before);
  });

  test('op with a missing stepId is rejected', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    const before = s;
    s = applyWorkbenchOp(s, { ...mkOp({ type: 'step.update', stepId: 'st_a' }), stepId: '' });
    expect(s).toBe(before);
  });
});

describe('applyWorkbenchOp: purity', () => {
  test('never mutates a deep-frozen input session (any op mix)', () => {
    let s = frozenEmpty();
    s = insertStep(s, 'st_a', 'user', 'user latex', { anchor: mkAnchor() });
    s = insertStep(s, 'st_b', 'professor');
    // Re-freeze each fold: the reducer must build fresh objects throughout.
    s = deepFreeze(s);
    s = deepFreeze(
      applyWorkbenchOp(
        s,
        mkOp({ type: 'step.update', actor: 'professor', stepId: 'st_a', latex: 'p' }),
      ),
    );
    s = deepFreeze(applyWorkbenchOp(s, mkOp({ type: 'suggest.accept', stepId: 'st_a' })));
    s = deepFreeze(
      applyWorkbenchOp(s, mkOp({ type: 'step.annotate', stepId: 'st_a', note: 'n1' })),
    );
    s = deepFreeze(applyWorkbenchOp(s, mkOp({ type: 'step.reorder', stepId: 'st_b', toIndex: 0 })));
    s = deepFreeze(applyWorkbenchOp(s, mkOp({ type: 'anchor.detach', stepId: 'st_a' })));
    expect(s.steps).toHaveLength(2);
    expect(s.opLog).toHaveLength(7);
  });

  test('every applied op lands in the op-log; undo is compensating, never removal', () => {
    let s = insertStep(frozenEmpty(), 'st_a');
    s = applyWorkbenchOp(s, mkOp({ type: 'step.delete', stepId: 'st_a' }));
    expect(s.steps).toEqual([]);
    expect(s.opLog.map((o) => o.type)).toEqual(['step.insert', 'step.delete']);
    expect(s.opLog[0]!.latex).toBe('x_{st_a}'); // original op text preserved
  });
});

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

describe('useWorkbenchStore', () => {
  test('ensureSession creates and caches a session per bookKey', () => {
    const { ensureSession, getSession } = useWorkbenchStore.getState();
    const s1 = ensureSession('bk1');
    expect(s1.sessionId).toBe('wb_bk1');
    expect(getSession('bk1')).toBe(s1);
    expect(ensureSession('bk1')).toBe(s1);
    expect(getSession('unknown')).toBeUndefined();
  });

  test('appendOp fills opId/at/sessionId and applies the reducer', () => {
    const store = useWorkbenchStore.getState();
    const op = store.appendOp('bk1', {
      actor: 'user',
      type: 'step.insert',
      stepId: 'st_a',
      latex: 'x^2',
    });
    expect(op.opId).toMatch(/^op_[0-9a-f]{12}$/);
    expect(op.sessionId).toBe('wb_bk1');
    expect(Date.parse(op.at)).not.toBeNaN();
    const session = useWorkbenchStore.getState().getSession('bk1')!;
    expect(session.steps[0]!.latex).toBe('x^2');
    expect(session.opLog).toHaveLength(1);
    expect(session.opLog[0]!.opId).toBe(op.opId);
  });

  test('appendOp with a mismatched sessionId leaves the session untouched', () => {
    const store = useWorkbenchStore.getState();
    store.ensureSession('bk1');
    store.appendOp('bk1', {
      actor: 'user',
      type: 'step.insert',
      stepId: 'st_a',
      latex: 'x^2',
      sessionId: 'wb_evil',
    });
    const session = useWorkbenchStore.getState().getSession('bk1')!;
    expect(session.steps).toEqual([]);
    expect(session.opLog).toEqual([]);
  });

  test('serializeSession → loadSerializedSession round-trips with fidelity', () => {
    const store = useWorkbenchStore.getState();
    store.appendOp('bk1', {
      actor: 'user',
      type: 'step.insert',
      stepId: 'st_a',
      latex: 'x^2',
      plain: 'x squared',
      anchor: mkAnchor(),
    });
    store.appendOp('bk1', { actor: 'user', type: 'step.annotate', stepId: 'st_a', note: 'note-9' });
    const json = store.serializeSession('bk1');
    expect(json).toContain('\n'); // pretty-printed

    useWorkbenchStore.setState({ sessions: {} });
    expect(useWorkbenchStore.getState().loadSerializedSession('bk1', json)).toBe(true);
    const restored = useWorkbenchStore.getState().getSession('bk1')!;
    expect(restored).toEqual(JSON.parse(json));
    expect(restored.steps[0]!.noteIds).toEqual(['note-9']);
    expect(restored.steps[0]!.anchor).toEqual(mkAnchor());
    expect(restored.sessionId).toBe('wb_bk1');
  });

  test('loadSerializedSession returns false on malformed JSON and does not throw', () => {
    const store = useWorkbenchStore.getState();
    store.ensureSession('bk1');
    expect(store.loadSerializedSession('bk1', '{not json')).toBe(false);
    expect(store.loadSerializedSession('bk1', '"just a string"')).toBe(false);
    expect(store.loadSerializedSession('bk1', '{"sessionId":42}')).toBe(false);
    // existing session untouched
    expect(useWorkbenchStore.getState().getSession('bk1')).toBeDefined();
  });

  test('loadSerializedSession accepts a valid foreign session under the given key', () => {
    const store = useWorkbenchStore.getState();
    const foreign = emptySession('other-book');
    expect(store.loadSerializedSession('slot1', JSON.stringify(foreign))).toBe(true);
    expect(useWorkbenchStore.getState().getSession('slot1')?.bookKey).toBe('other-book');
  });

  test('serializeSession of an unknown bookKey yields parseable JSON null', () => {
    const json = useWorkbenchStore.getState().serializeSession('nope');
    expect(JSON.parse(json)).toBeNull();
    expect(useWorkbenchStore.getState().loadSerializedSession('nope', json)).toBe(false);
  });

  test('getRecentOps returns the last n ops, newest last', () => {
    const store = useWorkbenchStore.getState();
    for (let i = 1; i <= 5; i++) {
      store.appendOp('bk1', {
        actor: 'user',
        type: 'step.insert',
        stepId: `st_${i}`,
        latex: `${i}`,
      });
    }
    const recent = useWorkbenchStore.getState().getRecentOps('bk1', 3);
    expect(recent.map((o) => o.stepId)).toEqual(['st_3', 'st_4', 'st_5']);
    expect(useWorkbenchStore.getState().getRecentOps('bk1', 99)).toHaveLength(5);
    expect(useWorkbenchStore.getState().getRecentOps('bk1', 0)).toEqual([]);
    expect(useWorkbenchStore.getState().getRecentOps('ghost', 3)).toEqual([]);
  });

  test('getProposalForStep returns the newest professor step.update for that step', () => {
    const store = useWorkbenchStore.getState();
    store.appendOp('bk1', { actor: 'user', type: 'step.insert', stepId: 'st_a', latex: 'user' });
    store.appendOp('bk1', {
      actor: 'professor',
      type: 'step.update',
      stepId: 'st_a',
      latex: 'proposal-1',
    });
    store.appendOp('bk1', { actor: 'user', type: 'step.update', stepId: 'st_a', latex: 'user v2' });
    store.appendOp('bk1', {
      actor: 'professor',
      type: 'step.update',
      stepId: 'st_a',
      latex: 'proposal-2',
      plain: 'p2',
    });
    const proposal = useWorkbenchStore.getState().getProposalForStep('bk1', 'st_a');
    expect(proposal?.latex).toBe('proposal-2');
    expect(proposal?.actor).toBe('professor');
    expect(useWorkbenchStore.getState().getProposalForStep('bk1', 'st_ghost')).toBeUndefined();
    expect(useWorkbenchStore.getState().getProposalForStep('ghost', 'st_a')).toBeUndefined();
  });

  test('sessions for different books are independent', () => {
    const store = useWorkbenchStore.getState();
    store.appendOp('bk1', { actor: 'user', type: 'step.insert', stepId: 'st_a', latex: 'a' });
    store.appendOp('bk2', { actor: 'professor', type: 'step.insert', stepId: 'st_z', latex: 'z' });
    expect(useWorkbenchStore.getState().getSession('bk1')?.steps).toHaveLength(1);
    expect(useWorkbenchStore.getState().getSession('bk2')?.steps[0]!.state).toBe('final');
  });
});
