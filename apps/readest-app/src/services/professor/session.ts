/**
 * Chapter session (research-openmaic-2026.md ports #3–#5): the book's
 * chapter is the course, the Prof is the tutor.
 *
 * The loop:
 *   1. GENERATE OBJECTIVES — the Prof drafts 3–5 learning objectives from
 *      the current chapter's text layer (one generateText call through the
 *      existing AI provider plumbing — the same seam tutor.ts uses).
 *   2. START SESSION — one objective at a time, each asked as ONE spoken
 *      quiz question through the existing askProfessorFromUI voice loop.
 *      The question's prompt carries the verdict contract: the Prof grades
 *      the learner's answer and ends with [PASS] or [RETRY] plus a
 *      [CAPTION:…] one-line takeaway. Verdicts are parsed in
 *      annotations.ts and ride the annotation bus back to the Study tab —
 *      no new channel, no new agents.
 *   3. SESSION END (OpenMAIC closing/synthesis + reflection card) — a
 *      session report (objectives with pass/retry marks and takeaways) is
 *      appended to notes.md, and a summary exchange is folded into
 *      learner.json via the existing appendExchange path.
 *
 * Everything except generateChapterObjectives is pure so the pedagogy
 * contract is testable without a model, a book, or a filesystem.
 */
import { generateText } from 'ai';
import type { AISettings } from '@/services/ai/types';
import { getAIProvider } from '@/services/ai/providers';
import type { HpubManifest } from '@/services/narration';
import type { TOCItem } from '@/libs/document';
import type { ProfessorAnnotation } from './annotations';

export interface SessionObjective {
  text: string;
  status: 'pending' | 'pass' | 'retry';
  takeaway?: string;
}

export interface ChapterSlice {
  /** Chapter title from the TOC, or "page N" when the TOC can't place it. */
  label: string;
  text: string;
}

export const MAX_OBJECTIVES = 5;
/** Chapters can be huge; the objectives prompt needs the gist, not the tome. */
export const MAX_CHAPTER_CHARS = 12000;

/** Flatten a TOC (depth-first) to the items that carry a page index. */
const flattenToc = (toc: TOCItem[]): TOCItem[] => {
  const out: TOCItem[] = [];
  const walk = (items: TOCItem[]) => {
    for (const item of items) {
      out.push(item);
      if (item.subitems?.length) walk(item.subitems);
    }
  };
  walk(toc);
  return out;
};

const pageSpan = (
  manifest: HpubManifest,
  page: number,
): [number, number] | null => {
  const entry = manifest.alignment.find((a) => a.page === page);
  return entry && entry.md_char_start !== null && entry.md_char_end !== null
    ? [entry.md_char_start, entry.md_char_end]
    : null;
};

/**
 * Slice the current chapter out of content.md. Chapter bounds come from the
 * TOC: for PDF books every TOC item carries a 0-based page index (foliate's
 * pdf.js makeTOCItem), so the current chapter spans from the last item at or
 * before the reader's page to the next one. Pages are mapped to md character
 * spans through the manifest; unanchored pages contribute nothing. When the
 * TOC can't place the reader (no outline, front matter), fall back to the
 * current page's excerpt — a one-page session beats no session.
 */
export function getChapterText(args: {
  md: string;
  manifest: HpubManifest;
  toc: TOCItem[];
  /** 1-based page the reader is on. */
  page: number;
  maxChars?: number;
}): ChapterSlice {
  const { md, manifest, toc, page, maxChars = MAX_CHAPTER_CHARS } = args;
  const items = flattenToc(toc)
    .filter((i) => Number.isFinite(i.index))
    .sort((a, b) => a.index - b.index);
  const current = [...items].reverse().find((i) => i.index <= page - 1);

  let startPage = page;
  let endPageExclusive = page + 1;
  let label = `page ${page}`;
  if (current) {
    startPage = current.index + 1;
    const next = items.find((i) => i.index > current.index);
    endPageExclusive = next ? next.index + 1 : manifest.page_count + 1;
    label = current.label.trim() || label;
  }

  const spans: Array<[number, number]> = [];
  for (let p = startPage; p < endPageExclusive; p++) {
    const span = pageSpan(manifest, p);
    if (span) spans.push(span);
  }
  // No anchored pages in the window (a diagram-only chapter): fall back to
  // the reader's own page so the prompt still has real text under it.
  if (spans.length === 0) {
    const span = pageSpan(manifest, page);
    if (span) spans.push(span);
  }
  const text =
    spans.length === 0
      ? ''
      : md
          .slice(
            Math.min(...spans.map((s) => s[0])),
            Math.max(...spans.map((s) => s[1])),
          )
          .trim()
          .slice(0, maxChars);
  return { label, text };
}

/**
 * Parse the Prof's objectives reply: one objective per line, numbered or
 * bulleted. Anything that isn't a list line is dropped; the list is clamped
 * to MAX_OBJECTIVES (parse failure is the caller's signal, not a crash).
 */
export function parseObjectivesResponse(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/.exec(line)?.[1]?.trim() ?? '')
    .filter((line) => line.length >= 8)
    .slice(0, MAX_OBJECTIVES);
}

