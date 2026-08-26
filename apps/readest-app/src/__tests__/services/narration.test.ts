import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildNarrationScript,
  buildPageMapper,
  segmentMarkdown,
  splitSentences,
  toNarrationJsonl,
  type HpubManifest,
} from '@/services/narration/script';
import { initVerbalizer } from '@/services/narration/verbalize';
import { isCitationClutter, isTocClutter, sanitizeProse } from '@/services/narration/sanitize';

const MD = [
  '# Chapter 2. Filtrations and Completions',
  '',
  'Let A be a Noetherian ring and $M$ a finite module. Then $x_i^2 + y_n$ holds, e.g. in the local case.',
  '',
  '$$\\\\mathcal{S} = \\\\{I : I = \\\\text{Ann}_A(x)\\\\}.$$',
  '',
  '![commutative diagram](assets/p30.png)',
  '',
  'Contents ................. 12',
  '',
  '[12] Atiyah, MacDonald (1969) pp. 44',
].join('\n');

const manifest: HpubManifest = {
  format: 'hpub/0.1',
  page_count: 2,
  alignment: [
    { page: 1, md_char_start: 0, md_char_end: 60 },
    { page: 2, md_char_start: 60, md_char_end: MD.length },
  ],
};

beforeAll(async () => {
  await initVerbalizer();
});

describe('segmentMarkdown', () => {
  it('segments blocks with original offsets intact', () => {
    const blocks = segmentMarkdown(MD);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toEqual(['heading', 'prose', 'display_math', 'image', 'prose', 'prose']);
    for (const b of blocks) {
      expect(MD.slice(b.start, b.end)).toBe(b.text);
    }
  });
});

describe('splitSentences', () => {
  it('does not split inside inline math or after abbreviations', () => {
    const text = 'Then $x_i^2 + y_n$ holds, e.g. in the local case. Next sentence.';
    const spans = splitSentences(text, 0);
    expect(spans).toHaveLength(2);
    expect(spans[0]!.text).toBe('Then $x_i^2 + y_n$ holds, e.g. in the local case.');
    expect(spans[1]!.text).toBe('Next sentence.');
  });

  it('does not split on decimals or numbered theorems', () => {
    const spans = splitSentences('See Theorem 3.2 for details. It applies.', 0);
    expect(spans).toHaveLength(2);
  });

  it('tracks offsets into the original text', () => {
    const text = 'First one.  Second two.';
    const spans = splitSentences(text, 100);
    expect(text.slice(spans[1]!.start - 100, spans[1]!.end - 100)).toBe('Second two.');
  });
});

describe('sanitizeProse', () => {
  it('rewraps Marker sub/sup soup as inline math', () => {
    const out = sanitizeProse('we have (0) = <sup>p</sup>∈AssA(M) N(p) here');
    expect(out).toContain('$p$');
  });

  it('drops QED glyph swaps', () => {
    expect(sanitizeProse('as required ¥')).toBe('as required');
  });

  it('expands abbreviations for speech', () => {
    expect(sanitizeProse('e.g. this, i.e. that')).toBe('for example this, that is that');
    expect(sanitizeProse('iff it holds')).toBe('if and only if it holds');
  });

  it('detects clutter', () => {
    expect(isTocClutter('Contents ............... 12')).toBe(true);
    expect(isCitationClutter('[12] [13] pp. 44')).toBe(true);
    expect(isCitationClutter('As shown in [12], the result holds')).toBe(false);
  });
});

