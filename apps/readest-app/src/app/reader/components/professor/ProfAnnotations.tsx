/**
 * ProfAnnotations — the professor's pen (HP-2, hey_prof_integration_plan §2).
 *
 * Draws the annotation set from the professor bus onto the foliate
 * Overlayer SVG of the relevant PDF page. Integration path (mirrors
 * Annotator/globalAnnotations, the established pattern):
 *
 *   view.renderer.getContents() → { index, doc, overlayer } per rendered
 *   section (= PDF page). The overlayer is the foliate Overlayer the VIEW
 *   attached; its `element` is an SVG in the page's DISPLAY coordinate
 *   space. Marker bboxes are PDF points (top-left origin) at scale 1, so
 *   on-screen position = bbox × the iframe document's --total-scale-factor.
 *
 *   foliate's Overlayer.redraw() only re-renders its own registered
 *   annotations, so our marks survive it — but their coordinates would go
 *   stale after zoom. We therefore wrap redraw once per overlayer instance
 *   and re-derive positions from the manifest bboxes after every foliate
 *   redraw. Content-anchored, never pixels.
 *
 * The svg stays pointer-events:none throughout: click-to-speak owns the page.
 */
import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import katex from 'katex';
import { useReaderStore } from '@/store/readerStore';
import { getNarration } from '@/services/narration/speakMode';
import { getPageBlocks, type HpubBlock } from '@/services/narration';
import type { ProfessorAnnotation } from '@/services/professor/annotations';
import {
  clearProfessorAnnotations,
  getProfessorAnnotations,
  setProfessorAnnotations,
  subscribeProfessorAnnotations,
} from '@/services/professor/annotationBus';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARK_ATTR = 'data-prof-mark';

interface OverlayerLike {
  element: SVGSVGElement;
  redraw(): void;
}

interface SectionContent {
  index?: number;
  doc?: Document;
  overlayer?: OverlayerLike;
}

const scaleFor = (doc: Document): number => {
  const v = Number.parseFloat(doc.documentElement.style.getPropertyValue('--total-scale-factor'));
  return Number.isFinite(v) && v > 0 ? v : 1;
};

const el = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, tag);
  node.setAttribute(MARK_ATTR, '');
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const rectOf = (b: HpubBlock, s: number) => ({
  x: b.bbox[0] * s,
  y: b.bbox[1] * s,
  w: (b.bbox[2] - b.bbox[0]) * s,
  h: (b.bbox[3] - b.bbox[1]) * s,
  cx: ((b.bbox[0] + b.bbox[2]) / 2) * s,
  cy: ((b.bbox[1] + b.bbox[3]) / 2) * s,
});

