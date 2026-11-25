/**
 * Misconception library — the professor's catalog of classic wrong turns.
 *
 * Each entry names one fault path with: the pattern signature(s) used by the
 * crude retriever, the root cause (why a student lands here), a Socratic clue
 * (points at a TEST the student can run — never the answer), a reveal line
 * for rung 3, and a teachback probe. retrieveMisconceptions is intentionally
 * simple: it returns ranked CANDIDATES; the LLM diagnosis stage
 * (diagnose.ts) picks among them. A wrong candidate costs a sentence; a
 * fabricated one costs trust.
 *
 * Wave 4 (audit Ruling 4, the Specificity Engine) adds the BOOK-SCOPED
 * library below: per chapter, the model pre-generates the common wrong
 * readings of a concept and every candidate is BOOK-VERIFIED against the
 * page before it may be stored — the repair a learner hears is grounded
 * in the page, never invented (the accuracy law).
 */
import { generateText } from 'ai';
import type { AISettings } from '@/services/ai/types';
import { getAIProvider } from '@/services/ai/providers';

export interface Misconception {
  id: string;
  name: string;
  domain: string;
  /** LaTeX-ish signatures of the faulty line; used by the crude retriever. */
  patternTemplates: string[];
  rootCause: string;
  /** Socratic nudge: points at a test the student can run, never the answer. */
  clueTemplate: string;
  /** Rung-3 correction, phrased in the student's own terms. */
  revealTemplate: string;
  /** What to ask them to explain back after the reveal. */
  teachbackProbe: string;
  provenance: string[];
  /** Prior probability this is the fault when the signature matches. */
  confidencePrior: number;
}

