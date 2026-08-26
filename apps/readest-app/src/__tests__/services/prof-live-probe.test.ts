import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildContextPack } from '@/services/professor/contextPack';
import { askProfessor } from '@/services/professor/tutor';
import { parseAnnotations, validateAnnotations } from '@/services/professor/annotations';
import { getPageBlocks, type HpubManifest } from '@/services/narration';
import type { AISettings } from '@/services/ai/types';

const RUN = process.env['PROF_LIVE'] === '1';
const DIR = path.join(
  process.env['HOME']!,
  'Library/Application Support/com.bilingify.readest/Readest/Books/87138e4f8cc14d7ddaddf71d709b036e',
);

describe.runIf(RUN)('professor live probe (gpt-4o-mini via user key)', () => {
  it('answers with speech + ink tags for the scaling question', async () => {
    const md = fs.readFileSync(path.join(DIR, 'content.md'), 'utf8');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'),
    ) as HpubManifest;
    const settingsRaw = JSON.parse(
      fs.readFileSync(
        path.join(
          process.env['HOME']!,
          'Library/Application Support/com.bilingify.readest/settings.json',
        ),
        'utf8',
      ),
    );
    const aiSettings = { ...settingsRaw.aiSettings, enabled: true } as AISettings;

    const pack = buildContextPack({ md, manifest, page: 4 });
    let answer = '';
    await askProfessor({
      question: 'Why does scaling the dot products by one over root d_k matter here?',
      pack,
      aiSettings,
      cb: {
        onToken: (t) => (answer += t),
        onDone: () => undefined,
        onError: (m) => {
          throw new Error(m);
        },
      },
    });

    const annotations = parseAnnotations(answer);
    const blocks = getPageBlocks(manifest, 4);
    const valid = validateAnnotations(annotations, blocks);
    const dropped = annotations.length - valid.length;
    fs.writeFileSync(
      '/tmp/prof-probe.txt',
      `ANSWER:\n${answer}\n\nANNOTATIONS: ${JSON.stringify(annotations, null, 1)}\nVALID: ${JSON.stringify(valid, null, 1)}\nDROPPED: ${JSON.stringify(dropped)}`,
    );
    expect(answer.length).toBeGreaterThan(40);
  }, 120_000);
});
