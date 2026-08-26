/**
 * Narration pipeline step ③ — SCRIPT.
 *
 * Builds narration.jsonl: one line per spoken unit, each carrying its
 * original content.md span and page so click-to-speak, skipping, and
 * follow-along highlighting become lookups (plan §4).
 *
 *   { "unit": 1234, "md_start": 88120, "md_end": 88341,
 *     "page": 47, "kind": "prose|inline_math|display_eq|heading|skip",
 *     "speak": "…the exact string sent to the TTS engine…" }
 *
 * Offset contract: md_start/md_end always refer to the ORIGINAL
 * content.md. Sentence splitting happens on original text; sanitize +
 * verbalize run per sentence and only affect `speak`.
 */
import { sanitizeHeading, sanitizeProse, isCitationClutter, isTocClutter } from './sanitize';
import { initVerbalizer, verbalizeDisplayEquation, verbalizeInlineMath } from './verbalize';
import { applyNarrativePass } from './narrative';

export type NarrationKind = 'prose' | 'inline_math' | 'display_eq' | 'heading' | 'skip';

/**
 * Narrative-pass prosody hints (NARRATIVE_PASS_PLAN §4): player-rendered
 * pauses between units — provider-independent, rate-independent, never
 * baked into audio. Attached by applyNarrativePass (narrative.ts).
 */
export interface NarrationProsody {
  pause_before_ms?: number;
  pause_after_ms?: number;
  energy?: 'normal' | 'lowered';
}

export interface NarrationUnit {
  unit: number;
  md_start: number;
  md_end: number;
  page: number | null;
  kind: NarrationKind;
  /** Exact string sent to the TTS engine. 'skip' units normally omit it,
   *  but may carry a short announcement ("Diagram on this page.") when the
   *  page class says the listener is missing a visual (amendment A2). */
  speak?: string;
  prosody?: NarrationProsody;
}

/**
 * A positioned content block on a PDF page (HP-2). Comes from the extractor
 * (marker) via manifest.json. `bbox` is [x0, y0, x1, y1] in PDF points with
 * a TOP-LEFT origin — i.e. pdf.js viewport coordinates at scale 1 — so the
 * on-screen position is bbox × the page's current total scale factor.
 */
export interface HpubBlock {
  id: string;
  type: string;
  bbox: [number, number, number, number];
  text_head?: string;
}

export interface HpubManifest {
  format: string;
  page_count: number;
  alignment: Array<{
    page: number;
    md_char_start: number | null;
    md_char_end: number | null;
    /** Amendment A2: prose / mixed / visual, from the extraction gate. */
    page_class?: 'prose' | 'mixed' | 'visual';
    /** Positioned blocks for professor annotations (HP-2). Optional: older
     *  hpub builds may not carry them; annotation drawing degrades to
     *  text-only answers when absent. */
    blocks?: HpubBlock[];
  }>;
}

/** Look up the positioned blocks for a 1-based page (empty when unknown). */
export const getPageBlocks = (manifest: HpubManifest, page: number): HpubBlock[] =>
  manifest.alignment.find((a) => a.page === page)?.blocks ?? [];

// ─── block segmentation ─────────────────────────────────────────────────────

type BlockKind = 'heading' | 'display_math' | 'image' | 'table' | 'prose';

interface MdBlock {
  kind: BlockKind;
  level?: number;
  start: number;
  end: number;
  text: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const IMAGE_RE = /^!\[[^\]]*\]\([^)]*\)\s*$/;
const TABLE_LINE_RE = /^\|.*\|?\s*$/;

/**
 * Split content.md into blocks, tracking original char offsets. Display
 * math ($$…$$) may span multiple lines; everything else is line-driven.
 */
