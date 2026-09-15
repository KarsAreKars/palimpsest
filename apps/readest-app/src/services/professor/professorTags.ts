/**
 * Workbench transcript tag parser (Workbench 2.1).
 *
 * The professor's streamed workbench messages end with protocol tags on
 * their own lines — [CONCEPT:name], [QKIND:kind], optionally [WORKBENCH:END]
 * to close the session, and [POINT:…] for a one-line takeaway. The UI renders
 * the display markdown (typeset $$ math via Streamdown) and consumes the
 * tags separately for the study log / session state.
 *
 * Contract:
 *  - Tags are case-sensitive as spec'd: [CONCEPT:…] strips, [concept:…] is
 *    left untouched.
 *  - Unknown ALL-CAPS bracket tags are removed too, but capture nothing.
 *  - Malformed brackets (no closing ], lowercase names) pass through intact.
 *  - $$ … $$ math blocks are never mangled: unknown-tag scanning skips
 *    them, so a matrix literal like [A] or an interval [0,1] inside math
 *    survives. The four protocol tags are the exception: they are scanned
 *    FIRST, everywhere — an unterminated $$ must not shield [CONCEPT:leak]
 *    from the protocol, and those uppercase protocol names cannot
 *    legitimately appear inside math anyway.
 */

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
}

/** All-caps bracket-tag shape: NAME or NAME:value. Case-sensitive. */
const TAG_PATTERN = /\[([A-Z][A-Z0-9_-]*)(?::([^\]\n]*))?\]/g;

/** The four protocol tags, scanned even inside math shields — their
 *  uppercase names cannot legitimately appear in math ([0,1] can). */
const PROTOCOL_TAG = /\[(CONCEPT|QKIND|WORKBENCH|POINT)(?::([^\]\n]*))?\]/g;

/** Split out $$ … $$ display math (an unterminated $$ protects to end-of-
 *  string rather than leaking tag-stripping into the tail). */
const MATH_SPLIT = /(\$\$[\s\S]*?(?:\$\$|$))/g;

export function parseProfessorTags(raw: string): ParsedProfessorMessage {
  let concept: string | undefined;
  let qkind: string | undefined;
  let end = false;
  let point: string | undefined;

  const captureProtocol = (_match: string, name: string, value?: string): string => {
    const v = (value ?? '').trim();
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
      default:
        break;
    }
    return '';
  };

  // Pass 1 — protocol tags are captured wherever they appear, even inside
  // an unterminated $$ shield ("$$x^2 + 1\n[CONCEPT:leak]" must not leak).
  const withoutProtocol = raw.replace(PROTOCOL_TAG, captureProtocol);

  // Pass 2 — unknown ALL-CAPS tags are stripped only OUTSIDE math shields,
  // so real math like [0,1] stays protected.
  const stripSegment = (segment: string): string =>
    segment
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
  return parsed;
}
