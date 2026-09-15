/**
 * Prompt contract tests (OpenMAIC pattern: prompts are assets with
 * regression tests). These strings are load-bearing pedagogy — the
 * disclosure ladder gates and the speech rules — ported from
 * THU-MAIC/OpenMAIC (MIT) on 2026-09-10. If an edit drops them, fail loud.
 */
import { describe, expect, test } from 'vitest';
import {
  PROFESSOR_SYSTEM_PROMPT,
  PROFESSOR_WORKBENCH_ADDENDUM,
  buildProfessorUserMessage,
} from '@/services/professor/prompt';
import type { ProfessorContextPack } from '@/services/professor/contextPack';

describe('professor system prompt', () => {
  test('carries the disclosure ladder with all four rungs', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('disclosure ladder');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('Rung 0');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('Rung 3');
  });

  test('release gates are keyed to Bloom levels', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).toMatch(/Bloom 1–2.*ONE genuine stuck signal/s);
    expect(PROFESSOR_SYSTEM_PROMPT).toMatch(/Bloom 5–6.*only on explicit request/s);
  });

  test('speech rules: marks are never announced, words stand alone', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('Never announce your marks');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('stand alone');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('Point FIRST');
  });

  test('spoken-word rule: no markdown, math said in words', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('read aloud');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('no markdown');
  });

  test('check-me protocol: correct the specific wrong turn first', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('load-bearing claim');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('wrong turn first');
  });
});

describe('professor workbench addendum — key contract lines are pinned', () => {
  test('citation whitelist contract: cite only listed pages, else "I will look"', () => {
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('Pages in your context');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('cite only those');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('I will look');
  });

  test('tag output contract: protocol tags only at the very end, END tag named', () => {
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('Protocol tags ONLY at the very end');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[CONCEPT:name]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[QKIND:kind]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[WORKBENCH:END]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('$$ display blocks');
  });

  test('the workbench system prompt is the base prompt plus the addendum', () => {
    expect(PROFESSOR_WORKBENCH_ADDENDUM.length).toBeGreaterThan(0);
    // additive-only guard: the addendum must not rewrite the base ladder.
    expect(PROFESSOR_SYSTEM_PROMPT).not.toContain('WORKBENCH MODE');
  });
});

describe('workbench 2.x addendum', () => {
  test('structured derivations: DERIVE/STEP literals, the ledger rules, and the parse-error kindness are present', () => {
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('STRUCTURED DERIVATIONS');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain(
      '[DERIVE title:What the substitution buys us goal:x = 2]',
    );
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[STEP /CHECKED ok]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[STEP n /CHECKED ok|bad]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('"algebra" is not a justification');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('a parse error, never wrong');
  });

  test('figures: DIAGRAM literal, the self-check sentence, and the emitted ```svg fence', () => {
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('FIGURES');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain(
      '[DIAGRAM claim:The three angles of a triangle sum to 180 degrees]',
    );
    // The self-check, before you send: the picture must SHOW the claim.
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('the picture must SHOW the claim');
    // The EMITTED string carries a literal triple-backtick svg fence.
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('```svg');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('viewBox="0 0 200 120"');
  });

  test('pedagogy + lookup + voice + bridge paragraphs are appended additively', () => {
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('PROBE BEFORE YOU TEACH');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('Looking things up');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[LOOK page:N]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('Spoken turns');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[VOICE]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('Routing to the desk');
    // R1: the bridge paragraph lives in the addendum, not the system prompt.
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain(
      "[TO_WORKBENCH prompt:'one short line, in your own words, single-quoted']",
    );
    expect(PROFESSOR_SYSTEM_PROMPT).not.toContain('TO_WORKBENCH');
  });

  test('the original addendum text is unchanged (one sentence still present)', () => {
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain(
      'Citations: pages you can cite this turn are listed in "Pages in your context"',
    );
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('WORKBENCH MODE');
  });
});

describe('buildProfessorUserMessage', () => {
  const pack: ProfessorContextPack = {
    position: { page: 7, md_span: [0, 500], narration_unit: null },
    page_class: 'prose',
    blocks: [{ id: '/page/7/Equation/2', type: 'Equation', text_head: 'softmax' }],
    chapter_context: '',
    excerpt: 'The scaling factor sits under the fraction.',
    excerpt_truncated: false,
    recent_exchanges: [],
    concept_states: { scaling: { bloom: 2, asked: 3, last_ts: '2026-09-10T00:00:00Z' } },
  };

  test('includes the page, block list, excerpt, and concept history', () => {
    const msg = buildProfessorUserMessage('why divide by root d_k?', pack);
    expect(msg).toContain('page 7');
    expect(msg).toContain('/page/7/Equation/2');
    expect(msg).toContain('scaling factor');
    expect(msg).toContain('scaling: asked 3x, Bloom level 2/6');
    expect(msg).toContain('why divide by root d_k?');
  });

  test('ends with the annotation reminder when blocks exist (recency bias)', () => {
    const msg = buildProfessorUserMessage('q', pack);
    const reminderIdx = msg.lastIndexOf('Reminder: if your answer refers');
    expect(reminderIdx).toBeGreaterThan(msg.lastIndexOf('The reader asks'));
  });
});