export const SEEDED_LIBRARY: Misconception[] = [
  {
    id: 'alg.exp_over_sum',
    name: 'power distributes over a sum',
    domain: 'algebra',
    patternTemplates: ['a^{2}+b^{2}', 'a^2+b^2', '(a+b)^{2}=a^{2}+b^{2}'],
    rootCause:
      'The student treats exponentiation as distributive over addition in the base: they ' +
      'expand (a+b)^n by raising each term to n and dropping the cross terms that come ' +
      'from actually multiplying the binomial out.',
    clueTemplate:
      'Pick small numbers for the two letters and compute both sides by hand. Does the ' +
      'left side produce an extra middle term the right side is missing?',
    revealTemplate:
      '(a+b)^2 means (a+b) times (a+b), and multiplying that out gives a cross term ' +
      '2ab. A power does not split across a plus — only across a product.',
    teachbackProbe:
      'Explain in your own words why (x+1)^2 is not x^2+1 — multiply it out or draw the square.',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.9,
  },
  {
    id: 'alg.distrib_over_power',
    name: 'a factor slides inside a power',
    domain: 'algebra',
    patternTemplates: ['ka^{n}=(ka)^{n}', '2x^{2}=(2x)^{2}', 'k\\cdota^{n}=(ka)^{n}'],
    rootCause:
      'The student moves a multiplicative factor across the boundary of a power as if the ' +
      'exponent only applied to the symbol it visually touches, so k·a^n becomes (ka)^n ' +
      '— the factor escapes being raised.',
    clueTemplate:
      'Choose a value for the letter, say 3, and a small value for the factor, say 2. ' +
      'Square each side on a calculator — which one grew by the extra factor?',
    revealTemplate:
      'The exponent applies to everything inside the parentheses, so when you pull a ' +
      'factor inside a power it gets raised too: (ka)^n is k^n times a^n, not k times a^n.',
    teachbackProbe: 'Tell me what (2x)^2 expands to and why the 2 must be squared as well.',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.75,
  },
  {
    id: 'alg.sign_of_negative',
    name: 'a negative loses its sign',
    domain: 'algebra',
    patternTemplates: ['-a^{2}=(-a)^{2}', '-(a+b)=-a+b', '(-x)^{2}=-x^{2}'],
    rootCause:
      'The student lets a minus sign drop or attach to the wrong thing when a negative ' +
      'quantity is squared, moved across the equation, or distributed — the sign is ' +
      'treated as decoration rather than a factor of negative one.',
    clueTemplate:
      'Put a negative number in for the letter and compute both forms. Which sign ' +
      'survives the square — and does your line agree?',
    revealTemplate:
      'A minus in front means multiply by negative one, and that factor participates in ' +
      'everything: (-x)^2 is positive, -x^2 is negative, and -(a+b) is -a-b.',
    teachbackProbe: 'Explain the difference between -x^2 and (-x)^2 with a number plugged in.',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.8,
  },
  {
    id: 'alg.cancel_terms',
    name: 'cancelling terms that are not factors',
    domain: 'algebra',
    patternTemplates: [
      '\\frac{x+3}{3}=x',
      '\\frac{a+b}{b}=a',
      '(x(x+2))/x=x+2\\text{ then }x+2\\to\\text{ drop }2',
    ],
    rootCause:
      'The student cancels matching symbols across a fraction as if addition inside the ' +
      'numerator worked like multiplication — cancelling a TERM instead of a FACTOR.',
    clueTemplate:
      'Set the letter to zero and evaluate the original line and your shortened line. ' +
      'Do they still agree?',
    revealTemplate:
      'You may only cancel a factor that multiplies the WHOLE top and bottom. In (x+3)/3 ' +
      'the 3 on top is added, not multiplied, so it cannot cancel the 3 below.',
    teachbackProbe:
      'Why can you cancel the x in x(x+2)/x but not the 3 in (x+3)/3? What is the difference?',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.9,
  },
  {
    id: 'alg.cross_multiply_always',
    name: 'cross-multiplying without an equation',
    domain: 'algebra',
    patternTemplates: [
      '\\frac{x}{2}+1\\to x+2',
      '\\frac{1}{x}+\\frac{1}{y}\\to y+x\\text{ (no equals sign)}',
    ],
    rootCause:
      'The student applies cross-multiplication, the move for clearing denominators in an ' +
      'EQUATION, to a bare expression — multiplying one term by a denominator with no ' +
      'equals sign to keep both sides honest.',
    clueTemplate:
      'Cross-multiplying is for equations. Point at the equals sign in this line — what ' +
      'is on the other side of it that also got multiplied?',
    revealTemplate:
      'Multiplying by a denominator is only legal when both sides of an equals sign get ' +
      'the same treatment. A single fraction inside an expression has no "other side" to ' +
      'multiply, so the denominator stays until you have a whole equation.',
    teachbackProbe:
      'When is it legal to multiply both sides by x, and what makes this line different?',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.7,
  },
  {
    id: 'alg.frac_add_numerator',
    name: 'adding fractions top-plus-top, bottom-plus-bottom',
    domain: 'algebra',
    patternTemplates: [
      '\\frac{a}{b}+\\frac{c}{d}=\\frac{a+c}{b+d}',
      '\\frac{1}{2}+\\frac{1}{3}=\\frac{2}{5}',
    ],
    rootCause:
      'The student adds fractions component-wise, treating the numerator and denominator ' +
      'as two independent columns to sum — usually because it visually resembles vector ' +
      'addition or because the correct common-denominator path was never internalized.',
    clueTemplate:
      'Test it with halves and thirds: is a half plus a third really two-fifths? Compute ' +
      'both sides as decimals and compare.',
    revealTemplate:
      'A fraction is one number, not two. To add them you rewrite both over a shared ' +
      'denominator — a half plus a third is three-sixths plus two-sixths, five-sixths. ' +
      'Top-plus-top, bottom-plus-bottom is a different operation entirely.',
    teachbackProbe:
      'Walk me through adding 1/2 and 1/3 the correct way, and say why 2/5 fails the ' +
      'decimal check.',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.95,
  },
  {
    id: 'alg.move_term_no_flip',
    name: 'moving a term without flipping its sign',
    domain: 'algebra',
    patternTemplates: ['x+3=5\\to x=5+3', '2x-4=6\\to 2x=6-4\\text{ (wrong way)}'],
    rootCause:
      'The student "moves" a term across the equals sign by sliding it over visually, ' +
      'keeping its sign — the operation applied to both sides (subtracting the term) is ' +
      'replaced by relocation.',
    clueTemplate:
      'Plug your answer back into the original line. Does the equality still hold? If ' +
      'not, which term changed sides without changing sign?',
    revealTemplate:
      'Nothing moves in an equation — both sides get the same operation. To get x alone ' +
      'you subtract 3 from BOTH sides, so x+3=5 becomes x=5-3, and the sign flips ' +
      'because you subtracted.',
    teachbackProbe:
      'Solve x-7=10 out loud and say what operation you do to both sides at each step.',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.9,
  },
  {
    id: 'alg.equals_operator',
    name: 'equals sign chained as "and then"',
    domain: 'algebra',
    patternTemplates: ['2x=6=x=3', 'a=b=c=d\\text{ with unrelated values}'],
    rootCause:
      'The student treats "=" as a step connector — "and then we get" — rather than a ' +
      'statement that two quantities are the same, so unrelated values get chained into ' +
      'one line and each equals sign is only locally true.',
    clueTemplate:
      'Read each equals sign out loud as "is equal to". Is 6 equal to x? What does the ' +
      'middle equals sign claim that cannot be true?',
    revealTemplate:
      'Each equals sign must stand on its own: everything to its left equals everything ' +
      'to its right. Write one step per line, or connect related equalities with arrows, ' +
      'but never stack values that are merely consecutive.',
    teachbackProbe:
      'Rewrite the chain as separate lines, one equality per line, and check each one.',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.8,
  },
  {
    id: 'calc.chain_rule_omitted',
    name: 'the inner derivative goes missing',
    domain: 'calculus',
    patternTemplates: [
      '\\frac{d}{dx}\\sin(x^{2})=\\cos(x^{2})',
      '\\frac{d}{dx}e^{3x}=e^{3x}',
      '\\frac{d}{dx}(x^{2}+1)^{5}=5(x^{2}+1)^{4}',
    ],
    rootCause:
      'The student differentiates the outer function and stops — the derivative of the ' +
      'inside (the chain rule factor) is left off, so composite functions are treated as ' +
      'if the inside were just x.',
    clueTemplate:
      'Your line is the derivative of the OUTSIDE only. What is the inside doing to the ' +
      'slope? Try a tiny change in x and see how much the inside alone moves.',
    revealTemplate:
      'This is a function inside a function, so the derivative is two factors: the ' +
      'derivative of the outside, TIMES the derivative of the inside. The inside here is ' +
      'not x, so its slope is not 1 — it must multiply your line.',
    teachbackProbe: 'Differentiate (x^2+1)^5 and point at the factor that comes from the inside.',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.9,
  },
  {
    id: 'calc.power_rule_product',
    name: 'the power rule applied to a product of functions',
    domain: 'calculus',
    patternTemplates: ['\\frac{d}{dx}x\\sin x=\\sin x', '\\frac{d}{dx}(uv)=u^{\\prime}v^{\\prime}'],
    rootCause:
      'The student differentiates a product factor-by-factor — differentiating each piece ' +
      'and multiplying or keeping the results — instead of using the product rule. The ' +
      'power rule shape ("drop the exponent, multiply") is overgeneralized to products.',
    clueTemplate:
      'Is that line a product of two things? Check your method on x times x — does it ' +
      'give the derivative of x^2? What rule does x·x actually need?',
    revealTemplate:
      'A product is not a power. The derivative of u times v is u-prime times v PLUS u ' +
      'times v-prime — each factor takes a turn being differentiated while the other ' +
      'watches, and the results are added, not multiplied.',
    teachbackProbe:
      'Differentiate x·sin(x) with the product rule and say why each of the two terms ' +
      'deserves to be there.',
    provenance: ['openmaic-tier-guidance', 'seed-v1'],
    confidencePrior: 0.85,
  },
];

