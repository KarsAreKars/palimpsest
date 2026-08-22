import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildNarrationScript } from '@/services/narration/script';
import type { HpubManifest } from '@/services/narration';

describe('offline profile: Atiyah–MacDonald narration build', () => {
  it('times the full pipeline against the real text layer', async () => {
    const md = fs.readFileSync('/tmp/hpub-demo/content.md', 'utf8');
    const manifest = JSON.parse(
      fs.readFileSync('/tmp/hpub-demo/manifest.json', 'utf8'),
    ) as HpubManifest;
    const t0 = Date.now();
    const units = await buildNarrationScript(md, manifest);
    const ms = Date.now() - t0;
    console.log(`BUILD: ${units.length} units in ${ms}ms`);
    const { toNarrationJsonl } = await import('@/services/narration/script');
    fs.writeFileSync('/tmp/hpub-demo/narration.jsonl', toNarrationJsonl(units));
    expect(units.length).toBeGreaterThan(0);
  }, 900_000);
});
