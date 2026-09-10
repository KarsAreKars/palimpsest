/**
 * Prompt contract tests (OpenMAIC pattern: prompts are assets with
 * regression tests). These strings are load-bearing pedagogy — the
 * disclosure ladder gates and the speech rules — ported from
 * THU-MAIC/OpenMAIC (MIT) on 2026-09-10. If an edit drops them, fail loud.
 */
import { describe, expect, test } from 'vitest';
import { PROFESSOR_SYSTEM_PROMPT, buildProfessorUserMessage } from '@/services/professor/prompt';
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
