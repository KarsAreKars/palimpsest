/**
 * The guided session (Learning Engine Wave A — THE FORM's first-class
 * mode; docs/THE_FORM.md, docs/ARCHITECTURE.md §2). Free mode is the desk
 * as it is; guided mode is the LearnHarness back-and-forth as a lived
 * session: the professor drives, the learner follows, the desk shows the
 * work.
 *
 * The lifecycle:
 *   idle → measuring → planning → teaching → practicing → reporting → done
 *
 *   - MEASURE is latent (A3, Ruling 5 #6): the ledger is read, never a
 *     quiz. The state read (rushed / defended / curious / bored) comes
 *     from the ledger plus the first exchange and repairs the STATE
 *     before the lesson — lower the stakes, shrink the step, change the
 *     angle — never a gate.
 *   - PLAN is the route (planRoute.ts), visible on the desk.
 *   - TEACH is the erotetic loop, one beat per concept: a trial (a
 *     question, a problem, a prediction — never a lecture), the learner
 *     generates, the professor diagnoses the wrong reading, repairs, and
 *     exits the concept at the 80% mastery threshold (A13: stamp, say
 *     so, leave). The retry → re-explain → re-ask contract is session.ts's
 *     (buildRetryQuestion), reused unchanged.
 *   - PRACTICE is the FSRS queue (practice.ts), interleaved.
 *   - REPORT is the librarian's note filed to the ledger — what took
 *     hold, what is forming, what waits, what comes next. No machinery
 *     talk, no scores.
 *
 * The mentor doctrine (AXIOM_FICTION PART 2) is the feel: trials not
 * lectures; withhold until ready; believe before evidence without lying
 * about the current state; know when to leave; teach the person; respect
 * agency (pause, skip, leave at any time — the session serves the
 * learner, never the reverse).
 *
 * The erotetic method (guidedStance): a beat the professor poses is a
 * trial — the stance table's scaffold/worked-example/socratic rows, never
 * answer-now. A question the LEARNER asks is answered completely and
 * immediately, always (C2) — the method serves the learner; it never
 * gates them.
 *
 * Everything here is pure so the pedagogy contract is testable without a
 * model, a book, or a filesystem. The session log (beats) is the
 * session's memory; the reducer is the only writer.
 */
import { gradedAccuracy, STUCK_THRESHOLD, type ConceptState } from './learner';
import type { RouteNode, StudyRoute } from './planRoute';
import { decideStance, type Stance, type StanceInput } from './stance';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type SessionPhase =
  | 'idle'
  | 'measuring'
  | 'planning'
  | 'teaching'
  | 'practicing'
  | 'reporting'
  | 'done';

/** The learner's state (A3) — read before the lesson, never a verdict
 *  about the person. 'steady' is the honest default when the evidence
 *  says nothing. */
export type LearnerStateRead = 'steady' | 'rushed' | 'defended' | 'curious' | 'bored';

/** One line in the session log — the session's memory. */
export interface SessionBeat {
  kind: 'trial' | 'verdict' | 'note';
  /** Who spoke. Absent = the professor (Wave A's beats). The guided
   *  conversation (Wave A2) logs the learner's turns too — the beat log
   *  IS the conversation. */
  speaker?: 'professor' | 'learner';
  /** Plain words, librarian voice — never machinery. */
  text: string;
  concept?: string;
  verdict?: 'pass' | 'retry';
  at: string; // ISO timestamp
}

export interface GuidedSessionState {
  phase: SessionPhase;
  goal: string;
  route: StudyRoute | null;
  /** Index into the teaching sequence (the route minus what they own). */
  conceptIdx: number;
  /** Graded outcomes per concept, newest last, capped at 10 — the
   *  in-session window behind the mastery exit. */
  graded: Record<string, Array<'pass' | 'retry'>>;
  /** Concepts where the mastery exit fired (stamp, say so, leave — A13). */
  exits: string[];
  /** Concepts the learner skipped — their agency, recorded without blame. */
  skipped: string[];
  stateRead: LearnerStateRead;
  /** Free-mode interruption: the session holds its place. */
  paused: boolean;
  beats: SessionBeat[];
}

// ---------------------------------------------------------------------------
// The conversation — the beat log as a scroll of turns (Wave A2)
// ---------------------------------------------------------------------------

/** One rendered message in the guided session's conversation. */
export interface ConversationTurn {
  speaker: 'professor' | 'learner';
  kind: SessionBeat['kind'];
  text: string;
  concept?: string;
  verdict?: 'pass' | 'retry';
  at: string;
}

/** The conversation IS the session: the beat log mapped to turns, in
 *  order, nothing added, nothing dropped. The UI renders exactly this. */
