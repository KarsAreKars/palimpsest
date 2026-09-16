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
import i18n from '@/i18n/i18n';
import type { WorkbenchBlock } from '@/services/professor/workbenchSession';
import type { CheckStepVerdict } from '@/services/professor/mathCheck';
import { parseProfessorTags, type ConceptMapShelves } from '@/services/professor/professorTags';
import { extractDiagramSvg, sanitizeDiagramSvg } from '@/services/professor/diagramSvg';

/** The commit path writes librarian prose onto the paper itself, so the
 *  locale resolves outside React. English source strings are the keys
 *  (defaultValue: key — the useTranslation contract, useTranslation.ts). */
const translate = (key: string): string => i18n.t(key, { defaultValue: key });

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
  /** [VOICE] — the professor asked that this turn be heard (never
   *  displayed; s4 §3). voiceId/lastHeardAt are written back after a
   *  successful playback so a restored sitting remembers which voice
   *  spoke. Absent on 2.1 transcripts. */
  voice?: {
    requested: boolean;
    voiceId?: string;
    lastHeardAt?: string; // ISO timestamp
  };
  /** Set at commit time when the per-exchange artifact budget muted a
   *  folio/figure payload, or a figure failed its commit-time self-check
   *  (d3 C2): the attempt still consumed the exchange's shape slot, so the
   *  count must see it. Additive metadata — renders as ordinary prose. */
  artifactMuted?: boolean;
  /** Desk placement, sheet-content coordinates in px (top-left of the
   *  block, relative to the column box's padding box). All optional, all
   *  additive: absent means "flow in the single column" — a 2.x block
   *  lacks them and renders exactly as today. Written by the desk
   *  composer on the blocks it commits; read by no 2.x code path.
   *  v1 stores x/width and ignores them at render; y is the commit-time
   *  insertion hint only (d2 §2.1, audit R2). */
  x?: number;
  y?: number;
  width?: number;
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

// ---------------------------------------------------------------------------
// Desk rail (d3 §B) — the traffic-light spine's row model. Pure,
// side-effect free: the rail renders exclusively from
// latestConceptMap(blocks) and never writes state.
// ---------------------------------------------------------------------------

export type DeskShelf = 'known' | 'edge' | 'unknown';

export interface DeskRailEntry {
  name: string;
  shelf: DeskShelf;
  /** Transcript block id to scroll to; null → inert chip. */
  threadId: string | null;
}

/** The rail's row model: shelves in catalogue order (known, edge,
 *  unknown), names in shelf order, threadId carried through. null map → []. */
export function buildDeskRail(map: ConceptMapData | null): DeskRailEntry[] {
  if (!map) return [];
  const fromShelf =
    (shelf: DeskShelf) =>
    (entries: ConceptMapEntry[]): DeskRailEntry[] =>
      entries.map((e) => ({ name: e.name, shelf, threadId: e.threadId }));
  return [
    ...fromShelf('known')(map.known),
    ...fromShelf('edge')(map.edge),
    ...fromShelf('unknown')(map.unknown),
  ];
}

// ---------------------------------------------------------------------------
// Penecho guards (folded 2.5, d3 C2) — enforced outside the model at the
// commit seam, exactly where the raw stream becomes a block.
// ---------------------------------------------------------------------------

/** Penecho M4 port: at most this many folio/figure (artifact) blocks per
 *  exchange. The exchange boundary is the most recent learner block. */
export const MAX_ARTIFACT_BLOCKS_PER_EXCHANGE = 3;

const BUDGET_MUTE_NOTE = 'The professor sets down his pen — one shape at a time.';
const FIGURE_FAILED_NOTE = 'The figure would not hold its ink; the claim stands as words.';

/** Artifact blocks (carrying a derivation or a diagram) since the last user
 *  block — the exchange's running shape count. Muted attempts count too:
 *  a failed figure consumed its slot (d3 C2.ii). */
