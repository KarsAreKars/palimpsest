/**
 * Judge CI (Wave 3, audit Ruling 4) — TutorRL's two judge prompts as
 * regression tests over golden transcripts. Every prompt edit is judged:
 * the professor must never leak a posed check's answer, and must follow
 * the pedagogical values (concise, complete, single-language, never a
 * monologue). The deterministic lane runs in CI (hermetic); the verbatim
 * templates + render/parse helpers are the offline lane's contract
 * (Ruling 5 #7 — offline labeling only).
 */
import { describe, expect, it } from 'vitest';
import {
  DOES_NOT_LEAK_ANSWER_PROMPT,
  FOLLOWS_PEDAGOGICAL_VALUES_PROMPT,
  parseJudgeVerdict,
  renderJudgePrompt,
} from '@/services/professor/eval/judges/prompts';
import {
  judgeLeak,
  judgeTranscript,
  judgeValues,
} from '@/services/professor/eval/judges/deterministic';
import {
  BAD_LEAK,
  BAD_LECTURE,
  GOLDEN_ASKED_ANSWERED,
  GOLDEN_IDK_RUNG_ONE,
  GOLDEN_POSED_CHECK_RELEASE,
  GOLDEN_TRANSCRIPTS,
} from '@/services/professor/eval/judges/golden';

describe('the imported TutorRL judge prompts (verbatim contract)', () => {
  it('does_not_leak_answer carries the rubric, the few-shots, and the verdict schema', () => {
    expect(DOES_NOT_LEAK_ANSWER_PROMPT).toContain(
      'You are tasked with inspecting a conversation between a student and a teacher (tutor).',
    );
    expect(DOES_NOT_LEAK_ANSWER_PROMPT).toContain('Provide the full answer upfront');
    // Four worked examples, OK and REJECT verdicts both demonstrated.
    expect(DOES_NOT_LEAK_ANSWER_PROMPT).toContain('Example 1');
    expect(DOES_NOT_LEAK_ANSWER_PROMPT).toContain('Example 4');
    expect(DOES_NOT_LEAK_ANSWER_PROMPT).toContain('"decision": "OK"');
    expect(DOES_NOT_LEAK_ANSWER_PROMPT).toContain('"decision": "REJECT"');
    expect(DOES_NOT_LEAK_ANSWER_PROMPT).toContain('==BEGIN CONVERSATION==');
    expect(DOES_NOT_LEAK_ANSWER_PROMPT).toContain('==END CONVERSATION==');
    expect(DOES_NOT_LEAK_ANSWER_PROMPT).toContain('{% for message in conversation %}');
  });

  it('follows_pedagogical_values carries the five reject rules', () => {
    expect(FOLLOWS_PEDAGOGICAL_VALUES_PROMPT).toContain('Overly Long Messages');
    expect(FOLLOWS_PEDAGOGICAL_VALUES_PROMPT).toContain('Teacher Dominates Conversation');
    expect(FOLLOWS_PEDAGOGICAL_VALUES_PROMPT).toContain('Language Mixing/Switching');
    expect(FOLLOWS_PEDAGOGICAL_VALUES_PROMPT).toContain('Unrealistic/Unnatural Interaction');
    expect(FOLLOWS_PEDAGOGICAL_VALUES_PROMPT).toContain('Incomplete or Empty');
    expect(FOLLOWS_PEDAGOGICAL_VALUES_PROMPT).toContain(
      'Most of the talking is done by the student',
    );
    expect(FOLLOWS_PEDAGOGICAL_VALUES_PROMPT).toContain('==BEGIN CONVERSATION==');
  });
});

