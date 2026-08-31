/**
 * Narrative pass — stage ④ of the narration pipeline (NARRATIVE_PASS_PLAN).
 *
 * content.md is built for FIDELITY; the voice needs a PERFORMANCE. This
 * stage doctors the script's speak-strings (never content.md — axiom A2)
 * and attaches prosody metadata the player renders as plain silence
 * (provider-independent — axiom A3).
 *
 * Everything here is deterministic (axiom A4): mechanical failures get
 * rules with contract tests; genuinely ambiguous text is left for the
 * phase-5 LLM tier.
 *
 *   content.md → sanitize → verbalize → script → ④ narrative → narration.jsonl
 *
 * The pure text doctor (doctorSpeakText) is also used by the professor's
 * voice (plan §7): spoken answers are spoken text too.
 */
import type { NarrationUnit, NarrationKind, NarrationProsody } from './script';

// ---------------------------------------------------------------------------
// The text doctor — pure string → string rules (contract-tested)
// ---------------------------------------------------------------------------

/**
 * Class 1: letter-spaced runs. Book designers letter-space display type;
 * extraction preserves the spaces and the voice spells the word out.
 * ≥3 consecutive single-letter tokens collapse into one word.
 * "l e t t e r" → "letter". Guard: never touches "I" (a real word) when
 * the run is only 2 long or mixed case sentence starts like "A B C" are
 * still collapsed — that IS spaced display type.
 */
const collapseLetterSpacing = (text: string): string =>
  text.replace(/(?:\b\p{L}\b[ ]){2,}\b\p{L}\b/gu, (run) => run.replace(/ /g, ''));

/**
 * Class 1b: drop caps. The chapter's first letter sits in its own text run,
 * so the chapter opens "T. he morning…" — rejoin letter + lowercase fragment.
 * Only at the start of the string, only with the tell-tale period.
 */
const fixDropCap = (text: string): string => text.replace(/^([A-Z])\. (?=[a-z])/, '$1');

// English prefixes whose compounds keep their hyphen across a line break:
// "self- taught" is "self-taught", not "selftaught". The list excludes
// prefixes that also START ordinary words — "under- standing" is a break
// of "understanding", "re- sult" of "result" — those must join.
const HYPHEN_PREFIXES = new Set([
  'self',
  'well',
  'non',
  'anti',
  'semi',
  'multi',
  'co',
  'inter',
  'pre',
  'post',
  'sub',
  'super',
  'trans',
  'ultra',
  'counter',
  'extra',
  'mid',
  'neo',
  'pseudo',
  'quasi',
  'cross',
  'half',
  'ill',
]);

/**
 * Class 2: hyphenation across line breaks. Extraction merges lines, leaving
 * "deci- sion" which the voice reads as "deci dash sion". A hyphen followed
 * by a SPACE is never correct typography — true compounds are closed up
 * ("well-known") — so hyphen-space is always a break artifact. Join unless
 * the left side is a known compound prefix.
 */
const dehyphenate = (text: string): string =>
  text.replace(/([A-Za-z]{2,})- ([a-z]{2,})/g, (_m, left: string, right: string) =>
    HYPHEN_PREFIXES.has(left.toLowerCase()) ? `${left}-${right}` : `${left}${right}`,
  );

/**
 * Class 5: symbols & abbreviations — the classic TTS text-normalization
 * layer. Conservative: only expansions every provider gets wrong or reads
 * awkwardly. Numbers/dates are left to the voice (they're good at those).
 */
const normalizeSymbols = (text: string): string =>
  text
    .replace(/\be\.g\./g, 'for example')
    .replace(/\bi\.e\./g, 'that is')
    .replace(/\bFig\./g, 'Figure')
    .replace(/\bvs\./g, 'versus')
    .replace(/\betc\./g, 'et cetera')
    .replace(/&/g, ' and ')
    .replace(/(\d)\s*%/g, '$1 percent')
    .replace(/≤/g, ' less than or equal to ')
    .replace(/≥/g, ' greater than or equal to ')
    .replace(/→/g, ' to ')
    .replace(/(?<!~)~(?=\d)/g, 'about ')
    // URLs compress to their domain; long paths are dropped entirely.
    .replace(/https?:\/\/(?:www\.)?([a-z0-9-]+)\.(com|org|net|edu|io|dev|ai)\S*/gi, '$1 dot $2')
    .replace(/\bdoi:\S+/gi, '');

/** Class 3 helpers: lines that are never prose. */
const isFurnitureText = (text: string): boolean => {
  const t = text.trim();
  if (t.length === 0) return true;
  if (/^(page\s*)?\d+$/i.test(t)) return true; // lone page number
  if (/^[·•*†‡§⁂-]+$/.test(t)) return true; // ornament / separator line
  if (/^\d+\s*[·•]\s*\d+$/.test(t)) return true; // "3 · 141" style splits
  return false;
};

const FURNITURE_MAX_CHARS = 60;
const FURNITURE_MIN_PAGES = 3;

