/**
 * Workbench session seam (Workbench 2.1) — the professor's block transcript.
 *
 * Two streamed entry points, mirroring the tutor seam in tutor.ts (same
 * provider plumbing: getAIProvider(aiSettings).getModel() + streamText +
 * 45s handshake timeout), but session-shaped:
 *
 *   - startWorkbenchSession — opens a session: builds the whole-book context
 *     pack (falling back to the page-window pack when the text layer exceeds
 *     the budget), composes the system-adjacent opening user message
 *     ("Open a workbench session for this book. The student is reading
 *     page X"), folds in a compact summary of recent professor Q&A and the
 *     learner's concept states, and asks the professor to greet in character
 *     and ask ONE first question.
 *   - sendWorkbenchTurn — one turn of the transcript: the full alternating
 *     history + the student's message + an optional deterministic checker
 *     summary line, answered in character per the ladder.
 *
 * STATELESS BY DESIGN: the caller owns persistence. Blocks go in via
 * `resumeBlocks` / `history` and come back through the callbacks; this
 * module never touches workbench.json.
 */
import { streamText } from 'ai';
import type { AISettings } from '@/services/ai/types';
import { getAIProvider } from '@/services/ai/providers';
import environmentConfig from '@/services/environment';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { getBookProgress } from '@/store/readerProgressStore';
import { PROFESSOR_WORKBENCH_SYSTEM_PROMPT } from './prompt';
import { buildTieredPack, type ProfessorContextPack } from './contextPack';
import { loadLearner, type LearnerState } from './learner';
import { loadBookSource, lookupBookPages, type PageLookupResult } from './pageLookup';
import { loadProfileCurrent, profileLinesForPrompt, type LearnerProfile } from './learnerProfile';

/** One transcript block in the workbench session. */
export interface WorkbenchBlock {
  id: string;
  author: 'professor' | 'user';
  content: string;
  /** ISO timestamp. */
  at: string;
  kind?: 'greeting' | 'question' | 'feedback' | 'derivation' | 'answer' | 'meta';
  /** [LOOK page:N] — pages the professor asked the desk to consult.
   *  Numbers only; the text is re-derived from the manifest each turn. */
  lookedUp?: number[];
}

export interface WorkbenchTurnCallbacks {
  onToken(token: string): void;
  onDone(full: string): void;
  /** `message` is English debug text for the console — never render it to
   *  the reader. `kind` selects the fixed, translated copy the UI shows;
   *  every path passes a kind so no raw provider detail can reach the eye. */
  onError(message: string, kind?: WorkbenchErrorKind): void;
}

/** Known failure kinds — the UI maps each to fixed librarian copy and never
 *  shows the raw `message`. */
export type WorkbenchErrorKind = 'no-provider' | 'text-layer' | 'timeout' | 'unknown';

export interface StartWorkbenchSessionOptions {
  bookKey: string;
  /** Prior session blocks when resuming — summarized into the opening turn. */
  resumeBlocks?: WorkbenchBlock[];
  aiSettings: AISettings;
  signal?: AbortSignal;
  cb: WorkbenchTurnCallbacks;
  /** 1-based page override; when omitted the reader progress store is read
   *  directly (standalone getter — no circular imports). */
  currentPage?: number;
}

export interface SendWorkbenchTurnOptions {
  bookKey: string;
  /** Full transcript so far, professor/user alternating. */
  history: WorkbenchBlock[];
  userContent: string;
  /** Pre-formatted deterministic checker line, e.g.
   *  "checker: step 2 not_equivalent, counterexample x=2 gives 5 vs 7".
   *  Trust it over the model's own reading of the math. */
  checkerSummary?: string;
  aiSettings: AISettings;
  signal?: AbortSignal;
  cb: WorkbenchTurnCallbacks;
}

/** How many transcript blocks fit in the opening/turn prompt. */
const HISTORY_BLOCK_LIMIT = 12;
/** Per-block truncation inside the history summary. */
const HISTORY_BLOCK_CHARS = 1200;