const drawOne = (
  svg: SVGSVGElement,
  a: ProfessorAnnotation,
  blocks: Map<string, HpubBlock>,
  s: number,
  page: { w: number; h: number },
): void => {
  switch (a.kind) {
    case 'highlight': {
      const b = blocks.get(a.blockId);
      if (!b) return;
      const r = rectOf(b, s);
      svg.append(
        el('rect', {
          x: String(r.x - 2),
          y: String(r.y - 2),
          width: String(r.w + 4),
          height: String(r.h + 4),
          rx: '3',
          fill: 'rgba(250, 204, 21, 0.32)',
        }),
      );
      return;
    }
    case 'box': {
      const b = blocks.get(a.blockId);
      if (!b) return;
      const r = rectOf(b, s);
      svg.append(
        el('rect', {
          x: String(r.x - 4),
          y: String(r.y - 4),
          width: String(r.w + 8),
          height: String(r.h + 8),
          rx: '5',
          fill: 'none',
          stroke: '#f59e0b',
          'stroke-width': '2.5',
        }),
      );
      return;
    }
    case 'point': {
      const b = blocks.get(a.blockId);
      if (!b) return;
      const r = rectOf(b, s);
      const dot = el('circle', {
        cx: String(r.cx),
        cy: String(r.cy),
        r: '9',
        fill: '#ef4444',
        opacity: '0.85',
      });
      dot.append(
        el('animate', {
          attributeName: 'r',
          values: '7;12;7',
          dur: '1.6s',
          repeatCount: 'indefinite',
        }),
        el('animate', {
          attributeName: 'opacity',
          values: '0.9;0.35;0.9',
          dur: '1.6s',
          repeatCount: 'indefinite',
        }),
      );
      svg.append(dot);
      return;
    }
    case 'arrow': {
      const from = blocks.get(a.fromBlockId);
      const to = blocks.get(a.toBlockId);
      if (!from || !to) return;
      const f = rectOf(from, s);
      const t = rectOf(to, s);
      // Edge-to-edge: start/end on the block borders along the center line,
      // so the stroke never crosses the ink it's connecting.
      const edge = (r: ReturnType<typeof rectOf>, towardX: number, towardY: number) => {
        const dx = towardX - r.cx;
        const dy = towardY - r.cy;
        const scaleX = dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity;
        const scaleY = dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity;
        const k = Math.min(scaleX, scaleY, 1);
        return { x: r.cx + dx * k, y: r.cy + dy * k };
      };
      const p1 = edge(f, t.cx, t.cy);
      const p2 = edge(t, f.cx, f.cy);
      // Gentle cubic arc: control points pushed perpendicular to the chord,
      // like a hand-drawn swoop rather than a ruler line.
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const nx = -(p2.y - p1.y);
      const ny = p2.x - p1.x;
      const len = Math.hypot(nx, ny) || 1;
      const bend = Math.min(28, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.18);
      const c1x = mx + (nx / len) * bend + (p1.x - mx) * 0.5;
      const c1y = my + (ny / len) * bend + (p1.y - my) * 0.5;
      const c2x = mx + (nx / len) * bend + (p2.x - mx) * 0.5;
      const c2y = my + (ny / len) * bend + (p2.y - my) * 0.5;
      let defs = svg.querySelector('defs[data-prof-mark]') as SVGDefsElement | null;
      if (!defs) {
        defs = el('defs', {});
        const marker = document.createElementNS(SVG_NS, 'marker');
        for (const [k, v] of Object.entries({
          id: 'prof-arrowhead',
          markerWidth: '10',
          markerHeight: '8',
          refX: '8',
          refY: '4',
          orient: 'auto',
        }))
          marker.setAttribute(k, v);
        const head = document.createElementNS(SVG_NS, 'path');
        head.setAttribute('d', 'M0,0 L10,4 L0,8 z');
        head.setAttribute('fill', '#2563eb');
        marker.append(head);
        defs.append(marker);
        svg.append(defs);
      }
      svg.append(
        el('path', {
          d: `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`,
          fill: 'none',
          stroke: '#2563eb',
          'stroke-width': '2.5',
          'stroke-linecap': 'round',
          opacity: '0.9',
          'marker-end': 'url(#prof-arrowhead)',
        }),
      );
      return;
    }
    case 'write': {
      const b = blocks.get(a.anchorBlockId);
      if (!b) return;
      const r = rectOf(b, s);
      let mathml = '';
      try {
        mathml = katex.renderToString(a.latex, { output: 'mathml', throwOnError: false });
      } catch {
        mathml = '';
      }
      const width = 260;
      const height = 84;
      const x = Math.min(r.x + r.w + 14, Math.max(page.w - width - 8, 8));
      const y = Math.min(Math.max(r.y - 6, 8), Math.max(page.h - height - 8, 8));
      // Leader line: anchor edge → card edge, so the note reads as attached
      // to its block even when pushed to the margin.
      const cardCx = x + 10;
      const cardCy = y + height / 2;
      svg.append(
        el('line', {
          x1: String(r.x + r.w + 2),
          y1: String(r.cy),
          x2: String(cardCx),
          y2: String(cardCy),
          stroke: 'rgba(180, 83, 9, 0.55)',
          'stroke-width': '1.5',
          'stroke-linecap': 'round',
        }),
      );
      const fo = el('foreignObject', {
        x: String(x),
        y: String(y),
        width: String(width),
        height: String(height),
      });
      const div = document.createElement('div');
      div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      // Paper chip: warm translucent card, amber ink — margin-note aesthetic
      // rather than a terminal slab.
      div.style.cssText =
        'display:inline-block;background:rgba(255, 251, 235, 0.94);color:#78350f;' +
        'padding:6px 11px;border-radius:8px;font-size:14px;line-height:1.5;' +
        'border:1px solid rgba(180, 83, 9, 0.45);' +
        'box-shadow:0 1px 4px rgba(120, 53, 15, 0.18);' +
        'font-family:ui-serif, Georgia, serif;';
      if (mathml) {
        div.innerHTML = mathml;
      } else {
        div.textContent = a.latex; // broken latex still says something
      }
      fo.append(div);
      svg.append(fo);
      return;
    }
    case 'caption': {
      // Takeaway chip at the foot of the page: measure-less chip = padded
      // text with a halo; keep centered and legible over any content.
      const text = el('text', {
        x: String(page.w / 2),
        y: String(page.h - 16),
        'text-anchor': 'middle',
        'font-size': '13.5',
        'font-weight': '500',
        'font-family': 'ui-serif, Georgia, serif',
        fill: '#78350f',
        stroke: 'rgba(255, 251, 235, 0.95)',
        'stroke-width': '4',
        'paint-order': 'stroke',
      });
      text.textContent = a.text;
      svg.append(text);
      return;
    }
    case 'page':
      return; // navigation is handled by useProfessor, not drawn
  }
};

