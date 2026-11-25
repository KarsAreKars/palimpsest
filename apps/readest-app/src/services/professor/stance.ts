/**
 * The stance decision table (Learning Engine Wave 3 — audit BINDING Ruling
 * 4 WAVE 3; TUTORRL_DEEPDIVE §5 distillation path; LEARNING_SCIENCE §16).
 *
 * Wave 1 left the disclosure ladder as PROSE the model interpreted. This
 * module makes the decision a LOOKUP: given (who initiated, mastery from
 * the Wave 2 ledger, the check verdict so far, the learner's words this
 * turn, and the R2 stance preference), exactly one stance comes out. The
 * prompt renders the table (prompt.ts) and the desk renders the matching
 * row per turn (workbenchSession.ts) — the model executes a stance, it no
 * longer decides one.
 *
 * The rungs themselves (Rung 0–3 in prompt.ts) survive as the scaffold
 * VOCABULARY; which rung is the table's call, never the model's. Direct
 * telling is first-class (Ruling 5 #8): `answer-now` and
 * `reveal-with-warmth` are rows, not failures.
 *
 * Pure: no IO, no model, no clock. TutorRL-7B labels transcripts OFFLINE
 * only (Ruling 5 #7) — nothing here routes at runtime to a second model.
 */
import type { Mastery } from './learner';

/** Who started this exchange: the learner asked, or the professor posed a
 *  check (exercise, check-me, teach-back, "work this step"). */
export type QuestionInitiation = 'asked' | 'posed';

/** The graded verdict on the concept's check so far (Wave 2 ledger's
 *  graded window, latest entry). 'none' = no graded check yet. */
export type CheckVerdictSoFar = 'none' | 'pass' | 'retry';

/** What the learner's own words THIS turn signal. */
export type LearnerSignal = 'none' | 'stuck' | 'ask-answer';

export type Stance =
  | 'answer-now' // the complete answer, first message (R1)
  | 'worked-example' // rung 2: a tiny worked analog, or the first step with the rest hidden
  | 'scaffold-one-rung' // climb exactly one rung, no more
  | 'socratic' // no hint — the one question that makes them attempt
  | 'reveal-with-warmth'; // rung 3: the full answer, plainly and warmly, then restate/re-derive

export interface StanceInput {
  initiation: QuestionInitiation;
  mastery: Mastery;
  verdict: CheckVerdictSoFar;
  signal: LearnerSignal;
  /** R2 standing stance preference (learnerProfile.probe_level, 1..6).
   *  Absent = no preference. */
  probeLevel?: number;
}

// ---------------------------------------------------------------------------
// The learner's words this turn → a signal (the only text the table reads)
// ---------------------------------------------------------------------------

/** "I don't know" family — same shape as workbenchChat's PROBE_SIGNAL_PATTERN,
 *  plus the stuck/lost phrasings the ladder prose already honored. */
