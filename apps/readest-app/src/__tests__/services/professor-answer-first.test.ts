/**
 * Golden-transcript replay — Learning Engine Wave 1 "Answer First"
 * (audit BINDING Ruling 4). Five representative exchanges:
 *
 *   1. a definitional question        (reader lane)
 *   2. a math question                (reader lane — the old 120-word cap case)
 *   3. an "explain X" visual concept  (reader lane — the old visual-first case)
 *   4. an "I don't know" follow-up    (workbench lane)
 *   5. a side-question mid-session    (workbench lane)
 *
 * For each, verify message one is assembled to CARRY the complete grounded
 * answer: the question, the page text, and no instruction that can gate it.
 * Where a deterministic offline professor exists (the echo tutor), run it
 * and assert its message one quotes the book and carries zero protocol tags
 * before substance. Live-model replay additionally happens in the dogfood
 * harness; this file is the CI gate.
 */
import { describe, it, expect } from 'vitest';
import { buildContextPack, type ProfessorContextPack } from '@/services/professor/contextPack';
import {
  PROFESSOR_SYSTEM_PROMPT,
  PROFESSOR_WORKBENCH_SYSTEM_PROMPT,
  buildProfessorUserMessage,
} from '@/services/professor/prompt';
import { buildEchoAnswer } from '@/services/professor/tutor';
import { composeWorkbenchTurnMessage } from '@/services/professor/workbenchSession';
import { stripAnnotationTags } from '@/services/professor/annotations';
import type { HpubManifest } from '@/services/narration';

// --- The golden book: "Golden Algebra", five anchored pages ------------------

const P1 =
  'The radical of an ideal I is the set of elements some power of which lands in I. ' +
  'The radical of an ideal is itself an ideal. ' +
  'A radical ideal equals its own radical. ';
const P2 =
  'To solve x + 3 = 5, subtract 3 from both sides. ' +
  'Both sides of an equation keep their balance when the same number leaves each. ' +
  'So x = 2, and substituting 2 back checks the balance. ';
const P3 =
  'A commutative diagram is a picture of objects and arrows where every directed path ' +
  'between two objects gives the same composite map. ' +
  'The universal property says the object is determined by what maps INTO it. ';
const P4 =
  'Entropy measures the dispersal of heat in a system. ' +
  'The second law says total entropy does not decrease. ';
const MD = P1 + P2 + P3 + P4;

const ends = [P1.length, P1.length + P2.length, P1.length + P2.length + P3.length, MD.length];

const manifest = {
  format: 'hpub/1',
  title: 'Golden Algebra',
  view_layer: 'book.pdf',
  text_layer: 'content.md',
  page_count: 4,
  alignment: [
    { page: 1, md_char_start: 0, md_char_end: ends[0], page_class: 'prose' },
    { page: 2, md_char_start: ends[0], md_char_end: ends[1], page_class: 'prose' },
    { page: 3, md_char_start: ends[1], md_char_end: ends[2], page_class: 'prose' },
    { page: 4, md_char_start: ends[2], md_char_end: ends[3], page_class: 'prose' },
  ],
} as unknown as HpubManifest;

const packAt = (page: number): ProfessorContextPack => buildContextPack({ md: MD, manifest, page });

/** Zero protocol tags before substance: the first tag-like token must not
 *  precede the first substantive sentence of message one. */
function expectTagsAfterSubstance(messageOne: string): void {
  const stripped = stripAnnotationTags(messageOne);
  const firstTag = messageOne.search(/\[[A-Z][A-Z-]*[\s:\]]/);
  const firstSubstanceEnd = stripped.search(/[.!?]/);
  if (firstTag === -1) return; // no tags at all — best case
  expect(firstTag).toBeGreaterThan(Math.max(firstSubstanceEnd, 0));
}

// --- Global invariants -------------------------------------------------------

describe('answer-first invariants (the gates are gone)', () => {
  it('no Bloom release gates anywhere in the persona (#4)', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).not.toContain('Release gates, read from their concept history');
    expect(PROFESSOR_SYSTEM_PROMPT).not.toMatch(/Bloom 1–2/);
    expect(PROFESSOR_SYSTEM_PROMPT).not.toMatch(/Bloom 5–6/);
  });

  it('the ladder trigger is scoped to professor-posed checks, not learner questions (#3)', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('never a gate on their questions');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('answered immediately and completely');
    // The old broad trigger ("asks for help with a problem rather than a
    // definition") made any re-asked question "stuck" — gone.
    expect(PROFESSOR_SYSTEM_PROMPT).not.toContain(
      'asks for help with a problem rather than a definition',
    );
  });

  it('reader lane can carry math inline: LaTeX and length-by-need are allowed (#10/#28)', () => {
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('LaTeX allowed, length by need');
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('worked math is written in symbols');
  });

  it('no thread-opening probe compulsion (#20/R2); stance chips are an offer', () => {
    expect(PROFESSOR_SYSTEM_PROMPT + PROFESSOR_WORKBENCH_SYSTEM_PROMPT).not.toContain(
      'PROBE BEFORE YOU TEACH',
    );
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain('THE STANCE OFFER');
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain('never a gate');
  });

  it('provenance and visuals are repertoire, not law (#16/#17)', () => {
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain('repertoire, not a ritual');
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain('THE VISUAL IS AN OFFER');
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).not.toContain(
      'Teach every concept three ways, in order',
    );
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).not.toContain('OPEN with the artifact');
  });

  it('"I don\'t know" stays first-class, never graded, ladder capped at rung 1 (#21)', () => {
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain(
      '"I don\'t know" is a first-class signal, never a wrong answer',
    );
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain(
      'never climb the disclosure ladder past rung 1',
    );
  });
});