const ProfAnnotations: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const getView = useReaderStore((s) => s.getView);
  const patchedRef = useRef(new WeakSet<OverlayerLike>());

  const annotationSet = useSyncExternalStore(subscribeProfessorAnnotations, () =>
    getProfessorAnnotations(bookKey),
  );

  const sections = useCallback((): SectionContent[] => {
    const view = getView(bookKey);
    return (view?.renderer?.getContents?.() ?? []) as SectionContent[];
  }, [getView, bookKey]);

  const drawInto = useCallback(
    (index: number) => {
      const hit = sections().find((c) => c.index === index && c.doc && c.overlayer?.element);
      if (!hit?.overlayer || !hit.doc) return false;
      const svg = hit.overlayer.element;
      svg.style.pointerEvents = 'none';
      svg.setAttribute('data-prof-annotations', String(index));
      for (const node of Array.from(svg.querySelectorAll(`[${MARK_ATTR}]`))) node.remove();

      const set = getProfessorAnnotations(bookKey);
      if (!set || set.page !== index + 1) return true;
      const controller = getNarration(bookKey)?.controller;
      if (!controller) return true;
      const blocks = new Map(getPageBlocks(controller.manifest, set.page).map((b) => [b.id, b]));
      const s = scaleFor(hit.doc);
      const page = {
        w: hit.doc.documentElement.clientWidth || hit.doc.body?.clientWidth || 0,
        h: hit.doc.documentElement.clientHeight || hit.doc.body?.clientHeight || 0,
      };
      for (const a of set.annotations) drawOne(svg, a, blocks, s, page);
      return true;
    },
    [bookKey, sections],
  );

  /** Wrap foliate's overlayer.redraw once so our marks re-anchor on zoom. */
  const ensurePatched = useCallback(
    (index: number) => {
      const hit = sections().find((c) => c.index === index && c.overlayer);
      const overlayer = hit?.overlayer;
      if (!overlayer || patchedRef.current.has(overlayer)) return;
      patchedRef.current.add(overlayer);
      const orig = overlayer.redraw.bind(overlayer);
      overlayer.redraw = () => {
        orig();
        drawInto(index);
      };
    },
    [sections, drawInto],
  );

  /** Clear every mark on every rendered page, then draw the active page's. */
  const redrawAll = useCallback(() => {
    for (const c of sections()) {
      if (typeof c.index === 'number' && c.overlayer) {
        ensurePatched(c.index);
        drawInto(c.index);
      }
    }
  }, [sections, ensurePatched, drawInto]);

  // React to new annotation sets and to foliate (re)rendering sections.
  useEffect(() => {
    redrawAll();
  }, [annotationSet, redrawAll]);

  useEffect(() => {
    // Test/probe hook (same pattern as __palimpsestNarration): lets the e2e
    // harness publish an annotation set without a live LLM.
    (window as unknown as Record<string, unknown>)['__palimpsestProfBus'] = {
      set: (page: number, annotations: unknown[]) =>
        setProfessorAnnotations(bookKey, { page, annotations: annotations as never }),
      clear: () => clearProfessorAnnotations(bookKey),
    };

    const view = getView(bookKey) as unknown as EventTarget | null;
    const onRelocate = () => redrawAll();
    const onCreateOverlay = (e: Event) => {
      const index = (e as CustomEvent<{ index?: number }>).detail?.index;
      if (typeof index === 'number') {
        ensurePatched(index);
        drawInto(index);
      }
    };
    view?.addEventListener('relocate', onRelocate);
    view?.addEventListener('create-overlay', onCreateOverlay);
    // Sections may already be live before this component mounted.
    redrawAll();
    return () => {
      view?.removeEventListener('relocate', onRelocate);
      view?.removeEventListener('create-overlay', onCreateOverlay);
    };
  }, [bookKey, getView, redrawAll, ensurePatched, drawInto]);

  return null;
};

export default ProfAnnotations;
