/**
 * Workbench transcript tag parser (Workbench 2.1).
 *
 * The professor's streamed workbench messages end with protocol tags on
 * their own lines — [CONCEPT:name], [QKIND:kind], optionally [WORKBENCH:END]
 * to close the session, and [POINT:…] for a one-line takeaway. Workbench 2.x
 * adds the pedagogy + structure vocabulary: [PROBE], [CONCEPTS known:…;
 * edge:…; unknown:…], [TEACHBACK ask:…], [EVALUATION], [LOOK page:N[,M]],
 * [DERIVE title:… goal:…], [STEP n /CHECKED ok|bad], [DIAGRAM claim:…], and
 * [VOICE]. The UI renders the display markdown (typeset $$ math via
 * Streamdown) and consumes the tags separately for the study log / session
 * state.
 *
 * Contract:
 *  - Tags are case-sensitive as spec'd: [CONCEPT:…] strips, [concept:…] is
 *    left untouched.
 *  - Unknown ALL-CAPS bracket tags are removed too, but capture nothing.
 *    A colon body or bare name is stripped wherever it appears; a space
 *    body ([NAME body…]) only in protocol position — the bracket on its
 *    own line — so mid-prose brackets like [NOTE see: below] pass
 *    through untouched.
 *  - Malformed brackets (no closing ], lowercase names) pass through intact.
 *  - $$ … $$ math blocks are never mangled: unknown-tag scanning skips
 *    them, so a matrix literal like [A] or an interval [0,1] inside math
 *    survives. The four protocol tags are the exception: they are scanned
 *    FIRST, everywhere — an unterminated $$ must not shield [CONCEPT:leak]
 *    from the protocol, and those uppercase protocol names cannot
 *    legitimately appear inside math anyway.
 */

/** [CONCEPTS …] — concept names in three shelves, as emitted. */
export interface ConceptMapShelves {
  known: string[];
  edge: string[];
  unknown: string[];
}

export interface ParsedProfessorMessage {
  /** Clean display markdown, tags stripped, math preserved verbatim. */
  display: string;
  /** [CONCEPT:name] — the concept this exchange is about. */
  concept?: string;
  /** [QKIND:kind] — define | why | how-connects | example | check-me. */
  qkind?: string;
  /** [WORKBENCH:END] — the professor closed the session. */
  end?: boolean;
  /** [POINT:…] — one-line takeaway, if the professor offered one. */
  point?: string;
  /** [PROBE] — the professor offers the stance chip row. */
  probe?: boolean;
  /** [CONCEPTS …] — the session's concept map at this point. */
  conceptMap?: ConceptMapShelves;
  /** [TEACHBACK ask:…] — this block requests a teach-back. */
  teachbackAsk?: string;
  /** [EVALUATION] — this block judges the most recent teach-back attempt. */
  evaluation?: boolean;
  /** [DERIVE title:.. goal:..] — a derivation folio opens in this block. */
  derive?: { title?: string; goal?: string };
  /** [STEP n /CHECKED ok|bad] — in display order; the desk renumbers. */
  stepMarks?: { professorChecked?: 'ok' | 'bad' }[];
  /** [DIAGRAM claim:..] — a figure slip; the SVG rides in a ```svg fence. */
  diagram?: { claim?: string };
  /** [PLOT f:..] — a computed function plot: LaTeX rules the DESK
   *  evaluates (never model-drawn data), optional `range:a,b`. Space-
   *  bodied and position-bound: the bracket must sit on its own line. */
  plot?: { fns: string[]; range?: [number, number] };
  /** [LOOK page:N,M] — page list (numbers only), capped at 4 at parse
   *  time; malformed values capture nothing. */
  look?: number[];
  /** [VOICE] — the professor asked that this turn be heard (never
   *  displayed). Value ignored. */
  voice?: boolean;
}

/** All-caps bracket-tag shape: NAME or NAME:value. Case-sensitive. */
const TAG_PATTERN = /\[([A-Z][A-Z0-9_-]*)(?::([^\]\n]*))?\]/g;

/** The protocol tags, scanned even inside math shields — their uppercase
 *  names cannot legitimately appear in math ([0,1] can). One regex, three
 *  arms (campaign audit R2, with one consistency fix): CONCEPTS/TEACHBACK
 *  and — because their grammars are space-joined key:value bodies, which
 *  R2's colon-only arm could never match — DERIVE/DIAGRAM/LOOK share the
 *  space-body arm; STEP carries a numeral and an optional /CHECKED tail;
 *  the rest carry a colon value or nothing. The space arm requires a
 *  lowercase `key:` after the space, so prose like `[NOTE see: below]`
 *  still passes through untouched (R2's load-bearing rationale). */
const PROTOCOL_TAG =
  /\[(CONCEPTS|TEACHBACK|DERIVE|DIAGRAM|LOOK)(?:[ \t]+[a-z][A-Za-z0-9_-]*:[^\]\n]*|:[^\]\n]*)?\]|\[(STEP)(?:[ \t]+\d+)?(?:[ \t]*\/CHECKED[ \t]+(?:ok|bad))?[ \t]*\]|\[(CONCEPT|QKIND|WORKBENCH|POINT|PROBE|EVALUATION|VOICE)(?::([^\]\n]*))?\]/g;

