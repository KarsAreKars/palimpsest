/**
 * guidedSessionStore — the guided session's controller (Wave A2).
 *
 * The session state machine (services/professor/guidedSession.ts) is
 * REUSED unchanged — this store is the driver Wave A lacked: it owns the
 * reducer state outside React (a notebook tab switch can no longer wipe a
 * live session — the Wave A state-loss bug), runs the ask/verdict loop
 * through the ordinary professor bridge, and keeps the conversation: the
 * beat log IS the conversation (every turn is a beat; buildConversation
 * renders it).
 *
 * The flow (THE FORM §2, the LearnHarness back-and-forth):
 *   begin → measure (latent: the ledger is read, never quizzed) → plan
 *   (the route, in the header strip) → teach (a trial per concept: his
 *   question → your answer → his verdict + repair → the next; the 80%
 *   mastery exit) → practice (the FSRS queue) → the report (his final
 *   message, filed to the ledger).
 *
 * Bug fixes over the Wave A panel (regression-tested):
 *   - Practice could never complete: the verdict intake read the [CONCEPT]
 *     tag off the annotation BUS, but useProfessor strips concept/qkind
 *     from the bus set — the stamped set never filled. The verdict now
 *     arrives on the ask's own onAnswer channel with the FULL parsed tags.
 *   - Pause between answer and verdict wedged the session: the advance was
 *     dropped and the re-ask guard blocked resume. The advance is now
 *     recorded (pendingAdvance) and runs on resume.
 *   - The intake raced React state (refs lagging a render behind the
 *     reducer). Zustand sets are synchronous — dispatch then read is exact.
 *   - A stale stream from a previous session could append into a new one;
 *     a generation counter drops late answers.
 *
 * Text-to-text is the default (owner ruling): every ask is silent unless
 * the speaker toggle (voiceOn) opts back in.
 */
import { create } from 'zustand';

import environmentConfig from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { getBookProgress } from '@/store/readerProgressStore';
import { askProfessorFromUI } from '@/services/professor/askBridge';
import { slugifyConcept, type ProfessorAnnotation } from '@/services/professor/annotations';
import {
  appendExchange,
  appendNote,
  emptyLearner,
  loadLearner,
  type LearnerState,
} from '@/services/professor/learner';
import { dueCards } from '@/services/professor/scheduler';
import { planRoute, type RouteSeed, type StudyRoute } from '@/services/professor/planRoute';
import { buildPracticeQuestion, composePracticeQueue } from '@/services/professor/practice';
import { PROFESSOR_GUIDED_SYSTEM_PROMPT } from '@/services/professor/prompt';
import { buildRetryQuestion, extractSessionOutcome } from '@/services/professor/session';
import {
  buildGuidedBeatPrompt,
  buildSessionReportMd,
  currentConcept,
  idleSession,
  readStateFromLedger,
  sessionReducer,
  sessionSummaryLine,
  teachSequence,
  type GuidedSessionState,
  type SessionBeat,
  type SessionEvent,
} from '@/services/professor/guidedSession';
import type { RouteNode } from '@/services/professor/planRoute';
import type { TOCItem } from '@/libs/document';

export type GuidedMode = 'free' | 'guided';

interface GuidedSessionStore {
  /** Free = the desk; guided = the full-screen session view. */
  mode: GuidedMode;
  /** Text-to-text is the default; the speaker toggle opts into voice. */
  voiceOn: boolean;
  /** The book the live session belongs to (one session at a time). */
  bookKey: string | null;
  session: GuidedSessionState;
  /** The filed report markdown (phase done), for the closing surface. */
  report: string | null;
  /** One quiet status line ("Session filed to your study notes."). */
  note: string;
  setMode: (bookKey: string, mode: GuidedMode) => void;
  setVoiceOn: (on: boolean) => void;
  /** Open the session: measure (latent) → plan → the first trial. */
  begin: (bookKey: string, goal?: string) => Promise<void>;
  /** The composer's send: a learner turn; while a trial stands it is the
   *  attempt, otherwise a free question (answered completely, C2). */
  answer: (bookKey: string, text: string) => void;
  skip: (bookKey: string) => void;
  pause: () => void;
  resume: (bookKey: string) => void;
  end: (bookKey: string, via: 'completed' | 'ended') => Promise<void>;
  /** New session: rest the machine, keep the mode. */
  reset: () => void;
  /** Internal: the reducer's only door. */
  _dispatch: (event: SessionEvent) => void;
}