// Book plumbing lives in pageLookup.ts (loadBookSource — audit §1.2: the
// move kills the circular import a lookup-from-session would create).

function currentReaderPage(bookKey: string, override?: number): number {
  if (override && override > 0) return override;
  try {
    return (getBookProgress(bookKey)?.index ?? 0) + 1;
  } catch {
    return 1;
  }
}

async function loadLearnerSafely(bookKey: string): Promise<LearnerState | null> {
  try {
    const book: Book | null = useBookDataStore.getState().getBookData(bookKey)?.book ?? null;
    if (!book) return null;
    const appService: AppService = await environmentConfig.getAppService();
    return await loadLearner(appService, book);
  } catch {
    return null; // no log yet, or unreadable — optional evidence, not a blocker
  }
}

/** The reader's study profile (W2.4) — try/catch → {}, mirroring
 *  loadLearnerSafely; an empty profile means the default professor. */
async function loadProfileSafely(): Promise<LearnerProfile> {
  try {
    return await loadProfileCurrent();
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly (pure — testable shapes kept small and local)
// ---------------------------------------------------------------------------

/** Pages the professor has consulted so far this sitting, ascending,
 *  deduped — from the persisted lookedUp metadata on professor blocks. */
export function collectLookedUpPages(history: WorkbenchBlock[]): number[] {
  const pages = new Set<number>();
  for (const b of history) {
    if (b.author !== 'professor' || !b.lookedUp) continue;
    for (const p of b.lookedUp) {
      if (Number.isInteger(p) && p >= 1) pages.add(p);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function summarizeHistory(blocks: WorkbenchBlock[]): string {
  return blocks
    .slice(-HISTORY_BLOCK_LIMIT)
    .map((b) => {
      const who = b.author === 'professor' ? 'Professor' : 'Student';
      const body =
        b.content.length > HISTORY_BLOCK_CHARS
          ? `${b.content.slice(0, HISTORY_BLOCK_CHARS)} …[trimmed]`
          : b.content;
      return `${who}: ${body}`;
    })
    .join('\n\n');
}

function summarizeLearner(state: LearnerState | null): string {
  if (!state) return '';
  const entries = Object.entries(state.concept_states)
    .sort((a, b) => b[1].asked - a[1].asked)
    .slice(0, 10);
  if (entries.length === 0) return '';
  const lines = entries.map(
    ([name, s]) => `${name.replace(/_/g, ' ')}: asked ${s.asked}x, Bloom level ${s.bloom}/6`,
  );
  return `Learner concept states (their study log across this book):\n${lines.join('\n')}`;
}

/** T3 — the rolling "where we are": the professor's own last answer, capped
 *  at 600 chars so it varies per turn without bloating the pack. */
function summarizeWhereWeAre(blocks: WorkbenchBlock[]): string {
  const last = [...blocks].reverse().find((b) => b.author === 'professor');
  if (!last) return '';
  const text =
    last.content.length > 600 ? `${last.content.slice(0, 600)} …[trimmed]` : last.content;
  return `Where we are — your last answer to this student (trimmed to 600 chars):\n${text}`;
}

/** Local/ollama mode: the assembled pack must fit LOCAL_PACK_MAX_CHARS. */
const isLocalMode = (aiSettings: AISettings): boolean => aiSettings.provider === 'ollama';

/**
 * The book-derived tiers (T0/T1/T2/T4) plus the citation whitelist, in a
 * fixed order. This block is byte-stable across turns while the reader
 * stays on the same page — the cache-friendly shared prefix. The whitelist
 * line carries the exact phrase the workbench addendum cites.
 *
 * `consultedPages` — pages fetched by the [LOOK] lookup tier whose text
 * rides in this turn's prompt (lookup.pages, never lookup.missing — the
 * honesty guard: nothing wears the whitelist the prompt does not carry).
 */
function packTierSections(
  pack: ProfessorContextPack,
  page: number,
  consultedPages: number[] = [],
): string[] {
  const parts: string[] = [];
  if (pack.wholeBook && pack.whole_book_text) {
    parts.push(
      "The book's full text layer, with [Page N] markers — your grounding source. " +
        'Cite page anchors whenever you quote or paraphrase it:\n"""\n' +
        pack.whole_book_text +
        '\n"""',
    );
  } else {
    if (pack.excerpt) {
      parts.push(
        `Text of the page the student is looking at (page ${page}):\n"""\n${pack.excerpt}\n"""`,
      );
    }
    if (pack.chapter_window?.text) {
      parts.push(
        `The chapter "${pack.chapter_window.label}" the student is reading around that page ` +
          '(context — cite only pages in the whitelist below):\n"""\n' +
          pack.chapter_window.text +
          '\n"""',
      );
    }
    const conceptPages = pack.concept_pages ?? {};
    const pages = Object.keys(conceptPages)
      .map(Number)
      .sort((a, b) => a - b);
    if (pages.length > 0) {
      const blocks = pages.map((p) => `[Page ${p}]\n${conceptPages[p]}`);
      parts.push(
        'Pages the student has struggled with (their study log follows them — ' +
          're-read before answering about these):\n' +
          blocks.join('\n\n'),
      );
    }
  }
  if (pack.pages_included && pack.pages_included.length + consultedPages.length > 0) {
    parts.push(
      `Pages in your context: ${[...new Set([...consultedPages, ...(pack.pages_included ?? [])])]
        .sort((a, b) => a - b)
        .join(', ')}`,
    );
  }
  return parts;
}

/** The [LOOK] lookup tier — ephemeral page text injected after the pack
 *  tiers and before the transcript summary (s2 §6.3). */
function lookupTierSections(lookup?: PageLookupResult): string[] {
  if (!lookup?.results.length) return [];
  const blocks = lookup.results.map((r) => `[Page ${r.page}]\n${r.text}`);
  return [
    'Pages you asked to consult (fetched from the book at your request — ' +
      'ground your next answer in these and cite them with a page anchor):\n' +
      blocks.join('\n\n'),
  ];
}

/** The reader's study-profile lines (W2.4, audit R6) — pushed immediately
 *  after the summarizeLearner block; empty profile → nothing. */
function profileSummary(profile?: LearnerProfile): string {
  if (!profile) return '';
  return profileLinesForPrompt(profile).join('\n');
}

/**
 * Compose the opening user message (pure — startWorkbenchSession streams
 * exactly this).
 */
export function composeWorkbenchOpening(args: {
  pack: ProfessorContextPack;
  page: number;
  resumeBlocks: WorkbenchBlock[];
  learner: LearnerState | null;
  /** Pages fetched by the [LOOK] lookup tier (the UI passes nothing here —
   *  the professor cannot LOOK before his first block); the whitelist
   *  merge and the tier ride for symmetry with the turn composer. */
  lookup?: PageLookupResult;
  /** The reader's study profile (W2.4) — additive T3 lines, never edits
   *  the addendum or the pack. */
  profile?: LearnerProfile;
}): string {
  const { pack, page, resumeBlocks, learner, lookup, profile } = args;
  const parts: string[] = [];
  parts.push(
    `Open a workbench session for this book. The student is reading page ${page}. ` +
      'This begins a transcript: every turn is a workbench block, yours signed Professor.',
  );
  parts.push(...packTierSections(pack, page, lookup?.pages ?? []));
  parts.push(...lookupTierSections(lookup));
  const history = summarizeHistory(resumeBlocks);
  if (history) {
    parts.push(`The recent professor–student exchange in this workbench:\n${history}`);
  }
  const learnerSummary = summarizeLearner(learner);
  if (learnerSummary) parts.push(learnerSummary);
  const profileLines = profileSummary(profile);
  if (profileLines) parts.push(profileLines);
  parts.push(
    'Greet the student in character — one short paragraph, warm and exact. Set the stage from the book: ' +
      'what the student has been asking about (the concept history above, when present). Then teach the first idea ' +
      'with provenance — WHAT IT IS from the book (cite the page), WHERE IT CAME FROM as a story, WHY IT MATTERS — ' +
      'and close by asking ONE first question about it: not trivial, not huge. Do not answer your own question. ' +
      'Follow the workbench output contract: math in $$ blocks, protocol tags only at the very end on their own lines.',
  );
  return parts.join('\n\n');
}

/**
 * Compose one turn's user message (pure — sendWorkbenchTurn streams exactly
 * this). CRITICAL (context architecture Finding B): the tiered pack rides
 * in EVERY turn, so the professor stays grounded on turns 2+ instead of
 * answering from a 12-block history summary alone. Book tiers come first in
 * a fixed byte-stable order; the turn-varying T3 material (transcript,
 * where-we-are, checker, the student's words) rides last.
 */
export function composeWorkbenchTurnMessage(args: {
  pack: ProfessorContextPack | null;
  page: number | null;
  history: WorkbenchBlock[];
  userContent: string;
  checkerSummary?: string;
  learner?: LearnerState | null;
  /** Pages fetched by the [LOOK] lookup tier this turn — the ephemeral
   *  text rides after the pack tiers; lookup.pages (never lookup.missing)
   *  merges into the citation whitelist (honesty guard, s2 §6.4). */
  lookup?: PageLookupResult;
  /** The reader's study profile (W2.4) — additive T3 lines, never edits
   *  the addendum or the pack. */
  profile?: LearnerProfile;
}): string {
  const {
    pack,
    page,
    history,
    userContent,
    checkerSummary,
    learner = null,
    lookup,
    profile,
  } = args;
  const parts: string[] = [];
  if (pack && page !== null) {
    parts.push(...packTierSections(pack, page, lookup?.pages ?? []));
  } else {
    parts.push(
      "(The book's text layer is not available this turn — answer from the transcript alone, " +
        'and say "I will look" when a claim needs the book.)',
    );
  }
  parts.push(...lookupTierSections(lookup));
  const transcript = summarizeHistory(history);
  if (transcript) {
    parts.push(`The workbench transcript so far (Professor and Student alternate):\n${transcript}`);
  }
  const whereWeAre = summarizeWhereWeAre(history);
  if (whereWeAre) parts.push(whereWeAre);
  const learnerSummary = summarizeLearner(learner);
  if (learnerSummary) parts.push(learnerSummary);
  const profileLines = profileSummary(profile);
  if (profileLines) parts.push(profileLines);
  if (checkerSummary) {
    parts.push(
      `Deterministic checker result for the student's latest work (trust this over your own reading): ${checkerSummary}`,
    );
  }
  parts.push(`The student now says: ${userContent}`);
  parts.push(
    'Respond in character per the workbench contract: teach with provenance (WHAT from the book with a page anchor, ' +
      'WHERE IT CAME FROM as a story, WHY IT MATTERS), never reveal an answer before a genuine attempt — ' +
      'climb the disclosure ladder one rung per exchange — math in $$ blocks, protocol tags only at the very end ' +
      'on their own lines.',
  );
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Provider streaming — the minimal tutor.ts pattern, reimplemented here so
// this seam stays self-contained (tutor.ts is owned by another lane).
// ---------------------------------------------------------------------------

async function streamWorkbenchTurn(
  aiSettings: AISettings,
  userContent: string,
  signal: AbortSignal | undefined,
  cb: WorkbenchTurnCallbacks,
): Promise<void> {
  let model;
  try {
    model = getAIProvider(aiSettings).getModel();
  } catch (e) {
    // Debug text only — the UI renders fixed copy for 'no-provider'.
    cb.onError(
      `Workbench provider is not configured: ${e instanceof Error ? e.message : String(e)}`,
      'no-provider',
    );
    return;
  }

  const timeout = AbortSignal.timeout(45_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const result = streamText({
      model,
      system: PROFESSOR_WORKBENCH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      abortSignal: combined,
    });
    let full = '';
    for await (const chunk of result.textStream) {
      full += chunk;
      cb.onToken(chunk);
    }
    cb.onDone(full);
  } catch (e) {
    if (signal?.aborted) return; // caller tore the session down mid-answer
    const timedOut = timeout.aborted && !signal?.aborted;
    // Debug text only — the UI renders fixed copy per kind; the raw
    // provider error never reaches the reader.
    cb.onError(
      timedOut
        ? 'The model handshake timed out after 45s.'
        : e instanceof Error
          ? e.message
          : String(e),
      timedOut ? 'timeout' : 'unknown',
    );
  }
}

const notEnabled = (cb: WorkbenchTurnCallbacks): void =>
  cb.onError('No AI provider configured for the workbench session.', 'no-provider');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open a workbench session for the book: the tiered pack (T0 page, T1
 * chapter window, T2 concept-struggle pages, T4 whole book when the book
 * is small), recent-exchange + learner-state summaries, and the
 * instruction to greet in character, set the stage from the book, and ask
 * ONE first question. Streams the professor's opening block.
 */
export async function startWorkbenchSession(opts: StartWorkbenchSessionOptions): Promise<void> {
  const { bookKey, resumeBlocks = [], aiSettings, signal, cb, currentPage } = opts;
  if (!aiSettings?.enabled) {
    notEnabled(cb);
    return;
  }
  const source = await loadBookSource(bookKey);
  if (!source) {
    cb.onError(
      "The book's text layer is not available yet — try again in a moment (or open the book once so its text layer is prepared).",
      'text-layer',
    );
    return;
  }
  const page = currentReaderPage(bookKey, currentPage);
  const learner = await loadLearnerSafely(bookKey);
  const profile = await loadProfileSafely();
  const pack = buildTieredPack({
    ...source,
    page,
    conceptStates: learner?.concept_states ?? {},
    learnerExchanges: learner?.exchanges ?? [],
    localMode: isLocalMode(aiSettings),
  });
  await streamWorkbenchTurn(
    aiSettings,
    composeWorkbenchOpening({ pack, page, resumeBlocks, learner, profile }),
    signal,
    cb,
  );
}

/**
 * One turn of the transcript: the REBUILT tiered pack (context architecture
 * Finding B — the pack rides in EVERY turn, not just the opening one; the
 * professor keeps the book and the current page whitelist on turns 2+),
 * the alternating history, an optional deterministic checker summary line,
 * and the student's message, answered in character per the ladder.
 */
export async function sendWorkbenchTurn(opts: SendWorkbenchTurnOptions): Promise<void> {
  const { bookKey, history, userContent, checkerSummary, aiSettings, signal, cb } = opts;
  if (!aiSettings?.enabled) {
    notEnabled(cb);
    return;
  }
  const source = await loadBookSource(bookKey);
  let pack: ProfessorContextPack | null = null;
  let page: number | null = null;
  let learner: LearnerState | null = null;
  if (source) {
    // Rebuilt every turn: the reader may have turned the page, and the
    // tier contents follow the learner log. Tier order stays byte-stable
    // for prompt caching — only the T3 tail varies.
    page = currentReaderPage(bookKey);
    learner = await loadLearnerSafely(bookKey);
    pack = buildTieredPack({
      ...source,
      page,
      conceptStates: learner?.concept_states ?? {},
      learnerExchanges: learner?.exchanges ?? [],
      localMode: isLocalMode(aiSettings),
    });
  }
  // The [LOOK] lookup tier: pages the professor asked the desk to consult
  // (persisted on the transcript blocks) are re-fetched from the manifest
  // every turn — a quiet no-op when the text layer is away or nothing was
  // consulted. lookup.pages (never lookup.missing) merges into the
  // whitelist inside compose — the honesty guard (s2 §6).
  const lookup = await lookupBookPages(bookKey, collectLookedUpPages(history));
  const profile = await loadProfileSafely();
  await streamWorkbenchTurn(
    aiSettings,
    composeWorkbenchTurnMessage({
      pack,
      page,
      history,
      userContent,
      checkerSummary,
      learner,
      lookup: lookup ?? undefined,
      profile,
    }),
    signal,
    cb,
  );
}
