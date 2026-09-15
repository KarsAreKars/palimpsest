/**
 * Context-architecture tests (docs/CONTEXT_ARCHITECTURE.md §6/§8) — the
 * tiered pack that replaces the 600k whole-book coin flip. Guards: tier
 * inclusion order, the 80k small-book whole-book gate, the 60k local-mode
 * cap with bottom-up tier drops, the pages_included citation whitelist,
 * and T2 concept-page selection (text search + learner-log fallback).
 */
import { describe, expect, test } from 'vitest';
import {
  buildConceptPages,
  buildTieredPack,
  buildWholeBookText,
  buildWorkbenchContextPack,
  CHAPTER_TIER_CHARS,
  CONCEPT_PAGE_CHARS,
  DEFAULT_MAX_EXCERPT_CHARS,
  LOCAL_PACK_MAX_CHARS,
  SMALL_BOOK_MAX_CHARS,
} from '@/services/professor/contextPack';
import type { ConceptState, LearnerExchange } from '@/services/professor/learner';
import type { HpubManifest } from '@/services/narration';
import type { TOCItem } from '@/libs/document';

const P1 = 'Page one introduces rings and ideals for beginners. ';
const P2 = 'Page two covers the radical of an ideal in detail. ';
const P3 = 'Page three explains direct limits and directed sets. ';
const P4 = 'Page four discusses exactness and prime ideals. ';
const P5 = 'Page five is about assorted examples and exercises. ';
const MD = P1 + P2 + P3 + P4 + P5;

const span = (page: number): [number, number] => {
  const starts = [0, P1.length, P1.length + P2.length, P1.length + P2.length + P3.length];
  const start = starts[page - 1] ?? 0;
  const end = page === 5 ? MD.length : (starts[page] ?? MD.length);
  return [start, end];
};

const manifest: HpubManifest = {
  format: 'hpub/1',
  page_count: 5,
  alignment: [1, 2, 3, 4, 5].map((page) => ({
    page,
    md_char_start: span(page)[0],
    md_char_end: span(page)[1],
    page_class: 'prose',
  })),
};

const toc: TOCItem[] = [
  { id: 1, label: 'Chapter One', href: 'a', index: 0 },
  { id: 2, label: 'Chapter Two', href: 'b', index: 2 },
];

const conceptStates: Record<string, ConceptState> = {
  direct_limits: { bloom: 2, asked: 5, last_ts: '2026-09-10T00:00:00Z' },
  radical_of_an_ideal: { bloom: 2, asked: 3, last_ts: '2026-09-11T00:00:00Z' },
  prime_ideals: { bloom: 3, asked: 1, last_ts: '2026-09-12T00:00:00Z' },
};