// ── Controller internals (non-reactive; one live session at a time) ────────

/** True from an ask until its graded verdict lands (or the beat moves). */
let awaiting = false;
/** A graded verdict that landed while paused — the advance waits for
 *  resume (the Wave A wedge fix). */
let pendingAdvance: { concept: string; verdict: 'pass' | 'retry' } | null = null;
/** Concepts already given their one retry round this session. */
let retried = new Set<string>();
/** The practice queue's concepts + progress (the completion fix). */
let practiceQueue = new Set<string>();
let practiceStamped = new Set<string>();
let practiceTotal = 0;
/** Once-guard for the report (verdict callback and End button can land
 *  in the same frame). */
let ended = false;
/** Drops answers from a stale stream after reset/begin. */
let generation = 0;
/** The ledger snapshot from begin (practice + the report's due count). */
let learnerSnapshot: LearnerState = emptyLearner();

const nowIso = () => new Date().toISOString();

/** The book's own order as route seeds (the TOC is the lesson plan). */
const tocSeedsFrom = (toc: TOCItem[]): RouteSeed[] => {
  const out: RouteSeed[] = [];
  const seen = new Set<string>();
  const walk = (items: TOCItem[]) => {
    for (const item of items) {
      const slug = slugifyConcept(item.label);
      if (slug.length >= 3 && !seen.has(slug)) {
        seen.add(slug);
        out.push({
          name: item.label.trim(),
          ...(Number.isFinite(item.index) ? { page: item.index + 1 } : {}),
        });
      }
      if (item.subitems?.length) walk(item.subitems);
    }
  };
  walk(toc);
  return out.slice(0, 40);
};

/** The goal: the learner's own words, else the professor infers from the
 *  book — the chapter being read. */
const inferGuidedGoal = (bookKey: string): string => {
  const page = (getBookProgress(bookKey)?.index ?? 0) + 1;
  let label = '';
  const walk = (items: TOCItem[]) => {
    for (const item of items) {
      if (Number.isFinite(item.index) && item.index <= page - 1) {
        label = item.label.trim() || label;
      }
      if (item.subitems?.length) walk(item.subitems);
    }
  };
  walk(useBookDataStore.getState().getBookData(bookKey)?.bookDoc?.toc ?? []);
  return label || 'this book';
};

