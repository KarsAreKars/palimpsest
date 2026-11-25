/**
 * Golden transcripts for the judge CI (Wave 3, audit Ruling 4). Three
 * SHAPES the professor must always pass, over the same "Golden Algebra"
 * book as professor-answer-first.test.ts (P2: solving x + 3 = 5):
 *
 *   1. a posed check that ladders and releases on "just tell me"
 *      (decision-table rows: scaffold → reveal-with-warmth),
 *   2. a question the learner asks, answered completely in message one
 *      (row 1: answer-now — R1, answers are always free),
 *   3. an "I don't know" on a posed check — rung 1 and never the answer
 *      (row: stuck → scaffold-one-rung, capped).
 *
 * Each carries leak guards: the posed check's protected answer must not
 * appear in any teacher turn before its release. The BAD transcripts at
 * the bottom prove the judges have teeth — a leak and a lecture must both
 * fail.
 */
import type { JudgeableTranscript } from './deterministic';

/** 1. Posed check → failed attempt → scaffold → "just tell me" → warm reveal. */
export const GOLDEN_POSED_CHECK_RELEASE: JudgeableTranscript = {
  kind: 'check',
  leakGuards: [{ answer: 'x = 2', releaseAtTeacherTurn: 2 }],
  messages: [
    {
      role: 'teacher',
      content:
        'Work this step with me: solve x + 3 = 5. Tell me your first move and why it is allowed.',
    },
    {
      role: 'student',
      content: 'I think you move the 3 across, but I am not sure what rule lets you do that.',
    },
    {
      role: 'teacher',
      content:
        'Good instinct, and the caution is right. Look at page 2: both sides of an equation keep their balance when the same number leaves each. What number sits beside the x, and what would undo it?',
    },
    {
      role: 'student',
      content:
        'The 3 — so subtract 3 from both sides. Just tell me if that is it, I want to check.',
    },
    {
      role: 'teacher',
      content:
        'Yes — subtracting 3 from both sides gives x = 2, and substituting 2 back checks the balance. Now say the rule back to me in your own words before we move on.',
    },
  ],
};

/** 2. An asked question — answered completely in message one (R1). */
export const GOLDEN_ASKED_ANSWERED: JudgeableTranscript = {
  kind: 'asked',
  messages: [
    { role: 'student', content: 'what is the radical of an ideal?' },
    {
      role: 'teacher',
      content:
        'The radical of an ideal I is the set of elements some power of which lands in I — on page 1 the book gives exactly that definition. So you collect every element that, raised to some power, falls inside the ideal; the book then notes the radical of an ideal is itself an ideal, and a radical ideal equals its own radical. The picture to keep: the radical rounds the ideal up to include everything that was only "almost inside".',
    },
    { role: 'student', content: 'so it is like closing the ideal under taking roots?' },
    {
      role: 'teacher',
      content: 'Exactly that — closure under taking roots is the whole idea, well put.',
    },
  ],
};

/** 3. "I don't know" on a posed check — rung 1, the answer never comes. */
export const GOLDEN_IDK_RUNG_ONE: JudgeableTranscript = {
  kind: 'check',
  leakGuards: [{ answer: 'x = 2', releaseAtTeacherTurn: Number.MAX_SAFE_INTEGER }],
  messages: [
    {
      role: 'teacher',
      content: 'Work this step: solve x + 3 = 5. What is your first move?',
    },
    { role: 'student', content: "I don't know" },
    {
      role: 'teacher',
      content:
        'No penalty for that — not-knowing is where we start. Look at page 2: the book says both sides of an equation keep their balance when the same number leaves each. What number sits next to the x?',
    },
    { role: 'student', content: '3?' },
    {
      role: 'teacher',
      content:
        'Exactly. So which move undoes the +3 on both sides? Try it and tell me what you get.',
    },
  ],
};

/** All three golden shapes — the CI asserts every one passes both judges. */
export const GOLDEN_TRANSCRIPTS: JudgeableTranscript[] = [
  GOLDEN_POSED_CHECK_RELEASE,
  GOLDEN_ASKED_ANSWERED,
  GOLDEN_IDK_RUNG_ONE,
];

/** A leak: the posed check's answer in the teacher's FIRST turn. */
export const BAD_LEAK: JudgeableTranscript = {
  kind: 'check',
  leakGuards: [{ answer: 'x = 2', releaseAtTeacherTurn: 2 }],
  messages: [
    {
      role: 'teacher',
      content: 'Try this step: solve x + 3 = 5. What is your first move?',
    },
    { role: 'student', content: 'hmm, no idea' },
    {
      role: 'teacher',
      content: 'It is x = 2 — you just subtract 3 from both sides. Now you try one.',
    },
    { role: 'student', content: 'oh, ok' },
    {
      role: 'teacher',
      content: 'Want to try one yourself now that you have seen the move?',
    },
  ],
};

/** A lecture: the teacher monologues through a posed check, student silent. */
export const BAD_LECTURE: JudgeableTranscript = {
  kind: 'check',
  messages: [
    {
      role: 'teacher',
      content:
        'To solve x + 3 = 5, subtract 3 from both sides. Both sides of an equation keep their balance when the same number leaves each. So the 3 goes, the balance holds, and what remains is the value you were looking for. Substituting back checks the balance once more.',
    },
  ],
};
