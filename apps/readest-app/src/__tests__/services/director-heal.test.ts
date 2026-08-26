import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyDirectorsPass, directorCompleterFromSettings } from '@/services/narration/director';
import type { NarrationUnit } from '@/services/narration';
import type { AISettings } from '@/services/ai/types';

const RUN = process.env['DIRECTOR_HEAL'] === '1';
const DIR = path.join(
  process.env['HOME']!,
  'Library/Application Support/com.bilingify.readest/Readest/Books/87138e4f8cc14d7ddaddf71d709b036e',
);

describe.runIf(RUN)('director heal: polish the live Attention narration.jsonl', () => {
  it('polishes prose/heading speak texts in place', async () => {
    const file = path.join(DIR, 'narration.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    const header = JSON.parse(lines[0]!);
    const units = lines.slice(1).map((l) => JSON.parse(l) as NarrationUnit);
    const settingsRaw = JSON.parse(
      fs.readFileSync(
        path.join(
          process.env['HOME']!,
          'Library/Application Support/com.bilingify.readest/settings.json',
        ),
        'utf8',
      ),
    );
    const completer = directorCompleterFromSettings({
      ...settingsRaw.aiSettings,
      enabled: true,
    } as AISettings);
    expect(completer).not.toBeNull();
    const polished = await applyDirectorsPass(units, completer!, (done, total) =>
      console.log(`batch ${done}/${total}`),
    );
    const changed = polished.filter((u, i) => u.speak !== units[i]!.speak).length;
    fs.writeFileSync(
      file,
      JSON.stringify({ meta: { ...header.meta, director: true } }) +
        '\n' +
        polished.map((u) => JSON.stringify(u)).join('\n') +
        '\n',
    );
    fs.writeFileSync(
      '/tmp/director-heal.txt',
      polished
        .filter((u, i) => u.speak !== units[i]!.speak)
        .slice(0, 12)
        .map(
          (u, i) => `BEFORE: ${units.find((x) => x.unit === u.unit)!.speak}\nAFTER:  ${u.speak}\n`,
        )
        .join('\n'),
    );
    console.log(`polished ${changed}/${units.length} units`);
    expect(changed).toBeGreaterThan(0);
  }, 600_000);
});
