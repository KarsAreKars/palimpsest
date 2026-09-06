/**
 * pageThumbs — real page thumbnails for the Spine (UX spec B). Captured
 * from the live PDF canvas at the moment a page is *touched* (a note or
 * ink lands on it), downscaled to 240px, cached under Cache/thumbs/.
 * The Spine cell falls back to its typed card when no thumb exists yet.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import type { AppService } from '@/types/system';

const THUMB_WIDTH = 240;
const dir = (bookHash: string) => `thumbs/${bookHash}`;
const file = (bookHash: string, page: number) => `${dir(bookHash)}/p${page}.png`;

export const capturePageThumb = async (
  appService: AppService,
  bookHash: string,
  page: number,
  doc: Document,
): Promise<boolean> => {
  try {
    // The PDF page renders as a <canvas> in the foliate iframe.
    const canvas = doc.querySelector('canvas');
    if (!canvas || canvas.width === 0) return false;
    const scale = THUMB_WIDTH / canvas.width;
    const off = document.createElement('canvas');
    off.width = THUMB_WIDTH;
    off.height = Math.round(canvas.height * scale);
    const ctx = off.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(canvas, 0, 0, off.width, off.height);
    const blob = await new Promise<Blob | null>((res) => off.toBlob(res, 'image/png'));
    if (!blob) return false;
    const bytes = await blob.arrayBuffer();
    await appService.writeFile(file(bookHash, page), 'Cache', bytes);
    return true;
  } catch (e) {
    console.warn('thumbs: capture failed', e);
    return false;
  }
};

/** convertFileSrc URL when a thumb exists on disk, else null. */
export const getThumbUrl = async (
  appService: AppService,
  bookHash: string,
  page: number,
): Promise<string | null> => {
  try {
    const ok = await appService.exists(file(bookHash, page), 'Cache');
    if (!ok) return null;
    return convertFileSrc(await appService.resolveFilePath(file(bookHash, page), 'Cache'));
  } catch {
    return null;
  }
};