export function professorArtifactCount(blocks: TranscriptBlock[]): number {
  let count = 0;
  for (const b of blocks) {
    if (b.author === 'user') count = 0;
    else if (b.derivation || b.diagram || b.artifactMuted) count += 1;
  }
  return count;
}

/** True when the budget is spent: another artifact this exchange must be
 *  muted. Prose never consults this. */
export const artifactBudgetSpent = (blocks: TranscriptBlock[]): boolean =>
  professorArtifactCount(blocks) >= MAX_ARTIFACT_BLOCKS_PER_EXCHANGE;

/** Shelf order for the one-step rule. */
const SHELF_ORDER: Record<DeskShelf, number> = { known: 0, edge: 1, unknown: 2 };
const SHELVES_IN_ORDER: DeskShelf[] = ['known', 'edge', 'unknown'];

/** Inverse: the shelf one step toward `toward` (3×3, written plain). */
const stepShelf = (from: DeskShelf, toward: DeskShelf): DeskShelf => {
  if (from === toward) return from;
  const delta = Math.sign(SHELF_ORDER[toward] - SHELF_ORDER[from]);
  return SHELVES_IN_ORDER[SHELF_ORDER[from] + delta]!;
};

/** Penecho M5 port (the evaluation cursor): relative to the shelves the
 *  latest concept map filed, a concept may move at most ONE shelf per
 *  professor commit. Names new to the map file where the professor puts
 *  them (first filing is not a move); a name aimed two shelves away lands
 *  one step along, in the shelf list it actually reached. Pure. */
