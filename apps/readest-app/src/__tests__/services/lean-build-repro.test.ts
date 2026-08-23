// Repro: build the narration script for the REAL Lean Learning text layer
// (208 pages, 376KB content.md) — the desktop app white-screens on book
// open, and this build is the only new code path that runs there.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildNarrationScript } from '@/services/narration/script';
import { initVerbalizer } from '@/services/narration/verbalize';

const DIR =
  process.env['HOME'] +
  '/Library/Application Support/com.bilingify.readest/Readest/Books/cd85c67650b7f3c09d8e0d72c6bb2dc6';

describe('Lean Learning narration build (real artifacts)', () => {
  it('completes without hanging or dying', async () => {
    const md = fs.readFileSync(`${DIR}/content.md`, 'utf8');
    const manifest = JSON.parse(fs.readFileSync(`${DIR}/manifest.json`, 'utf8'));
    console.log('md chars:', md.length, 'pages:', manifest.page_count);
    const t0 = Date.now();
    await initVerbalizer();
    console.log('verbalizer ready in', Date.now() - t0, 'ms');
    const t1 = Date.now();
    const units = await buildNarrationScript(md, manifest);
    console.log('built', units.length, 'units in', Date.now() - t1, 'ms');
    expect(units.length).toBeGreaterThan(0);
  }, 300_000);
});