const OBJECTIVES_SYSTEM = `You are the Professor inside Palimpsest, drafting a study plan from one chapter of a book the reader is working through.

Write 3 to 5 learning objectives for the chapter excerpt below. Each objective is one plain sentence stating something the reader should be able to DO after studying the chapter — explain, state, prove, apply, compare, compute — never vague verbs like "understand" or "learn". Stay strictly inside what the excerpt actually covers; never invent topics the chapter does not treat. Aim at the load-bearing ideas, in the order the chapter builds them.

Output ONLY the objectives, one per line, numbered "1." "2." "3." — no title, no preamble, no commentary.`;

/**
 * Draft 3–5 learning objectives for the chapter via the configured AI
 * provider. Returns null when AI is disabled, unconfigured, or the reply
 * can't be parsed into at least two objectives — a missing plan beats a
 * fake one.
 */
export async function generateChapterObjectives(args: {
  chapter: ChapterSlice;
  aiSettings?: AISettings | null;
  signal?: AbortSignal;
}): Promise<string[] | null> {
  const { chapter, aiSettings, signal } = args;
  if (!aiSettings?.enabled || !chapter.text) return null;
  let model;
  try {
    model = getAIProvider(aiSettings).getModel();
  } catch {
    return null;
  }
  try {
    const { text } = await generateText({
      model,
      system: OBJECTIVES_SYSTEM,
      prompt: `Chapter: ${chapter.label}\n\n"""\n${chapter.text}\n"""`,
      abortSignal: signal,
    });
    const objectives = parseObjectivesResponse(text);
    // Deliberate graceful degradation (review 2026-09-10): the contract is
    // 3-5 objectives, but a chapter that honestly yields 2 good ones is
    // still a session worth running — 1 is not.
    return objectives.length >= 2 ? objectives : null;
  } catch {
    return null;
  }
}

/**
 * The question that opens one objective's round, sent through the normal
 * askProfessorFromUI voice loop. The verdict contract (research port #5)
 * lives here: the Prof grades the learner's spoken answer and closes with
 * [PASS] or [RETRY] on its own line plus a [CAPTION:…] takeaway — both are
 * annotation-DSL tags, so they are stripped from speech and parsed back to
 * the Study tab through the annotation bus.
 */
export function buildSessionQuestion(
  objective: string,
  index: number,
  total: number,
  chapterLabel: string,
): string {
  return (
    `Chapter session on "${chapterLabel}" — objective ${index} of ${total}: "${objective}". ` +
    'Quiz me on exactly this objective. Ask me ONE question about it and stop there — ' +
    'do not answer it yourself, do not ask a second question. ' +
    'When I answer, grade the answer briefly and specifically: what was right, what was missing. ' +
    'End your grading with a verdict tag on its own line: [PASS] if I got the load-bearing idea ' +
    'in my own words, [RETRY] if something load-bearing was missing or wrong. ' +
    'Then add one line [CAPTION:the one-line takeaway for my study notes]. ' +
    'Ask the question now.'
  );
}

export interface SessionOutcome {
  verdict: 'pass' | 'retry';
  takeaway?: string;
}

/**
 * Read one objective's result off a completed annotation set: the LAST
 * verdict tag wins (a model that grades twice settles on its final word),
 * and the last caption is the takeaway. Returns null when the answer
 * carried no verdict — the session simply keeps waiting.
 */
export function extractSessionOutcome(annotations: ProfessorAnnotation[]): SessionOutcome | null {
  const verdicts = annotations.filter(
    (a): a is Extract<ProfessorAnnotation, { kind: 'verdict' }> => a.kind === 'verdict',
  );
  const last = verdicts[verdicts.length - 1];
  if (!last) return null;
  const captions = annotations.filter(
    (a): a is Extract<ProfessorAnnotation, { kind: 'caption' }> => a.kind === 'caption',
  );
  const takeaway = captions[captions.length - 1]?.text;
  return { verdict: last.verdict, ...(takeaway ? { takeaway } : {}) };
}

/**
 * The closing reflection card (research port #3), filed into notes.md at
 * session end: every objective with its stamp and one-line takeaway;
 * objectives never reached are marked as such rather than silently dropped.
 */
export function buildSessionReportMd(args: {
  chapterLabel: string;
  objectives: SessionObjective[];
  /** Pre-formatted short date, e.g. "Sep 11". */
  date: string;
  page: number;
}): string {
  const { chapterLabel, objectives, date, page } = args;
  const lines = objectives.map((o, i) => {
    const stamp =
      o.status === 'pass' ? 'PASS' : o.status === 'retry' ? 'RETRY' : 'not reached';
    const takeaway = o.takeaway ? ` — ${o.takeaway}` : '';
    return `${i + 1}. **${stamp}** — ${o.text}${takeaway}`;
  });
  const passed = objectives.filter((o) => o.status === 'pass').length;
  return [
    `### chapter session — ${chapterLabel} (p.${page}, ${date})`,
    '',
    ...lines,
    '',
    `_${passed}/${objectives.length} objectives stamped pass._`,
  ].join('\n');
}