export function buildConversation(state: GuidedSessionState): ConversationTurn[] {
  return state.beats.map((b) => ({
    speaker: b.speaker ?? 'professor',
    kind: b.kind,
    text: b.text,
    ...(b.concept ? { concept: b.concept } : {}),
    ...(b.verdict ? { verdict: b.verdict } : {}),
    at: b.at,
  }));
}

export const idleSession = (): GuidedSessionState => ({
  phase: 'idle',
  goal: '',
  route: null,
  conceptIdx: 0,
  graded: {},
  exits: [],
  skipped: [],
  stateRead: 'steady',
  paused: false,
  beats: [],
});

// ---------------------------------------------------------------------------
// Events — the only way the session moves
// ---------------------------------------------------------------------------

export type SessionEvent =
  | { type: 'start'; goal: string }
  | { type: 'measured'; stateRead: LearnerStateRead }
  | { type: 'planned'; route: StudyRoute }
  | { type: 'beat'; beat: SessionBeat }
  | { type: 'verdict'; concept: string; verdict: 'pass' | 'retry' }
  | { type: 'nextConcept' }
  | { type: 'skipConcept' }
  | { type: 'practiceDone' }
  | { type: 'reportFiled' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'exit' }
  | { type: 'reset' };

/** Concepts the professor teaches: the route minus what the learner
 *  already owns (the mastery exit is permanent — no re-drilling), the
 *  goal last. */
export function teachSequence(route: StudyRoute): RouteNode[] {
  return route.nodes.filter((n) => n.role !== 'known');
}

/** The concept the professor is teaching right now, if any. */
export function currentConcept(state: GuidedSessionState): RouteNode | null {
  if (state.phase !== 'teaching' || !state.route) return null;
  return teachSequence(state.route)[state.conceptIdx] ?? null;
}

/** The mastery exit threshold (A13; L2 §15's ≥80% gate, windowed). */
export const MASTERY_EXIT = 0.8;

const windowAccuracy = (window: Array<'pass' | 'retry'>): number =>
  window.length === 0 ? 0 : window.filter((v) => v === 'pass').length / window.length;

/** The exit fires when the in-session graded window reaches 80% passes —
 *  the same rule the ledger's masteryOf applies, so the desk and the
 *  ledger never disagree about "got it". */
export function masteryExitReached(state: GuidedSessionState, concept: string): boolean {
  if (state.exits.includes(concept)) return true;
  const window = state.graded[concept] ?? [];
  return window.length > 0 && windowAccuracy(window) >= MASTERY_EXIT;
}

export function sessionReducer(state: GuidedSessionState, event: SessionEvent): GuidedSessionState {
  switch (event.type) {
    case 'start': {
      // A session starts from rest — never over a live one.
      if (state.phase !== 'idle' && state.phase !== 'done') return state;
      return { ...idleSession(), phase: 'measuring', goal: event.goal.trim() || 'the goal' };
    }
    case 'measured':
      // The latent measure lands: the state read is stored before any
      // teaching — state precedes content (A3).
      return state.phase === 'measuring'
        ? { ...state, phase: 'planning', stateRead: event.stateRead }
        : state;
    case 'planned': {
      if (state.phase !== 'planning') return state;
      // Everything already owned → the road is walked before it starts;
      // go straight to practice.
      return {
        ...state,
        phase: teachSequence(event.route).length > 0 ? 'teaching' : 'practicing',
        route: event.route,
        conceptIdx: 0,
      };
    }
    case 'beat':
      // The log is the session's memory; it grows in every live phase.
      return state.phase === 'idle' ? state : { ...state, beats: [...state.beats, event.beat] };
    case 'verdict': {
      if (state.phase !== 'teaching' && state.phase !== 'practicing') return state;
      const window = [...(state.graded[event.concept] ?? []), event.verdict].slice(-10);
      const graded = { ...state.graded, [event.concept]: window };
      // The mastery exit fires AT the threshold — stamped once, never
      // re-drilled this session (A13). Evidence recorded while paused
      // still counts; the exit is honest.
      const exits =
        state.phase === 'teaching' &&
        !state.exits.includes(event.concept) &&
        windowAccuracy(window) >= MASTERY_EXIT
          ? [...state.exits, event.concept]
          : state.exits;
      return { ...state, graded, exits };
    }
    case 'nextConcept': {
      // A paused session holds its place — no silent advancement.
      if (state.phase !== 'teaching' || state.paused) return state;
      const next = state.conceptIdx + 1;
      return next >= (state.route ? teachSequence(state.route).length : 0)
        ? { ...state, phase: 'practicing' }
        : { ...state, conceptIdx: next };
    }
    case 'skipConcept': {
      // Respect agency: the learner may pass on a concept, ungraded,
      // without blame — it simply waits.
      if (state.phase !== 'teaching' || state.paused) return state;
      const current = state.route ? teachSequence(state.route)[state.conceptIdx] : undefined;
      const skipped =
        current && !state.skipped.includes(current.name)
          ? [...state.skipped, current.name]
          : state.skipped;
      const next = state.conceptIdx + 1;
      return next >= (state.route ? teachSequence(state.route).length : 0)
        ? { ...state, skipped, phase: 'practicing' }
        : { ...state, skipped, conceptIdx: next };
    }
    case 'practiceDone':
      return state.phase === 'practicing' ? { ...state, phase: 'reporting' } : state;
    case 'reportFiled':
      return state.phase === 'reporting' ? { ...state, phase: 'done' } : state;
    case 'pause':
      return state.phase === 'idle' || state.phase === 'done' ? state : { ...state, paused: true };
    case 'resume':
      return state.paused ? { ...state, paused: false } : state;
    case 'exit':
      // The learner is done — any live phase reports what happened, then
      // rests. The professor never overstays.
      return state.phase === 'idle' || state.phase === 'done' || state.phase === 'reporting'
        ? state
        : { ...state, phase: 'reporting', paused: false };
    case 'reset':
      return idleSession();
  }
}