/** [PLOT …] — the computed-plot tag. Unlike DERIVE/DIAGRAM it is
 *  POSITION-BOUND: the bracket must occupy its own line (the task's
 *  own-line rule). Mid-prose [PLOT f:…] is prose and passes through
 *  untouched; a malformed own-line body is consumed silently, capturing
 *  nothing (same fate the unknown-tag strip would give it). */
const PLOT_LINE_TAG = /^[ \t]*\[PLOT[ \t]+(f:[^\]\n]*)\][ \t]*$/gm;

/** Split on a separator at paren/brace depth 0 only — a comma inside
 *  `g(1, x)` or `\frac{1}{2}` never splits a function list. */
const splitTopLevel = (s: string, sep: ';' | ','): string[] => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
};

/** Body grammar: `f:rule, rule` sections split on top-level `;`, with an
 *  optional `range:a,b` (finite, ascending). No fns → nothing built. */
const parsePlotBody = (body: string): { fns: string[]; range?: [number, number] } | undefined => {
  let fns: string[] = [];
  let range: [number, number] | undefined;
  for (const section of splitTopLevel(body, ';')) {
    const s = section.trim();
    if (s.startsWith('f:')) {
      fns = splitTopLevel(s.slice(2), ',')
        .map((f) => f.trim())
        .filter(Boolean);
    } else if (s.startsWith('range:')) {
      const m = /^range:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (Number.isFinite(a) && Number.isFinite(b) && a < b) range = [a, b];
      }
    }
  }
  if (fns.length === 0) return undefined;
  return { fns, ...(range ? { range } : {}) };
};

/** Unknown space-bodied ALL-CAPS tag in protocol position: the bracket
 *  occupies its own line (the "tags on their own lines" contract). The
 *  name and body are captured positionally but recorded nowhere — the
 *  strip is silent by design. Mid-prose ALL-CAPS brackets are prose
 *  (see the doc comment above), so this pattern is line-anchored. */
const LINE_TAG_PATTERN = /^[ \t]*\[([A-Z][A-Z0-9_-]*)[ \t]([^\]\n]*)\][ \t]*$/gm;

/** Split out $$ … $$ display math (an unterminated $$ protects to end-of-
 *  string rather than leaking tag-stripping into the tail). */
const MATH_SPLIT = /(\$\$[\s\S]*?(?:\$\$|$))/g;

