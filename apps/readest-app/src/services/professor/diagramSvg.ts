/**
 * diagramSvg — the figure slip's mounting policy (Workbench 2.x, s3 §6).
 *
 * The professor draws in a fenced code block labelled ```svg immediately
 * after the [DIAGRAM claim:…] tag line. Extraction runs on the PARSED
 * display string (never on the raw stream), so the two-pass scanner's
 * math-shield rules are untouched. Sanitization is a separate, stricter
 * policy than utils/sanitize.ts: a figure accepts DRAWING MARKUP ONLY —
 * no scripts, no event handlers, no styles, no links, no external or
 * fragment references. Output is safe for dangerouslySetInnerHTML (still:
 * sanitize → render, in that order, every render).
 */
import DOMPurify from 'dompurify';

/** Pull the ```svg fence out of the parsed display string. The fence never
 *  reaches the eye — only the sanitized render. No fence → svg: ''. A
 *  second fence is left in the display as prose. */
export function extractDiagramSvg(display: string): { svg: string; display: string } {
  const m = /```svg\s*\n([\s\S]*?)```/.exec(display);
  if (!m) return { svg: '', display };
  const svg = (m[1] ?? '').trim();
  const without = `${display.slice(0, m.index)}\n${display.slice(m.index + m[0].length)}`;
  const cleaned = without
    .replace(/(?<=\S) {2,}(?=\S)/g, ' ') // a removed fence may leave double spaces
    .replace(/[ \t]+\n/g, '\n') // and trailing whitespace on an emptied line
    .trim();
  return { svg, display: cleaned };
}

/** The desk's mounting policy: allowlist tags and attributes, nothing
 *  executable, nothing external. Deliberately absent: `use` (fragment /
 *  external reference vector), `a`/`href` of any spelling (nothing in a
 *  figure navigates), `style` attribute and <style> element (no CSS
 *  injection), `foreignObject` (no HTML in the figure), `id`/`class` (no
 *  shadow-DOM or stylesheet hooks — the desk restyles figures itself via
 *  .wb-figure-svg descendants). DOMPurify strips on* handlers by default.
 *  Idempotent: sanitize(sanitize(x)) === sanitize(x). */
export function sanitizeDiagramSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    ALLOWED_TAGS: [
      'svg',
      'g',
      'path',
      'rect',
      'circle',
      'ellipse',
      'line',
      'polyline',
      'polygon',
      'text',
      'tspan',
      'defs',
      'marker',
      'title',
      'desc',
      'clipPath',
      'linearGradient',
      'radialGradient',
      'stop',
    ],
    ALLOWED_ATTR: [
      'xmlns',
      'viewBox',
      'width',
      'height',
      'x',
      'y',
      'x1',
      'x2',
      'y1',
      'y2',
      'cx',
      'cy',
      'r',
      'rx',
      'ry',
      'd',
      'points',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'stroke-dasharray',
      'opacity',
      'fill-opacity',
      'stroke-opacity',
      'transform',
      'text-anchor',
      'font-size',
      'font-family',
      'font-style',
      'marker-start',
      'marker-end',
      'marker-mid',
      'offset',
      'stop-color',
      'stop-opacity',
      'clip-path',
    ],
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'style', 'a', 'use'],
    FORBID_ATTR: ['src', 'href', 'xlink:href', 'style', 'srcset'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
