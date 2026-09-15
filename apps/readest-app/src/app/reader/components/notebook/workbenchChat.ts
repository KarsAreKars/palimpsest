/**
 * workbenchChat — the block-transcript state for the Workbench 2.1 sitting.
 *
 * A transcript is a per-book document: an alternating stack of professor
 * and student blocks (services/professor/workbenchSession.ts's WorkbenchBlock
 * plus the protocol metadata consumed out of the professor's raw text).
 * This module keeps the transcript in a small zustand store (keyed by
 * bookKey) so it survives tab unmounts, and provides the pure helpers the
 * tab needs: math extraction for the silent checker, the checker summary
 * the professor reads, and the file round-trip (mirrors the desk's
 * AppService file-API persistence pattern).
 *
 * Streaming partial text stays OUT of this store — it is component-local,
 * per the 2026-09-06 crash-scar rule that streaming state never leaves the
 * workbench subtree.
 */
import { create } from 'zustand';
import type { WorkbenchBlock } from '@/services/professor/workbenchSession';
import type { CheckStepVerdict } from '@/services/professor/mathCheck';
import { parseProfessorTags } from '@/services/professor/professorTags';

export interface TranscriptBlock extends WorkbenchBlock {
  /** [CONCEPT:name] — consumed from the raw stream, never displayed. */
  concept?: string;
  /** [QKIND:kind] — consumed from the raw stream, never displayed. */
  qkind?: string;
  /** [POINT:…] — the professor's one-line takeaway, when offered. */
  point?: string;
  /** [WORKBENCH:END] — the professor closed the session with this block. */
  ended?: boolean;
}

/** Silent-check state for one student block. Chips derive from this. */
export type BlockCheck =
  | { status: 'checking' }
  | { status: 'done'; verdicts: CheckStepVerdict[] }
  /** Echo mode: the math engine is away — no marks, no blame, no chips. */
  | { status: 'unavailable' };

export const WORKBENCH_TRANSCRIPT_FILENAME = 'workbench-transcript.json';

const TRANSCRIPT_VERSION = 1;
/** A single check run submits at most this many steps to the sidecar. */
const MAX_STEPS_PER_CHECK = 8;

// ---------------------------------------------------------------------------
// Pure helpers (kept side-effect free for contract tests)
// ---------------------------------------------------------------------------

let blockSeq = 0;
export const newBlockId = (): string =>
  `blk_${Date.now().toString(36)}_${((blockSeq = (blockSeq + 1) % 1296)).toString(36)}`;

/**
 * The citation anchors the professor is prompted to emit: `[Page N]`.
 * Used both to lift anchors out of the display prose (they become page
 * chips) and to know which chips may scroll the book (thread 2, resolved:
 * chip click scrolls the book to that page).
 */
export const PAGE_CITE_PATTERN = /\[Page (\d+)\]/g;

/** True when the prose smells like math even without $…$ fences. A line
 *  with sentence-like word density is prose even when it carries one math
 *  symbol ("so e = mc² means…" is a sentence, not a step). */
const MATHY_CHARS = /[=≤≥≠≈~±→←↔×·∫∑∏√∞∂∇²³ⁿ₀-₉]/;
/** Dictionary-looking words (3+ letters, lowercase tail) — four or more
 *  mark the line as prose. Pinned by tests. */
const DICTIONARY_WORD = /\b[A-Za-z][a-z]{2,}\b/g;

const isMathy = (content: string): boolean => {
  const prose = content
    .replace(/\$\$[\s\S]*?\$\$/g, ' ') // complete display math
    .replace(/\$\$[\s\S]*$/, ' ') // an unterminated $$ shields prose — that prose is NOT a step
    .replace(/\$[^$\n]+\$/g, ' ');
  if (!MATHY_CHARS.test(prose)) return false;
  return (prose.match(DICTIONARY_WORD) ?? []).length < 4;
};

/**
 * Pull the checkable math lines out of a student block. Display math wins
 * ($$…$$, one step each); inline math ($…$) is the fallback; bare math-y
 * prose is the last resort. Returns [] for plain prose — those blocks are
 * never checked, so they never wear a chip.
 */
export function extractMathSteps(
  content: string,
  idPrefix: string,
): { id: string; latex: string }[] {
  const display = [...content.matchAll(/\$\$([\s\S]*?)\$\$/g)]
    .map((m) => (m[1] ?? '').trim())
    .filter(Boolean);
  const inline = [...content.matchAll(/\$([^$\n]+)\$/g)]
    .map((m) => (m[1] ?? '').trim())
    .filter(Boolean);
  let latexSteps: string[] = [];
  if (display.length > 0) {
    latexSteps = display;
  } else if (inline.length > 0) {
    latexSteps = inline;
  } else if (isMathy(content)) {
    latexSteps = [content.trim()];
  }
  return latexSteps
    .slice(0, MAX_STEPS_PER_CHECK)
    .map((latex, i) => ({ id: `${idPrefix}:${i}`, latex }));
}

/**
 * The one-line deterministic summary the professor reads before answering
 * (checkerSummary in sendWorkbenchTurn's opts). Completed verdicts only —
 * lines still checking are omitted rather than guessed at. null when the
 * checker has nothing to say.
 */