export function parseProfessorTags(raw: string): ParsedProfessorMessage {
  let concept: string | undefined;
  let qkind: string | undefined;
  let end = false;
  let point: string | undefined;
  let probe = false;
  let conceptMap: ConceptMapShelves | undefined;
  let teachbackAsk: string | undefined;
  let evaluation = false;
  let derive: { title?: string; goal?: string } | undefined;
  let stepMarks: { professorChecked?: 'ok' | 'bad' }[] | undefined;
  let diagram: { claim?: string } | undefined;
  let plot: { fns: string[]; range?: [number, number] } | undefined;
  let look: number[] | undefined;
  let voice = false;

  // Pass 0 — [PLOT …] is line-anchored (protocol position only): captured
  // here, before the everywhere-scan, so a mid-prose [PLOT f:…] survives
  // as prose. Scanned first like the other protocol tags, so an
  // unterminated $$ cannot shield it.
  const withoutPlot = raw.replace(PLOT_LINE_TAG, (_match, body: string) => {
    const parsedPlot = parsePlotBody(body);
    if (parsedPlot) plot = parsedPlot;
    return '';
  });

  // The regex carries four groups — (CONCEPTS|TEACHBACK), (STEP),
  // (CONCEPT|…|VOICE), and its colon value — so the callback receives them
  // positionally: the name is whichever group participated, and only the
  // third arm's value is a real capture.
  const captureProtocol = (
    _match: string,
    shelfOrTeachback: string | undefined,
    step: string | undefined,
    colonName: string | undefined,
    colonValue: string | undefined,
  ): string => {
    const name = shelfOrTeachback ?? step ?? colonName;
    if (!name) return '';
    const value = colonName !== undefined ? colonValue : undefined;
    // The space-joined bodies ([CONCEPTS known:…], [TEACHBACK ask:…]) and
    // the step mark capture no value group — recover the body from the
    // match itself (text between `[NAME` and the closing `]`).
    const body = value ?? _match.slice(name.length + 1, -1);
    const v = body.trim();
    switch (name) {
      case 'CONCEPT':
        if (v) concept = v;
        break;
      case 'QKIND':
        if (v) qkind = v;
        break;
      case 'POINT':
        if (v) point = v;
        break;
      case 'WORKBENCH':
        if (v === 'END') end = true;
        break;
      case 'PROBE':
        probe = true;
        break;
      case 'EVALUATION':
        evaluation = true;
        break;
      case 'VOICE':
        voice = true; // value ignored
        break;
      case 'TEACHBACK': {
        const ask = body.replace(/^[ \t]+/, ''); // strip the space-joined body's lead
        const m = /^ask:(.*)$/s.exec(ask);
        if (m?.[1]?.trim()) teachbackAsk = m[1].trim();
        break;
      }
      case 'CONCEPTS': {
        const grab = (key: string): string[] => {
          const re = new RegExp(`${key}:([^;\\]]*)`);
          const hit = re.exec(v);
          if (!hit) return [];
          return (hit[1] ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        };
        conceptMap = { known: grab('known'), edge: grab('edge'), unknown: grab('unknown') };
        break;
      }
      case 'DERIVE': {
        // Split on the LAST ` goal:`; the head loses its leading `title:`.
        const goalIdx = v.lastIndexOf(' goal:');
        const pre = goalIdx >= 0 ? v.slice(0, goalIdx) : v;
        // A goal-only folio ([DERIVE goal:x = 2]): the pre-split segment
        // IS the goal, so no title was given — an empty title, not the
        // whole `goal:x = 2` string as the title.
        if (pre.startsWith('goal:')) {
          const goalOnly = pre.slice('goal:'.length).trim();
          derive = { ...(goalOnly ? { goal: goalOnly } : {}) };
          break;
        }
        const head = pre.replace(/^title:/, '').trim();
        const goal = goalIdx >= 0 ? v.slice(goalIdx + ' goal:'.length).trim() : '';
        derive = {
          ...(head ? { title: head } : {}),
          ...(goal ? { goal } : {}),
        };
        break;
      }
      case 'STEP': {
        const m = /^\[STEP(?:[ \t]+(\d+))?(?:[ \t]*\/CHECKED[ \t]+(ok|bad))?[ \t]*\]$/.exec(_match);
        const numeral = m?.[1];
        const checked = m?.[2] as 'ok' | 'bad' | undefined;
        // Rebuild the value so the step value parse below works verbatim
        // (audit R2): [STEP] → '' → captures {}, tag still consumed.
        const stepValue = `${numeral ?? ''}${checked ? ` /CHECKED ${checked}` : ''}`.trim();
        const parsedStep = /^\s*\d+\s*(?:\/CHECKED\s+(ok|bad))?\s*$/.exec(stepValue);
        stepMarks = [
          ...(stepMarks ?? []),
          parsedStep ? { professorChecked: parsedStep[1] as 'ok' | 'bad' | undefined } : {},
        ];
        break;
      }
      case 'DIAGRAM': {
        const claim = v.replace(/^claim:/, '').trim();
        if (claim) diagram = { claim }; // empty claim → nothing built
        break;
      }
      case 'LOOK': {
        const m = /^page:(\d+(?:\s*,\s*\d+)*)$/.exec(v);
        // The parse caps the list at four pages; malformed values capture
        // nothing.
        if (m?.[1])
          look = m[1]
            .split(/\s*,\s*/)
            .map(Number)
            .slice(0, 4);
        break;
      }
      default:
        break;
    }
    return '';
  };

  // Pass 1 — protocol tags are captured wherever they appear, even inside
  // an unterminated $$ shield ("$$x^2 + 1\n[CONCEPT:leak]" must not leak).
  const withoutProtocol = withoutPlot.replace(PROTOCOL_TAG, captureProtocol);

  // Pass 2 — unknown ALL-CAPS tags are stripped only OUTSIDE math shields,
  // so real math like [0,1] stays protected. A space-bodied tag ([NAME body…])
  // additionally must sit in protocol position (its own line): mid-prose
  // ALL-CAPS brackets are prose, e.g. [NOTE see: below].
  const stripSegment = (segment: string): string =>
    segment
      .replace(LINE_TAG_PATTERN, () => '') // space-bodied: protocol position only
      .replace(TAG_PATTERN, () => '') // protocol names are already gone: capture nothing
      .replace(/(?<=\S) {2,}(?=\S)/g, ' ') // a removed tag may leave a double space
      .replace(/[ \t]+\n/g, '\n'); // and trailing space on an emptied line

  const display = withoutProtocol
    .split(MATH_SPLIT)
    .map((segment, i) => (i % 2 === 1 ? segment : stripSegment(segment)))
    .join('')
    .trim();

  const parsed: ParsedProfessorMessage = { display };
  if (concept !== undefined) parsed.concept = concept;
  if (qkind !== undefined) parsed.qkind = qkind;
  if (end) parsed.end = true;
  if (point !== undefined) parsed.point = point;
  if (probe) parsed.probe = true;
  if (conceptMap) parsed.conceptMap = conceptMap;
  if (teachbackAsk !== undefined) parsed.teachbackAsk = teachbackAsk;
  if (evaluation) parsed.evaluation = true;
  if (derive) parsed.derive = derive;
  if (stepMarks) parsed.stepMarks = stepMarks;
  if (diagram) parsed.diagram = diagram;
  if (plot) parsed.plot = plot;
  if (look !== undefined) parsed.look = look;
  if (voice) parsed.voice = true;
  return parsed;
}
