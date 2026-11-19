/**
 * Practice (Learning Engine Wave 'Learn Mode') — its own mode, distinct
 * from reading: a focused run of checks over the Wave 2 FSRS queue,
 * interleaved with varied problems from the goal's concept nodes.
 *
 * Composition rides the Wave 2 scheduler unchanged: due cards (FSRS
 * due_ts is authoritative) plus a fresh lane, interleaved by
 * composeReviewQueue so practice never groups by document (L2 §3/§15).
 * When the learner has stated a goal, the fresh lane is the route's
 * nodes (planRoute.ts) — practice aims at the road. Grading is instant
 * and local where it can be: math the learner works in the notebook is
 * checked by the desk's existing silent checker the moment it is
 * written, and every graded verdict lands on the ledger through the
 * ordinary [CONCEPT:name][QKIND:check-me][PASS]/[RETRY] logging path —
 * no new channel. The retry → re-explain → re-ask loop is the one
 * session.ts already carries (buildRetryQuestion); the practice prompt
 * bakes its rules into the round so the voice loop needs no new UI.
 *
 * Pure throughout for contract tests.
 */
import { composeReviewQueue, dueCards } from './scheduler';
import { UNCATEGORIZED_CONCEPT, type ConceptState } from './learner';
import type { StudyRoute } from './planRoute';

export type PracticeKind = 'due' | 'forming';

export interface PracticeItem {
  /** Ledger slug — the [CONCEPT:name] logging key for its grading. */
  concept: string;
  /** 'due' = the FSRS card has come due; 'forming' = a varied problem
   *  from the route/ledger, not yet (or not currently) due. */
  kind: PracticeKind;
}

/** A practice sitting is deliberately shorter than a review sitting —
 *  checks are effort, and effort budgets run small (L2 §15's cap, halved). */
export const PRACTICE_CAP = 8;

const SKIP_CONCEPTS = new Set([UNCATEGORIZED_CONCEPT, 'chapter_session']);

/**
 * Compose the practice queue: due cards first-class (Wave 2 FSRS), the
 * fresh lane drawn from the goal route when one exists, else from the
 * ledger's engaged concepts; interleaved due/forming, capped. Empty
 * ledger and no route → [] (nothing to practise — the button hides).
 */
export function composePracticeQueue(args: {
  conceptStates: Record<string, ConceptState>;
  route?: StudyRoute;
  now: number;
  cap?: number;
}): PracticeItem[] {
  const { conceptStates, route, now, cap = PRACTICE_CAP } = args;
  const due = dueCards(conceptStates, now)
    .map((d) => d.concept)
    .filter((c) => !SKIP_CONCEPTS.has(c));
  const dueSet = new Set(due);

  const candidates = route ? route.nodes.map((n) => n.name) : Object.keys(conceptStates);
  const fresh: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (SKIP_CONCEPTS.has(c) || dueSet.has(c) || seen.has(c)) continue;
    seen.add(c);
    fresh.push(c);
    if (fresh.length >= cap) break;
  }

  const order = composeReviewQueue(
    due.map((concept) => ({ concept })),
    fresh.map((concept) => ({ concept })),
    cap,
  );
  return order.map((p) => ({
    concept: p.concept,
    kind: dueSet.has(p.concept) ? 'due' : 'forming',
  }));
}

/**
 * The question that opens a practice round, sent through the ordinary
 * askProfessorFromUI voice loop. The verdict contract (session.ts's) is
 * baked in per concept — one question at a time, grade, stamp
 * [PASS]/[RETRY] + [CAPTION:], tag the grading so it lands on the
 * ledger — plus the retry → re-explain → re-ask rule and the desk-
 * checker trust rule. Answers stay free mid-round (R1): a question the
 * learner asks is answered completely, then the queue resumes.
 */
export function buildPracticeQuestion(items: PracticeItem[]): string | null {
  if (items.length === 0) return null;
  const list = items
    .map(
      (it, i) =>
        `${i + 1}. ${it.concept.replace(/_/g, ' ')} (${it.kind === 'due' ? 'back for review' : 'forming'})`,
    )
    .join('\n');
  return (
    `Practice round — ${items.length} checks, and this is practice, not reading: you ask, I attempt, you grade. ` +
    `Work this queue one concept at a time, in order, never two concepts in one question:\n${list}\n` +
    'For each concept ask ONE question in a fresh form — never a form you have used on me before — ' +
    'and stop there; do not answer it yourself. Wait for my attempt, then grade briefly and specifically: ' +
    'what was right, what was missing. End the grading with a verdict tag on its own line: [PASS] if I have ' +
    'the load-bearing idea in my own words, [RETRY] if something load-bearing is missing or wrong — then one line ' +
    '[CAPTION:the one-line takeaway]. Tag every grading with that concept\u2019s name from the list, ' +
    '[CONCEPT:<name>][QKIND:check-me], so each outcome lands on my study ledger. ' +
    'If I miss one: re-explain only the missed part, differently and shorter, re-ask once in a new form, stamp ' +
    'the verdict, and move on — never an instant advance, never an identical repeat. ' +
    'If I ask you a question mid-round, answer it completely first — answers are always free — then return to the queue. ' +
    'Math I work in the notebook is checked by the desk the moment I write it: trust the checker over your own ' +
    'reading of my steps. When the queue is done, tell me plainly what held and what faded.'
  );
}
