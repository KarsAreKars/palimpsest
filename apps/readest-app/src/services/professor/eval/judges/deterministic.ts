/**
 * Deterministic judge lane (Wave 3 CI) — the two TutorRL rubrics
 * (does_not_leak_answer, follows_pedagogical_values) operationalized as
 * hermetic checks, so golden transcripts are judged in vitest with no
 * model in the loop. The live-judge lane (prompts.ts + an offline model)
 * labels richer transcripts OFFLINE (Ruling 5 #7); this lane is the gate
 * that can fail a build.
 *
 * Rubric mapping:
 *   does_not_leak_answer → a posed check's protected answer strings must
 *     not appear in any teacher message before the release turn.
 *   follows_pedagogical_values → teacher messages are non-empty, complete
 *     (no mid-sentence cut-off), not overly long; no language mixing; and
 *     in a CHECK dialog the teacher never monologues — no two consecutive
 *     teacher turns, and the student must speak at least once (the
 *     mechanical core of "most of the talking is done by the student";
 *     an ASKED dialog is exempt: a complete first-message answer is R1,
 *     not a violation).
 */
import type { JudgeMessage, JudgeVerdict } from './prompts';

export interface LeakGuard {
  /** The protected answer (the posed check's final result), matched
   *  case-insensitively on whitespace-normalized text. */
  answer: string;
  /** Teacher messages BEFORE this index (0-based, teacher messages only)
   *  must not contain the answer; the release turn and after may. */
  releaseAtTeacherTurn: number;
}

export interface JudgeableTranscript {
  messages: JudgeMessage[];
  /** 'check' = the professor posed the problem (full rubric); 'asked' =
   *  the learner asked (leak guards don't apply; talk-ratio exempt). */
  kind: 'asked' | 'check';
  leakGuards?: LeakGuard[];
}

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ');

const words = (s: string): number => s.trim().split(/\s+/g).filter(Boolean).length;

/** A teacher message this long is the rubric's "overly long". An asked
 *  dialog's complete answer gets more room (R1) but still not a wall. */
const MAX_TEACHER_WORDS_CHECK = 120;
const MAX_TEACHER_WORDS_ASKED = 400;

/** Crude language-mixing tripwire: common non-English function words that
 *  never belong in the librarian's English. */
const FOREIGN_WORDS =
  /\b(el|la|los|las|ambos|lados|por|der|die|und|das|ist|le|les|des|est|une|dans)\b/gi;

const ok = (reasoning: string): JudgeVerdict => ({ reasoning, decision: 'OK' });
const reject = (reasoning: string): JudgeVerdict => ({ reasoning, decision: 'REJECT' });

/** does_not_leak_answer, deterministic: the protected answer appears only
 *  at or after its release turn. */
export function judgeLeak(t: JudgeableTranscript): JudgeVerdict {
  const teacher = t.messages.filter((m) => m.role === 'teacher');
  for (const guard of t.leakGuards ?? []) {
    const needle = normalize(guard.answer);
    for (let i = 0; i < teacher.length; i++) {
      if (i >= guard.releaseAtTeacherTurn) break;
      if (normalize(teacher[i]!.content).includes(needle)) {
        return reject(
          `The teacher revealed the protected answer ("${guard.answer}") in teacher turn ${i + 1}, before the release turn (${guard.releaseAtTeacherTurn + 1}).`,
        );
      }
    }
  }
  return ok('No protected answer appears before its release turn.');
}

/** follows_pedagogical_values, deterministic: concise, complete,
 *  single-language messages; the student talks in a check dialog. */
export function judgeValues(t: JudgeableTranscript): JudgeVerdict {
  const teacher = t.messages.filter((m) => m.role === 'teacher');
  if (teacher.length === 0) return reject('The teacher said nothing.');
  const cap = t.kind === 'check' ? MAX_TEACHER_WORDS_CHECK : MAX_TEACHER_WORDS_ASKED;
  for (let i = 0; i < teacher.length; i++) {
    const body = teacher[i]!.content.trim();
    if (body.length === 0) return reject(`Teacher turn ${i + 1} is empty.`);
    if (words(body) > cap) {
      return reject(
        `Teacher turn ${i + 1} is ${words(body)} words — over the ${cap}-word "${t.kind}" cap (overly long message).`,
      );
    }
    if (!/[.!?…\]\)]$/.test(body)) {
      return reject(`Teacher turn ${i + 1} ends mid-sentence — incomplete or cut off.`);
    }
    const foreign = body.match(FOREIGN_WORDS);
    if (foreign && foreign.length >= 2) {
      return reject(
        `Teacher turn ${i + 1} mixes languages ("${foreign.slice(0, 3).join('", "')}").`,
      );
    }
  }
  if (t.kind === 'check') {
    if (!t.messages.some((m) => m.role === 'student')) {
      return reject('The student never speaks — the teacher dominates the conversation.');
    }
    for (let i = 1; i < t.messages.length; i++) {
      if (t.messages[i]!.role === 'teacher' && t.messages[i - 1]!.role === 'teacher') {
        return reject(
          `Teacher turns ${i} and ${i + 1} run back to back with no student turn between — the teacher dominates the conversation.`,
        );
      }
    }
  }
  return ok('Concise, complete, single-language messages; the student carries the check dialog.');
}

/** Both rubrics, TutorRL-style: any REJECT fails the conversation. */
export function judgeTranscript(t: JudgeableTranscript): JudgeVerdict {
  const leak = judgeLeak(t);
  if (leak.decision === 'REJECT') return leak;
  return judgeValues(t);
}
