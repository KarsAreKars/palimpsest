/**
 * Page lookup — the desk answers "I will look" (Workbench 2.x, lane B, s2 §9).
 *
 * The pure core (lookupPages) slices exact spans from the manifest's
 * alignment; the honesty guard keeps unanchored / out-of-range / empty
 * pages out of the results AND out of the citation whitelist; the turn
 * seam (sendWorkbenchTurn) injects the looked-up text as an ephemeral tier
 * and merges lookup.pages into "Pages in your context". Parser cases for
 * the [LOOK page:N] tag itself live in professor-tags.test.ts (wave A).
 */
import { describe, expect, test, vi, beforeEach } from 'vitest';

const { streamTextMock, narrationState } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  narrationState: { controller: null as unknown },
}));

vi.mock('ai', () => ({ streamText: streamTextMock }));

vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => ({ id: 'fake-model' }) }),
}));

vi.mock('@/services/narration/speakMode', () => ({
  getNarration: () =>
    narrationState.controller ? { controller: narrationState.controller } : undefined,
}));

import type { AISettings } from '@/services/ai/types';
import type { HpubManifest } from '@/services/narration';
import { LOOK_MAX_PAGES, lookupPages } from '@/services/professor/pageLookup';
import {
  collectLookedUpPages,
  sendWorkbenchTurn,
  type WorkbenchBlock,
} from '@/services/professor/workbenchSession';
import {
  parseTranscript,
  serializeTranscript,
  type TranscriptBlock,
} from '@/app/reader/components/notebook/workbenchChat';

const P1 = 'Entropy measures the dispersal of heat in a system, says page one. ';
const P2 = 'Page two is about rings, ideals, and their radicals. ';
const P3 = 'Page three treats direct limits over directed sets. ';
const MD = P1 + P2 + P3;

const manifest: HpubManifest = {
  format: 'hpub/1',
  page_count: 3,
  alignment: [
    { page: 1, md_char_start: 0, md_char_end: P1.length, page_class: 'prose' },
    { page: 2, md_char_start: P1.length, md_char_end: P1.length + P2.length, page_class: 'prose' },
    { page: 3, md_char_start: P1.length + P2.length, md_char_end: MD.length, page_class: 'prose' },
  ],
};

/** Second fixture: page 3 carries no text anchor (a picture page). */
const unanchoredManifest: HpubManifest = {
  ...manifest,
  alignment: manifest.alignment.map((a) =>
    a.page === 3 ? { ...a, md_char_start: null, md_char_end: null } : a,
  ),
};

const aiSettings = {
  enabled: true,
  provider: 'openrouter',
  ollamaBaseUrl: '',
  ollamaModel: '',
  ollamaEmbeddingModel: '',
} as unknown as AISettings;

const cb = () => ({ onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  narrationState.controller = { md: MD, manifest };
  streamTextMock.mockReturnValue({
    textStream: (async function* () {
      yield 'Professor reply';
    })(),
  });
});

describe('lookupPages — span slicing over the manifest alignment', () => {
  test('slices the exact span for a requested page', () => {
    const result = lookupPages({ md: MD, manifest, pages: [2] });
    expect(result.pages).toEqual([2]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      page: 2,
      text: P2,
      truncated: false,
      page_class: 'prose',
    });
    expect(result.missing).toEqual([]);
  });

  test('multi-page requests are deduped, sorted, and capped at LOOK_MAX_PAGES', () => {
    const merged = lookupPages({ md: MD, manifest, pages: [3, 1, 1, 2] });
    expect(merged.pages).toEqual([1, 2, 3]);
    expect(merged.missing).toEqual([]);
    // Five requests on a three-page book: sliced to the cap, excess missing.
    const capped = lookupPages({ md: MD, manifest, pages: [5, 1, 2, 3, 4] });
    expect(capped.pages).toEqual([1, 2, 3]);
    expect(capped.missing).toEqual([4, 5]);
    expect(LOOK_MAX_PAGES).toBe(4);
    // Cap-first ordering: dedupe happens before the slice, so a duplicated
    // early page does not evict a later unique one.
    const dup = lookupPages({ md: MD, manifest, pages: [1, 1, 1, 2, 3] });
    expect(dup.pages).toEqual([1, 2, 3]);
    expect(dup.missing).toEqual([]);
  });

  test('honesty: an unanchored page is missing, never empty text', () => {
    const result = lookupPages({ md: MD, manifest: unanchoredManifest, pages: [3] });
    expect(result.results).toHaveLength(0);
    expect(result.pages).toEqual([]);
    expect(result.missing).toEqual([3]);
    expect(result.results.some((r) => r.text === '')).toBe(false);
  });

  test('out-of-range pages (0 and page_count + 1) land in missing', () => {
    const result = lookupPages({ md: MD, manifest, pages: [0, 4] });
    expect(result.results).toHaveLength(0);
    expect(result.missing).toEqual([0, 4]);
  });

  test('a page longer than maxCharsPerPage is truncated at exactly the cap', () => {
    const result = lookupPages({ md: MD, manifest, pages: [2], maxCharsPerPage: 10 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.truncated).toBe(true);
    expect(result.results[0]!.text).toHaveLength(10);
    expect(P2.startsWith(result.results[0]!.text)).toBe(true);
  });
});

