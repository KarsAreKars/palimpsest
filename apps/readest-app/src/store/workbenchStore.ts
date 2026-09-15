/**
 * Workbench store (palimpsest) — the structured-step document model.
 *
 * A workbench session is a per-book derivation document: an ordered list of
 * steps (LaTeX + plain rendering + optional book anchor) plus an APPEND-ONLY
 * op-log. History is never rewritten — undo is a compensating op, not a
 * removal. The reducer (`applyWorkbenchOp`) is a pure state machine, kept
 * separate from the zustand store and from any file IO so the turn-taking
 * rules are contract-testable without a filesystem (same discipline as
 * services/professor/learner.ts).
 *
 * Turn-taking invariants enforced by the reducer:
 *   - A professor NEVER silently overwrites a user's step. Professor edits
 *     to user steps land as `proposed` suggestions; the user's latex stays
 *     visible until a user-actor `suggest.accept` applies the proposal.
 *   - Deletes are author-matched: only the user deletes user steps, only
 *     the professor deletes professor steps. Cross-author deletes are
 *     rejected (honest no-op, not logged).
 *   - Unknown or malformed ops are no-ops (return the input session
 *     unchanged, by reference) — the reducer never throws.
 */
import { create } from 'zustand';

export type WorkbenchStepState = 'final' | 'gap' | 'draft' | 'proposed';

export interface WorkbenchAnchor {
  page: number;
  mdSpan: [number, number];
  quote: string;
}

export interface WorkbenchStep {
  stepId: string; // "st_" + short id
  latex: string;
  plain: string; // human/plain rendering fallback
  author: 'professor' | 'user';
  state: WorkbenchStepState;
  anchor?: WorkbenchAnchor; // book grounding; preserved on edit unless explicitly detached
  noteIds: string[];
}

export type WorkbenchEditKind = 'typed' | 'deleted-own-step' | 'corrected-prof-step' | 'filled-gap';

export type WorkbenchOpType =
  | 'step.insert'
  | 'step.update'
  | 'step.delete'
  | 'step.reorder'
  | 'step.annotate'
  | 'anchor.attach'
  | 'anchor.detach'
  | 'suggest.accept'
  | 'suggest.reject';

export interface WorkbenchOp {
  opId: string;
  sessionId: string;
  actor: 'user' | 'professor';
  type: WorkbenchOpType;
  stepId: string;
  at: string; // ISO timestamp
  latex?: string;
  plain?: string;
  anchor?: WorkbenchAnchor;
  editKind?: WorkbenchEditKind;
  prevLatexHash?: string; // sha1-ish of the latex the actor believed the step had (optimistic concurrency)
  note?: string; // for step.annotate
  toIndex?: number; // for step.reorder
}

export interface WorkbenchSession {
  sessionId: string; // "wb_" + bookKey
  bookKey: string;
  steps: WorkbenchStep[];
  opLog: WorkbenchOp[];
  createdAt: string;
  updatedAt: string;
}

const WORKBENCH_OP_TYPES: readonly WorkbenchOpType[] = [
  'step.insert',
  'step.update',
  'step.delete',
  'step.reorder',
  'step.annotate',
  'anchor.attach',
  'anchor.detach',
  'suggest.accept',
  'suggest.reject',
];

const STEP_STATES: readonly WorkbenchStepState[] = ['final', 'gap', 'draft', 'proposed'];

// ---------------------------------------------------------------------------
// Ids and hashing
// ---------------------------------------------------------------------------

const shortRandom = (): string => {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 14).padEnd(12, '0');
};

export const newStepId = (): string => `st_${shortRandom()}`;
export const newOpId = (): string => `op_${shortRandom()}`;

/**
 * Small stable string hash (FNV-1a, 32-bit) with a "h1:" prefix. Not
 * cryptographic — it exists for optimistic-concurrency fields
 * (`prevLatexHash`), so callers can detect "the step changed underneath
 * me" cheaply and deterministically.
 */