// ---------------------------------------------------------------------------
// The state read (A3) — latent, never a quiz, never a gate
// ---------------------------------------------------------------------------

const SKIP_CONCEPTS = new Set(['uncategorized', 'chapter_session', 'guided_session']);

/**
 * Read the learner's state off the ledger before the first beat. The
 * heuristics are deliberately conservative and read SIGNALS, never
 * essence (A4: model state, never identity):
 *   - defended: a concept re-asked past the stuck threshold with no
 *     graded pass behind it — the attempt itself is being avoided
 *     (self-worth protection; the stakes feel high).
 *   - rushed: many concepts touched, none ever checked — surface
 *     contact, speed over hold.
 *   - steady: nothing loud in the log — begin conservatively.
 * 'curious' and 'bored' are read from the first exchange, not the
 * ledger; the caller refines the read through the same 'measured' event.
 */
export function readStateFromLedger(conceptStates: Record<string, ConceptState>): LearnerStateRead {
  const entries = Object.entries(conceptStates).filter(([name]) => !SKIP_CONCEPTS.has(name));
  if (entries.length === 0) return 'steady';
  const defended = entries.some(([, s]) => s.asked >= STUCK_THRESHOLD && gradedAccuracy(s) < 0.5);
  if (defended) return 'defended';
  const everGraded = entries.some(([, s]) => (s.graded?.length ?? 0) > 0);
  if (entries.length >= 5 && !everGraded) return 'rushed';
  return 'steady';
}

export interface StateAdjustment {
  move: 'none' | 'lower-stakes' | 'shrink-step' | 'change-angle' | 'follow-curiosity';
  /** A prompt fragment for the first beat — the state repair, in words
   *  the professor can act on. */
  line: string;
}

/** State-repair before content-repair (A3): the first beat is adjusted
 *  to the read — the lesson waits one breath. */
export function firstBeatAdjustment(read: LearnerStateRead): StateAdjustment {
  switch (read) {
    case 'defended':
      return {
        move: 'shrink-step',
        line: 'The ledger suggests the stakes feel high here. Open with the smallest possible step, and say plainly that this first attempt is practice — nothing rides on it.',
      };
    case 'rushed':
      return {
        move: 'lower-stakes',
        line: 'The learner has been moving fast. Slow the first beat down: one small question, no clock, and a wrong answer here costs nothing.',
      };
    case 'bored':
      return {
        move: 'change-angle',
        line: 'Approach the concept from an unexpected angle — a puzzle, a prediction, a real case — not the book’s first definition.',
      };
    case 'curious':
      return {
        move: 'follow-curiosity',
        line: 'They are leaning in. Go straight to the live edge of the concept; skip the warm-up.',
      };
    default:
      return { move: 'none', line: '' };
  }
}

// ---------------------------------------------------------------------------
// The erotetic default — the stance table under guided rules
// ---------------------------------------------------------------------------

/**
 * The guided-mode stance. C2 held: a question the LEARNER asks is
 * answered completely and immediately, always — answer-now, first row,
 * no exceptions. A beat the PROFESSOR poses is a trial: the table's own
 * rows apply (scaffold-one-rung by default, worked-example after a miss,
 * socratic on a pass, reveal-with-warmth at the honest end) — and
 * answer-now is unreachable for a posed beat, because the first row
 * matches on initiation 'asked' only. The erotetic method serves the
 * learner; it never gates them.
 */