/**
 * One pass over a unit's speak string. Order matters: strikethrough unwrap
 * and spacing repairs before symbol expansion, whitespace collapse last.
 */
export const doctorSpeakText = (text: string): string => {
  let t = text;
  // Strikethrough markup (~~x~~) is visual deletion; in books it's usually
  // rhetoric ("the WRONG way: 1. X 2. Y") and the text is meant to be read.
  // Unwrap before the ~→"about" rule can mangle the tildes.
  t = t.replace(/~~([^~]+)~~/g, '$1');
  t = fixDropCap(t);
  t = collapseLetterSpacing(t);
  t = dehyphenate(t);
  t = normalizeSymbols(t);
  return t.replace(/\s{2,}/g, ' ').trim();
};

// ---------------------------------------------------------------------------
// Prosody (plan §4) — player-rendered pauses, never baked into audio
// ---------------------------------------------------------------------------

const KIND_PROSODY: Record<NarrationKind, NarrationProsody> = {
  heading: { pause_before_ms: 700, pause_after_ms: 600 },
  display_eq: { pause_before_ms: 300, pause_after_ms: 300 },
  prose: {},
  inline_math: {},
  skip: { pause_before_ms: 250, pause_after_ms: 250 }, // diagram announcements
};

// Paragraph = paratone boundary (SPEECH_SCIENCE.md §2): listeners segment
// discourse by pitch resets and longer silence here. 300ms read as a
// sentence beat; ~650ms is the audible 'new unit' cue. Silence at structure
// points aids comprehension — never minimize it (§3).
const PARAGRAPH_PAUSE_MS = 650;

// ---------------------------------------------------------------------------
// The pass itself
// ---------------------------------------------------------------------------

/**
 * Apply the narrative pass to a built script:
 *   1. doctor every speak string (classes 1, 2, 5, 6-lite)
 *   2. furniture filter (class 3): lone furniture lines dropped; short
 *      first/last-of-page lines repeated across ≥3 pages dropped
 *      (running heads). Units become silent (speak removed) — spans and
 *      pages are untouched so click-to-speak alignment survives.
 *   3. prosody: kind-based beats + a paragraph pause when consecutive
 *      units have a gap in the md source (block boundary).
 */
export const applyNarrativePass = (units: NarrationUnit[]): NarrationUnit[] => {
  // Furniture detection needs the doctored text, so doctor first.
  const doctored = units.map((u) => ({
    ...u,
    speak: u.speak ? doctorSpeakText(u.speak) : u.speak,
  }));

  // Tally short edge-of-page lines across pages.
  const byPage = new Map<number, NarrationUnit[]>();
  for (const u of doctored) {
    if (u.page === null) continue;
    const list = byPage.get(u.page) ?? [];
    list.push(u);
    byPage.set(u.page, list);
  }
  const edgeTextCount = new Map<string, number>();
  for (const list of byPage.values()) {
    const speakable = list.filter((u) => u.speak && u.kind !== 'skip');
    for (const edge of [speakable[0], speakable[speakable.length - 1]]) {
      if (edge?.speak && edge.speak.length <= FURNITURE_MAX_CHARS) {
        const key = edge.speak.toLowerCase();
        edgeTextCount.set(key, (edgeTextCount.get(key) ?? 0) + 1);
      }
    }
  }
  const isRunningHead = (speak: string): boolean =>
    (edgeTextCount.get(speak.toLowerCase()) ?? 0) >= FURNITURE_MIN_PAGES;

  const out: NarrationUnit[] = [];
  for (const u of doctored) {
    let speak = u.speak;
    if (
      speak &&
      (isFurnitureText(speak) || (speak.length <= FURNITURE_MAX_CHARS && isRunningHead(speak)))
    ) {
      speak = undefined; // silenced, not removed: md span + page survive
    }

    const base = KIND_PROSODY[u.kind] ?? {};
    let pauseBefore = base.pause_before_ms ?? 0;
    const prev = out[out.length - 1];
    // Blocks in content.md are separated by a blank line ("\n\n") — a 2-char
    // md gap between consecutive units is the paragraph boundary.
    if (prev && prev.kind !== 'skip' && u.md_start - prev.md_end > 1) {
      pauseBefore = Math.max(pauseBefore, PARAGRAPH_PAUSE_MS);
    }
    const prosody: NarrationProsody = {
      ...(pauseBefore ? { pause_before_ms: pauseBefore } : {}),
      ...(base.pause_after_ms ? { pause_after_ms: base.pause_after_ms } : {}),
      ...(base.energy ? { energy: base.energy } : {}),
    };

    out.push({
      ...u,
      ...(speak ? { speak } : {}),
      ...(Object.keys(prosody).length > 0 ? { prosody } : {}),
    });
    // u had speak but it was silenced: drop the stale field entirely.
    if (!speak) delete out[out.length - 1]!.speak;
  }
  return out;
};