const byId = new Map(SEEDED_LIBRARY.map((m) => [m.id, m]));

/** Normalize LaTeX for crude matching: kill whitespace and \left/\right. */
const norm = (s: string): string => s.replace(/\s+/g, '').replace(/\\left|\\right/g, '');

/**
 * Turn a pattern template into a crude regex: command names (\frac, \cdot,
 * …) are matched verbatim, every other letter/digit becomes a wildcard.
 */
function templateRegex(template: string): RegExp {
  const core = norm(template).split('\\text{')[0] ?? '';
  let out = '';
  let i = 0;
  while (i < core.length) {
    const ch = core[i]!;
    if (ch === '\\') {
      const m = /^\\[a-zA-Z]+/.exec(core.slice(i));
      if (m) {
        out += m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        i += m[0].length;
        continue;
      }
    }
    if (/[a-zA-Z0-9]/.test(ch)) out += '[a-zA-Z0-9]+';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(out);
}

/**
 * Crude template retrieval: rank seeded misconceptions whose pattern
 * signatures appear in the student's actual line (or contrast with the
 * expected line). Returns at most 5 ids; candidates already in the student's
 * history enter the pool with a weak prior and rank first, most-recent — a
 * named fault tends to repeat. Intentionally simple: the LLM stage picks
 * among the candidates.
 */
export function retrieveMisconceptions(
  expectedLatex: string,
  actualLatex: string,
  historyIds: string[],
): string[] {
  const exp = norm(expectedLatex);
  const act = norm(actualLatex);

  const scored: { id: string; score: number }[] = [];
  for (const m of SEEDED_LIBRARY) {
    let score = historyIds.includes(m.id) ? 1 : 0; // repeat-offender prior
    for (const t of m.patternTemplates) {
      const sig = templateRegex(t);
      if (sig.test(act))
        score += 2; // signature in the wrong line
      else if (sig.test(exp)) score += 1; // contrast only
    }
    score += heuristic(m.id, exp, act);
    if (score > 0) scored.push({ id: m.id, score });
  }

  const recency = (id: string): number => historyIds.lastIndexOf(id); // -1 = never
  scored.sort((a, b) => recency(b.id) - recency(a.id) || b.score - a.score);
  return scored.slice(0, 5).map((s) => s.id);
}

/** Per-id structural checks on the normalized (expected, actual) pair. */
function heuristic(id: string, exp: string, act: string): number {
  switch (id) {
    case 'alg.exp_over_sum': {
      // expected has (…+…)^n, actual has two nth-power terms joined by '+'
      const binom = exp.match(/\([a-z0-9]+[+][a-z0-9]+\)\^\{?\d\}?/);
      const split = act.match(/[a-z0-9]\^\{?\d\}?[+][a-z0-9]\^\{?\d\}?/);
      return binom && split && !act.includes('2ab') ? 2 : 0;
    }
    case 'alg.distrib_over_power': {
      // actual has a bare factor in front of a power while expected groups it
      const factored = act.match(/\d[a-z][a-z]?\^\{?\d\}?/);
      const grouped = exp.match(/\(\d/);
      return factored && grouped ? 2 : 0;
    }
    case 'alg.sign_of_negative': {
      const expNegSq = exp.includes('(-') || exp.includes('-x^{2}') || exp.includes('-x^2');
      const actNegSq = act.includes('(-') || act.includes('-x^{2}') || act.includes('-x^2');
      // the two lines disagree on where the negative lives
      return expNegSq !== actNegSq && (expNegSq || actNegSq) ? 2 : 0;
    }
    case 'alg.cancel_terms': {
      // expected has a parenthesized sum sharing a factor; actual lost the parens
      const sumOver =
        exp.match(/\([a-z0-9]+[+][a-z0-9]+\)\//) || exp.match(/\/\([a-z0-9]+[+][a-z0-9]+\)/);
      const lostParens = !act.includes('(') && exp.includes('(');
      return sumOver && lostParens ? 2 : 0;
    }
    case 'alg.cross_multiply_always': {
      // expected is an equation containing a fraction; actual cleared a
      // denominator with no '=' left to justify it
      const hasFrac = (s: string): boolean => s.includes('/') || s.includes('\\frac');
      const wasEquation = exp.includes('=') && hasFrac(exp);
      const cleared = hasFrac(exp) && !hasFrac(act);
      return wasEquation && cleared ? 2 : 0;
    }
    case 'alg.frac_add_numerator': {
      const twoFractions = (exp.match(/\\frac/g) ?? []).length >= 2;
      const combined = /[\({][a-z0-9]+[+][a-z0-9]+[\)}]\/[\({][a-z0-9]+[+][a-z0-9]+[\)}]/.test(act);
      const plusOverBar = act.includes('+') && act.includes('/') && !twoFractions;
      return twoFractions && (combined || plusOverBar) ? 2 : 0;
    }
    case 'alg.move_term_no_flip': {
      // a '+k' that lived left of '=' reappears right of '=' still added
      const moved = exp.match(/[+]\d+.*=/) && act.match(/=[^=]*[+]\d+/);
      const flipped = act.match(/=[^=]*[-]\d+/);
      return moved && !flipped ? 2 : 0;
    }
    case 'alg.equals_operator': {
      const eqs = act.split('=').length - 1;
      return eqs >= 2 ? 2 : 0;
    }
    case 'calc.chain_rule_omitted': {
      const hasFn = /(sin|cos|tan|ln|e\^|\)\^\{?\d\})/.test(exp);
      const expProduct = exp.includes('\\cdot') || /\)[a-z(]/.test(exp);
      const actNoChain = !act.includes('\\cdot') && !/[0-9][a-z]\^/.test(act);
      return hasFn && expProduct && actNoChain ? 2 : 0;
    }
    case 'calc.power_rule_product': {
      const product =
        /x\s*(\\cdot)?\s*(\\sin|\\cos|\\ln|e\^)/.test(exp) ||
        /(\\sin|\\cos)\(?x\)?\s*(\\cdot)?\s*x/.test(exp);
      const lone = /(sin|cos|ln)/.test(act) && !act.includes('+');
      return product && lone ? 2 : 0;
    }
    default:
      return 0;
  }
}

/** Test hook: fetch an entry by id (used by the diagnosis prompt builder). */
export function getMisconception(id: string): Misconception | undefined {
  return byId.get(id);
}

// ---------------------------------------------------------------------------
// Wave 4 — the book-scoped chapter library (generation + verification)
// ---------------------------------------------------------------------------

/** Where a wrong reading lives: the page (and, cross-book, the book). */
export interface MisconceptionSourceRef {
  /** Book identifier (hash) — optional inside one book's own store. */
  book?: string;
  /** 1-based page the reading AND its correction were read from. */
  page: number;
}

/** One pre-generated, book-verified wrong reading of a concept. */
export interface ChapterMisconception {
  /** Stable id: `<concept>.<slug of the wrong reading>`. */
  id: string;
  /** Ledger concept slug this reading is a wrong turn of. */
  concept: string;
  /** The wrong reading as ONE clause in the learner's terms, verb-first
   *  ("treated correlation as proof of causation") so the repair can say
   *  "You treated correlation as proof of causation, but on page N…". */
  wrongReading: string;
  /** What the page actually says instead — one clause, the correction. */
  correction: string;
  /** VERBATIM quote from the page the correction rests on. Verified by
   *  verifyChapterMisconception before storage (accuracy law). */
  evidenceQuote: string;
  sourceRef: MisconceptionSourceRef;
  provenance: string[];
  /** Prior probability this reading is the fault when it matches. */
  confidencePrior: number;
}

/** The per-book store, keyed by concept + page. Serializable — it rides
 *  learner.json as `misconception_library` (learner.ts). */
export type MisconceptionLibrary = Record<string, ChapterMisconception[]>;

export const libraryKey = (concept: string, page: number): string => `${concept}:${page}`;

/** Dedupe-append verified entries into the store. Pure. */
export function storeChapterMisconceptions(
  library: MisconceptionLibrary,
  entries: ChapterMisconception[],
): MisconceptionLibrary {
  if (entries.length === 0) return library;
  const out: MisconceptionLibrary = { ...library };
  for (const m of entries) {
    const key = libraryKey(m.concept, m.sourceRef.page);
    const existing = out[key] ?? [];
    if (existing.some((e) => e.id === m.id)) continue;
    out[key] = [...existing, m];
  }
  return out;
}

/** Every known wrong reading of a concept — all pages, or one page's. */
export function misconceptionsForConcept(
  library: MisconceptionLibrary,
  concept: string,
  page?: number,
): ChapterMisconception[] {
  if (page !== undefined) return library[libraryKey(concept, page)] ?? [];
  const out: ChapterMisconception[] = [];
  for (const [key, list] of Object.entries(library)) {
    if (key.startsWith(`${concept}:`)) out.push(...list);
  }
  return out;
}

// --- verification (the accuracy law, mechanized) ----------------------------

/** Normalize for quote containment: case, curly quotes, whitespace. */
const normText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** A quote shorter than this cannot be verified — and unverifiable is
 *  unverified. */
export const MIN_QUOTE_CHARS = 12;

/**
 * Book-verify one candidate against the page it claims to come from: the
 * evidence quote must appear VERBATIM (modulo case/whitespace/quotes) in
 * the page text, and both clauses must be present. Anything else is
 * invented, and invented repairs are dropped before they can be stored.
 */
export function verifyChapterMisconception(
  m: Pick<ChapterMisconception, 'wrongReading' | 'correction' | 'evidenceQuote'>,
  pageText: string,
): boolean {
  if (m.wrongReading.trim().length === 0 || m.correction.trim().length === 0) return false;
  const quote = normText(m.evidenceQuote);
  if (quote.length < MIN_QUOTE_CHARS) return false;
  return normText(pageText).includes(quote);
}

// --- generation (pre-generate per chapter, then verify) ---------------------

const GENERATE_SYSTEM = `You are preparing a tutor's notes on the wrong readings a real reader may take from a book page. Given a concept and the page's text, list up to 3 plausible WRONG READINGS of that concept a reader could honestly walk away with — misreadings of what THIS page says, never invented topics.

For each wrong reading give:
- "wrong_reading": the wrong reading as ONE clause in the reader's terms, starting with a verb ("treated correlation as proof of causation", "thought the limit must be attained").
- "correction": what the page actually says instead, one clause.
- "evidence_quote": a VERBATIM sentence copied character-for-character from the page text that the correction rests on. If no sentence on the page grounds the correction, drop the wrong reading.

Respond with ONLY a JSON object, no prose, no code fences:
{"misconceptions": [{"wrong_reading": string, "correction": string, "evidence_quote": string}]}`;

/** Generation cap — a chapter's key concept has a handful of classic
 *  wrong turns, not a catalogue (LEARNING_SCIENCE §11: 2–4 turn budget). */
export const MAX_GENERATED_PER_CONCEPT = 3;

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .split('_')
    .slice(0, 5)
    .join('_');

/** Lenient JSON extraction (same discipline as diagnose.ts): strip fences,
 *  slice from the first '{' to the last '}', else null. */
function lenientParseObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface GenerateMisconceptionsInput {
  /** Ledger concept slug. */
  concept: string;
  /** 1-based page the concept is read on. */
  page: number;
  /** The page's text — the ONLY ground truth candidates are checked against. */
  pageText: string;
  aiSettings?: AISettings | null;
  signal?: AbortSignal;
}

/**
 * The generation+verify pipeline (Wave 4): the model PROPOSES the common
 * wrong readings of a concept on a page; every candidate is then
 * book-verified against the page text and the unverifiable ones are
 * dropped. Returns only grounded entries — and [] on any failure (no
 * provider, timeout, malformed JSON). Never throws, never fabricates:
 * a missing library falls back to the hint ladder; a fabricated one
 * would teach a wrong book.
 */
export async function generateChapterMisconceptions(
  input: GenerateMisconceptionsInput,
): Promise<ChapterMisconception[]> {
  const { aiSettings, signal } = input;
  if (!aiSettings?.enabled) return [];
  let model;
  try {
    model = getAIProvider(aiSettings).getModel();
  } catch {
    return [];
  }
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const { text } = await generateText({
      model,
      system: GENERATE_SYSTEM,
      prompt: `Concept: ${input.concept}\n\nPage ${input.page} text:\n${input.pageText}`,
      abortSignal: combined,
    });
    const raw = lenientParseObject(text);
    const list = raw && Array.isArray(raw['misconceptions']) ? raw['misconceptions'] : [];
    const out: ChapterMisconception[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      if (out.length >= MAX_GENERATED_PER_CONCEPT) break;
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Record<string, unknown>;
      const wrongReading =
        typeof rec['wrong_reading'] === 'string' ? rec['wrong_reading'].trim() : '';
      const correction = typeof rec['correction'] === 'string' ? rec['correction'].trim() : '';
      const evidenceQuote =
        typeof rec['evidence_quote'] === 'string' ? rec['evidence_quote'].trim() : '';
      // The accuracy law, mechanized: unverifiable against the page → dropped.
      if (!verifyChapterMisconception({ wrongReading, correction, evidenceQuote }, input.pageText))
        continue;
      const slug = slugify(wrongReading);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({
        id: `${input.concept}.${slug}`,
        concept: input.concept,
        wrongReading,
        correction,
        evidenceQuote,
        sourceRef: { page: input.page },
        provenance: ['wave4-generated', 'book-verified'],
        confidencePrior: 0.5,
      });
    }
    return out;
  } catch {
    return [];
  }
}
