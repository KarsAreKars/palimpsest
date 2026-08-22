import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

/**
 * .hpub — the Palimpsest book package. A renamed zip containing:
 *
 *   book.pdf          view layer, byte-identical to the user's imported PDF
 *   content.md        text layer, LaTeX math preserved (Marker output)
 *   manifest.json     page ↔ MD span alignment + per-block bboxes
 *   narration.jsonl   spoken script (optional until the narration pipeline runs)
 *   knowledge.json    v2 concept graph (optional)
 *   assets/           extracted images/diagrams (optional)
 *
 * Hard constraint #4: a book enters the library only with view layer (PDF) +
 * text layer (MD) + manifest binding them. No manifest, no book.
 */

export const HPUB_BOOK_ENTRY = 'book.pdf';
export const HPUB_REQUIRED_ENTRIES = [HPUB_BOOK_ENTRY, 'content.md', 'manifest.json'] as const;
export const HPUB_KNOWN_SIDECARS = [
  'content.md',
  'manifest.json',
  'narration.jsonl',
  'knowledge.json',
] as const;
export const HPUB_ASSETS_PREFIX = 'assets/';

export interface HpubSidecar {
  /** Path relative to the package root, e.g. "manifest.json" or "assets/p30-diagram.png". */
  path: string;
  data: ArrayBuffer;
}

export interface HpubPackage {
  /** The view layer as a standalone File — imported as a normal PDF book. */
  pdfFile: File;
  /** Everything else in the package, to be written next to the book file. */
  sidecars: HpubSidecar[];
}

const readEntry = async (entry: {
  getData?: (writer: BlobWriter) => Promise<Blob>;
}): Promise<ArrayBuffer> => {
  if (!entry.getData) throw new Error('Invalid .hpub package: directory entry where file expected');
  const blob = await entry.getData(new BlobWriter());
  return blob.arrayBuffer();
};

/**
 * Unpack a .hpub package. Throws on constraint-#4 violations (missing view
 * layer, text layer, or manifest) — a failed import, not a degraded book.
 */
export async function extractHpubPackage(source: File | Blob): Promise<HpubPackage> {
  const reader = new ZipReader(new BlobReader(source));
  try {
    const entries = await reader.getEntries();
    const byName = new Map(entries.filter((e) => !e.directory).map((e) => [e.filename, e]));

    for (const required of HPUB_REQUIRED_ENTRIES) {
      if (!byName.has(required)) {
        throw new Error(
          `Invalid .hpub package: missing ${required} (a book needs its PDF, text layer, and manifest)`,
        );
      }
    }

    const pdfBytes = await readEntry(byName.get(HPUB_BOOK_ENTRY)!);
    const pdfFile = new File([pdfBytes], HPUB_BOOK_ENTRY, { type: 'application/pdf' });

    const sidecars: HpubSidecar[] = [];
    for (const entry of byName.values()) {
      const name = entry.filename;
      if (name === HPUB_BOOK_ENTRY) continue;
      const isKnownSidecar = (HPUB_KNOWN_SIDECARS as readonly string[]).includes(name);
      const isAsset = name.startsWith(HPUB_ASSETS_PREFIX);
      if (!isKnownSidecar && !isAsset) continue;
      sidecars.push({ path: name, data: await readEntry(entry) });
    }

    return { pdfFile, sidecars };
  } finally {
    await reader.close();
  }
}
