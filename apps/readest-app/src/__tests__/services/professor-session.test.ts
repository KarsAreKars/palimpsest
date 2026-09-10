/**
 * Chapter-session contract tests (research-openmaic-2026.md ports #3–#5).
 * The load-bearing guarantees:
 *  1. The verdict contract — [PASS]/[RETRY] tags parse into structured
 *     verdicts and are stripped before speech/display (OpenMAIC's rule:
 *     the learner never sees the grading tokens).
 *  2. Chapter slicing — TOC page-index windows into content.md, with the
 *     current-page fallback when the TOC can't place the reader.
 *  3. Objectives parsing clamps to the 3–5 card contract.
 *  4. The closing reflection report marks every objective honestly.
 */
import { describe, expect, test, vi } from 'vitest';
// The provider factory pulls the settings/supabase chain at import time;
// these tests cover pure functions only, so the factory is mocked away.
vi.mock('@/services/ai/providers', () => ({ getAIProvider: vi.fn() }));
import { parseAnnotations, stripAnnotations } from '@/services/professor/annotations';
import {
  buildSessionQuestion,
  buildSessionReportMd,
  extractSessionOutcome,
  getChapterText,
  parseObjectivesResponse,
  MAX_OBJECTIVES,
  type SessionObjective,
} from '@/services/professor/session';
import type { HpubManifest } from '@/services/narration';
import type { TOCItem } from '@/libs/document';

