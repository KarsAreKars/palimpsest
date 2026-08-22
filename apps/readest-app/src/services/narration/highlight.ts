/**
 * Follow-along highlight: map the currently-spoken narration unit to spans
 * in the PDF.js text layer and mark them.
 *
 * The pure core (findSpanRange) is unit-tested; the DOM applier
 * (applyUnitHighlight / clearUnitHighlight) runs in the section document.
 *
 * Matching is normalized-substring: PDF text-layer spans and the unit's
 * original MD text both reduce to lowercase alphanumeric streams, then the
 * unit text is located inside the concatenated span stream and mapped back
 * to a span range. Math-heavy sentences won't fully match (their PDF glyphs
 * are private-font) — a partial prefix match still highlights the prose run.
 */

export interface SpanRange {
  start: number; // index of first span
  end: number; // index of last span, inclusive
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Locate `target` (a unit's original MD text) within the page's span texts.
 * Returns the inclusive span range covering the match, or null.
 */
export const findSpanRange = (spanTexts: string[], target: string): SpanRange | null => {
  const needle = norm(target);
  if (needle.length < 3) return null;

  // Build the concatenated normalized stream with per-span boundaries.
  const boundaries: number[] = []; // stream offset where span i starts
  let stream = '';
  for (const t of spanTexts) {
    boundaries.push(stream.length);
    stream += norm(t);
  }
  const total = stream.length;
  if (total === 0) return null;

  // Try full match, then progressively shorter prefixes (min 12 chars) so
  // trailing math/markup differences don't kill the highlight.
  let hit = stream.indexOf(needle);
  let matchedLen = needle.length;
  if (hit === -1) {
    for (let len = needle.length - 1; len >= 12; len--) {
      hit = stream.indexOf(needle.slice(0, len));
      if (hit !== -1) {
        matchedLen = len;
        break;
      }
    }
  }
  if (hit === -1) return null;

  const matchEnd = hit + matchedLen;
  let start = -1;
  let end = -1;
  for (let i = 0; i < spanTexts.length; i++) {
    const spanStart = boundaries[i]!;
    const spanEnd = i + 1 < spanTexts.length ? boundaries[i + 1]! : total;
    if (start === -1 && spanEnd > hit) start = i;
    if (spanStart < matchEnd) end = i;
    if (spanStart >= matchEnd) break;
  }
  return start === -1 || end === -1 ? null : { start, end };
};

export const HIGHLIGHT_CLASS = 'palimpsest-speaking';

const STYLE_ID = 'palimpsest-narration-style';

const ensureStyle = (doc: Document): void => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.${HIGHLIGHT_CLASS} { background: rgba(255, 213, 79, 0.45); border-radius: 2px; }`;
  doc.head.appendChild(style);
};

export const clearUnitHighlight = (doc: Document): void => {
  doc.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
};

/**
 * Highlight the spans matching `unitText` inside the section document's
 * text layer. Returns true when something was highlighted.
 */
export const applyUnitHighlight = (doc: Document, unitText: string): boolean => {
  clearUnitHighlight(doc);
  const spans = Array.from(doc.querySelectorAll('.textLayer span')) as HTMLElement[];
  if (spans.length === 0) return false;
  const range = findSpanRange(
    spans.map((s) => s.textContent ?? ''),
    unitText,
  );
  if (!range) return false;
  ensureStyle(doc);
  for (let i = range.start; i <= range.end; i++) {
    spans[i]!.classList.add(HIGHLIGHT_CLASS);
  }
  return true;
};
