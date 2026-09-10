/**
 * The Director's pass (A4 open item): an LLM polish of the spoken script's
 * prose for audiobook cadence.
 *
 * The deterministic pipeline (sanitize → verbalize → narrative pass) makes
 * narration CORRECT; this pass makes it sound read-aloud: natural clause
 * pauses, an em-dash before a reveal, a comma where a reader breathes.
 * It runs once per book, right after the script is built, and only when an
 * AI provider is configured (Settings → AI). Everything about it is
 * defensive: batch output that misaligns falls back to the deterministic
 * text for that unit — the pass can only improve cadence, never lose words.
 *
 * Scope (v1): prose and heading units only. Math speech (inline_math /
 * display_eq) is SRE-verbalized LaTeX — an LLM rewrite there risks exactly
 * the word-salad class of bug we just eliminated. Math gets the Lecturer's
 * pass (§14.2) separately.
 *
 * The core (polishBatch / applyDirectorsPass) takes an injected completer
 * so it is unit-testable without an API key.
 */
import { generateText } from 'ai';
import type { AISettings } from '@/services/ai/types';
import { getAIProvider } from '@/services/ai/providers';
import type { NarrationUnit } from './script';
import { nlog, nwarn } from './log';

/** Units per LLM call — big enough to amortize, small enough to realign. */
export const DIRECTOR_BATCH = 15;

/** Per-batch request ceiling. 2026-09-10: a hung generateText (flaky
 * network, no timeout in the ai SDK by default) stalled the sequential
 * batch loop ~2h with the library badge stuck at "5/6 building spoken
 * script". A batch that can't answer in 60s falls back to the
 * deterministic text and the pass moves on. */
export const DIRECTOR_TIMEOUT_MS = 60_000;

export type DirectorCompleter = (prompt: string) => Promise<string[]>;

const DIRECTOR_INSTRUCTIONS = `You are the director of an audiobook recording. You receive numbered lines of narration text, one per line, each prefixed with its index like "[3] some text".

Rewrite each line so it reads aloud beautifully: add natural pauses with punctuation (a comma where a reader breathes, an em-dash before a reveal, an ellipsis for a trailing thought — sparingly), and smooth spoken-word flow. Rules:
- Keep every fact and every word's meaning. This is cadence, not paraphrase.
- Never add content, never summarize, never comment.
- Keep technical terms and any math wording exactly as written.
- If a line is already fine, return it unchanged.
- Return ONLY a JSON array of strings, in the same order, one per input line. No markdown fences, no commentary.`;

/** Extract the JSON array from a model response, tolerating fences. */
export const parseDirectorResponse = (raw: string): string[] | null => {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed;
    return null;
  } catch {
    return null;
  }
};

/**
 * Polish one batch of speak texts. Per-line fallback: a misaligned or empty
 * response line yields the original text — the pass never loses content.
 */
export const polishBatch = async (
  lines: string[],
  complete: DirectorCompleter,
): Promise<string[]> => {
  const prompt =
    DIRECTOR_INSTRUCTIONS + '\n\nLines:\n' + lines.map((l, i) => `[${i}] ${l}`).join('\n');
  try {
    const out = await complete(prompt);
    return lines.map((orig, i) => {
      const polished = out[i]?.trim();
      // Sanity: non-empty, not wildly longer (a runaway rewrite), no JSON debris.
      if (!polished || polished.length > orig.length * 2 + 80) return orig;
      return polished;
    });
  } catch (e) {
    nwarn('narration-director: batch failed (timeout/provider), keeping deterministic text', e);
    return lines;
  }
};

/**
 * Polish the prose/heading units of a script in place order. Returns a new
 * array; untouched units keep their identity (referential stability for the
 * player's caches).
 */
export const applyDirectorsPass = async (
  units: NarrationUnit[],
  complete: DirectorCompleter,
  onBatch?: (done: number, total: number) => void,
): Promise<NarrationUnit[]> => {
  const targets = units
    .map((u, i) => ({ u, i }))
    .filter(
      ({ u }) => (u.kind === 'prose' || u.kind === 'heading') && (u.speak ?? '').trim().length > 12,
    );
  const result = [...units];
  const total = Math.ceil(targets.length / DIRECTOR_BATCH);
  let failed = 0;
  nlog(`narration-director: pass starting — ${targets.length} units in ${total} batches`);
  for (let b = 0; b < total; b++) {
    const slice = targets.slice(b * DIRECTOR_BATCH, (b + 1) * DIRECTOR_BATCH);
    const originals = slice.map(({ u }) => u.speak ?? '');
    const polished = await polishBatch(originals, complete);
    if (polished === originals) failed++; // polishBatch returns its input on error/timeout
    slice.forEach(({ u, i }, j) => {
      if (polished[j] && polished[j] !== u.speak) result[i] = { ...u, speak: polished[j] };
    });
    onBatch?.(b + 1, total);
    if ((b + 1) % 10 === 0 || b + 1 === total)
      nlog(`narration-director: batch ${b + 1}/${total} (${failed} fell back)`);
  }
  return result;
};

/**
 * The AI-backed completer for the app's configured provider (Settings → AI).
 * Returns null when AI is disabled or unconfigured — callers then skip the
 * pass entirely (the deterministic script is already good).
 */
export const directorCompleterFromSettings = (
  aiSettings: AISettings | undefined | null,
): DirectorCompleter | null => {
  if (!aiSettings?.enabled) return null;
  let model;
  try {
    model = getAIProvider(aiSettings).getModel();
  } catch {
    return null;
  }
  return async (prompt: string) => {
    const { text } = await generateText({
      model,
      prompt,
      abortSignal: AbortSignal.timeout(DIRECTOR_TIMEOUT_MS),
    });
    const parsed = parseDirectorResponse(text);
    if (!parsed) throw new Error('director: response was not a JSON string array');
    return parsed;
  };
};
