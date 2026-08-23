/**
 * Professor annotation DSL (HP-2, hey_prof_integration_plan §2).
 *
 * The professor's answer is spoken-word prose PLUS a small set of visual
 * directives that point at the page. Directives are single-line tags the
 * model emits inline; the renderer draws them on the PDF and the spoken /
 * displayed text never contains them.
 *
 *   [POINT:block:ID]            pulse a block (look here)
 *   [HIGHLIGHT:block:ID]        tint a block's box
 *   [BOX:block:ID]              outline a block
 *   [ARROW:block:A->block:B]    connect two blocks
 *   [WRITE:block:ID | latex]    write math beside a block (KaTeX)
 *   [CAPTION:text]              one-line takeaway at the foot of the page
 *   [PAGE:n]                    jump the reader to page n before annotating
 *
 * Hard rules (contract-tested):
 *  - Tags are stripped before display AND before speech. Audio must never
 *    contain DSL syntax.
 *  - Block IDs the model hallucinated are dropped silently (logged) — the
 *    answer still renders, minus that mark. Never trust, always validate
 *    against the manifest's block list for the page.
 */
import type { HpubBlock } from '@/services/narration';

export type ProfessorAnnotation =
  | { kind: 'point'; blockId: string }
  | { kind: 'highlight'; blockId: string }
  | { kind: 'box'; blockId: string }
  | { kind: 'arrow'; fromBlockId: string; toBlockId: string }
  | { kind: 'write'; anchorBlockId: string; latex: string }
  | { kind: 'caption'; text: string }
  | { kind: 'page'; page: number };

const TAG_RE = /\[(POINT|HIGHLIGHT|BOX|ARROW|WRITE|CAPTION|PAGE):([^\]\n]*)\]/g;

const BLOCK_PREFIX = 'block:';

/** Parse every DSL tag in `text` into structured annotations (unvalidated). */
export function parseAnnotations(text: string): ProfessorAnnotation[] {
  const out: ProfessorAnnotation[] = [];
  for (const match of text.matchAll(TAG_RE)) {
    const tag = match[1];
    const body = (match[2] ?? '').trim();
    switch (tag) {
      case 'POINT':
      case 'HIGHLIGHT':
      case 'BOX': {
        if (body.startsWith(BLOCK_PREFIX) && body.length > BLOCK_PREFIX.length) {
          const kind = tag.toLowerCase() as 'point' | 'highlight' | 'box';
          out.push({ kind, blockId: body.slice(BLOCK_PREFIX.length).trim() });
        }
        break;
      }
      case 'ARROW': {
        // Accept ->, →, or ↦ between the two block: operands.
        const m = body.match(/^block:(.+?)\s*(?:->|→|↦)\s*block:(.+)$/);
        if (m?.[1] && m[2]) {
          out.push({
            kind: 'arrow',
            fromBlockId: m[1].trim(),
            toBlockId: m[2].trim(),
          });
        }
        break;
      }
      case 'WRITE': {
        const sep = body.indexOf('|');
        if (sep > 0) {
          const target = body.slice(0, sep).trim();
          const latex = body.slice(sep + 1).trim();
          if (target.startsWith(BLOCK_PREFIX) && latex) {
            out.push({
              kind: 'write',
              anchorBlockId: target.slice(BLOCK_PREFIX.length).trim(),
              latex,
            });
          }
        }
        break;
      }
      case 'CAPTION': {
        if (body) out.push({ kind: 'caption', text: body });
        break;
      }
      case 'PAGE': {
        const n = Number.parseInt(body, 10);
        if (Number.isFinite(n) && n > 0) out.push({ kind: 'page', page: n });
        break;
      }
    }
  }
  return out;
}

/**
 * Remove all DSL tags from an answer, returning clean prose. This is the
 * ONLY text that may reach the speech path or the overlay bubble.
 */
export function stripAnnotations(text: string): string {
  return text
    .replace(TAG_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Keep only annotations whose block IDs exist on the page. Hallucinated
 * references are dropped with a warning — the rest of the answer is
 * unaffected. CAPTION and PAGE carry no block reference and always pass.
 */
export function validateAnnotations(
  annotations: ProfessorAnnotation[],
  blocks: HpubBlock[],
): ProfessorAnnotation[] {
  const valid = new Set(blocks.map((b) => b.id));
  const out: ProfessorAnnotation[] = [];
  for (const a of annotations) {
    let ok = true;
    if (a.kind === 'point' || a.kind === 'highlight' || a.kind === 'box') {
      ok = valid.has(a.blockId);
    } else if (a.kind === 'arrow') {
      ok = valid.has(a.fromBlockId) && valid.has(a.toBlockId);
    } else if (a.kind === 'write') {
      ok = valid.has(a.anchorBlockId);
    }
    if (ok) out.push(a);
    else console.warn('[professor] dropping annotation with unknown block id:', a);
  }
  return out;
}
