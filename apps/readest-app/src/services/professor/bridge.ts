/**
 * Chat-bridge (Workbench 2.x #7) — "take it to the desk".
 *
 * When a chat exchange goes deep (the reader's question wants line-by-line
 * worked steps, a derivation, or page-anchored development that a spoken
 * answer cannot carry), the professor may close his answer with ONE
 * protocol tag on its own line at the very end:
 *
 *   [TO_WORKBENCH prompt:'one line, in his words, single-quoted']
 *
 * The tag is a signal, never display: stripped from speech and prose the
 * moment it streams, parsed into a persistent inline suggestion, and never
 * shown raw. Malformed variants pass through untouched (the
 * professorTags.ts precedent: only well-formed tags are consumed).
 */
import { create } from 'zustand';

/** Exact tag name and the single-quoted grammar. One tag per answer. */
export const WORKBENCH_BRIDGE_TAG = 'TO_WORKBENCH';
export const BRIDGE_PROMPT_MAX_CHARS = 280;

/** Well-formed tag, single line, single-quoted prompt, no newline inside. */
const BRIDGE_TAG_RE = /\[TO_WORKBENCH prompt:'([^'\n]*)'\]/;

export interface WorkbenchBridgeSuggestion {
  bookKey: string;
  /** The reader's own question that went deep — seeded into the desk session. */
  question: string;
  /** The professor's one-line reason, from the tag body (≤ 280 chars). */
  prompt: string;
  /** The exchange's concept slug, when the answer carried [CONCEPT:…]. */
  concept?: string;
  /** ISO timestamp of the answer. */
  at: string;
}

/**
 * Terminal parse — call once on the full raw answer (useProfessor onDone).
 * Returns the suggestion (null when the tag is absent or malformed) and the
 * text with every well-formed bridge tag removed. Whitespace is NOT
 * otherwise normalized: `stripAnnotations` downstream owns that, same
 * contract as `stripAnnotationTags`.
 */
export function extractBridgeSuggestion(
  raw: string,
  ctx: { bookKey: string; question: string; concept?: string },
): { suggestion: WorkbenchBridgeSuggestion | null; text: string } {
  const m = raw.match(BRIDGE_TAG_RE);
  if (!m) return { suggestion: null, text: raw };
  const prompt = (m[1] ?? '').trim();
  if (!prompt) return { suggestion: null, text: raw }; // malformed = leave intact
  return {
    suggestion: {
      bookKey: ctx.bookKey,
      question: ctx.question,
      prompt: prompt.slice(0, BRIDGE_PROMPT_MAX_CHARS),
      ...(ctx.concept ? { concept: ctx.concept } : {}),
      at: new Date().toISOString(),
    },
    text: raw.replace(new RegExp(BRIDGE_TAG_RE.source, 'g'), ''),
  };
}

/**
 * Stream filter — call per token BEFORE `voice.push` and before appending to
 * the answer state. Chunk-safe: a tag split across token boundaries is
 * buffered and dropped whole; everything else passes through verbatim
 * (whitespace untouched — the voice path tracks offsets into this stream).
 * Call `flush()` from onDone to release a harmless trailing remainder.
 */
export function makeBridgeTagFilter(): { push(chunk: string): string; flush(): string } {
  let held = '';
  return {
    push(chunk: string): string {
      const buf = held + chunk;
      // A '[' followed by a newline or space is prose bracketing (the
      // holdPartialTag precedent in services/professor/voice.ts:101).
      const open = buf.lastIndexOf('[');
      if (open === -1) {
        held = '';
        return buf;
      }
      const close = buf.indexOf(']', open);
      if (close !== -1) {
        const seg = buf.slice(open, close + 1);
        const rest = buf.slice(0, open) + buf.slice(close + 1);
        if (/^\[TO_WORKBENCH\b/.test(seg)) {
          held = '';
          return rest; // complete bridge tag — dropped
        }
        held = '';
        return buf; // some other bracket construct — pass through
      }
      const frag = buf.slice(open);
      if (frag.includes('\n') || frag.startsWith('[ ')) {
        held = '';
        return buf;
      }
      held = frag; // possibly a tag split mid-stream — hold it
      return buf.slice(0, open);
    },
    flush(): string {
      const rest = held;
      held = '';
      return rest;
    },
  };
}

// ── Suggestion store (persistent, per the standing law) ────────────────────

interface BridgeState {
  /** The latest live suggestion for this book; survives overlay close/reopen,
   *  replaced by the next answer that carries the tag, cleared on act/dismiss. */
  suggestion: WorkbenchBridgeSuggestion | null;
  setSuggestion: (s: WorkbenchBridgeSuggestion) => void;
  clear: () => void;
}

export const useBridgeStore = create<BridgeState>((set) => ({
  suggestion: null,
  setSuggestion: (suggestion) => set({ suggestion }),
  clear: () => set({ suggestion: null }),
}));

// ── Handoff to the desk ────────────────────────────────────────────────────

export const WORKBENCH_BRIDGE_EVENT = 'palimpsest-workbench-bridge';

export interface WorkbenchBridgeRequest {
  bookKey: string;
  /** Seeded as the first student block of the desk session. */
  question: string;
  concept?: string;
  at: string;
}

// Consumed exactly once per book by the Workbench tab (integration note
// §1.6). Module-level, not zustand: a one-shot handoff, not state.
const pending = new Map<string, WorkbenchBridgeRequest>();

/** Stage + announce. The overlay calls this on "Take it to the desk". */
export function requestWorkbenchBridge(req: WorkbenchBridgeRequest): void {
  pending.set(req.bookKey, req);
  window.dispatchEvent(new CustomEvent(WORKBENCH_BRIDGE_EVENT, { detail: req }));
}

/** The desk calls this on mount and on the event; exactly-once semantics. */
export function consumeWorkbenchBridge(bookKey: string): WorkbenchBridgeRequest | null {
  const req = pending.get(bookKey) ?? null;
  if (req) pending.delete(bookKey);
  return req;
}
