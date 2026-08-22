/**
 * Speak-mode registry — the shared, non-React state connecting:
 *   - FoliateViewer's imperative iframe listeners (click interception)
 *   - useNarration (session lifecycle, page turns, highlight, keyboard)
 *   - useTTSControl (speak/stop button delegation)
 *
 * Speak mode is the plan's signature interaction state: when it's on, a plain
 * click on the PDF text layer means "read from this word", not "turn page".
 */
import type { NarrationController } from './controller';

export interface NarrationEntry {
  controller: NarrationController;
  speakMode: boolean;
}

const registry = new Map<string, NarrationEntry>();

export const registerNarration = (bookKey: string, entry: NarrationEntry): void => {
  registry.set(bookKey, entry);
};

export const unregisterNarration = (bookKey: string): void => {
  registry.delete(bookKey);
};

export const getNarration = (bookKey: string): NarrationEntry | undefined => registry.get(bookKey);

export const setNarrationSpeakMode = (bookKey: string, on: boolean): void => {
  const entry = registry.get(bookKey);
  if (entry) entry.speakMode = on;
};

export const isNarrationSpeakMode = (bookKey: string): boolean =>
  registry.get(bookKey)?.speakMode ?? false;

/**
 * Extract the clicked word from a PDF.js text-layer click. Spans may hold
 * several words; estimate the word under the cursor by x-fraction within the
 * span (monospace-ish approximation — the downstream fuzzy matcher absorbs
 * the error). Returns null when the click wasn't on text.
 */
export const wordAtClick = (event: MouseEvent): string | null => {
  const target = event.target as HTMLElement | null;
  const span = target?.closest('.textLayer span') as HTMLElement | null;
  if (!span) return null;
  const text = span.textContent ?? '';
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) return words[0]!;
  const rect = span.getBoundingClientRect();
  const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
  // Walk words with their approximate char share of the span.
  let acc = 0;
  for (const word of words) {
    acc += word.length + 1;
    if (acc / (text.length + 1) >= fraction) return word;
  }
  return words[words.length - 1]!;
};

/**
 * Iframe click interceptor, registered with capture ahead of the app's tap
 * handling. Returns without handling (false) when speak mode is off or the
 * click wasn't on the text layer.
 */
export const handleNarrationSpeakClick = (
  bookKey: string,
  page: number,
  event: MouseEvent,
): void => {
  if (!isNarrationSpeakMode(bookKey)) return;
  const word = wordAtClick(event);
  if (!word) return;
  event.preventDefault();
  event.stopPropagation();
  window.postMessage({ type: 'narration-word-click', bookKey, page, word }, '*');
};
