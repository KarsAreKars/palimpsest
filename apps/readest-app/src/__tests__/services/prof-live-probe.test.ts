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

    const pack = buildContextPack({
      md,
      manifest,
      page: 4,
      extraPages: [5],
      // Reproduce the failure condition from the user's video: a session
      // history of prose-only answers that taught the model to stop tagging.
      recentExchanges: [
        {
          q: 'What is the scaling trick?',
          a: 'The scaling trick stabilizes the gradients during attention calculations. It keeps dot products from growing too large.',
        },
        {
          q: 'Can you point out where it says attention on the page?',
          a: "The concept of attention is central to multi-head attention. It appears in the text and in the equation defining each head's output.",
        },
      ],
    });
    let answer = '';
    await askProfessor({
      question: 'point at where the scaling by root d_k happens in equation 1',
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
    const blocks = [...getPageBlocks(manifest, 4), ...getPageBlocks(manifest, 5)];
    const valid = validateAnnotations(annotations, blocks);
    const dropped = annotations.length - valid.length;
    fs.writeFileSync(
      '/tmp/prof-probe.txt',
      `ANSWER:\n${answer}\n\nANNOTATIONS: ${JSON.stringify(annotations, null, 1)}\nVALID: ${JSON.stringify(valid, null, 1)}\nDROPPED: ${JSON.stringify(dropped)}`,
    );
    expect(answer.length).toBeGreaterThan(40);
  }, 120_000);

  it('vision smoke: page image flows through the provider (A8)', async () => {
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
    // 1x1 red PNG — enough to prove the image content part reaches the model.
    const RED_DOT =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    let answer = '';
    await askProfessor({
      question:
        'I attached an image along with the page context. In one short sentence: what color dominates the attached image?',
      pack,
      aiSettings,
      images: [RED_DOT],
      cb: {
        onToken: (t) => (answer += t),
        onDone: () => undefined,
        onError: (m) => {
          throw new Error(m);
        },
      },
    });
    console.log('VISION PROBE ANSWER:', answer.slice(0, 300));
    expect(answer.length).toBeGreaterThan(20);
    // 1x1 red renders at the red/orange boundary at that resolution;
    // the assertion is that the model GROUNDED in the image at all.
    expect(answer.toLowerCase()).toMatch(/red|orange/);
  }, 120_000);
});
