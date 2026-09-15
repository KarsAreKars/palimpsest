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
import { parseProfessorTags, type ConceptMapShelves } from '@/services/professor/professorTags';
import { extractDiagramSvg } from '@/services/professor/diagramSvg';

/** The three stances on the probe chip row, in display order. */
export type ProbeStance = 'lead' | 'ask' | 'work';

export interface ConceptMapEntry {
  name: string;
  /** Transcript block id of the most recent professor block about this
   *  concept ([CONCEPT:name] match), or null when the name is new. */
  threadId: string | null;
}

export interface ConceptMapData {
  known: ConceptMapEntry[];
  edge: ConceptMapEntry[];
  unknown: ConceptMapEntry[];
}

export interface DerivationStep {
  /** Stable id: `${blockId}:${i}` — same convention as extractMathSteps. */
  id: string;
  latex: string;
  /** The prose line under the step, when the professor offered one. */
  justification?: string;
  /** The professor's private self-report from [STEP n /CHECKED ..]. */
  professorChecked?: 'ok' | 'bad';
}

export interface DerivationData {
  title?: string;
  goalLatex?: string;
  steps: DerivationStep[];
  /** Filled by the silent check; absent until then. */
  goalReached?: boolean;
  goalByStep?: string;
}

export interface DiagramData {
  /** From [DIAGRAM claim:..]; also the figcaption and the aria-label. */
  claim: string;
  /** Raw SVG from the ```svg fence, sanitized at RENDER time only. */
  svg: string;
}

/** The wave-A block model is the union of the five lane specs (audit R9):
 *  s1's pedagogy fields + s3's derivation/diagram fields + lookedUp (R4).
 *  Every field is optional — a 2.1 block lacks them all and renders exactly
 *  as today (campaign non-negotiable 5). */
export interface TranscriptBlock extends WorkbenchBlock {
  /** [CONCEPT:name] — consumed from the raw stream, never displayed. */
  concept?: string;
  /** [QKIND:kind] — consumed from the raw stream, never displayed. */
  qkind?: string;
  /** [POINT:…] — the professor's one-line takeaway, when offered. */
  point?: string;
  /** [WORKBENCH:END] — the professor closed the session with this block. */
  ended?: boolean;
  /** [PROBE] — this professor block offers the stance chip row. */
  probe?: boolean;
  /** Set when the learner picked a stance from this block's chip row. */
  probePicked?: ProbeStance;
  /** [CONCEPTS …] — the session's concept map at this point (latest block
   *  carrying the field wins; the slip renders from the latest). */
  conceptMap?: ConceptMapData;
  /** On a professor block: [TEACHBACK ask:…]. On the following user block:
   *  the ask this attempt answers (set by the composer). */
  teachbackAsk?: string;
  /** [EVALUATION] — id of the user teach-back attempt block this block judges. */
  teachbackOf?: string;
  /** "I don't know" as a first-class signal — surfaced, NEVER graded. */
  probeSignal?: boolean;
  /** [DERIVE ..] + $$ steps — a numbered folio. */
  derivation?: DerivationData;
  /** [DIAGRAM ..] + ```svg fence — a figure slip. */
  diagram?: DiagramData;
  /** Set on a learner block that appends steps to an open folio: the
   *  folio's block id (s3 §7.3). */
  extendsDerivation?: string;
  /** [LOOK page:N] — pages the professor asked the desk to consult.
   *  Numbers only; the text is re-derived from the manifest each turn. */
  lookedUp?: number[];
}

/** Silent-check state for one block. Chips derive from this. */
export type BlockCheck =
  | { status: 'checking' }
  | {
      status: 'done';
      verdicts: CheckStepVerdict[];
      goal?: { reached: boolean; byStep?: string };
    }
  /** Echo mode: the math engine is away — no marks, no blame, no chips. */
  | { status: 'unavailable' };

export const WORKBENCH_TRANSCRIPT_FILENAME = 'workbench-transcript.json';

const TRANSCRIPT_VERSION = 1;
/** A single check run submits at most this many steps to the sidecar.
 *  Folios honour the same cap — a derivation's step 9+ simply wears no
 *  chip (s3 §10 Q4, confirmed). */
