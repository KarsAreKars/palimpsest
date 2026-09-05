/**
 * Professor page vision (A8) — the Prof sees what you see.
 *
 * Captures the currently visible PDF pages as PNG data URLs and hands them
 * to the tutor as corroborating evidence: figures, diagrams, layout, and
 * rendered math are things the text-only context pack cannot convey. The
 * images are evidence, NOT the addressing system — annotations still
 * reference manifest block ids and are validated/drawn exactly as before.
 *
 * Capture strategy: foliate's pdf.js renderer paints each page into a
 * <canvas> inside the section's frame document. We clone-paint the largest
 * canvas per visible section into an export canvas (resolution-capped) and
 * read out a data URL — no re-render, no pdf.js document handle needed, no
 * UI chrome, no ink. If the page canvas isn't found (e.g. still rendering),
 * that page is simply skipped — vision is additive, never a failure mode.
 */

export interface PageImage {
  /** 1-based PDF page number (section index + 1). */
  page: number;
  /** data:image/png;base64,… */
  dataUrl: string;
}

interface SectionContentLike {
  index?: number;
  doc?: Document;
}

const collectCanvases = (root: Document | ShadowRoot, into: HTMLCanvasElement[]): void => {
  for (const c of Array.from(root.querySelectorAll('canvas'))) into.push(c);
  // Pierce shadow roots (foliate keeps overlayers/annotations in them; the
  // page canvas is normally in the main frame doc, but be thorough).
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.shadowRoot) collectCanvases(el.shadowRoot, into);
  }
};

const findPageCanvas = (doc: Document): HTMLCanvasElement | null => {
  const canvases: HTMLCanvasElement[] = [];
  collectCanvases(doc, canvases);
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  for (const c of canvases) {
    const area = c.width * c.height;
    if (area > bestArea) {
      best = c;
      bestArea = area;
    }
  }
  return best;
};

import { invoke } from '@tauri-apps/api/core';

/** ClickyX parity: 3s cache TTL — rapid follow-up questions reuse the frame. */
const WINDOW_SHOT_TTL_MS = 3000;
let windowShotCache: { at: number; dataUrl: string } | null = null;

/**
 * Live screenshot of the reader window (Rust `capture_window_screenshot`,
 * xcap) — the Prof sees the user's literal view: highlights, selection,
 * ink, exactly as displayed. Least-privilege: only our own process's
 * windows are captured, downscaled to 1280px server-side.
 *
 * Additive, never a failure mode: without macOS Screen Recording
 * permission (or on any capture error) this returns null and the Prof
 * answers from the A8 page images alone.
 */
export async function captureWindowScreenshotDataUrl(): Promise<string | null> {
  if (windowShotCache && Date.now() - windowShotCache.at < WINDOW_SHOT_TTL_MS) {
    return windowShotCache.dataUrl;
  }
  try {
    const dataUrl = await invoke<string>('capture_window_screenshot');
    windowShotCache = { at: Date.now(), dataUrl };
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Clone-paint the visible pages' canvases into PNG data URLs.
 * `maxWidth` caps the export width (vision tokens scale with pixels; a
 * 1400px-wide page reads well and stays cheap). Returns [] when the view
 * or canvases aren't ready — callers treat vision as best-effort.
 */
export function captureVisiblePageImages(
  view: unknown,
  opts: { maxPages?: number; maxWidth?: number } = {},
): PageImage[] {
  const { maxPages = 2, maxWidth = 1400 } = opts;
  const renderer = (view as { renderer?: { getContents?: () => SectionContentLike[] } } | null)
    ?.renderer;
  const contents = renderer?.getContents?.() ?? [];

  const out: PageImage[] = [];
  for (const c of contents.slice(0, maxPages)) {
    const doc = c.doc;
    if (!doc) continue;
    const src = findPageCanvas(doc);
    if (!src || src.width === 0 || src.height === 0) continue;
    const scale = Math.min(1, maxWidth / src.width);
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    if (!ctx) continue;
    try {
      ctx.drawImage(src, 0, 0, w, h);
      out.push({ page: (c.index ?? 0) + 1, dataUrl: off.toDataURL('image/png') });
    } catch {
      // Tainted or unpaintable canvas — skip this page, keep the rest.
    }
  }
  return out;
}