export const segmentMarkdown = (md: string): MdBlock[] => {
  const blocks: MdBlock[] = [];
  const push = (kind: BlockKind, start: number, end: number, level?: number) => {
    const text = md.slice(start, end);
    if (text.trim().length === 0) return;
    blocks.push({ kind, start, end, level, text });
  };

  let pos = 0;
  let proseStart = -1;
  const flushProse = (upto: number) => {
    if (proseStart >= 0) {
      push('prose', proseStart, upto);
      proseStart = -1;
    }
  };

  while (pos < md.length) {
    const lineEnd = md.indexOf('\n', pos);
    const end = lineEnd === -1 ? md.length : lineEnd;
    const line = md.slice(pos, end);
    const trimmed = line.trim();

    const heading = HEADING_RE.exec(trimmed);
    const isDisplayMathOpen =
      trimmed === '$$' ||
      (trimmed.startsWith('$$') &&
        trimmed.endsWith('$$') &&
        trimmed.length > 3 &&
        trimmed !== '$$');
    const isImage = IMAGE_RE.test(trimmed);
    const isTable = TABLE_LINE_RE.test(trimmed) && trimmed.includes('|');

    if (heading) {
      flushProse(pos);
      push('heading', pos, end, heading[1]!.length);
    } else if (trimmed === '$$') {
      // Multiline display equation: consume through the closing $$.
      flushProse(pos);
      let close = md.indexOf('$$', end + 1);
      if (close === -1) close = md.length;
      const blockEnd = close + 2;
      push('display_math', pos, Math.min(blockEnd, md.length));
      pos = blockEnd;
      continue;
    } else if (isDisplayMathOpen) {
      flushProse(pos);
      push('display_math', pos, end);
    } else if (isImage) {
      flushProse(pos);
      push('image', pos, end);
    } else if (isTable) {
      flushProse(pos);
      push('table', pos, end);
    } else if (trimmed.length === 0) {
      flushProse(pos);
    } else {
      if (proseStart === -1) proseStart = pos;
    }
    pos = end + 1;
  }
  flushProse(md.length);
  return blocks;
};

// ─── sentence splitting (math-aware, abbreviation-protected) ────────────────

/** Dotted tokens that must not end a sentence when followed by a space. */
const NO_SPLIT_AFTER = new Set([
  'e.g',
  'i.e',
  'cf',
  'etc',
  'vs',
  'resp',
  'approx',
  'fig',
  'eq',
  'thm',
  'lem',
  'prop',
  'cor',
  'def',
  'ex',
  'sec',
  'no',
  'nos',
  'pp',
  'vol',
  'ch',
  'dr',
  'mr',
  'mrs',
  'ms',
  'st',
  'al',
  'ed',
  'eds',
  'a.m',
  'p.m',
  'u.s',
  'u.k',
]);

interface SentenceSpan {
  start: number;
  end: number;
  text: string;
}

/**
 * Split a prose block into sentences on ORIGINAL text (offsets preserved).
 * Never splits inside $…$ inline math, inside bracketed citations, or after
 * protected abbreviations / single uppercase initials ("A. Grothendieck").
 */