export function summarizeChecks(checks: BlockCheck[]): string | null {
  const parts: string[] = [];
  // Global ordinal across blocks — no two "step 1"s in one summary.
  let stepNo = 0;
  for (const check of checks) {
    if (check.status !== 'done') continue;
    check.verdicts.forEach((v) => {
      stepNo += 1;
      const name = v.status === 'parse_error' ? 'parse_error' : (v.verdict ?? 'unknown');
      let line = `step ${stepNo} ${name}`;
      const cx = v.counterexample;
      if (name === 'not_equivalent' && cx) {
        const assigns = Object.entries(cx.assignments)
          .map(([k, val]) => `${k}=${String(val)}`)
          .join(', ');
        line += `, counterexample ${assigns ? `${assigns} ` : ''}gives ${cx.prevValue} vs ${cx.stepValue}`;
      }
      parts.push(line);
    });
  }
  return parts.length > 0 ? `checker: ${parts.join('; ')}` : null;
}

/**
 * Commit a raw professor stream into a transcript block: protocol tags are
 * consumed into metadata, the display string is what lands on the paper.
 */
export function commitProfessorBlock(
  raw: string,
  existing: TranscriptBlock[] = [],
): TranscriptBlock {
  const parsed = parseProfessorTags(raw);
  const block: TranscriptBlock = {
    id: newBlockId(),
    author: 'professor',
    content: parsed.display,
    at: new Date().toISOString(),
  };
  if (parsed.concept !== undefined) block.concept = parsed.concept;
  if (parsed.qkind !== undefined) block.qkind = parsed.qkind;
  if (parsed.point !== undefined) block.point = parsed.point;
  if (parsed.end) block.ended = true;
  // A greeting is only the first professor block of a fresh transcript.
  if (existing.filter((b) => b.author === 'professor').length === 0) block.kind = 'greeting';
  return block;
}

/** A streamed partial may end mid-tag — never let a half-tag reach the
 *  eye. Also eats a COMPLETE tag at the very end (during streaming we cannot
 *  know the protocol line is finished until the next token or the commit)
 *  and a trailing lone `[` (likely the first stroke of a tag or an interval
 *  — it reappears the moment more text arrives). */
export function stripPartialTagTail(text: string): string {
  const tag = /[ \t]*\[[A-Z][A-Z0-9_-]*(?::[^\]\n]*)?\]?(?=[ \t\n]*$)/.exec(text);
  if (tag) return text.slice(0, tag.index);
  const lone = /[ \t]*\[(?=[ \t\n]*$)/.exec(text);
  return lone ? text.slice(0, lone.index) : text;
}

// ---------------------------------------------------------------------------
// File round-trip (AppService file-API pattern, mirrors the desk's
// workbench.json contract: silent console.warn on failure, never a throw)
// ---------------------------------------------------------------------------

interface TranscriptFile {
  version: number;
  savedAt: string;
  blocks: TranscriptBlock[];
}

export const serializeTranscript = (blocks: TranscriptBlock[]): string =>
  JSON.stringify(
    {
      version: TRANSCRIPT_VERSION,
      savedAt: new Date().toISOString(),
      blocks,
    } satisfies TranscriptFile,
    null,
    2,
  );

const isBlock = (v: unknown): v is TranscriptBlock => {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b['id'] === 'string' &&
    (b['author'] === 'professor' || b['author'] === 'user') &&
    typeof b['content'] === 'string' &&
    typeof b['at'] === 'string'
  );
};

/** null on any malformed shape — the caller falls back to a fresh sitting. */
export function parseTranscript(json: string): TranscriptBlock[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const blocks = (parsed as Record<string, unknown>)['blocks'];
    if (!Array.isArray(blocks) || !blocks.every(isBlock)) return null;
    return blocks as TranscriptBlock[];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store — per-book transcript + per-block silent-check state
// ---------------------------------------------------------------------------

interface WorkbenchChatState {
  blocks: Record<string, TranscriptBlock[]>;
  checks: Record<string, Record<string, BlockCheck>>;
  setBlocks: (bookKey: string, blocks: TranscriptBlock[]) => void;
  appendBlock: (bookKey: string, block: TranscriptBlock) => void;
  setCheck: (bookKey: string, blockId: string, check: BlockCheck | null) => void;
  clearBook: (bookKey: string) => void;
}

export const useWorkbenchChatStore = create<WorkbenchChatState>((set) => ({
  blocks: {},
  checks: {},
  setBlocks: (bookKey, blocks) => set((s) => ({ blocks: { ...s.blocks, [bookKey]: blocks } })),
  appendBlock: (bookKey, block) =>
    set((s) => ({
      blocks: { ...s.blocks, [bookKey]: [...(s.blocks[bookKey] ?? []), block] },
    })),
  setCheck: (bookKey, blockId, check) =>
    set((s) => {
      const forBook = { ...(s.checks[bookKey] ?? {}) };
      if (check === null) delete forBook[blockId];
      else forBook[blockId] = check;
      return { checks: { ...s.checks, [bookKey]: forBook } };
    }),
  clearBook: (bookKey) =>
    set((s) => {
      const blocks = { ...s.blocks };
      const checks = { ...s.checks };
      delete blocks[bookKey];
      delete checks[bookKey];
      return { blocks, checks };
    }),
}));