export const STUCK_WORDS =
  /\b(i don'?t know|i do not know|i have no idea|no idea|i'?m stuck|i'?m lost)\b/i;

/** An explicit ask for the answer — the attempt's honest end (R1). */
export const ASK_ANSWER_WORDS =
  /\b(just tell me|tell me the answer|give me the answer|what'?s the answer|show me the answer)\b/i;

export function signalOf(words: string): LearnerSignal {
  if (ASK_ANSWER_WORDS.test(words)) return 'ask-answer';
  if (STUCK_WORDS.test(words)) return 'stuck';
  return 'none';
}

// ---------------------------------------------------------------------------
// The table — declarative rows, first match wins. Each row's condition is
// DATA (so the prompt can render it) and the match is mechanical.
// ---------------------------------------------------------------------------

export interface StanceCondition {
  initiation?: QuestionInitiation;
  signal?: LearnerSignal;
  verdict?: CheckVerdictSoFar;
  mastery?: Mastery;
  /** Matches when probeLevel is set and ≥ this. */
  probeAtLeast?: number;
  /** Matches when probeLevel is set and ≤ this. */
  probeAtMost?: number;
}

export interface StanceRow {
  if: StanceCondition;
  stance: Stance;
  /** One plain line: why this row exists (finding + trace). */
  because: string;
}

/**
 * Priority order is the policy. R1 first (answers are always free), then
 * the release rows, then the ladder rows, then the no-attempt rows.
 */
export const STANCE_ROWS: readonly StanceRow[] = [
  {
    if: { initiation: 'asked' },
    stance: 'answer-now',
    because: 'a question the learner asks is answered completely, first — always (R1)',
  },
  {
    if: { signal: 'ask-answer' },
    stance: 'reveal-with-warmth',
    because: 'an explicit "just tell me" is the attempt’s honest end (R1)',
  },
  {
    if: { signal: 'stuck', verdict: 'retry' },
    stance: 'reveal-with-warmth',
    because: 'a failed attempt behind the stuck signal bottoms out the ladder (§16)',
  },
  {
    if: { signal: 'stuck' },
    stance: 'scaffold-one-rung',
    because: '"I don’t know" earns the smallest useful cue — never past rung 1 (#21, §16)',
  },
  {
    if: { verdict: 'retry' },
    stance: 'worked-example',
    because: 'a failed attempt gets the smallest worked piece at the divergence (TutorRL §5)',
  },
  {
    if: { verdict: 'pass' },
    stance: 'socratic',
    because:
      'a passed check is confirmed, then raised one level with a harder question (TutorRL §5)',
  },
  {
    if: { probeAtLeast: 5 },
    stance: 'socratic',
    because: 'the learner’s profile asks to be asked first (R2)',
  },
  {
    if: { probeAtMost: 2 },
    stance: 'worked-example',
    because: 'the learner’s profile asks to be led — demonstrate, they follow (R2)',
  },
  {
    if: { mastery: 'known' },
    stance: 'socratic',
    because:
      'the ledger says they own it — raise the stakes with a question, never re-teach (fading, §17.5)',
  },
  {
    if: {},
    stance: 'scaffold-one-rung',
    because: 'a posed check with no attempt yet earns the smallest hint first (§16)',
  },
];

function matches(c: StanceCondition, i: StanceInput): boolean {
  if (c.initiation !== undefined && i.initiation !== c.initiation) return false;
  if (c.signal !== undefined && i.signal !== c.signal) return false;
  if (c.verdict !== undefined && i.verdict !== c.verdict) return false;
  if (c.mastery !== undefined && i.mastery !== c.mastery) return false;
  if (c.probeAtLeast !== undefined && (i.probeLevel ?? -Infinity) < c.probeAtLeast) return false;
  if (c.probeAtMost !== undefined && (i.probeLevel ?? Infinity) > c.probeAtMost) return false;
  return true;
}

/** The row that applies — the table is total (the last row matches all). */
export function matchingRow(input: StanceInput): StanceRow {
  return STANCE_ROWS.find((r) => matches(r.if, input)) ?? STANCE_ROWS[STANCE_ROWS.length - 1]!;
}

export function decideStance(input: StanceInput): Stance {
  return matchingRow(input).stance;
}

// ---------------------------------------------------------------------------
// Worked-example fading (Wave 4, audit Ruling 4 WAVE 4; LEARNING_SCIENCE
// §7: Kalyuga et al. 2001 expertise reversal — worked examples help
// novices and HURT experts, so the example shrinks as the ledger's
// graded mastery rises: full → partial → none).
// ---------------------------------------------------------------------------

export type WorkedExampleDepth = 'full' | 'partial' | 'none';

export function workedExampleDepth(mastery: Mastery): WorkedExampleDepth {
  switch (mastery) {
    case 'known':
      return 'none'; // expertise reversal guard: examples now cost learning
    case 'edge':
      return 'partial'; // completion strategy (Paas & van Merriënboer 1994)
    default:
      return 'full'; // novice: complete examples beat unaided search (Sweller)
  }
}

const WORKED_EXAMPLE_DEPTH_LINES: Record<WorkedExampleDepth, string> = {
  full: 'Worked-example depth FULL — demonstrate the whole worked analog, every step, slowly (no graded evidence yet: complete examples are the right load for a novice, §7).',
  partial:
    'Worked-example depth PARTIAL — work the early steps aloud, then leave the LAST step blank for the learner to complete (faded completion problem, §7).',
  none: 'Worked-example depth NONE — the study log says they own this; a worked example now is over-scaffolding (Kalyuga expertise reversal, §17.5) — pose the problem directly.',
};

// ---------------------------------------------------------------------------
// Rendering — the prompt carries the whole table; the turn carries its row.
// ---------------------------------------------------------------------------

function renderCondition(c: StanceCondition): string {
  const parts: string[] = [];
  if (c.initiation === 'asked') parts.push('the learner asked the question');
  if (c.initiation === 'posed') parts.push('a check the professor posed');
  if (c.signal === 'stuck') parts.push('their words say stuck ("I don’t know")');
  if (c.signal === 'ask-answer') parts.push('their words ask for the answer ("just tell me")');
  if (c.verdict === 'retry') parts.push('the last graded check failed');
  if (c.verdict === 'pass') parts.push('the last graded check passed');
  if (c.mastery === 'known') parts.push('the study log says they own this');
  if (c.mastery === 'edge') parts.push('the study log says this is still forming');
  if (c.mastery === 'unknown') parts.push('the study log has no graded check on this yet');
  if (c.probeAtLeast !== undefined)
    parts.push(`their profile asks to be probed (Bloom ≥ ${c.probeAtLeast})`);
  if (c.probeAtMost !== undefined)
    parts.push(`their profile asks to be led (Bloom ≤ ${c.probeAtMost})`);
  if (parts.length === 0) parts.push('otherwise');
  return parts.join(', and ');
}

/** The whole table, numbered, first-match-wins — for the system prompt. */
export function renderStanceTable(): string {
  const rows = STANCE_ROWS.map(
    (r, n) => `  ${n + 1}. ${renderCondition(r.if)} → ${r.stance} — ${r.because}.`,
  ).join('\n');
  return (
    rows +
    '\n  Worked-example stances fade with demonstrated competence: full example → ' +
    'partial (last step left blank) → none, as the study log’s mastery rises (Kalyuga, §7).'
  );
}

/** The one applicable row, for the turn message — the desk's lookup, handed
 *  to the model so the row is executed, not re-derived. Worked-example
 *  rows carry their Kalyuga fading depth (full/partial/none) with them. */
export function renderStanceLine(input: StanceInput): string {
  const row = matchingRow(input);
  const line = `This turn’s stance, from the decision table (execute it; do not re-decide): ${row.stance} — ${row.because}.`;
  if (row.stance !== 'worked-example') return line;
  return `${line} ${WORKED_EXAMPLE_DEPTH_LINES[workedExampleDepth(input.mastery)]}`;
}