export const splitSentences = (text: string, blockStart: number): SentenceSpan[] => {
  const spans: SentenceSpan[] = [];
  let sentenceStart = 0;
  let i = 0;
  let inMath = false;
  let bracketDepth = 0;

  const pushSentence = (end: number) => {
    const raw = text.slice(sentenceStart, end);
    const s = sentenceStart + (raw.length - raw.trimStart().length);
    const e = end - (raw.length - raw.trimEnd().length);
    if (s < e) {
      spans.push({ start: blockStart + s, end: blockStart + e, text: text.slice(s, e) });
    }
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '$') {
      inMath = !inMath;
      i++;
      continue;
    }
    if (inMath) {
      i++;
      continue;
    }
    if (ch === '[') bracketDepth++;
    if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if ((ch === '.' || ch === '!' || ch === '?' || ch === '…') && bracketDepth === 0) {
      // Absorb closing quotes/parens: `... proved.) Next` ends after `)`.
      let j = i + 1;
      while (j < text.length && ['"', "'", ')', ']', '}', '*', '_'].includes(text[j]!)) j++;
      const next = text[j];
      const isEnd = next === undefined || next === '\n' || next === ' ';
      if (isEnd) {
        const nextWord = text.slice(j).trimStart();
        const boundary = j + (text.slice(j).match(/^\s*/)?.[0].length ?? 0);
        if (nextWord.length === 0) {
          pushSentence(text.length);
          sentenceStart = text.length;
          i = text.length;
          continue;
        }
        // Abbreviation protection: token before the dot, lowercased, dot-stripped.
        const before = text.slice(Math.max(0, i - 12), i);
        const token = (before.match(/([A-Za-z](?:\.[A-Za-z]){0,3}|[A-Za-z]+)$/)?.[1] ?? '')
          .replace(/\./g, '')
          .toLowerCase();
        const fullToken = (before.match(/([A-Za-z]+(?:\.[A-Za-z]+){0,3})\.?$/)?.[1] ?? '')
          .replace(/\.$/, '')
          .toLowerCase();
        const protectedToken =
          NO_SPLIT_AFTER.has(token) ||
          NO_SPLIT_AFTER.has(fullToken) ||
          // Decimal numbers: "3.2" — next char is a digit.
          /\d$/.test(before) ||
          // Numbered theorems/sections: "Theorem 3." followed by "2" —
          // handled by the digit rule above; dotted initials: "A. Grothendieck".
          /^[A-Z]$/.test(before.trim().slice(-1));
        const startsSentence = /^["'(\[]*[A-Z0-9$]/.test(nextWord);
        if (!protectedToken && startsSentence) {
          pushSentence(boundary);
          sentenceStart = boundary;
          i = boundary;
          continue;
        }
      }
    }
    i++;
  }
  if (sentenceStart < text.length) pushSentence(text.length);
  return spans;
};

// ─── inline markdown stripping (speak text only) ────────────────────────────

const stripInlineMarkdown = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links: keep the text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // reference links
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
    .replace(/^>\s?/gm, '') // blockquote marker
    .replace(/^[-*+]\s+/gm, '') // list bullets
    .replace(/^\d+\.\s+/gm, ''); // ordered list markers

// ─── page binding ───────────────────────────────────────────────────────────

export const buildPageMapper = (manifest: HpubManifest): ((offset: number) => number | null) => {
  const spans = manifest.alignment
    .filter((p) => p.md_char_start !== null && p.md_char_end !== null)
    .sort((a, b) => a.md_char_start! - b.md_char_start!);
  return (offset: number) => {
    let best: number | null = null;
    for (const p of spans) {
      if (p.md_char_start! <= offset) best = p.page;
      else break;
    }
    return best;
  };
};

/** Page → class lookup (amendment A2). Missing classes default to 'prose'. */
export const buildPageClassMapper = (
  manifest: HpubManifest,
): ((page: number | null) => 'prose' | 'mixed' | 'visual') => {
  const classes = new Map(
    manifest.alignment.map((p) => [p.page, p.page_class ?? ('prose' as const)]),
  );
  return (page) => (page === null ? 'prose' : (classes.get(page) ?? 'prose'));
};

// ─── script assembly ────────────────────────────────────────────────────────

export interface BuildScriptOptions {
  /** Display-equation verbosity (plan §4: user setting, not constant). */
  equationVerbosity?: 'full' | 'brief' | 'skip';
}

/**
 * Build narration units from content.md + manifest.json. Caller must await
 * initVerbalizer() once before calling (SRE engine setup).
 */