export const MAX_STEPS_PER_CHECK = 8;

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
  // Whole-derivation results ride the same line, after the step verdicts.
  let goalNote = '';
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
      const goal = check.goal;
      if (goal) {
        goalNote = `; goal ${goal.reached ? 'reached' : 'not reached'}${goal.byStep ? ` by ${goal.byStep}` : ''}`;
      }
    });
  }
  return parts.length > 0 ? `checker: ${parts.join('; ')}${goalNote}` : null;
}

/** "I don't know" as a first-class signal — anywhere in the message, any
 *  casing. Surfaced, never graded (not by the silent checker, not by the
 *  professor's pedagogy). */
export const PROBE_SIGNAL_PATTERN = /\b(i don'?t know|i do not know|i have no idea|no idea)\b/i;
export const isProbeSignal = (content: string): boolean => PROBE_SIGNAL_PATTERN.test(content);

/** The latest concept-map shelves carried by any block, or null. */
export const latestConceptMap = (blocks: TranscriptBlock[]): ConceptMapData | null =>
  [...blocks].reverse().find((b) => b.conceptMap)?.conceptMap ?? null;

/** Resolve each concept name to the id of the most recent block that
 *  carried it as [CONCEPT:name]. Names never yet discussed get null. */
export function resolveConceptThreads(
  blocks: TranscriptBlock[],
  shelves: ConceptMapShelves,
): ConceptMapData {
  const threads = new Map<string, string>();
  for (const b of blocks) {
    if (b.author === 'professor' && typeof b.concept === 'string') {
      threads.set(b.concept, b.id); // later wins
    }
  }
  const mapShelf = (names: string[]): ConceptMapEntry[] =>
    names.map((name) => ({ name, threadId: threads.get(name) ?? null }));
  return {
    known: mapShelf(shelves.known),
    edge: mapShelf(shelves.edge),
    unknown: mapShelf(shelves.unknown),
  };
}

/** Steps in derivation blocks are numbered with one running ordinal across
 *  the whole transcript — no two "step 1"s in the sitting. The ordinal is
 *  DERIVED from block order at render time, never stored (a stored ordinal
 *  would go stale when the learner appends a step). */
export function derivationOrdinal(
  blocks: TranscriptBlock[],
  blockId: string,
  stepIndex: number,
): number {
  let n = stepIndex + 1;
  for (const b of blocks) {
    if (b.id === blockId) break;
    if (b.derivation) n += b.derivation.steps.length;
  }
  return n;
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
  if (parsed.probe) block.probe = true;
  if (parsed.conceptMap) {
    block.conceptMap = resolveConceptThreads(existing, parsed.conceptMap);
  }
  if (parsed.teachbackAsk) block.teachbackAsk = parsed.teachbackAsk;
  if (parsed.evaluation) {
    const attempt = [...existing]
      .reverse()
      .find((b) => b.author === 'user' && typeof b.teachbackAsk === 'string');
    if (attempt) block.teachbackOf = attempt.id;
  }
  if (parsed.look !== undefined) block.lookedUp = parsed.look;
  if (parsed.diagram?.claim) {
    // The fence never reaches the eye; a missing fence degrades to the
    // claim printed as prose (svg: '' — §3.5 graceful degradation).
    const extracted = extractDiagramSvg(parsed.display);
    block.diagram = { claim: parsed.diagram.claim, svg: extracted.svg };
    block.content = extracted.display;
  }
  if (parsed.derive) {
    // The desk numbers steps itself — the professor's numeral is ignored.
    const steps: DerivationStep[] = [];
    const parts = parsed.display.split(/(\$\$[\s\S]*?\$\$)/);
    for (let pi = 1; pi < parts.length; pi += 2) {
      const latex = (parts[pi] ?? '').replace(/^\$\$|\$\$$/g, '').trim();
      if (!latex) continue;
      const idx = steps.length;
      const after = parts[pi + 1] ?? '';
      const justificationLine = after
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean);
      const mark = parsed.stepMarks?.[idx];
      steps.push({
        id: `${block.id}:${idx}`,
        latex,
        ...(justificationLine ? { justification: justificationLine } : {}),
        ...(mark?.professorChecked ? { professorChecked: mark.professorChecked } : {}),
      });
    }
    block.derivation = {
      ...(parsed.derive.title ? { title: parsed.derive.title } : {}),
      ...(parsed.derive.goal ? { goalLatex: parsed.derive.goal } : {}),
      steps,
    };
  }
  // A greeting is only the first professor block of a fresh transcript.
  if (existing.filter((b) => b.author === 'professor').length === 0) block.kind = 'greeting';
  return block;
}