describe('verdict tags — the grading contract', () => {
  test('[PASS] and [RETRY] parse into verdict annotations', () => {
    expect(parseAnnotations('Well said. [PASS]')).toEqual([{ kind: 'verdict', verdict: 'pass' }]);
    expect(parseAnnotations('Not quite. [RETRY]')).toEqual([{ kind: 'verdict', verdict: 'retry' }]);
  });

  test('verdict tags never reach speech or the bubble', () => {
    const answer =
      'You got the scaling right but missed where it applies. [RETRY]\n[CAPTION:the factor sits inside softmax]';
    const clean = stripAnnotations(answer);
    expect(clean).toBe('You got the scaling right but missed where it applies.');
    expect(clean).not.toMatch(/\[PASS\]|\[RETRY\]|\[CAPTION/);
  });

  test('a full session answer parses verdict plus takeaway caption', () => {
    const parsed = parseAnnotations(
      'The exponent is right, the normalization is missing. [RETRY]\n[CAPTION:softmax divides by the sum over all keys]',
    );
    expect(parsed).toEqual([
      { kind: 'verdict', verdict: 'retry' },
      { kind: 'caption', text: 'softmax divides by the sum over all keys' },
    ]);
  });
});

describe('extractSessionOutcome', () => {
  test('reads the last verdict and the takeaway caption', () => {
    const outcome = extractSessionOutcome([
      { kind: 'caption', text: 'first draft' },
      { kind: 'verdict', verdict: 'retry' },
      { kind: 'verdict', verdict: 'pass' },
      { kind: 'caption', text: 'direct limits preserve surjectivity' },
    ]);
    expect(outcome).toEqual({ verdict: 'pass', takeaway: 'direct limits preserve surjectivity' });
  });

  test('returns null when the answer carried no verdict — keep waiting', () => {
    expect(extractSessionOutcome([{ kind: 'caption', text: 'just a note' }])).toBeNull();
    expect(extractSessionOutcome([])).toBeNull();
  });
});

describe('parseObjectivesResponse', () => {
  test('parses numbered lines into objective text', () => {
    const raw = [
      '1. Explain why the softmax argument is scaled by root d_k',
      '2. State the decomposition condition for an exact sequence',
      '3) Compute the direct limit of a simple system',
    ].join('\n');
    expect(parseObjectivesResponse(raw)).toEqual([
      'Explain why the softmax argument is scaled by root d_k',
      'State the decomposition condition for an exact sequence',
      'Compute the direct limit of a simple system',
    ]);
  });

  test('accepts bullets, drops preamble and headings, clamps to the cap', () => {
    const raw = [
      'Here are the objectives:',
      '- Explain the first idea in plain words',
      '- State the second idea precisely',
      '* Apply the third idea to an example',
      '• Compare the fourth idea with its analogue',
      '- Prove the fifth idea from the definitions',
      '- A sixth objective that must be cut',
    ].join('\n');
    const out = parseObjectivesResponse(raw);
    expect(out).toHaveLength(MAX_OBJECTIVES);
    expect(out[0]).toBe('Explain the first idea in plain words');
    expect(out).not.toContain('A sixth objective that must be cut');
  });

  test('returns nothing for prose without a list', () => {
    expect(parseObjectivesResponse('No list here.')).toEqual([]);
  });
});

describe('getChapterText', () => {
  // A tiny fake book: 6 pages, two chapters. Chapter 2 starts on page 3.
  const md = 'AAAA BBBB CCCC DDDD EEEE FFFF';
  const manifest: HpubManifest = {
    format: 'hpub/1',
    page_count: 6,
    alignment: [0, 1, 2, 3, 4, 5].map((i) => ({
      page: i + 1,
      md_char_start: i * 5,
      md_char_end: i * 5 + 4,
    })),
  };
  const toc: TOCItem[] = [
    { id: 1, label: 'Chapter One', href: 'a', index: 0 },
    { id: 2, label: 'Chapter Two', href: 'b', index: 2 },
  ];

  test('slices the whole current chapter via the TOC window', () => {
    const slice = getChapterText({ md, manifest, toc, page: 3 });
    expect(slice.label).toBe('Chapter Two');
    expect(slice.text).toBe('CCCC DDDD EEEE FFFF');
  });

  test('a mid-chapter page still gets the whole chapter', () => {
    const slice = getChapterText({ md, manifest, toc, page: 5 });
    expect(slice.label).toBe('Chapter Two');
    expect(slice.text).toBe('CCCC DDDD EEEE FFFF');
  });

  test('nested TOC items participate via their own page index', () => {
    const nested: TOCItem[] = [
      {
        id: 1,
        label: 'Part',
        href: 'a',
        index: 0,
        subitems: [{ id: 2, label: 'Section', href: 'b', index: 3 }],
      },
    ];
    const slice = getChapterText({ md, manifest, toc: nested, page: 4 });
    expect(slice.label).toBe('Section');
    expect(slice.text).toBe('DDDD EEEE FFFF');
  });

  test('falls back to the current page when the TOC has no page indices', () => {
    const noIndex = [{ id: 1, label: 'Front', href: 'a' } as unknown as TOCItem];
    const slice = getChapterText({ md, manifest, toc: noIndex, page: 2 });
    expect(slice.label).toBe('page 2');
    expect(slice.text).toBe('BBBB');
  });

  test('unanchored pages contribute nothing; a fully unanchored window falls back', () => {
    const sparse: HpubManifest = {
      format: 'hpub/1',
      page_count: 6,
      alignment: [{ page: 4, md_char_start: 15, md_char_end: 19 }],
    };
    const slice = getChapterText({ md, manifest: sparse, toc, page: 4 });
    expect(slice.text).toBe('DDDD');
  });
});

describe('buildSessionQuestion — the voice-loop contract', () => {
  test('carries the objective and the verdict markers', () => {
    const q = buildSessionQuestion('Explain the scaling factor', 2, 4, 'Attention');
    expect(q).toContain('"Explain the scaling factor"');
    expect(q).toContain('objective 2 of 4');
    expect(q).toContain('"Attention"');
    expect(q).toContain('[PASS]');
    expect(q).toContain('[RETRY]');
    expect(q).toContain('[CAPTION:');
    // One question at a time — the OpenMAIC quiz discipline.
    expect(q).toContain('ONE question');
  });
});

describe('buildSessionReportMd — the closing reflection card', () => {
  const objectives: SessionObjective[] = [
    { text: 'Explain the scaling factor', status: 'pass', takeaway: 'it keeps gradients stable' },
    { text: 'State the decomposition condition', status: 'retry', takeaway: 'exactness at M' },
    { text: 'Compute a direct limit', status: 'pending' },
  ];

  test('marks every objective honestly: pass, retry, not reached', () => {
    const md = buildSessionReportMd({
      chapterLabel: 'Chapter Two',
      objectives,
      date: 'Sep 11',
      page: 12,
    });
    expect(md).toContain('### chapter session — Chapter Two (p.12, Sep 11)');
    expect(md).toContain('1. **PASS** — Explain the scaling factor — it keeps gradients stable');
    expect(md).toContain('2. **RETRY** — State the decomposition condition — exactness at M');
    expect(md).toContain('3. **not reached** — Compute a direct limit');
    expect(md).toContain('_1/3 objectives stamped pass._');
  });
});
