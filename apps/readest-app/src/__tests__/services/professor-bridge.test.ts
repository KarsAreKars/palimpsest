/**
 * Chat-bridge contract tests (Workbench 2.x #7) — the [TO_WORKBENCH] tag
 * grammar, the chunk-safe stream filter (speech-safety), and the exactly-
 * once handoff to the desk. (s5-bridge-profile.md Part 3.)
 */
import { describe, it, expect } from 'vitest';
import {
  WORKBENCH_BRIDGE_EVENT,
  BRIDGE_PROMPT_MAX_CHARS,
  extractBridgeSuggestion,
  makeBridgeTagFilter,
  requestWorkbenchBridge,
  consumeWorkbenchBridge,
  type WorkbenchBridgeRequest,
} from '@/services/professor/bridge';

const CTX = { bookKey: 'book-1', question: 'Why does the empty intersection matter?' };

describe('extractBridgeSuggestion', () => {
  it('parses a well-formed tag and strips it from the prose', () => {
    const raw =
      "Because it vacuously holds — but that deserves the desk's full treatment.\n" +
      "[TO_WORKBENCH prompt:'This wants working line by line.']";
    const { suggestion, text } = extractBridgeSuggestion(raw, CTX);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.prompt).toBe('This wants working line by line.');
    expect(suggestion!.question).toBe(CTX.question);
    expect(suggestion!.bookKey).toBe(CTX.bookKey);
    expect(suggestion!.at).toEqual(expect.any(String));
    expect(text).not.toContain('TO_WORKBENCH');
    expect(text).toContain('Because it vacuously holds');
    // Whitespace is otherwise untouched (stripAnnotations owns that).
    expect(text.endsWith('\n')).toBe(true);
  });

  it('absent / malformed tags return null and leave the raw text untouched', () => {
    const noTag = 'Just prose, no signal at all.';
    expect(extractBridgeSuggestion(noTag, CTX)).toEqual({ suggestion: null, text: noTag });

    // Double-quoted body — not the grammar.
    const doubleQuoted = 'Answer.\n[TO_WORKBENCH prompt:"not the grammar"]';
    expect(extractBridgeSuggestion(doubleQuoted, CTX).suggestion).toBeNull();
    expect(extractBridgeSuggestion(doubleQuoted, CTX).text).toBe(doubleQuoted);

    // Unquoted body — not the grammar.
    const unquoted = 'Answer.\n[TO_WORKBENCH prompt:just words]';
    expect(extractBridgeSuggestion(unquoted, CTX).suggestion).toBeNull();
    expect(extractBridgeSuggestion(unquoted, CTX).text).toBe(unquoted);

    // Empty prompt — malformed, passes through so the reader sees no silent drop.
    const empty = "Answer.\n[TO_WORKBENCH prompt:'']";
    expect(extractBridgeSuggestion(empty, CTX).suggestion).toBeNull();
    expect(extractBridgeSuggestion(empty, CTX).text).toBe(empty);
  });

  it('first tag wins and every well-formed tag is stripped; >280 chars is capped', () => {
    const raw =
      'Prose one.\n' +
      "[TO_WORKBENCH prompt:'first reason']\n" +
      'Prose two.\n' +
      "[TO_WORKBENCH prompt:'second reason']";
    const { suggestion, text } = extractBridgeSuggestion(raw, CTX);
    expect(suggestion!.prompt).toBe('first reason');
    expect(text).not.toContain('TO_WORKBENCH');
    expect(text).toContain('Prose one.');
    expect(text).toContain('Prose two.');

    const longPrompt = 'x'.repeat(BRIDGE_PROMPT_MAX_CHARS + 40);
    const long = `[TO_WORKBENCH prompt:'${longPrompt}']`;
    const capped = extractBridgeSuggestion(long, CTX).suggestion!;
    expect(capped.prompt.length).toBe(BRIDGE_PROMPT_MAX_CHARS);
  });
});

describe('makeBridgeTagFilter', () => {
  it('drops a tag split across chunk boundaries and releases the prose unchanged', () => {
    const filter = makeBridgeTagFilter();
    const chunks = [
      'He looked up from the page.\n[TO_W',
      "ORKBENCH prompt:'This wants w",
      "orking line by line.']\nThe rest stands alone.",
    ];
    const out = chunks.map((c) => filter.push(c)).join('');
    expect(out).not.toContain('TO_WORKBENCH');
    expect(out).not.toContain('prompt:');
    expect(out).toBe('He looked up from the page.\n\nThe rest stands alone.');
    expect(filter.flush()).toBe('');
  });

  it('passes non-tag brackets like [0,1] through verbatim', () => {
    const filter = makeBridgeTagFilter();
    const line = 'the interval [0,1] holds here';
    expect(filter.push(line)).toBe(line);
    expect(filter.flush()).toBe('');
  });

  it('holds a trailing partial and releases it on flush()', () => {
    const filter = makeBridgeTagFilter();
    expect(filter.push('…and then [TO_WOR')).toBe('…and then ');
    expect(filter.flush()).toBe('[TO_WOR');
    // After flush the filter is empty again.
    expect(filter.flush()).toBe('');
  });
});

describe('bridge handoff', () => {
  it('consumes exactly once per book and dispatches the event', () => {
    const req: WorkbenchBridgeRequest = {
      bookKey: 'book-1',
      question: 'Why does the empty intersection matter?',
      at: new Date().toISOString(),
    };
    let heard: WorkbenchBridgeRequest | null = null;
    const onEvent = (e: Event) => {
      heard = (e as CustomEvent<WorkbenchBridgeRequest>).detail;
    };
    window.addEventListener(WORKBENCH_BRIDGE_EVENT, onEvent);
    try {
      requestWorkbenchBridge(req);
      expect(heard).toBe(req);
      expect(consumeWorkbenchBridge('book-1')).toBe(req);
      expect(consumeWorkbenchBridge('book-1')).toBeNull(); // exactly once
      expect(consumeWorkbenchBridge('other-book')).toBeNull();
    } finally {
      window.removeEventListener(WORKBENCH_BRIDGE_EVENT, onEvent);
    }
  });
});