/** The learner's appended steps land in their own user block; the folio
 *  itself lives on the professor's block. When the last professor block
 *  carries an open derivation and the user's new block consists solely of
 *  $$…$$ segments + justification lines (no leading prose), append the new
 *  steps to the folio — pure; returns the array UNCHANGED when the block
 *  does not parse as steps (s3 §7.3). The caller marks the user block with
 *  `extendsDerivation`. */
export function associateLearnerStep(
  blocks: TranscriptBlock[],
  userBlock: TranscriptBlock,
): TranscriptBlock[] {
  const folio = [...blocks].reverse().find((b) => b.author === 'professor');
  if (!folio?.derivation) return blocks;
  const parts = userBlock.content.split(/(\$\$[\s\S]*?\$\$)/);
  if (parts[0]?.trim()) return blocks; // leading prose — not a step append
  const steps: DerivationStep[] = [];
  for (let pi = 1; pi < parts.length; pi += 2) {
    const latex = (parts[pi] ?? '').replace(/^\$\$|\$\$$/g, '').trim();
    if (!latex) continue;
    const after = parts[pi + 1] ?? '';
    const justificationLine = after
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    steps.push({
      id: `${folio.id}:${folio.derivation.steps.length + steps.length}`,
      latex,
      ...(justificationLine ? { justification: justificationLine } : {}),
    });
  }
  if (steps.length === 0) return blocks;
  return blocks.map((b) =>
    b.id === folio.id && b.derivation
      ? { ...b, derivation: { ...b.derivation, steps: [...b.derivation.steps, ...steps] } }
      : b,
  );
}

/** A streamed partial may end mid-tag — never let a half-tag reach the
 *  eye. Also eats a COMPLETE tag at the very end (during streaming we cannot
 *  know the protocol line is finished until the next token or the commit)
 *  and a trailing lone `[` (likely the first stroke of a tag or an interval
 *  — it reappears the moment more text arrives). */
export function stripPartialTagTail(text: string): string {
  // R3 + one extension: the step arm ends `\d*[^\]\n]*` (not the ruling's
  // literal `/CHECKED` tail) because a stream cut INSIDE `/CHECKED` (`[STEP
  // 3 /CHEC`) must still be held back — the ruling's literal form matches
  // no truncation point within the CHECKED literal. Strictly wider: every
  // tail the ruling's regex eats, this eats too.
  const tag =
    /[ \t]*\[[A-Z][A-Z0-9_-]*(?::[^\]\n]*|[ \t]+[a-z][A-Za-z0-9_-]*:[^\]\n]*|[ \t]+\d*[^\]\n]*)?\]?(?=[ \t\n]*$)/.exec(
      text,
    );
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
  /** The learner picked a stance from a probe block's chip row. */
  markProbePicked: (bookKey: string, blockId: string, stance: ProbeStance) => void;
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
  markProbePicked: (bookKey, blockId, stance) =>
    set((s) => ({
      blocks: {
        ...s.blocks,
        [bookKey]: (s.blocks[bookKey] ?? []).map((b) =>
          b.id === blockId && b.probe ? { ...b, probePicked: stance } : b,
        ),
      },
    })),
  clearBook: (bookKey) =>
    set((s) => {
      const blocks = { ...s.blocks };
      const checks = { ...s.checks };
      delete blocks[bookKey];
      delete checks[bookKey];
      return { blocks, checks };
    }),
}));