describe('buildTieredPack — tier inclusion', () => {
  test('assembles T0 excerpt, T1 chapter window, T2 concept pages, T4 whole book for a small book', () => {
    const pack = buildTieredPack({ md: MD, manifest, toc, page: 3, conceptStates });
    // T0
    expect(pack.excerpt).toContain('direct limits');
    expect(pack.position.page).toBe(3);
    // T1 — reader is on page 3, so Chapter Two (pages 3–5) is the window.
    expect(pack.chapter_window?.label).toBe('Chapter Two');
    expect(pack.chapter_window?.text).toContain('directed sets');
    expect(pack.chapter_window?.text).toContain('examples and exercises');
    // T2 — the three struggled-with concepts anchor to their pages.
    expect(pack.concept_pages?.[2]).toContain('radical of an ideal');
    expect(pack.concept_pages?.[3]).toContain('direct limits');
    expect(pack.concept_pages?.[4]).toContain('prime ideals');
    // T4 — a ~230-char book is far under SMALL_BOOK_MAX_CHARS.
    expect(MD.length).toBeLessThan(SMALL_BOOK_MAX_CHARS);
    expect(pack.wholeBook).toBe(true);
    expect(pack.whole_book_text).toContain('[Page 3]');
  });

  test('pages_included is the sorted union of current, chapter, and concept pages', () => {
    const pack = buildTieredPack({ md: MD, manifest, toc, page: 3, conceptStates });
    // T4 fired (small book) → every anchored page is citeable.
    expect(pack.pages_included).toEqual([1, 2, 3, 4, 5]);
  });

  test('without T4, pages_included is exactly the tier pages (citation whitelist)', () => {
    const pack = buildTieredPack({
      md: MD,
      manifest,
      toc,
      page: 3,
      conceptStates,
      localMode: true,
    });
    expect(pack.wholeBook).toBe(false);
    // current 3 + chapter window 3–5 + concept pages 2,3,4.
    expect(pack.pages_included).toEqual([2, 3, 4, 5]);
  });

  test('is deterministic — identical inputs give a byte-identical pack (prompt caching)', () => {
    const a = buildTieredPack({ md: MD, manifest, toc, page: 3, conceptStates });
    const b = buildTieredPack({ md: MD, manifest, toc, page: 3, conceptStates });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('buildTieredPack — small-book whole-book gate (80k)', () => {
  // Four 25k-char pages: 100k chars total — over the 80k gate, under any
  // local cap concern in cloud mode.
  const bigPage = (seed: string) => `${seed} ${'x'.repeat(25_000 - seed.length - 1)}`;
  const bigMd = [1, 2, 3, 4].map((n) => bigPage(`Page ${n} has plain prose.`)).join('');
  const bigManifest: HpubManifest = {
    format: 'hpub/1',
    page_count: 4,
    alignment: [0, 1, 2, 3].map((i) => ({
      page: i + 1,
      md_char_start: i * 25_000,
      md_char_end: (i + 1) * 25_000,
      page_class: 'prose',
    })),
  };

  test('a book over 80k chars does NOT get whole_book_text but keeps T1+T2', () => {
    expect(bigMd.length).toBeGreaterThan(SMALL_BOOK_MAX_CHARS);
    const states: Record<string, ConceptState> = {
      // Not present anywhere in the text → falls back to the learner log.
      obscure_concept: { bloom: 1, asked: 4, last_ts: '2026-09-10T00:00:00Z' },
    };
    const exchanges: LearnerExchange[] = [
      {
        ts: '2026-09-01T00:00:00Z',
        concept: 'obscure_concept',
        page: 2,
        question_kind: 'define',
        question: 'q',
        resolved: false,
      },
    ];
    const pack = buildTieredPack({
      md: bigMd,
      manifest: bigManifest,
      toc: [],
      page: 1,
      conceptStates: states,
      learnerExchanges: exchanges,
    });
    expect(pack.wholeBook).toBe(false);
    expect(pack.whole_book_text).toBeUndefined();
    // T1 still grounds the turn (degrades to the reader's own page with no TOC).
    expect(pack.chapter_window?.label).toBe('page 1');
    expect(pack.chapter_window?.text).toContain('Page 1 has plain prose');
    // T2 fallback: the page where the concept was last logged.
    expect(pack.concept_pages?.[2]).toContain('Page 2 has plain prose');
    expect(pack.pages_included).toEqual([1, 2]);
  });

  test('buildWholeBookText gates at 80k by default', () => {
    expect(buildWholeBookText(bigMd, bigManifest)).toBeNull();
    expect(buildWholeBookText(MD, manifest)).toContain('[Page 1]');
  });
});

describe('buildTieredPack — local-mode cap (60k)', () => {
  // Four 45k-char pages: 180k chars — T0 alone (45k excerpt) plus the 30k
  // chapter window blows past LOCAL_PACK_MAX_CHARS.
  const localPage = (seed: string) => `${seed} ${'y'.repeat(45_000 - seed.length - 1)}`;
  const localMd = [1, 2, 3, 4].map((n) => localPage(`Local page ${n}.`)).join('');
  const localManifest: HpubManifest = {
    format: 'hpub/1',
    page_count: 4,
    alignment: [0, 1, 2, 3].map((i) => ({
      page: i + 1,
      md_char_start: i * 45_000,
      md_char_end: (i + 1) * 45_000,
      page_class: 'prose',
    })),
  };
  const states: Record<string, ConceptState> = {
    logged_thing: { bloom: 1, asked: 2, last_ts: '2026-09-10T00:00:00Z' },
  };
  const exchanges: LearnerExchange[] = [
    {
      ts: '2026-09-01T00:00:00Z',
      concept: 'logged_thing',
      page: 4,
      question_kind: 'why',
      question: 'q',
      resolved: false,
    },
  ];

  test('never emits whole_book_text in local mode, even for a small book', () => {
    const pack = buildTieredPack({ md: MD, manifest, toc, page: 1, localMode: true });
    expect(pack.wholeBook).toBe(false);
    expect(pack.whole_book_text).toBeUndefined();
    // Tiers still assemble under the cap.
    expect(pack.chapter_window?.text).toContain('rings and ideals');
  });

  test('drops tiers bottom-up (T1 chapter first) to fit LOCAL_PACK_MAX_CHARS', () => {
    const pack = buildTieredPack({
      md: localMd,
      manifest: localManifest,
      toc: [],
      page: 1,
      conceptStates: states,
      learnerExchanges: exchanges,
      maxExcerptChars: 45_000, // the whole first page into T0
      localMode: true,
    });
    // T0 survives — the reader's own page is never dropped.
    expect(pack.excerpt).toContain('Local page 1');
    expect(pack.excerpt.length).toBe(45_000);
    // 45k excerpt + 30k chapter window > 60k → T1 dropped…
    expect(pack.chapter_window).toBeUndefined();
    // …and the chapter's pages leave the whitelist with it.
    expect(pack.pages_included).toEqual([1, 4]);
    // T2 stays: 45k + 3k concept page ≤ 60k.
    expect(pack.concept_pages?.[4]).toContain('Local page 4');
    const total =
      pack.excerpt.length +
      (pack.chapter_window?.text.length ?? 0) +
      Object.values(pack.concept_pages ?? {}).reduce((n, t) => n + t.length, 0);
    expect(total).toBeLessThanOrEqual(LOCAL_PACK_MAX_CHARS);
  });

  test('drops T2 as well when T0 alone already exceeds the cap', () => {
    // 70k-char pages: T0 alone blows the local cap.
    const hugePage = (seed: string) => `${seed} ${'z'.repeat(70_000 - seed.length - 1)}`;
    const hugeMd = [1, 2, 3, 4].map((n) => hugePage(`Huge page ${n}.`)).join('');
    const hugeManifest: HpubManifest = {
      format: 'hpub/1',
      page_count: 4,
      alignment: [0, 1, 2, 3].map((i) => ({
        page: i + 1,
        md_char_start: i * 70_000,
        md_char_end: (i + 1) * 70_000,
        page_class: 'prose',
      })),
    };
    const pack = buildTieredPack({
      md: hugeMd,
      manifest: hugeManifest,
      toc: [],
      page: 1,
      conceptStates: states,
      learnerExchanges: exchanges,
      maxExcerptChars: 100_000, // the whole 70k page into T0
      localMode: true,
    });
    expect(pack.excerpt.length).toBe(70_000);
    expect(pack.excerpt.length).toBeGreaterThan(LOCAL_PACK_MAX_CHARS);
    expect(pack.chapter_window).toBeUndefined();
    expect(pack.concept_pages).toBeUndefined();
    expect(pack.pages_included).toEqual([1]);
  });
});

describe('pages_included — citation honesty (only pages whose text rides in the prompt)', () => {
  test('extraPages are annotated but NOT whitelisted in v1 (their text is never embedded)', () => {
    // Local mode suppresses T4 so only the honest tier pages qualify.
    // (extraPages still feed `blocks` via getPageBlocks when the manifest
    // carries block geometry — this fixture has none, which is fine.)
    const pack = buildTieredPack({
      md: MD,
      manifest,
      toc,
      page: 1,
      extraPages: [4],
      localMode: true,
    });
    // Page 4's text rides in no tier (chapter one spans pages 1–2 only).
    expect(pack.pages_included).toEqual([1, 2]);
  });

  test('an unanchored current page wears no whitelist entry', () => {
    const gappyManifest: HpubManifest = {
      ...manifest,
      alignment: manifest.alignment.map((a) =>
        a.page === 3 ? { ...a, md_char_start: null, md_char_end: null } : a,
      ),
    };
    const pack = buildTieredPack({
      md: MD,
      manifest: gappyManifest,
      toc,
      page: 3,
      conceptStates: {},
      localMode: true,
    });
    // Page 3 ships no excerpt — the whitelist names only real context.
    expect(pack.pages_included).not.toContain(3);
    expect(pack.excerpt).toBe('');
  });

  test('chapter-window pages past the truncation cut leave the whitelist', () => {
    // Chapter Two spans pages 3–5 but the window text is hard-capped — cut
    // inside page 4 so page 5 is beyond the cut.
    const fivePageMd = MD; // pages 3,4,5 in chapter two
    const pack = buildTieredPack({
      md: fivePageMd,
      manifest,
      toc,
      page: 3,
      conceptStates: {},
      maxExcerptChars: DEFAULT_MAX_EXCERPT_CHARS,
      localMode: true,
    });
    // Recreate the cap scenario deterministically: window cap is 30k, our MD
    // is ~230 chars — so instead verify the includedPages plumbing directly:
    // with this small book the whole tier fits and the whitelist still lists
    // exactly the tier pages.
    expect(pack.chapter_window?.text).toContain('directed sets');
    expect(pack.pages_included).toEqual([3, 4, 5]);

    // And with a genuinely over-cap chapter window, the cut pages drop out.
    const widePage = (seed: string) => `${seed} ${'w'.repeat(25_000 - seed.length - 1)}`;
    const wideMd = [1, 2, 3, 4, 5].map((n) => widePage(`Wide page ${n}.`)).join('');
    const wideManifest: HpubManifest = {
      format: 'hpub/1',
      page_count: 5,
      alignment: [0, 1, 2, 3, 4].map((i) => ({
        page: i + 1,
        md_char_start: i * 25_000,
        md_char_end: (i + 1) * 25_000,
        page_class: 'prose',
      })),
    };
    const wideToc: TOCItem[] = [
      { id: 1, label: 'All', href: 'a', index: 0 },
      // no second chapter item → the window runs to the end of the book
    ];
    const widePack = buildTieredPack({
      md: wideMd,
      manifest: wideManifest,
      toc: wideToc,
      page: 1,
      conceptStates: {},
      localMode: true,
    });
    // CHAPTER_TIER_CHARS (30k) cuts inside page 2 → pages 3–5 ride nowhere.
    expect(widePack.chapter_window!.text.length).toBeLessThanOrEqual(CHAPTER_TIER_CHARS);
    expect(widePack.pages_included).toEqual([1, 2]);
  });
});

describe('buildConceptPages', () => {
  test('selects pages by top-3 asked count and finds the concept text', () => {
    const pages = buildConceptPages(MD, manifest, conceptStates);
    expect(
      Object.keys(pages)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([2, 3, 4]);
    expect(pages[3]).toContain('direct limits');
  });

  test('caps each page excerpt at capPerPage', () => {
    const pages = buildConceptPages(MD, manifest, conceptStates, 20);
    expect(pages[3]!.length).toBe(20);
  });

  test('falls back to the page where the concept was last logged', () => {
    const states: Record<string, ConceptState> = {
      never_in_text: { bloom: 1, asked: 2, last_ts: '2026-09-10T00:00:00Z' },
    };
    const exchanges: LearnerExchange[] = [
      {
        ts: '2026-09-01T00:00:00Z',
        concept: 'never_in_text',
        page: 1,
        question_kind: 'define',
        question: 'q',
        resolved: false,
      },
      {
        ts: '2026-09-02T00:00:00Z',
        concept: 'never_in_text',
        page: 4,
        question_kind: 'why',
        question: 'q2',
        resolved: false,
      },
    ];
    const pages = buildConceptPages(MD, manifest, states, CONCEPT_PAGE_CHARS, exchanges);
    // The LAST logged page wins.
    expect(pages[4]).toContain('prime ideals');
    expect(pages[1]).toBeUndefined();
  });

  test('dedupes pages: two concepts on one page share one slot', () => {
    const states: Record<string, ConceptState> = {
      rings: { bloom: 2, asked: 9, last_ts: '2026-09-10T00:00:00Z' },
      ideals: { bloom: 2, asked: 8, last_ts: '2026-09-10T00:00:00Z' },
      direct_limits: { bloom: 2, asked: 7, last_ts: '2026-09-10T00:00:00Z' },
    };
    const pages = buildConceptPages(MD, manifest, states);
    // rings and ideals both live on page 1 — one slot; the tier holds at
    // most CONCEPT_TIER_PAGE_COUNT pages total.
    expect(
      Object.keys(pages)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([1, 3]);
    expect(pages[1]).toContain('rings and ideals');
    expect(pages[3]).toContain('direct limits');
  });
});

describe('buildWorkbenchContextPack — compat shim', () => {
  test('is buildTieredPack with the legacy wholeBook flag (true only when T4 fired)', () => {
    const pack = buildWorkbenchContextPack({ md: MD, manifest, page: 2 });
    expect(pack.wholeBook).toBe(true);
    expect(pack.whole_book_text).toContain('[Page 2]');
    expect(pack.pages_included).toEqual([1, 2, 3, 4, 5]);
    // Deprecated arg accepted and ignored (gate is SMALL_BOOK_MAX_CHARS).
    const legacy = buildWorkbenchContextPack({
      md: MD,
      manifest,
      page: 2,
      wholeBookBudgetChars: 5,
    });
    expect(legacy.wholeBook).toBe(true);
  });

  test('CHAPTER_TIER_CHARS is the chapter-window budget', () => {
    expect(CHAPTER_TIER_CHARS).toBe(30_000);
  });
});
