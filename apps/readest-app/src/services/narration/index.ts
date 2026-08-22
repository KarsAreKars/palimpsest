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
import {
  buildNarrationScript,
  toNarrationJsonl,
  type HpubManifest,
  type NarrationUnit,
} from './script';

export const NARRATION_FILENAME = 'narration.jsonl';
export const NARRATION_FORMAT_VERSION = 1;

export type { HpubManifest, NarrationUnit };

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
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as NarrationUnit);
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
  const units = await buildNarrationScript(md, manifest);
  await appService.writeFile(`${dir}/${NARRATION_FILENAME}`, 'Books', toNarrationJsonl(units));
  return units.length;
};
