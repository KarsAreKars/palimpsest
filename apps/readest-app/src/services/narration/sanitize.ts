/**
 * Narration pipeline step ① — SANITIZE.
 *
 * Fixes known Marker extraction artifacts and strips clutter that would
 * pollute the spoken script. Operates per text unit (sentence/heading):
 * the caller (script.ts) tracks original content.md offsets, so this layer
 * is free to rewrite text for speech without bookkeeping.
 *
 * Known Marker flaws handled here (phase-0 bake-off evidence):
 *   - inline math degrading to <sup>/<sub> tags  → rewrapped as $…$ so the
 *     verbalizer speaks it as math instead of TTS reading raw tag soup
 *   - private-font symbol swaps: ¥ / ■ for the QED mark ∎ (dropped — an
 *     audiobook listener gains nothing from a spoken QED glyph)
 *   - citation clutter lines ([12] [13] …), figure/table reference captions
 *
 * Also normalizes typography for TTS rhythm: punctuation is the prosody API.
 */

/** Abbreviations expanded before sentence splitting and synthesis. */
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bw\.l\.o\.g\.\s*/gi, 'without loss of generality '],
  [/\bw\.r\.t\.\s*/gi, 'with respect to '],
  [/\be\.g\.\s*/gi, 'for example '],
  [/\bi\.e\.\s*/gi, 'that is '],
  [/\bcf\.\s*/gi, 'compare '],
  [/\betc\.\s*/gi, 'and so on '],
  [/\biff\b\s*/gi, 'if and only if '],
  [/\bresp\.\s*/gi, 'respectively '],
  [/\bFig(?:ure)?\.\s*/g, 'Figure '],
  [/\bEq\.\s*/g, 'Equation '],
  [/\bThm\.\s*/g, 'Theorem '],
  [/\bLem\.\s*/g, 'Lemma '],
  [/\bProp\.\s*/g, 'Proposition '],
  [/\bCor\.\s*/g, 'Corollary '],
  [/\bDef\.\s*/g, 'Definition '],
  [/\bEx\.\s*/g, 'Exercise '],
  [/\bSec\.\s*/g, 'Section '],
  [/\bvs\.\s*/gi, 'versus '],
];

/**
 * Marker emits private-font inline math as tag soup like
 * `<sup>p</sup>∈AssA(M)` (sub/sup runs). Rewrap contiguous sub/sup-tagged
 * runs (plus their immediate symbol neighbors) as inline math so the
 * verbalizer gets a shot at them.
 */
const rewrapSubSupMath = (text: string): string => {
  // <sup>x</sup> / <sub>x</sub> runs, optionally chained: unwrap tags and
  // wrap the run in $…$. Chained runs like <sup>a</sup><sub>b</sub> collapse
  // into a single math span.
  return text.replace(
    /(?:<\/?(?:sup|sub)>[^$<]*?)+(?:<\/(?:sup|sub)>)/g,
    (match) => `$${match.replace(/<\/?(?:sup|sub)>/g, '')}$`,
  );
};

/** Drop QED glyph swaps (¥, ■, ∎) — visual punctuation, not speech. */
const dropQedGlyphs = (text: string): string => text.replace(/[¥■∎]/g, '');

/** Normalize dashes and ellipses for TTS pacing. */
const normalizeTypography = (text: string): string =>
  text
    .replace(/---/g, '—')
    .replace(/--/g, '—')
    .replace(/\.\.\./g, '…')
    .replace(/\s+—\s+/g, ' — ');

/** Strip leftover HTML comments and stray empty emphasis markers. */
const stripResidualMarkup = (text: string): string =>
  text.replace(/<!--[\s\S]*?-->/g, '').replace(/(\*\*|__)(?=\s|$)/g, '');

/** True when a block is pure citation clutter: "[12] [13] p. 44" etc.,
 *  or a bibliography entry: "[12] Atiyah, MacDonald (1969) pp. 44". */
export const isCitationClutter = (text: string): boolean => {
  const trimmed = text.trim();
  if (!/\[\d+\]/.test(trimmed)) return false;
  const stripped = trimmed.replace(/(\[\d+(?:[-–,]\s*\d+)*\]|\b\d{4}\b|pp?\.?\s*\d+|,|;|\s)/g, '');
  if (stripped.length === 0) return true;
  // Bibliography entry shape: starts with [n] and carries a year or page ref.
  return /^\[\d+\]/.test(trimmed) && /(\b(19|20)\d{2}\b|pp?\.\s*\d+|\bvol\b\.?)/i.test(trimmed);
};

/** True for TOC lines: dotted leaders ending in a page number. */
export const isTocClutter = (text: string): boolean => /\.{4,}\s*\d+\s*$/.test(text.trim());

/**
 * Sanitize one prose unit for speech. Returns '' when nothing should be
 * spoken (pure clutter). Never throws — a failed import is decided at the
 * extraction gate, not here.
 */
export const sanitizeProse = (text: string): string => {
  let out = text;
  out = stripResidualMarkup(out);
  out = rewrapSubSupMath(out);
  out = dropQedGlyphs(out);
  out = normalizeTypography(out);
  for (const [pattern, replacement] of ABBREVIATIONS) {
    out = out.replace(pattern, replacement);
  }
  // Collapse whitespace runs introduced by removals.
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  return out;
};

/** Sanitize a heading: same prose fixes, minus abbreviation-driven pacing. */
export const sanitizeHeading = (text: string): string => {
  const out = sanitizeProse(text);
  // Headings speak as announcements; guarantee terminal punctuation so the
  // TTS engine inserts a pause before the following paragraph.
  return out && !/[.!?…:]$/.test(out) ? `${out}.` : out;
};
