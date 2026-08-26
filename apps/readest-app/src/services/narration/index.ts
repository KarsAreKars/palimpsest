/**
 * Narration pipeline orchestrator (plan §4).
 *
 *   content.md ──▶ ① SANITIZE ──▶ ② VERBALIZE ──▶ ③ SCRIPT ──▶ narration.jsonl
 *
 * Runs after the Marker sidecar lands a book's text layer. The artifact is
 * written next to content.md in Books/<hash>/ — versioned, content-derived,
 * and lazily rebuildable when a better Verbalizer ships (plan §2.1).
 */
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { getDir } from '@/utils/book';
import { useSettingsStore } from '@/store/settingsStore';
import { applyDirectorsPass, directorCompleterFromSettings } from './director';
import {
  buildNarrationScript,
  toNarrationJsonl,
  type HpubBlock,
  type HpubManifest,
  type NarrationUnit,
} from './script';

export const NARRATION_FILENAME = 'narration.jsonl';
export const NARRATION_FORMAT_VERSION = 2;

/** First JSONL line: format marker. loadNarration treats a missing or older
 *  version as stale → returns null → the controller rebuilds the script
 *  from content.md in place (never re-runs marker — plan A5). */
const FORMAT_HEADER = JSON.stringify({ meta: { format: NARRATION_FORMAT_VERSION } });

export type { HpubBlock, HpubManifest, NarrationUnit };
export { getPageBlocks } from './script';

/** Load a book's narration script if its text layer has been narrated. */
/**
 * readFile('text') returns the content as stored; the web AppService keeps
 * ArrayBuffers for anything written as binary (e.g. .hpub sidecar bytes),
 * so text artifacts must be decoded defensively.
 */
const toText = (content: string | ArrayBuffer): string =>
  typeof content === 'string' ? content : new TextDecoder().decode(content);

export const loadNarration = async (
  appService: AppService,
  book: Book,
): Promise<NarrationUnit[] | null> => {
  const path = `${getDir(book)}/${NARRATION_FILENAME}`;
  if (!(await appService.exists(path, 'Books'))) return null;
  const raw = toText(await appService.readFile(path, 'Books', 'text'));
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return null;
  let start = 0;
  try {
    const first = JSON.parse(lines[0]!) as { meta?: { format?: number } };
    if (first.meta && typeof first.meta.format === 'number') {
      if (first.meta.format < NARRATION_FORMAT_VERSION) return null; // stale script
      start = 1;
    } else {
      return null; // pre-header (v1) script — rebuild
    }
  } catch {
    return null;
  }
  return lines.slice(start).map((line) => JSON.parse(line) as NarrationUnit);
};

/**
 * Build narration.jsonl for a book whose text layer (content.md +
 * manifest.json) is present. Returns the unit count, or null when the
 * text layer isn't there yet.
 */
export const buildNarrationForBook = async (
  appService: AppService,
  book: Book,
): Promise<number | null> => {
  const dir = getDir(book);
  const manifestPath = `${dir}/manifest.json`;
  const mdPath = `${dir}/content.md`;
  if (
    !(await appService.exists(manifestPath, 'Books')) ||
    !(await appService.exists(mdPath, 'Books'))
  ) {
    return null;
  }
  const manifest = JSON.parse(
    toText(await appService.readFile(manifestPath, 'Books', 'text')),
  ) as HpubManifest;
  const md = toText(await appService.readFile(mdPath, 'Books', 'text'));

  // TODO(settings): read equationVerbosity from the user's narration settings
  // once the setting ships (plan §4 — default full/announce+speak).
  let units = await buildNarrationScript(md, manifest);
  // The Director's pass (A4): LLM polish of prose cadence for audiobook
  // feel — once per book, only when an AI provider is configured, always
  // with per-unit fallback to the deterministic text.
  const completer = directorCompleterFromSettings(useSettingsStore.getState().settings?.aiSettings);
  if (completer) {
    try {
      units = await applyDirectorsPass(units, completer);
      console.info('narration: director pass applied');
    } catch (e) {
      console.warn('narration: director pass skipped', e);
    }
  }
  await appService.writeFile(
    `${dir}/${NARRATION_FILENAME}`,
    'Books',
    FORMAT_HEADER + '\n' + toNarrationJsonl(units),
  );
  return units.length;
};
