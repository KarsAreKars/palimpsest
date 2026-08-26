/**
 * ProfAnnotations — the professor's pen (HP-2, hey_prof_integration_plan §2).
 *
 * Draws the annotation set from the professor bus onto the foliate
 * Overlayer SVG of the relevant PDF page.
 *
 * Geometry (A5, DOM-anchored): marks anchor to LIVE DOM rects, not
 * bbox × scale-factor math. Blocks with text are located in the PDF.js
 * text layer (normalized substring search — the same machinery as the
 * narration highlight), and an affine map bbox → svg-space is fitted from
 * those anchors per page. Text-less blocks (equations-as-images,
 * diagrams) go through the calibrated map; a page with zero anchors falls
 * back to raw bbox × --total-scale-factor. Positions re-derive after
 * every foliate redraw, so ink survives zoom and page turns.
 *
 * The svg stays pointer-events:none throughout: click-to-speak owns the page.
 */
import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import katex from 'katex';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { getNarration } from '@/services/narration/speakMode';
import { getPageBlocks, type HpubBlock, type HpubManifest } from '@/services/narration';
import { getDir } from '@/utils/book';
import { findSpanRange } from '@/services/narration/highlight';
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

/** Fallback scale when a page has no text anchors at all. */
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/** svg-space = iframeRect + iframeViewRect − svgRect: span/canvas rects are
 *  iframe-viewport space; the SVG lives in the TOP document (shadow-DOM
 *  frame wrapper). The iframe element's own rect bridges the two. */
const svgSpace = (doc: Document, svg: SVGSVGElement) => {
  const frameEl = doc.defaultView?.frameElement as HTMLElement | null;
  if (!frameEl) return null;
  const fb = frameEl.getBoundingClientRect();
  const sb = svg.getBoundingClientRect();
  return { dx: fb.left - sb.left, dy: fb.top - sb.top };
};

/** Exact top-left + first-line extent of a block's text in the PDF.js text
 *  layer, converted into the overlayer SVG's coordinate space. */
const findDomAnchor = (doc: Document, svg: SVGSVGElement, textHead: string) => {
  const spans = Array.from(doc.querySelectorAll('.textLayer span')) as HTMLElement[];
  if (spans.length === 0) return null;
  const conv = svgSpace(doc, svg);
  if (!conv) return null;
  const range = findSpanRange(
    spans.map((s) => s.textContent ?? ''),
    textHead,
  );
  if (!range) return null;
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (let i = range.start; i <= range.end; i++) {
    const br = spans[i]!.getBoundingClientRect();
    l = Math.min(l, br.left);
    t = Math.min(t, br.top);
    r = Math.max(r, br.right);
    b = Math.max(b, br.bottom);
  }
  if (!Number.isFinite(l) || r - l < 1 || b - t < 1) return null;
  return {
    x: conv.dx + l,
    y: conv.dy + t,
    w: r - l,
    h: b - t,
  };
};

/**
 * Page geometry: exact DOM anchors where text exists + median-offset map
 * for everything else.
 *
 * The naive bbox × scale math breaks two ways: the page sits at an unknown
 * offset inside the frame wrapper (centering margins), and duplicate text
 * heads (two "Definition — Given two ideals…" blocks on one page) poison a
 * least-squares fit. The median offset is immune to both: scale comes from
 * --total-scale-factor, and the offset is the MEDIAN of
 * (domTopLeft − scale × bboxTopLeft) across anchored blocks — a few wrong
 * anchors don't move it. Blocks with a DOM anchor use its exact x/y.
 */
interface PageGeometry {
  s: number;
  bx: number;
  by: number;
  anchors: Map<string, { x: number; y: number }>;
}

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const buildPageGeometry = (
  doc: Document,
  svg: SVGSVGElement,
  blocks: Map<string, HpubBlock>,
): PageGeometry => {
  const s = scaleFor(doc);
  const anchors = new Map<string, { x: number; y: number }>();
  const offX: number[] = [];
  const offY: number[] = [];
  for (const b of blocks.values()) {
    const head = b.text_head ?? '';
    if (head.length < 15) continue;
    const anchor = findDomAnchor(doc, svg, head);
    if (!anchor) continue;
    anchors.set(b.id, { x: anchor.x, y: anchor.y });
    offX.push(anchor.x - s * b.bbox[0]);
    offY.push(anchor.y - s * b.bbox[1]);
  }
  return {
    s,
    bx: offX.length ? median(offX) : 0,
    by: offY.length ? median(offY) : 0,
    anchors,
  };
};

