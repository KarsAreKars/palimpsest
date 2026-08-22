/**
 * Narration pipeline step ② — VERBALIZE.
 *
 * LaTeX → spoken English via Speech Rule Engine (ClearSpeak rule set),
 * with temml doing LaTeX → MathML. This is the `Verbalizer` capability
 * (plan §2.2): swappable for MathCAT or an LLM pass without touching the
 * script builder.
 *
 * SRE and temml are loaded DYNAMICALLY: SRE's bundle evaluates Node-only
 * code paths (fs) at import time, which breaks server-side page-data
 * collection in the Next build. The verbalizer only ever runs client-side
 * (Tauri webview), after `initVerbalizer()` resolves.
 *
 * Never throws on bad math: a malformed $…$ span falls back to a spoken
 * placeholder rather than killing the narration build for the whole book.
 */

interface SreApi {
  setupEngine(options: {
    modality?: string;
    domain?: string;
    style?: string;
    locale?: string;
  }): Promise<unknown>;
  toSpeech(mathml: string): string;
}

interface TemmlApi {
  renderToString(latex: string, options?: { displayMode?: boolean }): string;
}

let sre: SreApi | null = null;
let temml: TemmlApi | null = null;
let ready: Promise<void> | null = null;

/** Idempotent one-time load of SRE + temml and SRE engine setup. */
export const initVerbalizer = (): Promise<void> => {
  if (!ready) {
    ready = (async () => {
      const [sreMod, temmlMod] = await Promise.all([import('speech-rule-engine'), import('temml')]);
      // CJS/ESM interop: both libs may surface as default or namespace.
      sre = ((sreMod as { default?: SreApi }).default ?? sreMod) as SreApi;
      temml = ((temmlMod as { default?: TemmlApi }).default ?? temmlMod) as unknown as TemmlApi;
      // SRE's browser path can park forever on locale readiness; fail loudly
      // instead of hanging the narration build (callers fall back cleanly).
      await Promise.race([
        sre.setupEngine({
          modality: 'speech',
          domain: 'clearspeak',
          style: 'default',
          locale: 'en',
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SRE setupEngine timed out')), 30_000),
        ),
      ]);
    })();
  }
  return ready;
};

/** Spoken English for one LaTeX span. Falls back to a placeholder on error. */
export const latexToSpeech = (latex: string, display: boolean): string => {
  const trimmed = latex.trim();
  if (!trimmed || !sre || !temml) return '';
  try {
    const mathml = temml.renderToString(trimmed, { displayMode: display });
    const speech = sre.toSpeech(mathml).trim();
    return speech || 'formula';
  } catch {
    return 'formula';
  }
};

/**
 * Verbalize all inline math spans ($…$, not $$…$$ — display equations are
 * their own narration units) inside an already-sanitized prose string.
 */
export const verbalizeInlineMath = (text: string): string =>
  text.replace(/\$([^$]+)\$/g, (_, latex: string) => latexToSpeech(latex, false));

/** Display-equation announcement per the plan's default verbosity policy. */
export const verbalizeDisplayEquation = (latex: string): string =>
  `Equation: ${latexToSpeech(latex, true)}.`;