// --- The five golden exchanges ------------------------------------------------

describe('golden exchange 1 — a definitional question (reader lane)', () => {
  const q = 'what is the radical of an ideal?';
  const pack = packAt(1);

  it('message one assembles page, excerpt, and the question', () => {
    const msg = buildProfessorUserMessage(q, pack);
    expect(msg).toContain('page 1');
    expect(msg).toContain('The radical of an ideal I is the set');
    expect(msg).toContain(`The reader asks: ${q}`);
  });

  it('the offline professor answers from the book with zero protocol tags before substance', () => {
    const messageOne = buildEchoAnswer(q, pack);
    expect(messageOne).toContain('page 1');
    expect(messageOne).toContain('radical of an ideal');
    expectTagsAfterSubstance(messageOne);
    expect(messageOne).not.toMatch(/\[CONCEPT|\[QKIND|\[POINT|\[PROBE/);
  });
});

describe('golden exchange 2 — a math question (reader lane)', () => {
  const q = 'how do I solve x + 3 = 5?';
  const pack = packAt(2);

  it('message one assembles the math page and the question', () => {
    const msg = buildProfessorUserMessage(q, pack);
    expect(msg).toContain('subtract 3 from both sides');
    expect(msg).toContain(`The reader asks: ${q}`);
  });

  it('the persona permits the full worked answer inline — no cap, no route-away', () => {
    // #10: the read-mode rules allow LaTeX and length-by-need.
    expect(PROFESSOR_SYSTEM_PROMPT).toContain('LaTeX allowed, length by need');
    // #28: routing is for wanting the desk, never because the reader cannot carry it.
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain(
      'never because a short answer could not carry',
    );
  });

  it('the offline professor points at the exact step, tags after substance', () => {
    const messageOne = buildEchoAnswer(q, pack);
    expect(messageOne).toContain('subtract 3 from both sides');
    expectTagsAfterSubstance(messageOne);
  });
});

describe('golden exchange 3 — an "explain X" visual concept (reader lane)', () => {
  const q = 'explain what a commutative diagram is for';
  const pack = packAt(3);

  it('message one assembles the concept page', () => {
    const msg = buildProfessorUserMessage(q, pack);
    expect(msg).toContain('every directed path');
  });

  it('no visual-first mandate: prose-first is the desk default (#17)', () => {
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain("prose is the desk's default");
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).not.toContain(
      "the desk's first language is the picture",
    );
  });
});

describe('golden exchange 4 — an "I don\'t know" follow-up (workbench lane)', () => {
  const history = [
    {
      id: 'b1',
      author: 'professor' as const,
      content: 'Work this step: why does subtracting 3 from both sides preserve the equation?',
      at: '2026-11-19T10:00:00Z',
    },
  ];
  const pack = packAt(2);
  const msg = composeWorkbenchTurnMessage({
    pack,
    page: 2,
    history,
    userContent: "I don't know",
  });

  it('message one carries the pack, the transcript, and the honest signal', () => {
    expect(msg).toContain('subtract 3 from both sides');
    expect(msg).toContain('The workbench transcript so far');
    expect(msg).toContain("The student now says: I don't know");
    // The closer is the one-line answer-first reminder (#31).
    expect(msg).toContain('Answer first, in character');
    expect(msg).not.toContain('Respond in character per the workbench contract');
    // The dropped self-echo tier (#30).
    expect(msg).not.toContain('Where we are');
  });

  it('the persona never grades the not-knowing and caps the ladder at rung 1 (#21)', () => {
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain('never grade it');
    expect(PROFESSOR_WORKBENCH_SYSTEM_PROMPT).toContain(
      'never climb the disclosure ladder past rung 1',
    );
  });
});

describe('golden exchange 5 — a side-question mid-session (workbench lane)', () => {
  const history = [
    {
      id: 'b1',
      author: 'professor' as const,
      content: 'Entropy is the load-bearing idea here — where do you think it leaks?',
      at: '2026-11-19T10:00:00Z',
    },
    {
      id: 'b2',
      author: 'user' as const,
      content: 'into the surroundings?',
      at: '2026-11-19T10:01:00Z',
    },
  ];
  const pack = packAt(4);
  const msg = composeWorkbenchTurnMessage({
    pack,
    page: 4,
    history,
    userContent: 'side question — is a radical ideal the same as a prime ideal?',
  });

  it('message one carries the book AND the side question, answered freely (R1)', () => {
    expect(msg).toContain('Entropy measures the dispersal of heat');
    expect(msg).toContain(
      'The student now says: side question — is a radical ideal the same as a prime ideal?',
    );
    expect(msg).toContain('answered completely now');
  });

  it('no probe ceremony is injected at thread or turn level (#20)', () => {
    expect(msg).not.toContain('[PROBE]');
    expect(msg).not.toContain('PROBE BEFORE YOU TEACH');
  });
});
