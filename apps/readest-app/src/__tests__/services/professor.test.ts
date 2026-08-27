import { describe, it, expect } from 'vitest';
import {
  buildContextPack,
  CHAPTER_CONTEXT_TAIL_CHARS,
  type ProfessorContextPack,
} from '@/services/professor/contextPack';
import { PROFESSOR_SYSTEM_PROMPT, buildProfessorUserMessage } from '@/services/professor/prompt';
import { buildEchoAnswer } from '@/services/professor/tutor';
import type { HpubManifest } from '@/services/narration';

// Two anchored pages of a fake book; page 3 is visual (no span).
const MD =
  'Page one has some prose about rings and ideals. ' +
  'Every ideal has a radical. The radical of an ideal is an ideal. ' +
  '#'.repeat(0) +
  'Page two talks about direct limits and directed sets. ' +
  'A directed set is partially ordered. Direct limits preserve exactness.';

const P1_END = MD.indexOf('Page two');
const manifest: HpubManifest = {
  format: 'hpub/1',
  page_count: 3,
  alignment: [
    { page: 1, md_char_start: 0, md_char_end: P1_END, page_class: 'prose' },
    { page: 2, md_char_start: P1_END, md_char_end: MD.length, page_class: 'prose' },
    { page: 3, md_char_start: null, md_char_end: null, page_class: 'visual' },
  ],
};

describe('buildContextPack', () => {
  it('extracts the page excerpt from the manifest span', () => {
    const pack = buildContextPack({ md: MD, manifest, page: 2 });
    expect(pack.position.page).toBe(2);
    expect(pack.position.md_span).toEqual([P1_END, MD.length]);
    expect(pack.excerpt).toContain('direct limits');
    expect(pack.excerpt).not.toContain('Page one');
    expect(pack.excerpt_truncated).toBe(false);
  });

  it('carries the previous page tail as chapter context', () => {
    const pack = buildContextPack({ md: MD, manifest, page: 2 });
    expect(pack.chapter_context).toContain('radical');
    expect(pack.chapter_context.length).toBeLessThanOrEqual(CHAPTER_CONTEXT_TAIL_CHARS);
  });

  it('handles a visual page with no span gracefully', () => {
    const pack = buildContextPack({ md: MD, manifest, page: 3 });
    expect(pack.position.md_span).toBeNull();
    expect(pack.excerpt).toBe('');
    expect(pack.page_class).toBe('visual');
    // chapter context still reaches back to page 2
    expect(pack.chapter_context).toContain('direct limits');
  });

  it('caps the excerpt and flags truncation', () => {
    const pack = buildContextPack({ md: MD, manifest, page: 2, maxExcerptChars: 40 });
    expect(pack.excerpt.length).toBe(40);
    expect(pack.excerpt_truncated).toBe(true);
  });

  it('keeps only the last two recent exchanges', () => {
    const recentExchanges = [
      { q: 'q1', a: 'a1' },
      { q: 'q2', a: 'a2' },
      { q: 'q3', a: 'a3' },
    ];
    const pack = buildContextPack({ md: MD, manifest, page: 1, recentExchanges });
    expect(pack.recent_exchanges).toEqual([
      { q: 'q2', a: 'a2' },
      { q: 'q3', a: 'a3' },
    ]);
  });

  it('records the active narration unit when one is playing', () => {
    const pack = buildContextPack({
      md: MD,
      manifest,
      page: 1,
      currentUnit: { unit: 41, md_start: 0, md_end: 10, page: 1, kind: 'prose', speak: 'x' },
    });
    expect(pack.position.narration_unit).toBe(41);
  });
});

describe('professor prompt', () => {
  const pack: ProfessorContextPack = buildContextPack({ md: MD, manifest, page: 2 });

  it('system prompt carries the grounding + spoken-word + humanizer rules', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).toMatch(/source of truth/);
    expect(PROFESSOR_SYSTEM_PROMPT).toMatch(/read aloud/);
    expect(PROFESSOR_SYSTEM_PROMPT).toMatch(/no bullet-point/i);
    expect(PROFESSOR_SYSTEM_PROMPT).toMatch(/never sycophantic/i);
    // A8: page-vision grounding — images are evidence, not addressing.
    expect(PROFESSOR_SYSTEM_PROMPT).toMatch(/NOT the addressing system/);
  });

  it('buildUserContent stays text-only without images, adds parts with them', async () => {
    const { buildUserContent } = await import('@/services/professor/tutor');
    const plain = buildUserContent('what is a direct limit?', pack);
    expect(typeof plain).toBe('string');
    const withEyes = buildUserContent('explain the diagram', pack, [
      'data:image/png;base64,AAA',
      'data:image/png;base64,BBB',
    ]);
    expect(Array.isArray(withEyes)).toBe(true);
    if (!Array.isArray(withEyes)) return;
    expect(withEyes[0]).toMatchObject({ type: 'text' });
    expect((withEyes[0] as { text: string }).text).toContain('explain the diagram');
    expect(withEyes.slice(1)).toEqual([
      { type: 'image', image: 'data:image/png;base64,AAA' },
      { type: 'image', image: 'data:image/png;base64,BBB' },
    ]);
  });

  it('user message embeds the excerpt and the question', () => {
    const msg = buildProfessorUserMessage('what is a direct limit?', pack);
    expect(msg).toContain('page 2');
    expect(msg).toContain('Direct limits preserve exactness');
    expect(msg).toContain('what is a direct limit?');
  });

  it('warns when the page is visual so the model does not guess', () => {
    const visual = buildContextPack({ md: MD, manifest, page: 3 });
    const msg = buildProfessorUserMessage('explain the diagram', visual);
    expect(msg).toMatch(/mostly diagrams/i);
  });
});

describe('echo tutor (offline double)', () => {
  it('quotes the passage the question touches', () => {
    const pack = buildContextPack({ md: MD, manifest, page: 2 });
    const answer = buildEchoAnswer('why do direct limits matter?', pack);
    expect(answer).toContain('page 2');
    expect(answer).toContain('directed set');
    expect(answer).toMatch(/echo tutor/i); // always honest about what it is
  });

  it('refuses to guess when nothing matches', () => {
    const pack = buildContextPack({ md: MD, manifest, page: 1 });
    const answer = buildEchoAnswer('quantum entanglement zanzibar', pack);
    expect(answer).toMatch(/rather not guess/i);
  });
});