describe('renderJudgePrompt + parseJudgeVerdict (the offline lane’s contract)', () => {
  it('substitutes the conversation TutorRL-style', () => {
    const rendered = renderJudgePrompt(DOES_NOT_LEAK_ANSWER_PROMPT, [
      { role: 'teacher', content: 'What is your first move?' },
      { role: 'student', content: 'Subtract 3?' },
    ]);
    expect(rendered).not.toContain('{% for message in conversation %}');
    expect(rendered).toContain('- Teacher: What is your first move?');
    expect(rendered).toContain('- Student: Subtract 3?');
    expect(rendered).toContain('==BEGIN CONVERSATION==');
  });

  it('parses the verdict the way classroom.py does (first { to last })', () => {
    expect(
      parseJudgeVerdict('Some preamble {"reasoning": "guided well", "decision": "OK"} trailing'),
    ).toEqual({ reasoning: 'guided well', decision: 'OK' });
    expect(parseJudgeVerdict('{"reasoning": "leaked", "decision": "REJECT"}')).toEqual({
      reasoning: 'leaked',
      decision: 'REJECT',
    });
    expect(parseJudgeVerdict('no json here')).toBeNull();
    expect(parseJudgeVerdict('{"reasoning": 3, "decision": "OK"}')).toBeNull();
    expect(parseJudgeVerdict('{"reasoning": "x", "decision": "MAYBE"}')).toBeNull();
  });
});

describe('the judge CI over golden transcripts — the professor passes', () => {
  it('every golden shape passes BOTH judges (zero leaks to posed checks)', () => {
    for (const t of GOLDEN_TRANSCRIPTS) {
      expect(judgeLeak(t).decision).toBe('OK');
      expect(judgeValues(t).decision).toBe('OK');
      expect(judgeTranscript(t).decision).toBe('OK');
    }
  });

  it('a posed check ladders and releases only on "just tell me"', () => {
    expect(judgeTranscript(GOLDEN_POSED_CHECK_RELEASE).decision).toBe('OK');
    // The reveal turn DOES carry the answer — release is first-class.
    const reveal = GOLDEN_POSED_CHECK_RELEASE.messages.filter((m) => m.role === 'teacher')[2]!;
    expect(reveal.content).toContain('x = 2');
  });

  it('an asked question is answered completely in message one — and that is NOT a violation (R1)', () => {
    expect(judgeTranscript(GOLDEN_ASKED_ANSWERED).decision).toBe('OK');
  });

  it('"I don’t know" earns rung 1 and the answer never comes', () => {
    expect(judgeTranscript(GOLDEN_IDK_RUNG_ONE).decision).toBe('OK');
    for (const m of GOLDEN_IDK_RUNG_ONE.messages.filter((m) => m.role === 'teacher')) {
      expect(m.content).not.toContain('x = 2');
    }
  });
});

describe('the judges have teeth', () => {
  it('a leaked answer to a posed check is REJECTED', () => {
    const verdict = judgeLeak(BAD_LEAK);
    expect(verdict.decision).toBe('REJECT');
    expect(verdict.reasoning).toContain('protected answer');
  });

  it('a teacher monologue with a silent student is REJECTED', () => {
    const verdict = judgeValues(BAD_LECTURE);
    expect(verdict.decision).toBe('REJECT');
    expect(verdict.reasoning).toContain('student never speaks');
  });

  it('an overly long teacher turn in a check dialog is REJECTED', () => {
    const verdict = judgeValues({
      kind: 'check',
      messages: [
        { role: 'student', content: 'why?' },
        { role: 'teacher', content: `${'Because the balance holds. '.repeat(40)}Done.` },
      ],
    });
    expect(verdict.decision).toBe('REJECT');
    expect(verdict.reasoning).toContain('overly long');
  });

  it('a cut-off teacher turn is REJECTED', () => {
    const verdict = judgeValues({
      kind: 'asked',
      messages: [
        { role: 'student', content: 'what is it?' },
        { role: 'teacher', content: 'It is the set of elements some power of which' },
      ],
    });
    expect(verdict.decision).toBe('REJECT');
    expect(verdict.reasoning).toContain('mid-sentence');
  });

  it('language mixing is REJECTED', () => {
    const verdict = judgeValues({
      kind: 'asked',
      messages: [
        { role: 'student', content: 'should I divide next?' },
        { role: 'teacher', content: 'Yes, exactly! Divide ambos lados por dos.' },
      ],
    });
    expect(verdict.decision).toBe('REJECT');
    expect(verdict.reasoning).toContain('mixes languages');
  });

  it('back-to-back teacher turns in a check dialog are REJECTED', () => {
    const verdict = judgeValues({
      kind: 'check',
      messages: [
        { role: 'teacher', content: 'Try this step first.' },
        { role: 'teacher', content: 'And here is another thought while you work.' },
        { role: 'student', content: 'ok' },
      ],
    });
    expect(verdict.decision).toBe('REJECT');
    expect(verdict.reasoning).toContain('back to back');
  });
});