export const buildNarrationScript = async (
  md: string,
  manifest: HpubManifest,
  opts: BuildScriptOptions = {},
): Promise<NarrationUnit[]> => {
  await initVerbalizer();
  const { equationVerbosity = 'full' } = opts;
  const pageFor = buildPageMapper(manifest);
  const classFor = buildPageClassMapper(manifest);
  const units: NarrationUnit[] = [];
  let n = 0;

  const pushUnit = (start: number, end: number, kind: NarrationKind, speak?: string): void => {
    units.push({
      unit: n++,
      md_start: start,
      md_end: end,
      page: pageFor(start),
      kind,
      ...(speak ? { speak } : {}),
    });
  };

  for (const block of segmentMarkdown(md)) {
    switch (block.kind) {
      case 'heading': {
        const text = block.text.replace(/^#{1,6}\s+/, '');
        const speak = sanitizeHeading(stripInlineMarkdown(text));
        if (speak) pushUnit(block.start, block.end, 'heading', speak);
        break;
      }
      case 'display_math': {
        if (equationVerbosity === 'skip') {
          pushUnit(block.start, block.end, 'skip');
          break;
        }
        const latex = block.text.replace(/^\$\$/, '').replace(/\$\$$/, '').trim();
        const speech =
          equationVerbosity === 'brief' ? 'Equation.' : verbalizeDisplayEquation(latex);
        pushUnit(block.start, block.end, 'display_eq', speech);
        break;
      }
      case 'image':
      case 'table': {
        // Marker (especially LLM-assisted) wraps numbered display equations
        // in a one-row pipe table: `| Attention( $Q,K,V$ ) = … | (1) |`.
        // Those rows ARE math — reclassify as display_eq so the equation is
        // narrated instead of skipped (A4).
        if (block.kind === 'table') {
          const eqSpeaks: string[] = [];
          let sawRealTable = false;
          for (const line of block.text.split('\n')) {
            const row = line.trim();
            if (!row.startsWith('|')) continue;
            if (/^\|[\s\-:|]+\|$/.test(row)) continue; // separator
            const cells = row
              .split('|')
              .slice(1, -1)
              .map((c) => c.trim());
            const lastIsEqNumber =
              cells.length >= 2 && /^\(?\d{1,3}[a-z]?\)?$/.test(cells[cells.length - 1]!);
            const mathCells = cells.filter((c) => /\$[^$]+\$/.test(c));
            if (lastIsEqNumber && mathCells.length > 0) {
              const speak = verbalizeInlineMath(mathCells.join(' '));
              if (speak.trim()) eqSpeaks.push(speak);
            } else {
              sawRealTable = true;
            }
          }
          for (const speak of eqSpeaks) {
            pushUnit(block.start, block.end, 'display_eq', speak);
          }
          if (!sawRealTable) break; // pure equation block — nothing skipped
        }
        // Visual blocks: never read aloud as text. On mixed/visual pages
        // (A2 page classes) the listener is told what they're missing —
        // "diagram on this page" — instead of a silent skip. On prose pages
        // an inline figure is not worth interrupting the flow for.
        const cls = classFor(pageFor(block.start));
        const announcement =
          cls === 'prose'
            ? undefined
            : block.kind === 'image'
              ? 'Diagram on this page.'
              : 'Table on this page.';
        pushUnit(block.start, block.end, 'skip', announcement);
        break;
      }
      case 'prose': {
        if (isTocClutter(block.text) || isCitationClutter(block.text)) {
          pushUnit(block.start, block.end, 'skip');
          break;
        }
        for (const span of splitSentences(block.text, block.start)) {
          const stripped = stripInlineMarkdown(span.text);
          const sanitized = sanitizeProse(stripped);
          if (!sanitized) continue;
          if (isTocClutter(sanitized) || isCitationClutter(sanitized)) continue;
          const speak = verbalizeInlineMath(sanitized);
          const hasMath = /\$[^$]+\$/.test(sanitized);
          pushUnit(span.start, span.end, hasMath ? 'inline_math' : 'prose', speak);
        }
        break;
      }
    }
  }
  return applyNarrativePass(units);
};

export const toNarrationJsonl = (units: NarrationUnit[]): string =>
  units.map((u) => JSON.stringify(u)).join('\n') + (units.length > 0 ? '\n' : '');