export function clampConceptShelves(
  prev: ConceptMapData | null,
  next: ConceptMapShelves,
): ConceptMapShelves {
  if (!prev) return { known: [...next.known], edge: [...next.edge], unknown: [...next.unknown] };
  const prevShelf = new Map<string, DeskShelf>();
  for (const e of prev.known) prevShelf.set(e.name, 'known');
  for (const e of prev.edge) prevShelf.set(e.name, 'edge');
  for (const e of prev.unknown) prevShelf.set(e.name, 'unknown');
  const placed = new Set<string>();
  const result: Record<DeskShelf, string[]> = { known: [], edge: [], unknown: [] };
  const file = (names: string[], toward: DeskShelf) => {
    for (const name of names) {
      if (placed.has(name)) continue; // one landing per name
      placed.add(name);
      const from = prevShelf.get(name);
      result[from ? stepShelf(from, toward) : toward].push(name);
    }
  };
  file(next.known, 'known');
  file(next.edge, 'edge');
  file(next.unknown, 'unknown');
  return result;
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
    // Penecho M5: shelves move at most one step per commit vs the latest
    // filed map; new names file freely (d3 C2.iii).
    const shelves = clampConceptShelves(latestConceptMap(existing), parsed.conceptMap);
    block.conceptMap = resolveConceptThreads(existing, shelves);
  }
  if (parsed.teachbackAsk) block.teachbackAsk = parsed.teachbackAsk;
  if (parsed.evaluation) {
    const attempt = [...existing]
      .reverse()
      .find((b) => b.author === 'user' && typeof b.teachbackAsk === 'string');
    if (attempt) block.teachbackOf = attempt.id;
  }
  if (parsed.look !== undefined) block.lookedUp = parsed.look;
  if (parsed.voice) block.voice = { requested: true };
  if (parsed.diagram?.claim) {
    // The fence never reaches the eye; a missing fence degrades to the
    // claim printed as prose (svg: '' — §3.5 graceful degradation).
    const extracted = extractDiagramSvg(parsed.display);
    if (artifactBudgetSpent(existing)) {
      // C2.i: the exchange's shape budget is spent — the payload is
      // muted and the claim lands as clean prose before the note; the
      // attempt is marked so the count stays honest for anything later
      // in the exchange.
      block.content = `${extracted.display}\n\n${parsed.diagram.claim}\n\n${translate(BUDGET_MUTE_NOTE)}`;
      block.artifactMuted = true;
    } else if (extracted.svg !== '' && !sanitizeDiagramSvg(extracted.svg)) {
      // C2.ii commit-time self-check: the figure would not hold its ink.
      // The claim stands as words (printed, since the tag never reaches
      // the display); the exchange's figure slot is consumed — the retry
      // reopens at the next learner block. An EMPTY fence is an authoring
      // slip, not a failed drawing — it takes the plain degrade path below
      // and does not consume the stop.
      block.content = `${extracted.display}\n\n${parsed.diagram.claim}\n\n${translate(FIGURE_FAILED_NOTE)}`;
      block.artifactMuted = true;
    } else {
      block.diagram = { claim: parsed.diagram.claim, svg: extracted.svg };
      block.content = extracted.display;
    }
  }
  if (parsed.derive) {
    if (artifactBudgetSpent(existing)) {
      // C2.i: muted folio — no DerivationStep[] is built, but
      // parsed.display still carries the $$ steps as text, so the block
      // lands as clean prose with the note.
      block.content = `${parsed.display}\n\n${translate(BUDGET_MUTE_NOTE)}`;
      block.artifactMuted = true;
    } else {
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

/** The learner's turn as a commit-ready block: answers the professor's
 *  open teach-back ask, marks the honest "I don't know" signal, detects a
 *  folio step-append, and carries the desk placement fields (d2 §2.1).
 *  Pure — the caller owns store writes and the network turn. */
export interface UserTurnInit {
  content: string;
  /** Desk placement (optional, additive — d2 §2.1). */
  x?: number;
  y?: number;
  width?: number;
}

/**
 * Build the learner's block for a turn, applying the same metadata rules
 *  as the 2.x composer: answers the professor's open teach-back ask, marks
 *  the honest "I don't know" signal, and detects a folio step-append.
 *  Pure — the caller owns store writes and the network turn.
 */
export function buildUserBlock(
  priorBlocks: TranscriptBlock[],
  init: UserTurnInit,
): { block: TranscriptBlock; associated: TranscriptBlock[] } {
  const block: TranscriptBlock = {
    id: newBlockId(),
    author: 'user',
    content: init.content,
    at: new Date().toISOString(),
    ...(init.x !== undefined ? { x: init.x } : {}),
    ...(init.y !== undefined ? { y: init.y } : {}),
    ...(init.width !== undefined ? { width: init.width } : {}),
  };
  const prior = priorBlocks[priorBlocks.length - 1];
  if (prior?.author === 'professor' && prior.teachbackAsk && !prior.teachbackOf) {
    block.teachbackAsk = prior.teachbackAsk;
  }
  if (isProbeSignal(block.content)) block.probeSignal = true;
  const associated = associateLearnerStep(priorBlocks, block);
  if (associated !== priorBlocks) {
    const changed = associated.find((b, i) => b !== priorBlocks[i]);
    if (changed) block.extendsDerivation = changed.id;
  }
  return { block, associated };
}

/** Placement fields survive the file round-trip only when finite numbers;
 *  width must be positive. Anything else is stripped (the block still
 *  loads — honest paper, never an erased-looking block). */
export const sanitizePlacement = (b: TranscriptBlock): TranscriptBlock => {
  const { x, y, width, ...rest } = b;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return {
    ...rest,
    ...(num(x) ? { x } : {}),
    ...(num(y) ? { y } : {}),
    ...(num(width) && width > 0 ? { width } : {}),
  };
};

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
    // Placement fields sanitize, never reject (d2 §2.2): a block carrying
    // x: "oops" keeps its ink; only the malformed placement is stripped.
    return (blocks as TranscriptBlock[]).map(sanitizePlacement);
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
  /** Additive patch of one committed block — the voice player writes
   *  voiceId/lastHeardAt back through here (s4 §4.4). */
  updateBlock: (bookKey: string, blockId: string, patch: Partial<TranscriptBlock>) => void;
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
  updateBlock: (bookKey, blockId, patch) =>
    set((s) => ({
      blocks: {
        ...s.blocks,
        [bookKey]: (s.blocks[bookKey] ?? []).map((b) =>
          b.id === blockId ? { ...b, ...patch } : b,
        ),
      },
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
