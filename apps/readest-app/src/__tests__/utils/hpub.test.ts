import { describe, expect, it } from 'vitest';
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';
import { extractHpubPackage } from '@/utils/hpub';

const textEncoder = new TextEncoder();

async function buildHpub(entries: Record<string, Uint8Array>): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const [name, data] of Object.entries(entries)) {
    await writer.add(name, new BlobReader(new Blob([data.buffer as ArrayBuffer])));
  }
  return writer.close();
}

const PDF_BYTES = textEncoder.encode('%PDF-1.7 fake pdf bytes');
const CONTENT_MD = textEncoder.encode('# Chapter 1\n\nInline math $e = mc^2$ here.\n');
const MANIFEST = JSON.stringify({
  version: 1,
  pages: [{ page: 1, mdStart: 0, mdEnd: 40, blocks: [] }],
});

describe('extractHpubPackage', () => {
  it('extracts the view layer and all sidecars from a valid package', async () => {
    const pkg = await buildHpub({
      'book.pdf': PDF_BYTES,
      'content.md': CONTENT_MD,
      'manifest.json': textEncoder.encode(MANIFEST),
      'narration.jsonl': textEncoder.encode('{"unit":1,"speak":"Chapter 1"}\n'),
      'assets/diagram.png': textEncoder.encode('fake-png'),
    });

    const { pdfFile, sidecars } = await extractHpubPackage(new File([pkg], 'book.hpub'));

    expect(pdfFile.name).toBe('book.pdf');
    expect(pdfFile.type).toBe('application/pdf');
    expect(Array.from(new Uint8Array(await pdfFile.arrayBuffer()))).toEqual(Array.from(PDF_BYTES));

    const byPath = new Map(sidecars.map((s) => [s.path, s.data]));
    expect([...byPath.keys()].sort()).toEqual([
      'assets/diagram.png',
      'content.md',
      'manifest.json',
      'narration.jsonl',
    ]);
    expect(new TextDecoder().decode(byPath.get('manifest.json')!)).toBe(MANIFEST);
    expect(new TextDecoder().decode(byPath.get('content.md')!)).toEqual(
      new TextDecoder().decode(CONTENT_MD),
    );
  });

  it.each([
    'book.pdf',
    'content.md',
    'manifest.json',
  ])('rejects a package missing %s (no manifest/text-layer/view-layer, no book)', async (missing) => {
    const entries: Record<string, Uint8Array> = {
      'book.pdf': PDF_BYTES,
      'content.md': CONTENT_MD,
      'manifest.json': textEncoder.encode(MANIFEST),
    };
    delete entries[missing];
    const pkg = await buildHpub(entries);

    await expect(extractHpubPackage(new File([pkg], 'book.hpub'))).rejects.toThrow(
      `missing ${missing}`,
    );
  });

  it('ignores unknown entries', async () => {
    const pkg = await buildHpub({
      'book.pdf': PDF_BYTES,
      'content.md': CONTENT_MD,
      'manifest.json': textEncoder.encode(MANIFEST),
      'README.txt': textEncoder.encode('not a book artifact'),
    });

    const { sidecars } = await extractHpubPackage(new File([pkg], 'book.hpub'));
    expect(sidecars.map((s) => s.path)).not.toContain('README.txt');
  });
});
