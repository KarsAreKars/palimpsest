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
 * Meta tags (HP-4, plan §6 — the question log). Never drawn and never
 * spoken; parsed for learner.json, stripped like everything else:
 *
 *   [CONCEPT:associated primes] the concept this exchange is about
 *   [QKIND:why]                 question kind: define / why / how-connects /
 *                               example / check-me
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
  | { kind: 'page'; page: number }
  | { kind: 'concept'; name: string }
  | { kind: 'qkind'; qkind: string };

const TAG_RE = /\[(POINT|HIGHLIGHT|BOX|ARROW|WRITE|CAPTION|PAGE|CONCEPT|QKIND):([^\]\n]*)\]/g;

const BLOCK_PREFIX = 'block:';

/** "Associated Primes!" → "associated_primes" — stable learner.json keys. */
export function slugifyConcept(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

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
      case 'CONCEPT': {
        const name = slugifyConcept(body);
        if (name) out.push({ kind: 'concept', name });
        break;
      }
      case 'QKIND': {
        if (body) out.push({ kind: 'qkind', qkind: body.toLowerCase().trim() });
        break;
      }
    }
  }
  return out;
}

/**
 * Remove DSL tags only — no whitespace normalization. The streaming speech
 * path (professor/voice.ts) consumes token deltas and tracks offsets into
 * the stripped text, which a trim/collapse would invalidate. Display keeps
 * using stripAnnotations below.
 */
export function stripAnnotationTags(text: string): string {
  return text.replace(TAG_RE, '');
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
  /** Models reliably abbreviate full paths to their numeric tail
   *  ("block:6" for "/page/3/Equation/6"). Repair when the abbreviation
   *  resolves to exactly one block on the page; drop when ambiguous. */
  const repair = (id: string): string | null => {
    if (valid.has(id)) return id;
    const matches = blocks.filter((b) => b.id.endsWith(`/${id}`));
    return matches.length === 1 ? matches[0]!.id : null;
  };
  const out: ProfessorAnnotation[] = [];
  for (const a of annotations) {
    if (a.kind === 'point' || a.kind === 'highlight' || a.kind === 'box') {
      const id = repair(a.blockId);
      if (id) out.push({ ...a, blockId: id });
      else console.warn('[professor] dropping annotation with unknown block id:', a);
    } else if (a.kind === 'arrow') {
      const from = repair(a.fromBlockId);
      const to = repair(a.toBlockId);
      if (from && to) out.push({ ...a, fromBlockId: from, toBlockId: to });
      else console.warn('[professor] dropping annotation with unknown block id:', a);
    } else if (a.kind === 'write') {
      const id = repair(a.anchorBlockId);
      if (id) out.push({ ...a, anchorBlockId: id });
      else console.warn('[professor] dropping annotation with unknown block id:', a);
    } else {
      out.push(a);
    }
  }
  return out;
}