describe('buildNarrationScript', () => {
  it('produces units with speak text, kinds, pages, and original offsets', async () => {
    const units = await buildNarrationScript(MD, manifest);
    const byKind = (k: string) => units.filter((u) => u.kind === k);

    expect(byKind('heading')).toHaveLength(1);
    expect(byKind('heading')[0]!.speak).toBe('Chapter 2. Filtrations and Completions.');

    const prose = byKind('inline_math');
    expect(prose.length).toBeGreaterThan(0);
    expect(prose[0]!.speak).not.toContain('$');
    expect(prose[0]!.speak).not.toContain('x_i');
    // Math verbalized, not raw LaTeX (some unit speaks the $x_i^2 + y_n$ span):
    expect(units.some((u) => u.speak?.includes('squared'))).toBe(true);
    // Abbreviation expanded:
    expect(units.some((u) => u.speak?.includes('for example'))).toBe(true);

    const eq = byKind('display_eq');
    expect(eq).toHaveLength(1);
    expect(eq[0]!.speak).toMatch(/^Equation: /);

    // image + TOC line + citation line are skipped, never spoken
    expect(byKind('skip')).toHaveLength(3);
    expect(units.every((u) => u.kind !== 'skip' || u.speak === undefined)).toBe(true);

    // Offsets point into the original content.md
    for (const u of units) {
      expect(u.md_start).toBeLessThan(u.md_end);
      expect(u.md_end).toBeLessThanOrEqual(MD.length);
    }
    const headingUnit = byKind('heading')[0]!;
    expect(MD.slice(headingUnit.md_start, headingUnit.md_end)).toContain('# Chapter 2');

    // Page binding via manifest
    expect(headingUnit.page).toBe(1);
    expect(byKind('display_eq')[0]!.page).toBe(2);

    // Sequential unit ids
    expect(units.map((u) => u.unit)).toEqual(units.map((_, i) => i));
  });

  it('respects equation verbosity settings', async () => {
    const brief = await buildNarrationScript(MD, manifest, { equationVerbosity: 'brief' });
    expect(brief.find((u) => u.kind === 'display_eq')!.speak).toBe('Equation.');
    const skip = await buildNarrationScript(MD, manifest, { equationVerbosity: 'skip' });
    expect(skip.find((u) => u.kind === 'display_eq')).toBeUndefined();
  });

  it('announces visual blocks on mixed/visual pages (amendment A2)', async () => {
    const visualManifest: HpubManifest = {
      format: 'hpub/0.1',
      page_count: 2,
      alignment: [
        { page: 1, md_char_start: 0, md_char_end: 60, page_class: 'prose' },
        { page: 2, md_char_start: 60, md_char_end: MD.length, page_class: 'visual' },
      ],
    };
    const units = await buildNarrationScript(MD, visualManifest);
    const imageUnit = units.find((u) => MD.slice(u.md_start, u.md_end).includes('!['));
    expect(imageUnit).toBeDefined();
    expect(imageUnit!.kind).toBe('skip');
    expect(imageUnit!.speak).toBe('Diagram on this page.');

    // On prose pages the same image stays silent.
    const proseUnits = await buildNarrationScript(MD, manifest);
    const proseImage = proseUnits.find((u) => MD.slice(u.md_start, u.md_end).includes('!['));
    expect(proseImage!.speak).toBeUndefined();
  });

  it('serializes to JSONL, one unit per line', async () => {
    const units = await buildNarrationScript(MD, manifest);
    const jsonl = toNarrationJsonl(units);
    const lines = jsonl.trim().split('\n');
    expect(lines).toHaveLength(units.length);
    expect(JSON.parse(lines[0]!)).toMatchObject({ unit: 0, kind: 'heading' });
  });
});

describe('buildPageMapper', () => {
  it('maps offsets to pages and tolerates gaps', () => {
    const pageFor = buildPageMapper(manifest);
    expect(pageFor(0)).toBe(1);
    expect(pageFor(59)).toBe(1);
    expect(pageFor(60)).toBe(2);
    expect(pageFor(MD.length)).toBe(2);
  });
});

describe('rewrapSubSupMath adjacency (Attention paper regressions)', () => {
  it('does not swallow prose between two distant sup tags', () => {
    const src =
      'While for small values of d<sup>k</sup> the two mechanisms perform similarly, additive attention outperforms dot product attention without scaling for larger values of d<sup>k</sup>.';
    expect(sanitizeProse(src)).toBe(
      'While for small values of d$k$ the two mechanisms perform similarly, additive attention outperforms dot product attention without scaling for larger values of d$k$.',
    );
  });

  it('keeps adjacent tag chains as one math span', () => {
    expect(sanitizeProse('the sum P<sup>d</sup><sup>k</sup> <sup>i</sup>=1 qiki converges')).toBe(
      'the sum P$dk i$=1 qiki converges',
    );
  });

  it('drops footnote markers instead of verbalizing them', () => {
    expect(sanitizeProse('Ashish Vaswani<sup>∗</sup> Google Brain')).toBe(
      'Ashish Vaswani Google Brain',
    );
    expect(sanitizeProse('<sup>4</sup>To illustrate why')).toBe('To illustrate why');
  });

  it('strips page-anchor spans from speech', () => {
    expect(sanitizeProse('<span id="page-3-1"></span>Assume that the components of q and k.')).toBe(
      'Assume that the components of q and k.',
    );
  });
});

describe('citation link residue (Attention paper regression)', () => {
  it('drops escaped-bracket citation links from speech', () => {
    expect(sanitizeProse('attention without scaling [\\[3\\]](#page-9-3). Next')).toBe(
      'attention without scaling. Next',
    );
  });
  it('drops plain bracket citations inline', () => {
    expect(sanitizeProse('as shown by Vaswani [3] in their work')).toBe(
      'as shown by Vaswani in their work',
    );
  });
});
