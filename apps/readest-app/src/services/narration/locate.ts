/**
 * Click-to-speak resolution (plan §5 — the signature interaction).
 *
 *   1. PDF.js text layer gives the clicked word + coordinates (caller's job).
 *   2. The manifest narrows to the page's MD span.
 *   3. Fuzzy-match the clicked word inside that span → MD offset.
 *   4. Find the narration unit containing that offset → start streaming there.
 *
 * Pure logic, no DOM — PDF.js coordinate work lives in the reader layer.
 */
import type { HpubManifest, NarrationUnit } from './index';

/** Normalization shared by matching: lowercase alphanumeric runs. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Binary-search the narration unit whose [md_start, md_end) contains offset.
 * Skip units count: a click inside a table/image span resolves to it, and
 * the player decides to advance to the next speakable unit.
 */
export const findUnitAtOffset = (units: NarrationUnit[], offset: number): NarrationUnit | null => {
  let lo = 0;
  let hi = units.length - 1;
  let best: NarrationUnit | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const u = units[mid]!;
    if (offset < u.md_start) {
      hi = mid - 1;
    } else if (offset >= u.md_end) {
      lo = mid + 1;
    } else {
      return u;
    }
  }
  // Between units (whitespace/markup): take the nearest following unit.
  return best ?? units.find((u) => u.md_start >= offset) ?? units[units.length - 1] ?? null;
};

/** All units overlapping a page's MD span, in reading order. */
export const unitsForPage = (units: NarrationUnit[], page: number): NarrationUnit[] =>
  units.filter((u) => u.page === page);

/**
 * Fuzzy-locate a clicked word inside a page's MD span. Returns the MD char
 * offset of the best match, or null when nothing plausible matches.
 *
 * Strategy: walk the span's word tokens (normalized); exact normalized match
 * wins; otherwise fall back to prefix/substring containment, then to the
 * token with the smallest edit distance within a threshold.
 */
export const locateWordInSpan = (
  md: string,
  spanStart: number,
  spanEnd: number,
  clickedWord: string,
): number | null => {
  const target = norm(clickedWord);
  if (!target) return null;

  const span = md.slice(spanStart, spanEnd);
  const tokenRe = /[a-zA-Z0-9]+/g;
  let m: RegExpExecArray | null;
  let exact: number | null = null;
  let prefix: number | null = null;
  let bestFuzzy: { offset: number; dist: number } | null = null;

  while ((m = tokenRe.exec(span)) !== null) {
    const token = norm(m[0]);
    if (!token) continue;
    const offset = spanStart + m.index;
    if (token === target) {
      exact = offset;
      break;
    }
    if (!prefix && (token.startsWith(target) || target.startsWith(token))) {
      prefix = offset;
    }
    if (!exact) {
      const d = editDistanceWithin(token, target, 2);
      if (d !== null && (bestFuzzy === null || d < bestFuzzy.dist)) {
        bestFuzzy = { offset, dist: d };
      }
    }
  }
  return exact ?? prefix ?? bestFuzzy?.offset ?? null;
};

/** Levenshtein distance with an early-exit threshold (returns null above it). */
const editDistanceWithin = (a: string, b: string, threshold: number): number | null => {
  if (Math.abs(a.length - b.length) > threshold) return null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > threshold) return null;
    prev = cur;
  }
  const d = prev[b.length]!;
  return d <= threshold ? d : null;
};

export interface ClickResolution {
  unit: NarrationUnit;
  /** MD offset of the clicked word inside the unit's span. */
  mdOffset: number;
}

/**
 * Full click → unit resolution. `clickedWord` is the PDF text-layer word.
 * Returns null when the page has no reliable span or no match.
 */
export const resolveClickToUnit = (
  md: string,
  manifest: HpubManifest,
  units: NarrationUnit[],
  page: number,
  clickedWord: string,
): ClickResolution | null => {
  const span = manifest.alignment.find((p) => p.page === page);
  if (!span || span.md_char_start === null || span.md_char_end === null) return null;
  const mdOffset = locateWordInSpan(md, span.md_char_start, span.md_char_end, clickedWord);
  if (mdOffset === null) return null;
  const unit = findUnitAtOffset(units, mdOffset);
  return unit ? { unit, mdOffset } : null;
};
