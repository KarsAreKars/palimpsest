/**
 * Workbench session — context architecture Finding B regression:
 * sendWorkbenchTurn must carry the REBUILT tiered pack (book tiers + the
 * "Pages in your context" whitelist) on EVERY turn, not just the opening
 * one. Before the fix, turns 2+ were stateless single messages with no
 * book text at all — citation drift guaranteed.
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
import {
  sendWorkbenchTurn,
  startWorkbenchSession,
  type WorkbenchBlock,
} from '@/services/professor/workbenchSession';

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

const aiSettings = {
  enabled: true,
  provider: 'openrouter',
  ollamaBaseUrl: '',
  ollamaModel: '',
  ollamaEmbeddingModel: '',
} as unknown as AISettings;

const history: WorkbenchBlock[] = [
  {
    id: 'b1',
    author: 'professor',
    content: 'Entropy is the load-bearing idea here — where do you think it leaks?',
    at: '2026-09-15T10:00:00Z',
  },
  {
    id: 'b2',
    author: 'user',
    content: 'into the surroundings?',
    at: '2026-09-15T10:01:00Z',
  },
];

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

describe('sendWorkbenchTurn — the pack rides every turn (Finding B fix)', () => {
  test('the assembled message contains the current page excerpt, not just history', async () => {
    const callbacks = cb();
    await sendWorkbenchTurn({
      bookKey: 'book-1',
      history,
      userContent: 'why does entropy increase?',
      aiSettings,
      cb: callbacks,
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
    const sent = streamTextMock.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    const message = sent.messages[0]!.content;
    // The regression: turns must carry the book, not only the transcript.
    expect(message).toContain('Entropy measures the dispersal of heat');
    // The citation whitelist the prompt addendum names.
    expect(message).toContain('Pages in your context: 1, 2, 3');
    // T3 still rides along: transcript, where-we-are, the student's words.
    expect(message).toContain('The workbench transcript so far');
    expect(message).toContain('Where we are');
    expect(message).toContain('The student now says: why does entropy increase?');
  });

  test('the book tiers precede the turn-varying T3 tail (cache-friendly order)', async () => {
    const callbacks = cb();
    await sendWorkbenchTurn({
      bookKey: 'book-1',
      history,
      userContent: 'and then?',
      aiSettings,
      cb: callbacks,
    });
    const sent = streamTextMock.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    const message = sent.messages[0]!.content;
    expect(message.indexOf('Entropy measures the dispersal of heat')).toBeLessThan(
      message.indexOf('The workbench transcript so far'),
    );
    expect(message.indexOf('Pages in your context')).toBeLessThan(
      message.indexOf('The student now says'),
    );
  });

  test('turn 2 rebuilds the pack instead of drifting bookless', async () => {
    const callbacks = cb();
    // Turn 1
    await sendWorkbenchTurn({
      bookKey: 'book-1',
      history: [],
      userContent: 'open with entropy',
      aiSettings,
      cb: callbacks,
    });
    // Turn 2 — previously this carried NO book context at all.
    await sendWorkbenchTurn({
      bookKey: 'book-1',
      history,
      userContent: 'why does it always grow?',
      aiSettings,
      cb: callbacks,
    });
    const second = streamTextMock.mock.calls[1]![0] as {
      messages: Array<{ content: string }>;
    };
    expect(second.messages[0]!.content).toContain('Entropy measures the dispersal of heat');
  });

  test('degrades honestly when the text layer is unavailable', async () => {
    narrationState.controller = null;
    const callbacks = cb();
    await sendWorkbenchTurn({
      bookKey: 'book-1',
      history,
      userContent: 'hello?',
      aiSettings,
      cb: callbacks,
    });
    const sent = streamTextMock.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(sent.messages[0]!.content).toContain('text layer is not available this turn');
    expect(sent.messages[0]!.content).toContain('I will look');
  });
});

describe('startWorkbenchSession — local-mode pack cap (the localMode wiring)', () => {
  test('ollama settings hard-cap the pack: whole_book_text never ships locally', async () => {
    const callbacks = cb();
    await startWorkbenchSession({
      bookKey: 'book-1',
      aiSettings: { ...aiSettings, provider: 'ollama' } as AISettings,
      cb: callbacks,
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
    const sent = streamTextMock.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    const message = sent.messages[0]!.content;
    // Deleting `localMode: isLocalMode(aiSettings)` from startWorkbenchSession
    // flips this: the small book would ship its whole text layer locally.
    expect(message).not.toContain('full text layer, with [Page N] markers');
    // …while the honest tiers still ground the professor.
    expect(message).toContain('Entropy measures the dispersal of heat');
  });

  test('non-local providers still get the whole book for a small book', async () => {
    const callbacks = cb();
    await startWorkbenchSession({ bookKey: 'book-1', aiSettings, cb: callbacks });
    const sent = streamTextMock.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(sent.messages[0]!.content).toContain('full text layer, with [Page N] markers');
  });
});
describe('startWorkbenchSession — tiered opening', () => {
  test('opening message carries the pack and the citation whitelist', async () => {
    const callbacks = cb();
    await startWorkbenchSession({ bookKey: 'book-1', aiSettings, cb: callbacks });
    expect(callbacks.onError).not.toHaveBeenCalled();
    const sent = streamTextMock.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    const message = sent.messages[0]!.content;
    expect(message).toContain(
      'Open a workbench session for this book. The student is reading page 1.',
    );
    // Small book → T4 whole book with [Page N] markers.
    expect(message).toContain('[Page 1]');
    expect(message).toContain('Pages in your context: 1, 2, 3');
    expect(message).toContain('Greet the student in character');
  });
});