export const useGuidedSessionStore = create<GuidedSessionStore>((set, get) => {
  const dispatch = (event: SessionEvent) =>
    set((st) => ({ session: sessionReducer(st.session, event) }));

  const pushBeat = (beat: SessionBeat) => dispatch({ type: 'beat', beat });

  /** One ask through the ordinary professor loop, wired to the intake. */
  const gAsk = (bookKey: string, prompt: string) => {
    const gen = generation;
    askProfessorFromUI(bookKey, prompt, {
      system: PROFESSOR_GUIDED_SYSTEM_PROMPT,
      silent: !get().voiceOn,
      onAnswer: (text, annotations) => {
        if (gen !== generation) return; // a stale stream, not this session
        handleAnswer(bookKey, text, annotations);
      },
      onError: () => {
        if (gen !== generation) return;
        // The stream failed (barge-in aborts never fire this): say so in
        // the conversation, keep the place — the beat can be re-asked.
        awaiting = false;
        pushBeat({
          kind: 'note',
          speaker: 'professor',
          text: 'The line went quiet — say that again, and I will pick it up.',
          at: nowIso(),
        });
      },
    });
  };

  /** The concept a turn is about: the live node, else the [CONCEPT] tag. */
  const turnConcept = (s: GuidedSessionState, tag?: string): string | undefined => {
    if (s.phase === 'teaching') return currentConcept(s)?.name ?? tag;
    return tag;
  };

  /** The advance after a graded teaching verdict: one retry round, else
   *  the next concept — or practice when the road is walked. */
  const advanceFromVerdict = (bookKey: string, node: RouteNode, verdict: 'pass' | 'retry') => {
    const s = get().session;
    if (!s.route) return;
    // The mastery exit is final: no re-ask of a concept he has left (A13).
    const exited = s.exits.includes(node.name);
    if (!exited && verdict === 'retry' && !retried.has(node.name)) {
      // Retry → re-explain → re-ask (session.ts's contract): one round,
      // never an instant advance, never an identical repeat.
      retried.add(node.name);
      gAsk(bookKey, buildRetryQuestion(node.label));
      return;
    }
    const nextIdx = s.conceptIdx + 1;
    dispatch({ type: 'nextConcept' });
    if (nextIdx >= teachSequence(s.route).length) beginPractice(bookKey, s.route);
    else askBeat(bookKey, s.route, nextIdx, s.stateRead);
  };

  /** The verdict intake — the professor's completed answer moves the
   *  machine. Ordered: his turn lands in the conversation first, then the
   *  verdict, then the advance. */
  const handleAnswer = (bookKey: string, text: string, annotations: ProfessorAnnotation[]) => {
    const st = get();
    const s = st.session;
    if (st.bookKey !== bookKey || s.phase === 'idle') return;
    const outcome = extractSessionOutcome(annotations);
    const conceptTag = annotations.find(
      (a): a is Extract<ProfessorAnnotation, { kind: 'concept' }> => a.kind === 'concept',
    )?.name;
    const at = nowIso();

    // His turn, always — the conversation is the session.
    const concept = turnConcept(s, conceptTag);
    pushBeat({
      kind: outcome ? 'verdict' : 'trial',
      speaker: 'professor',
      text,
      ...(concept ? { concept } : {}),
      ...(outcome ? { verdict: outcome.verdict } : {}),
      at,
    });

    // No verdict: a free question answered completely (C2) — the trial
    // still stands; nothing advances.
    if (!outcome) return;

    if (s.phase === 'practicing') {
      // The completion fix: the concept comes off the FULL parsed tags
      // (the bus set drops it). Only queue concepts count.
      if (conceptTag && practiceQueue.has(conceptTag)) {
        dispatch({ type: 'verdict', concept: conceptTag, verdict: outcome.verdict });
        practiceStamped.add(conceptTag);
      }
      if (practiceStamped.size >= practiceTotal && practiceTotal > 0) {
        awaiting = false;
        void endSession(bookKey, 'completed');
      }
      // Otherwise the practice prompt itself drives the next question.
      return;
    }

    if (s.phase !== 'teaching') return;
    const node = currentConcept(s);
    if (!node) return;
    dispatch({ type: 'verdict', concept: node.name, verdict: outcome.verdict });
    const after = get().session;
    // The mastery exit (A13): stamp, say so, leave — in his voice.
    if (after.exits.includes(node.name) && !s.exits.includes(node.name)) {
      pushBeat({
        kind: 'note',
        speaker: 'professor',
        text: `You've got this — ${node.label} is settled. Moving on.`,
        concept: node.name,
        at: nowIso(),
      });
    }
    awaiting = false;
    if (after.paused) {
      // Evidence is filed; the session holds its place. The advance waits
      // for resume — never dropped (the Wave A wedge fix).
      pendingAdvance = { concept: node.name, verdict: outcome.verdict };
      return;
    }
    advanceFromVerdict(bookKey, node, outcome.verdict);
  };

  /** One teaching beat: the erotetic trial, posed through the loop. */
  const askBeat = (
    bookKey: string,
    route: StudyRoute,
    idx: number,
    stateRead: GuidedSessionState['stateRead'],
  ) => {
    const node = teachSequence(route)[idx];
    if (!node) return;
    const prompt = buildGuidedBeatPrompt({
      goal: route.goalLabel,
      route,
      conceptIdx: idx,
      stateRead,
    });
    if (!prompt) return;
    awaiting = true;
    gAsk(bookKey, prompt);
  };

  /** The practice phase: the FSRS queue, interleaved (practice.ts). */
  const beginPractice = (bookKey: string, route: StudyRoute) => {
    const items = composePracticeQueue({
      conceptStates: learnerSnapshot.concept_states,
      route,
      now: Date.now(),
    });
    const q = buildPracticeQuestion(items);
    if (!q) {
      void endSession(bookKey, 'ended');
      return;
    }
    practiceQueue = new Set(items.map((i) => i.concept));
    practiceStamped = new Set();
    practiceTotal = items.length;
    awaiting = true;
    gAsk(bookKey, q);
  };

  /** The session report (A13: he knows when to stop). His final message,
   *  filed to notes.md + the ledger, librarian voice. */
  const endSession = async (bookKey: string, via: 'completed' | 'ended') => {
    if (ended) return;
    ended = true;
    awaiting = false;
    pendingAdvance = null;
    dispatch(via === 'completed' ? { type: 'practiceDone' } : { type: 'exit' });
    const s = get().session;
    const appService = await environmentConfig.getAppService().catch(() => null);
    const book = useBookDataStore.getState().getBookData(bookKey)?.book;
    const page = (getBookProgress(bookKey)?.index ?? 0) + 1;
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let dueCount = 0;
    if (appService && book) {
      const fresh = await loadLearner(appService, book).catch(() => learnerSnapshot);
      dueCount = dueCards(fresh.concept_states, Date.now()).filter(
        ({ concept }) =>
          concept !== 'uncategorized' &&
          concept !== 'chapter_session' &&
          concept !== 'guided_session',
      ).length;
    }
    const report = buildSessionReportMd(s, { date, page, dueCount });
    pushBeat({ kind: 'note', speaker: 'professor', text: report, at: nowIso() });
    if (appService && book) {
      try {
        await appendNote(appService, book, report);
        await appendExchange(appService, book, {
          ts: new Date().toISOString(),
          concept: 'guided_session',
          page,
          question_kind: 'check-me',
          question: sessionSummaryLine(s),
          resolved: false,
        });
      } catch (e) {
        console.warn('[guided] session report failed', e);
      }
    }
    dispatch({ type: 'reportFiled' });
    set({ report, note: 'Session filed to your study notes.' });
  };

  return {
    mode: 'free',
    voiceOn: false,
    bookKey: null,
    session: idleSession(),
    report: null,
    note: '',

    _dispatch: dispatch,

    setMode: (bookKey, mode) => {
      const s = get().session;
      set({ mode });
      if (mode === 'free' && s.phase !== 'idle' && s.phase !== 'done' && !s.paused) {
        // Free mid-session pauses — the session holds its place (agency).
        dispatch({ type: 'pause' });
      } else if (mode === 'guided' && s.paused && get().bookKey === bookKey) {
        get().resume(bookKey);
      }
    },

    setVoiceOn: (on) => set({ voiceOn: on }),

    begin: async (bookKey, goalDraft) => {
      const s0 = get().session;
      if (s0.phase !== 'idle' && s0.phase !== 'done') return; // never over a live one
      generation += 1;
      ended = false;
      awaiting = false;
      pendingAdvance = null;
      retried = new Set();
      practiceQueue = new Set();
      practiceStamped = new Set();
      practiceTotal = 0;
      const appService = await environmentConfig.getAppService().catch(() => null);
      const bookData = useBookDataStore.getState().getBookData(bookKey);
      const book = bookData?.book;
      let learner: LearnerState = emptyLearner();
      if (appService && book) {
        learner = await loadLearner(appService, book).catch(() => emptyLearner());
      }
      learnerSnapshot = learner;
      // MEASURE is latent: the ledger is read, never quizzed (A3).
      const states = learner.concept_states;
      const pages: Record<string, number> = {};
      for (const ex of learner.exchanges) {
        if (Number.isFinite(ex.page)) pages[ex.concept] = ex.page;
      }
      const goal = (goalDraft ?? '').trim() || inferGuidedGoal(bookKey);
      const stateRead = readStateFromLedger(states);
      // PLAN: the route, visible in the header strip.
      const route = planRoute({
        goal,
        conceptStates: states,
        seeds: tocSeedsFrom(bookData?.bookDoc?.toc ?? []),
        book: book?.hash,
        pages,
      });
      set({ bookKey, mode: 'guided', report: null, note: '' });
      dispatch({ type: 'start', goal });
      dispatch({ type: 'measured', stateRead });
      dispatch({ type: 'planned', route });
      const seq = teachSequence(route);
      pushBeat({
        kind: 'note',
        speaker: 'professor',
        text: `A guided session begins: the road to ${goal}. ${seq.length} ${
          seq.length === 1 ? 'concept' : 'concepts'
        } on the road.`,
        at: nowIso(),
      });
      if (seq.length === 0) beginPractice(bookKey, route);
      else askBeat(bookKey, route, 0, stateRead);
    },

    answer: (bookKey, text) => {
      const t = text.trim();
      if (!t || get().bookKey !== bookKey) return;
      const s = get().session;
      if (s.phase !== 'teaching' && s.phase !== 'practicing') return;
      pushBeat({ kind: 'note', speaker: 'learner', text: t, at: nowIso() });
      if (s.paused) {
        // A free question while the session holds — answered completely,
        // always (C2); the place is kept.
        gAsk(bookKey, t);
        return;
      }
      // While a trial stands the message is the attempt; the verdict tag
      // (when he grades) moves the machine.
      gAsk(bookKey, t);
    },

    skip: (bookKey) => {
      const s = get().session;
      const node = currentConcept(s);
      if (!node || !s.route || s.paused) return;
      pushBeat({
        kind: 'note',
        speaker: 'professor',
        text: `You pass on ${node.label} — it waits. No blame; the road keeps it.`,
        concept: node.name,
        at: nowIso(),
      });
      awaiting = false;
      pendingAdvance = null;
      const nextIdx = s.conceptIdx + 1;
      dispatch({ type: 'skipConcept' });
      if (nextIdx >= teachSequence(s.route).length) beginPractice(bookKey, s.route);
      else askBeat(bookKey, s.route, nextIdx, s.stateRead);
    },

    pause: () => {
      const s = get().session;
      if (s.phase === 'idle' || s.phase === 'done' || s.paused) return;
      dispatch({ type: 'pause' });
    },

    resume: (bookKey) => {
      const s = get().session;
      if (!s.paused) return;
      dispatch({ type: 'resume' });
      if (pendingAdvance) {
        // The verdict landed while paused — the advance runs now.
        const pa = pendingAdvance;
        pendingAdvance = null;
        const node = s.route ? teachSequence(s.route)[s.conceptIdx] : undefined;
        if (node) advanceFromVerdict(bookKey, node, pa.verdict);
        return;
      }
      // The trial never posed (paused before the ask landed): pose it now.
      if (s.phase === 'teaching' && !awaiting && s.route && currentConcept(s)) {
        askBeat(bookKey, s.route, s.conceptIdx, s.stateRead);
      }
    },

    end: async (bookKey, via) => {
      await endSession(bookKey, via);
    },

    reset: () => {
      generation += 1;
      ended = true;
      awaiting = false;
      pendingAdvance = null;
      set({ session: idleSession(), report: null, note: '', bookKey: null });
    },
  };
});