export function guidedStance(input: StanceInput): Stance {
  if (input.initiation === 'asked') return 'answer-now';
  return decideStance({ ...input, initiation: 'posed' });
}

// ---------------------------------------------------------------------------
// The teach beat — a trial, not a lecture
// ---------------------------------------------------------------------------

/**
 * The prompt that opens one teaching beat, sent through the ordinary
 * professor loop. The erotetic contract lives here: the professor poses
 * ONE trial and waits; the learner generates before any reveal; the
 * verdict contract (session.ts's) grades the attempt so it lands on the
 * ledger; an asked question is answered completely first (C2). The first
 * beat carries the state-read adjustment (A3) — state-repair before
 * content-repair.
 */
export function buildGuidedBeatPrompt(args: {
  goal: string;
  route: StudyRoute;
  conceptIdx: number;
  stateRead: LearnerStateRead;
}): string | null {
  const seq = teachSequence(args.route);
  const node = seq[args.conceptIdx];
  if (!node) return null;
  const pretty = node.label;
  const adjust = args.conceptIdx === 0 ? firstBeatAdjustment(args.stateRead).line : '';
  return [
    `Guided session on "${args.goal}" — concept ${args.conceptIdx + 1} of ${seq.length} on the road: "${pretty}".`,
    adjust,
    'This is a trial, not a lecture: pose ONE question, problem, or prediction that makes me generate the idea myself — then stop and wait. Do not explain the concept first, and do not answer your own question.',
    'When I answer, diagnose briefly and specifically: name exactly what was right, and the exact wrong reading if there was one — the reading, never me. End the grading with a verdict tag on its own line: [PASS] if I have the load-bearing idea in my own words, [RETRY] if something load-bearing is missing — then one line [CAPTION:the one-line takeaway].',
    `Tag the grading [CONCEPT:${node.name}][QKIND:check-me] so the outcome lands on my study ledger.`,
    'If I ask you a question, answer it completely and immediately — answers are always free — then return to the trial.',
  ]
    .filter((line) => line.length > 0)
    .join(' ');
}

// ---------------------------------------------------------------------------
// The report — the librarian's note, filed to the ledger
// ---------------------------------------------------------------------------

/**
 * The session report (A13's other half: the professor knows when to
 * stop, and stopping is part of the teaching). Librarian voice, no
 * machinery: what took hold, what is still forming, what waits, and what
 * comes next. `dueCount` is the review surface's own count, phrased as a
 * return invitation, never a number to chase.
 */
export function buildSessionReportMd(
  state: GuidedSessionState,
  opts: { date: string; page: number; dueCount?: number },
): string {
  const pretty = (slug: string): string => slug.replace(/_/g, ' ');
  const seq = state.route ? teachSequence(state.route) : [];
  const forming = Object.keys(state.graded).filter((c) => !state.exits.includes(c));
  const waiting = seq
    .map((n) => n.name)
    .filter((n) => !state.exits.includes(n) && !forming.includes(n));
  const settled = state.exits.length;
  const total = seq.length > 0 ? seq.length : Object.keys(state.graded).length;
  const next =
    waiting.length > 0
      ? `Next time, the road picks up at ${pretty(waiting[0]!)}.`
      : 'The road is walked — what remains is keeping it.';
  const due =
    opts.dueCount !== undefined && opts.dueCount > 0
      ? ` ${opts.dueCount} earlier ${opts.dueCount === 1 ? 'idea is' : 'ideas are'} due back on the desk when they call.`
      : '';
  return [
    `### guided session — ${state.goal} (p.${opts.page}, ${opts.date})`,
    '',
    `Taking hold: ${settled > 0 ? state.exits.map(pretty).join(', ') : 'nothing new settled today — that is allowed'}.`,
    `Still forming: ${forming.length > 0 ? forming.map(pretty).join(', ') : 'nothing mid-way'}.`,
    `Waiting its turn: ${waiting.length > 0 ? waiting.map(pretty).join(', ') : 'the road is walked'}.`,
    '',
    `${next}${due}`,
    '',
    `_${settled} of ${total} concepts settled._`,
  ].join('\n');
}

/** The one-line summary folded into learner.json at session end (the
 *  chapter session's pattern, session.ts). */
export function sessionSummaryLine(state: GuidedSessionState): string {
  const forming = Object.keys(state.graded).filter((c) => !state.exits.includes(c)).length;
  return `Guided session on ${state.goal}: ${state.exits.length} settled, ${forming} still forming`;
}