describe('collectLookedUpPages — history scan', () => {
  test('dedupes and sorts professor lookedUp metadata; user blocks ignored', () => {
    const history: WorkbenchBlock[] = [
      {
        id: 'b1',
        author: 'professor',
        content: 'I will look.',
        at: '2026-09-15T10:00:00Z',
        lookedUp: [12],
      },
      {
        id: 'b2',
        author: 'user',
        content: 'and?',
        at: '2026-09-15T10:01:00Z',
        lookedUp: [99], // learner blocks carry no lookup metadata — ignored
      },
      {
        id: 'b3',
        author: 'professor',
        content: 'here it is.',
        at: '2026-09-15T10:02:00Z',
        lookedUp: [7, 12],
      },
      { id: 'b4', author: 'professor', content: 'plain block', at: '2026-09-15T10:03:00Z' },
    ];
    expect(collectLookedUpPages(history)).toEqual([7, 12]);
  });
});

describe('sendWorkbenchTurn — the lookup tier and the whitelist honesty guard', () => {
  const historyWithLookup: WorkbenchBlock[] = [
    {
      id: 'b1',
      author: 'professor',
      content: 'The definition lives on an earlier leaf — I will look.',
      at: '2026-09-15T10:00:00Z',
      lookedUp: [3],
    },
    { id: 'b2', author: 'user', content: 'what did it say?', at: '2026-09-15T10:01:00Z' },
  ];

  test('looked-up text rides the turn and the whitelist gains the page', async () => {
    const callbacks = cb();
    await sendWorkbenchTurn({
      bookKey: 'book-1',
      history: historyWithLookup,
      userContent: 'tell me about ideals',
      aiSettings,
      cb: callbacks,
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
    const sent = streamTextMock.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
    };
    const message = sent.messages[0]!.content;
    // The ephemeral lookup tier carries the page's exact text…
    expect(message).toContain('Pages you asked to consult');
    expect(message).toContain(P2);
    // …and the citation whitelist merges the consulted page.
    expect(message).toContain('Pages in your context: 1, 2, 3');
  });

  test('an unanchored looked-up page rides nowhere — not the tier, not the whitelist', async () => {
    narrationState.controller = { md: MD, manifest: unanchoredManifest };
    const callbacks = cb();
    await sendWorkbenchTurn({
      bookKey: 'book-1',
      history: historyWithLookup,
      userContent: 'tell me about ideals',
      aiSettings,
      cb: callbacks,
    });
    const sent = streamTextMock.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
    };
    const message = sent.messages[0]!.content;
    // The looked-up page 3 came back missing: no consult tier was injected
    // for it. (The whole-book tier still carries page 3's bytes inside page
    // 2's span — that is the pack's layout, outside this lane's contract.)
    expect(message).not.toContain('Pages you asked to consult');
    // Page 3 is unanchored: the whitelist lists only the anchored pages.
    expect(message).not.toContain('Pages in your context: 1, 2, 3');
    expect(message).toContain('Pages in your context: 1, 2');
  });
});

describe('transcript round-trip — lookedUp is additive and back-compat', () => {
  test('lookedUp survives serialize/parse, and a 2.1-era block parses unchanged', () => {
    const modern: TranscriptBlock[] = [
      {
        id: 'b1',
        author: 'professor',
        content: 'I will look.',
        at: '2026-09-15T10:00:00Z',
        lookedUp: [2],
      },
    ];
    const roundTripped = parseTranscript(serializeTranscript(modern));
    expect(roundTripped).toEqual(modern);

    // A block exactly as 2.1 wrote it — no lookedUp, no new fields.
    const legacyJson = JSON.stringify({
      version: 1,
      savedAt: '2026-09-01T09:00:00.000Z',
      blocks: [
        {
          id: 'blk_legacy',
          author: 'professor',
          content: 'Entropy again — where does it leak?',
          at: '2026-09-01T09:00:00Z',
          kind: 'question',
        },
      ],
    });
    const legacy = parseTranscript(legacyJson);
    expect(legacy).toHaveLength(1);
    expect(legacy![0]!.lookedUp).toBeUndefined();
    expect(legacy![0]!.content).toBe('Entropy again — where does it leak?');
  });
});