const rectOf = (b: HpubBlock, g: PageGeometry): Rect => {
  const anchor = g.anchors.get(b.id);
  const x = anchor ? anchor.x : g.s * b.bbox[0] + g.bx;
  const y = anchor ? anchor.y : g.s * b.bbox[1] + g.by;
  const w = g.s * (b.bbox[2] - b.bbox[0]);
  const h = g.s * (b.bbox[3] - b.bbox[1]);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
};

const drawOne = (
  svg: SVGSVGElement,
  a: ProfessorAnnotation,
  blocks: Map<string, HpubBlock>,
  g: PageGeometry,
  page: { w: number; h: number },
): void => {
  switch (a.kind) {
    case 'highlight': {
      const b = blocks.get(a.blockId);
      if (!b) return;
      const r = rectOf(b, g);
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
      const r = rectOf(b, g);
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
      const r = rectOf(b, g);
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
      const f = rectOf(from, g);
      const t = rectOf(to, g);
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
      const r = rectOf(b, g);
      let mathml = '';
      try {
        mathml = katex.renderToString(a.latex, { output: 'mathml', throwOnError: false });
      } catch {
        mathml = '';
      }
      const width = 260;
      const height = 84;
      // Prefer the right margin; when the anchor block spans the full text
      // width (equations do), drop the note below the block instead of
      // clamping it on top of the content.
      const rightRoom = page.w - (r.x + r.w + 14);
      const below = rightRoom < width;
      const x = below
        ? Math.min(Math.max(r.x, 8), Math.max(page.w - width - 8, 8))
        : Math.min(r.x + r.w + 14, Math.max(page.w - width - 8, 8));
      const y = below
        ? Math.min(r.y + r.h + 10, Math.max(page.h - height - 8, 8))
        : Math.min(Math.max(r.y - 6, 8), Math.max(page.h - height - 8, 8));
      // Leader line: nearest block edge midpoint → card edge midpoint, so
      // the note reads as attached to its block.
      const fromX = below ? r.cx : r.x + r.w + 2;
      const fromY = below ? r.y + r.h + 2 : r.cy;
      const toX = below ? x + width / 2 : x + 10;
      const toY = below ? y : y + height / 2;
      svg.append(
        el('line', {
          x1: String(fromX),
          y1: String(fromY),
          x2: String(toX),
          y2: String(toY),
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
  const { appService } = useEnv();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const patchedRef = useRef(new WeakSet<OverlayerLike>());
  const redrawRef = useRef<() => void>(() => {});
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pen must not depend on a live narration session: load the manifest
  // straight from the book directory when the controller hasn't built one.
  const manifestRef = useRef<HpubManifest | null>(null);
  const manifestLoadingRef = useRef(false);

  const ensureManifest = useCallback((): void => {
    if (manifestRef.current || manifestLoadingRef.current) return;
    const narrationManifest = getNarration(bookKey)?.controller?.manifest;
    if (narrationManifest) {
      manifestRef.current = narrationManifest;
      return;
    }
    const book = getBookData(bookKey)?.book;
    if (!appService || !book) return;
    manifestLoadingRef.current = true;
    void (async () => {
      try {
        const raw = await appService.readFile(`${getDir(book)}/manifest.json`, 'Books', 'text');
        const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        manifestRef.current = JSON.parse(text) as HpubManifest;
      } catch {
        manifestRef.current = null;
      } finally {
        manifestLoadingRef.current = false;
        redrawRef.current();
      }
    })();
  }, [appService, bookKey, getBookData]);

  const annotationSet = useSyncExternalStore(subscribeProfessorAnnotations, () =>
    getProfessorAnnotations(bookKey),
  );

  const sections = useCallback((): SectionContent[] => {
    const view = getView(bookKey);
    return (view?.renderer?.getContents?.() ?? []) as SectionContent[];
  }, [getView, bookKey]);

  const drawInto = useCallback(
    (index: number) => {
      const all = sections();
      const hit = all.find((c) => c.index === index && c.doc && c.overlayer?.element);
      if (!hit?.overlayer || !hit.doc) return false;
      const svg = hit.overlayer.element;
      svg.style.pointerEvents = 'none';
      svg.setAttribute('data-prof-annotations', String(index));
      for (const node of Array.from(svg.querySelectorAll(`[${MARK_ATTR}]`))) node.remove();

      const set = getProfessorAnnotations(bookKey);
      if (!set || set.page !== index + 1) return true;
      // Pre-lap (A5): a pending set (answer still streaming) draws faint
      // with a slow pulse; the completed set snaps to full ink. The
      // transition makes the snap visible rather than a hard cut.
      svg.style.transition = 'opacity 220ms ease-out';
      svg.style.opacity = set.pending ? '0.35' : '1';
      const manifest = getNarration(bookKey)?.controller?.manifest ?? manifestRef.current;
      if (!manifest) {
        ensureManifest();
        return true;
      }
      const blocks = new Map(getPageBlocks(manifest, set.page).map((b) => [b.id, b]));
      const g = buildPageGeometry(hit.doc, svg, blocks);
      const sb = svg.getBoundingClientRect();
      // Caption baseline: the bottom of the page SHEET (canvas), not the
      // wrapper — the iframe centers the sheet with margins, and a caption
      // below the sheet floats over reader chrome.
      const conv = svgSpace(hit.doc, svg);
      const canvas = hit.doc.querySelector('canvas');
      const sheetBottom = canvas
        ? canvas.getBoundingClientRect().bottom + (conv?.dy ?? 0)
        : sb.height;
      const page = { w: sb.width, h: Math.min(sheetBottom, sb.height) };
      for (const a of set.annotations) drawOne(svg, a, blocks, g, page);
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
    ensureManifest();
    redrawAll();
  }, [annotationSet, redrawAll, ensureManifest]);

  useEffect(() => {
    // Test/probe hook (same pattern as __palimpsestNarration): lets the e2e
    // harness publish an annotation set without a live LLM.
    (window as unknown as Record<string, unknown>)['__palimpsestProfBus'] = {
      set: (page: number, annotations: unknown[]) =>
        setProfessorAnnotations(bookKey, { page, annotations: annotations as never }),
      clear: () => clearProfessorAnnotations(bookKey),
    };

    const view = getView(bookKey) as unknown as (EventTarget & { renderer?: EventTarget }) | null;
    const onRelocate = () => {
      // Contrast settling (A5): ink ghosts while the page moves and snaps
      // back 250ms after motion stops — the eye anchors on the content,
      // not on floating marks. redrawAll re-applies pending/full opacity.
      for (const c of sections()) {
        const svg = c.overlayer?.element;
        if (svg?.querySelector(`[${MARK_ATTR}]`)) svg.style.opacity = '0.2';
      }
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => redrawAll(), 250);
    };
    // NB: 'create-overlayer' is dispatched on the RENDERER and the view does
    // NOT re-dispatch it — listen on view.renderer directly. After a
    // text-layer rebuild (zoom/font load) foliate REMOVES the old overlayer
    // element and re-emits, so our marks must re-draw into the fresh element
    // every time. The view's own attach listener was registered at open()
    // (before this one), so the fresh overlayer is already live in
    // getContents() when this handler runs.
    const onCreateOverlay = (e: Event) => {
      const index = (e as CustomEvent<{ index?: number }>).detail?.index;
      if (typeof index === 'number') {
        ensurePatched(index);
        drawInto(index);
      }
    };
    view?.addEventListener('relocate', onRelocate);
    view?.renderer?.addEventListener('create-overlayer', onCreateOverlay);
    // Sections may already be live before this component mounted.
    ensureManifest();
    redrawAll();
    return () => {
      view?.removeEventListener('relocate', onRelocate);
      view?.renderer?.removeEventListener('create-overlayer', onCreateOverlay);
    };
  }, [bookKey, getView, redrawAll, ensurePatched, drawInto]);

  return null;
};

export default ProfAnnotations;