export function latexHash(latex: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < latex.length; i++) {
    h ^= latex.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `h1:${(h >>> 0).toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Session construction and op validation
// ---------------------------------------------------------------------------

export function emptySession(bookKey: string): WorkbenchSession {
  const at = new Date().toISOString();
  return {
    sessionId: `wb_${bookKey}`,
    bookKey,
    steps: [],
    opLog: [],
    createdAt: at,
    updatedAt: at,
  };
}

const isAnchor = (a: unknown): a is WorkbenchAnchor => {
  if (!a || typeof a !== 'object') return false;
  const { page, mdSpan, quote } = a as { page?: unknown; mdSpan?: unknown; quote?: unknown };
  return (
    typeof page === 'number' &&
    Array.isArray(mdSpan) &&
    mdSpan.length === 2 &&
    typeof mdSpan[0] === 'number' &&
    typeof mdSpan[1] === 'number' &&
    typeof quote === 'string'
  );
};

/** Shape-check an op. Anything malformed is an honest no-op, never a throw. */
const isValidOp = (op: WorkbenchOp): boolean => {
  if (!op || typeof op !== 'object') return false;
  if (typeof op.opId !== 'string' || op.opId.length === 0) return false;
  if (typeof op.sessionId !== 'string' || op.sessionId.length === 0) return false;
  if (op.actor !== 'user' && op.actor !== 'professor') return false;
  if (!WORKBENCH_OP_TYPES.includes(op.type)) return false;
  if (typeof op.stepId !== 'string' || op.stepId.length === 0) return false;
  if (typeof op.at !== 'string' || Number.isNaN(Date.parse(op.at))) return false;
  if (op.anchor !== undefined && !isAnchor(op.anchor)) return false;
  return true;
};

/** Applied-op commit: append to the op-log and bump updatedAt to the op's ts. */
const commit = (session: WorkbenchSession, op: WorkbenchOp): WorkbenchSession => ({
  ...session,
  opLog: [...session.opLog, op],
  updatedAt: op.at,
});

const stepIndex = (session: WorkbenchSession, stepId: string): number =>
  session.steps.findIndex((s) => s.stepId === stepId);

/**
 * Newest professor proposal op for a step: the most recent professor
 * `step.update`, falling back to a professor `step.insert` that carries
 * latex (a professor re-insert of an existing stepId is logged as a
 * `step.insert` yet IS a proposed update — see applyWorkbenchOp).
 */
const findProposalOp = (session: WorkbenchSession, stepId: string): WorkbenchOp | undefined => {
  for (let i = session.opLog.length - 1; i >= 0; i--) {
    const op = session.opLog[i];
    if (!op || op.actor !== 'professor' || op.stepId !== stepId) continue;
    if (op.type === 'step.update') return op;
    if (op.type === 'step.insert' && typeof op.latex === 'string') return op;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

/**
 * Fold one op into the session. PURE: never mutates the input and returns
 * the input session BY REFERENCE for rejected/malformed ops (so callers can
 * detect no-ops with `===`). Rejected ops are NOT appended to the op-log —
 * the log only records ops that actually changed (or validly attempted)
 * state.
 */
export function applyWorkbenchOp(session: WorkbenchSession, op: WorkbenchOp): WorkbenchSession {
  if (!isValidOp(op)) return session;
  if (op.sessionId !== session.sessionId) return session;

  switch (op.type) {
    case 'step.insert': {
      const existing = session.steps.find((s) => s.stepId === op.stepId);
      if (existing) {
        // Duplicate insert. A professor re-insert becomes a PROPOSED update
        // (proposal text lives on the op; the step's latex is untouched) —
        // never a silent overwrite. A user re-insert is simply a no-op.
        if (op.actor !== 'professor') return session;
        const steps = session.steps.map((s) =>
          s.stepId === op.stepId ? { ...s, state: 'proposed' as WorkbenchStepState } : s,
        );
        return commit({ ...session, steps }, op);
      }
      const step: WorkbenchStep = {
        stepId: op.stepId,
        latex: op.latex ?? '',
        plain: op.plain ?? '',
        author: op.actor,
        state: op.actor === 'professor' ? 'final' : 'draft',
        noteIds: [],
        ...(op.anchor ? { anchor: op.anchor } : {}),
      };
      const steps = [...session.steps];
      const toIndex = Math.max(0, Math.min(op.toIndex ?? steps.length, steps.length));
      steps.splice(toIndex, 0, step);
      return commit({ ...session, steps }, op);
    }

    case 'step.update': {
      const step = session.steps.find((s) => s.stepId === op.stepId);
      if (!step) return session;
      if (op.actor === 'professor' && step.author === 'user') {
        // Tracked suggestion: the user's latex stays visible; the proposal
        // is queryable via the op-log (findProposalOp / getProposalForStep)
        // and lands only on suggest.accept.
        const steps = session.steps.map((s) =>
          s.stepId === op.stepId ? { ...s, state: 'proposed' as WorkbenchStepState } : s,
        );
        return commit({ ...session, steps }, op);
      }
      const steps = session.steps.map((s) =>
        s.stepId === op.stepId
          ? {
              ...s,
              latex: op.latex ?? s.latex,
              plain: op.plain ?? s.plain,
              ...(op.anchor ? { anchor: op.anchor } : {}),
            }
          : s,
      );
      return commit({ ...session, steps }, op);
    }

    case 'step.delete': {
      const step = session.steps.find((s) => s.stepId === op.stepId);
      if (!step) return session;
      // Turn-taking: only the author deletes their own step. Cross-author
      // deletes (incl. professor "proposed deletes") are rejected.
      if (step.author !== op.actor) return session;
      const steps = session.steps.filter((s) => s.stepId !== op.stepId);
      return commit({ ...session, steps }, op);
    }

    case 'step.reorder': {
      const from = stepIndex(session, op.stepId);
      if (from < 0) return session;
      const to = op.toIndex;
      if (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= session.steps.length) {
        return session;
      }
      if (from === to) return commit(session, op);
      const steps = [...session.steps];
      const moved = steps.splice(from, 1)[0];
      if (!moved) return session;
      steps.splice(to, 0, moved);
      return commit({ ...session, steps }, op);
    }

    case 'step.annotate': {
      if (stepIndex(session, op.stepId) < 0) return session;
      const note = op.note;
      if (typeof note !== 'string' || note.length === 0) return session;
      // Note CONTENT lives outside this store; the step only accumulates ids.
      const steps = session.steps.map((s) =>
        s.stepId === op.stepId ? { ...s, noteIds: [...s.noteIds, note] } : s,
      );
      return commit({ ...session, steps }, op);
    }

    case 'anchor.attach': {
      const idx = stepIndex(session, op.stepId);
      if (idx < 0) return session;
      if (!op.anchor) return session;
      const steps = session.steps.map((s, i) => (i === idx ? { ...s, anchor: op.anchor } : s));
      return commit({ ...session, steps }, op);
    }

    case 'anchor.detach': {
      const idx = stepIndex(session, op.stepId);
      if (idx < 0) return session;
      const steps = session.steps.map((s, i) => {
        if (i !== idx) return s;
        const next = { ...s };
        delete next.anchor;
        return next;
      });
      return commit({ ...session, steps }, op);
    }

    case 'suggest.accept': {
      if (op.actor !== 'user') return session;
      const step = session.steps.find((s) => s.stepId === op.stepId);
      if (!step || step.state !== 'proposed') return session;
      const proposal = findProposalOp(session, op.stepId);
      if (!proposal) return session;
      const steps = session.steps.map((s) =>
        s.stepId === op.stepId
          ? {
              ...s,
              latex: proposal.latex ?? s.latex,
              plain: proposal.plain ?? s.plain,
              state: 'final' as WorkbenchStepState,
            }
          : s,
      );
      return commit({ ...session, steps }, op);
    }

    case 'suggest.reject': {
      if (op.actor !== 'user') return session;
      const step = session.steps.find((s) => s.stepId === op.stepId);
      if (!step || step.state !== 'proposed') return session;
      // Only user-authored steps return to draft; rejecting a professor
      // step's proposal is a no-op.
      if (step.author !== 'user') return session;
      const steps = session.steps.map((s) =>
        s.stepId === op.stepId ? { ...s, state: 'draft' as WorkbenchStepState } : s,
      );
      return commit({ ...session, steps }, op);
    }

    default:
      return session;
  }
}

// ---------------------------------------------------------------------------
// Serialization (honest parse — caller owns the file IO)
// ---------------------------------------------------------------------------

const isValidStepShape = (s: unknown): boolean => {
  if (!s || typeof s !== 'object') return false;
  const { stepId, latex, plain, author, state, noteIds } = s as {
    stepId?: unknown;
    latex?: unknown;
    plain?: unknown;
    author?: unknown;
    state?: unknown;
    noteIds?: unknown;
  };
  return (
    typeof stepId === 'string' &&
    typeof latex === 'string' &&
    typeof plain === 'string' &&
    (author === 'user' || author === 'professor') &&
    typeof state === 'string' &&
    STEP_STATES.includes(state as WorkbenchStepState) &&
    Array.isArray(noteIds)
  );
};

const isValidSessionShape = (s: unknown): s is WorkbenchSession => {
  if (!s || typeof s !== 'object') return false;
  const { sessionId, bookKey, steps, opLog, createdAt, updatedAt } = s as {
    sessionId?: unknown;
    bookKey?: unknown;
    steps?: unknown;
    opLog?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };
  return (
    typeof sessionId === 'string' &&
    typeof bookKey === 'string' &&
    Array.isArray(steps) &&
    steps.every(isValidStepShape) &&
    Array.isArray(opLog) &&
    typeof createdAt === 'string' &&
    typeof updatedAt === 'string'
  );
};

// ---------------------------------------------------------------------------
// Zustand store — NO persist middleware; file persistence is the caller's
// job via serializeSession / loadSerializedSession.
// ---------------------------------------------------------------------------

export interface WorkbenchState {
  sessions: Record<string, WorkbenchSession>;
  ensureSession: (bookKey: string) => WorkbenchSession;
  appendOp: (
    bookKey: string,
    op: Omit<WorkbenchOp, 'opId' | 'at' | 'sessionId'> & { sessionId?: string },
  ) => WorkbenchOp;
  getSession: (bookKey: string) => WorkbenchSession | undefined;
  serializeSession: (bookKey: string) => string;
  loadSerializedSession: (bookKey: string, json: string) => boolean;
  getRecentOps: (bookKey: string, n: number) => WorkbenchOp[];
  getProposalForStep: (bookKey: string, stepId: string) => WorkbenchOp | undefined;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  sessions: {},

  ensureSession: (bookKey) => {
    const existing = get().sessions[bookKey];
    if (existing) return existing;
    const session = emptySession(bookKey);
    set((state) => ({ sessions: { ...state.sessions, [bookKey]: session } }));
    return session;
  },

  appendOp: (bookKey, op) => {
    const session = get().ensureSession(bookKey);
    const full: WorkbenchOp = {
      ...op,
      opId: newOpId(),
      at: new Date().toISOString(),
      sessionId: op.sessionId ?? session.sessionId,
    };
    const next = applyWorkbenchOp(session, full);
    // Rejected ops leave the session untouched (reference equality check).
    if (next !== session) {
      set((state) => ({ sessions: { ...state.sessions, [bookKey]: next } }));
    }
    return full;
  },

  getSession: (bookKey) => get().sessions[bookKey],

  serializeSession: (bookKey) => {
    const session = get().sessions[bookKey];
    return JSON.stringify(session ?? null, null, 2);
  },

  loadSerializedSession: (bookKey, json) => {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!isValidSessionShape(parsed)) return false;
      set((state) => ({ sessions: { ...state.sessions, [bookKey]: parsed } }));
      return true;
    } catch {
      return false; // malformed JSON — honest failure, no throw
    }
  },

  getRecentOps: (bookKey, n) => {
    const session = get().sessions[bookKey];
    if (!session || n <= 0) return [];
    return session.opLog.slice(-n);
  },

  getProposalForStep: (bookKey, stepId) => {
    const session = get().sessions[bookKey];
    if (!session) return undefined;
    return findProposalOp(session, stepId);
  },
}));
