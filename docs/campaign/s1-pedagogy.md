# S1 — Pedagogy: Probe chips, the concept-map slip, teach-back

**Campaign:** Workbench 2.x — "The Living Desk" (`docs/WORKBENCH_2_X_CAMPAIGN.md`)
**Owner items:** 1 (probe chips + concept map) and 6 (teach-back)
**Lane:** A — owns `workbenchChat.ts`, `professorTags.ts`, `prompt.ts`, `WorkbenchTab.tsx/.css`
**Design world:** The Antiquarian Catalogue — librarian voice, stamp `#8C3B22` (`var(--stamp)`) as the sole accent, light mode, unlayered CSS, no machinery talk.

---

## 1. What is being built

Three additions to the block transcript, all **additive-only** (campaign non-negotiables 1, 4, 5):

1. **Probe chips.** When a thread starts, the professor offers a chip row — `lead me` / `ask me first` / `I will work it` — before he teaches. A learner message containing "I don't know" (anywhere in the text) is a first-class probe signal: it is surfaced in the UI and is **never graded** — not by the silent checker, not by the professor's pedagogy.
2. **The concept map.** A running known / edge / unknown catalogue of concepts, maintained by the professor across the session via a protocol tag, rendered as a compact three-column desk slip; every chip is clickable and opens the transcript thread where that concept was last discussed.
3. **Teach-back.** The professor asks the learner to restate a step in their own words (`[TEACHBACK ask:…]`); the learner's next block is the attempt; the professor's following block, marked `[EVALUATION]`, compares the restatement against the book's actual statement — grounded, kind, specific.

Nothing is removed or rewritten. Every change is a new optional field, a new tag name in the scanner's existing alternation, or an appended paragraph in the addendum.

---

## 2. Protocol tags (exact strings, additive)

Parsed in `apps/readest-app/src/services/professor/professorTags.ts` by the existing two-pass scanner (`parseProfessorTags`, line 47; protocol regex `PROTOCOL_TAG`, line 41). Tags are case-sensitive, never displayed, each on its own line at the very end of a message (same contract as the four existing tags).

| Tag | Shape | Meaning |
|---|---|---|
| `[PROBE]` | bare, no value | This professor block offers the stance chip row. |
| `[CONCEPTS known:.. edge:.. unknown:..]` | key:value groups, `;` between groups, `,` between names | The session's concept map at this moment. Example: `[CONCEPTS known:Fourier series, orthogonality; edge:convergence; unknown:Parseval's identity]`. Groups may be omitted (empty). Concept names are plain words, same convention as `[CONCEPT:name]`. |
| `[TEACHBACK ask:..]` | one-line value | The professor asks the learner to restate something in their own words. The value is the ask, in the professor's voice. The learner's **next** block is the attempt. |
| `[EVALUATION]` | bare | This professor block evaluates the learner's most recent teach-back attempt. |

### 2.1 Scanner changes (`professorTags.ts`)

**`PROTOCOL_TAG` (line 41)** — extend the alternation additively, keeping the existing four names first:

```ts
const PROTOCOL_TAG =
  /\[(CONCEPT|QKIND|WORKBENCH|POINT|PROBE|CONCEPTS|TEACHBACK|EVALUATION)(?::([^\]\n]*))?\]/g;
```

Note: `[CONCEPTS known:…]` and `[TEACHBACK ask:…]` carry a **space-separated** key:value body, so the colon is not immediately after the name. The alternation still matches because after `CONCEPTS` the regex's `(?::…)?` group is optional and `\]` fails — **the match must be allowed to continue past the name**. Replace the regex wholesale with one that matches an optional value of either shape:

```ts
const PROTOCOL_TAG =
  /\[(CONCEPT|QKIND|WORKBENCH|POINT|PROBE|CONCEPTS|TEACHBACK|EVALUATION)(?::([^\]\n]*)|[ \t]+[a-z][A-Za-z0-9_-]*:[^\]\n]*)?\]/g;
```

(`[PROBE]` and `[EVALUATION]` match via the optional group being absent; `[CONCEPTS …]`/`[TEACHBACK …]` match via the new `|[ \t]+[a-z]…:[^\]\n]*` arm. For these two, `value` — the part after the name — arrives as ` known:Fourier series; edge:…` and is parsed further inside `captureProtocol`.)

**`captureProtocol` (line 53)** — add cases, all trimming and last-wins exactly like the existing ones:

```ts
case 'PROBE':
  probe = true;
  break;
case 'EVALUATION':
  evaluation = true;
  break;
case 'TEACHBACK': {
  const ask = v.replace(/^[ \t]+/, '');           // strip the leading space of the space-joined body
  const m = /^ask:(.*)$/s.exec(ask);
  if (m && m[1].trim()) teachbackAsk = m[1].trim();
  break;
}
case 'CONCEPTS': {
  const body = v.replace(/^[ \t]+/, '');
  const grab = (key: string): string[] => {
    const re = new RegExp(`${key}:([^;\\]]*)`);
    const hit = re.exec(body);
    if (!hit) return [];
    return hit[1].split(',').map((s) => s.trim()).filter(Boolean);
  };
  conceptMap = { known: grab('known'), edge: grab('edge'), unknown: grab('unknown') };
  break;
}
```

(The `grab` regexes rely on the `;` group separator; a name containing `;` or `,` is out of contract — same plain-words rule as `[CONCEPT:name]`.)

**Pass 2 is untouched.** Unknown ALL-CAPS tags are still stripped outside `$$` shields only; the four new protocol names are consumed in pass 1 exactly like the existing four, so the math-shield guarantees in the header comment (matrix literals, `[0,1]` intervals survive; an unterminated `$$` must not shield a protocol tag) extend to the new tags unchanged.

**`ParsedProfessorMessage` (line 23)** — add, and add the shared map type here (this file is the parse layer; `workbenchChat.ts` imports it — never the reverse, no cycle):

```ts
/** [CONCEPTS …] — concept names in three shelves, as emitted. */
export interface ConceptMapShelves {
  known: string[];
  edge: string[];
  unknown: string[];
}

export interface ParsedProfessorMessage {
  display: string;
  concept?: string;
  qkind?: string;
  end?: boolean;
  point?: string;
  /** [PROBE] — the professor offers the stance chip row. */
  probe?: boolean;
  /** [CONCEPTS …] — the session's concept map at this point. */
  conceptMap?: ConceptMapShelves;
  /** [TEACHBACK ask:…] — this block requests a teach-back. */
  teachbackAsk?: string;
  /** [EVALUATION] — this block judges the most recent teach-back attempt. */
  evaluation?: boolean;
}
```

### 2.2 Streaming: `stripPartialTagTail` (`workbenchChat.ts` line 166)

The existing tail regex `/[ \t]*\[[A-Z][A-Z0-9_-]*(?::[^\]\n]*)?\]?(?=[ \t\n]*$)/` only strips a complete-or-partial tag whose value starts with `:`. A streamed partial ending `[CONCEPTS known:Fourier` would strip only `[CONCEPTS` and flash ` known:Fourier` at the reader. Extend the optional-value group with the same space-joined arm (additive, one line):

```ts
const tag =
  /[ \t]*\[[A-Z][A-Z0-9_-]*(?::[^\]\n]*|[ \t]+[a-z][A-Za-z0-9_-]*:[^\]\n]*)?\]?(?=[ \t\n]*$)/.exec(text);
```

The trailing-lone-`[` arm below it is unchanged. This is the same "never let a half-tag reach the eye" rule the function already carries.

---

## 3. Transcript model (`workbenchChat.ts`, additive fields only)

**Do not add new values to `WorkbenchBlock['kind']`.** That union lives in `services/professor/workbenchSession.ts` (`WorkbenchBlock`, line ~31), which is lane **B**'s file and must not be edited by this wave. Block identity for the three new shapes comes from new optional fields on `TranscriptBlock` (line 22). This also satisfies back-compat by construction: old blocks lack the fields, new renderers treat missing fields as plain prose.

```ts
import type { ConceptMapShelves } from '@/services/professor/professorTags';

/** The three stances on the probe chip row, in display order. */
export type ProbeStance = 'lead' | 'ask' | 'work';

export interface ConceptMapEntry {
  name: string;
  /** Transcript block id of the most recent professor block about this
   *  concept ([CONCEPT:name] match), or null when the name is new. */
  threadId: string | null;
}

export interface ConceptMapData {
  known: ConceptMapEntry[];
  edge: ConceptMapEntry[];
  unknown: ConceptMapEntry[];
}

export interface TranscriptBlock extends WorkbenchBlock {
  concept?: string;
  qkind?: string;
  point?: string;
  ended?: boolean;
  /** [PROBE] — this professor block offers the stance chip row. */
  probe?: boolean;
  /** Set when the learner picked a stance from this block's chip row. */
  probePicked?: ProbeStance;
  /** [CONCEPTS …] — the session's concept map at this point (latest block
   *  carrying the field wins; the slip renders from the latest). */
  conceptMap?: ConceptMapData;
  /** On a professor block: [TEACHBACK ask:…]. On the following user block:
   *  the ask this attempt answers (set by the composer, §5). */
  teachbackAsk?: string;
  /** [EVALUATION] — id of the user teach-back attempt block this block judges. */
  teachbackOf?: string;
}
```

### 3.1 New pure helpers (side-effect free, next to `commitProfessorBlock`)

```ts
/** "I don't know" as a first-class signal — anywhere in the message, any
 *  casing. Surfaced, never graded. */
export const PROBE_SIGNAL_PATTERN =
  /\b(i don'?t know|i do not know|i have no idea|no idea)\b/i;
export const isProbeSignal = (content: string): boolean =>
  PROBE_SIGNAL_PATTERN.test(content);

/** The latest concept-map shelves carried by any block, or null. */
export const latestConceptMap = (blocks: TranscriptBlock[]): ConceptMapData | null =>
  [...blocks].reverse().find((b) => b.conceptMap)?.conceptMap ?? null;

/** Resolve each concept name to the id of the most recent block that
 *  carried it as [CONCEPT:name]. Names never yet discussed get null. */
export function resolveConceptThreads(
  blocks: TranscriptBlock[],
  shelves: ConceptMapShelves,
): ConceptMapData;
```

`resolveConceptThreads` walks `blocks` once, keeping a `Map<string, string>` of concept name → block id (professor blocks only, later wins), then maps the three shelves.

### 3.2 `commitProfessorBlock` (line 141)

Additive assignments after the existing four, using the already-passed `existing` array:

```ts
if (parsed.probe) block.probe = true;
if (parsed.conceptMap) {
  block.conceptMap = resolveConceptThreads(existing, parsed.conceptMap);
}
if (parsed.teachbackAsk) block.teachbackAsk = parsed.teachbackAsk;
if (parsed.evaluation) {
  const attempt = [...existing]
    .reverse()
    .find((b) => b.author === 'user' && typeof b.teachbackAsk === 'string');
  if (attempt) block.teachbackOf = attempt.id;
}
```

The greeting rule (first professor block gets `kind: 'greeting'`) is untouched.

### 3.3 Persistence — no version bump

`serializeTranscript` (line 182) JSON-stringifies whole blocks, so the new fields ride along with no change. `isBlock` (line 195) validates only `id`/`author`/`content`/`at`, so (a) 2.1 transcripts parse cleanly, and (b) new-field transcripts parse under old code. **Keep `TRANSCRIPT_VERSION = 1`.** Graceful-degradation rule (campaign non-negotiable 5): any block whose shape the renderer doesn't recognise renders as plain prose — guaranteed here because every new field is optional and renderers gate on it.

---

## 4. Prompt addendum (`prompt.ts`, additive-only)

**Non-negotiable 4:** new prompt material is appended to `PROFESSOR_WORKBENCH_ADDENDUM` (line 117) only; `PROFESSOR_SYSTEM_PROMPT` and every existing line of the addendum stay byte-identical (`professor-prompt.test.ts` guards them). Append exactly this paragraph to the template literal, after the "Citations:" line, before the closing backtick:

```
PROBE BEFORE YOU TEACH — when a thread starts, do not lecture first. Offer the student their choice of stance with [PROBE] on its own line after your opening words; the desk shows three chips and the student picks one: "lead me" (you demonstrate, they follow), "ask me first" (you question, they reason), "I will work it" (you watch, they attempt). Teach according to the chosen stance.
"I don't know" is a first-class signal, never a wrong answer. When the student says it — in any words ("I don't know", "no idea", "I have no idea") — never grade it, never count it as a failed attempt, and never climb the disclosure ladder past rung 1 in response. Mark the honest not-knowing warmly and probe the nearest edge instead.
THE CONCEPT MAP — maintain the session's catalogue with [CONCEPTS known:name, name; edge:name; unknown:name] on its own line at the end of a message, whenever the map changes: known = the student has explained it back correctly at least once; edge = the student has touched it but wavers; unknown = not yet approached. List only what the session has actually established; keep names in plain words, reuse the exact spelling of earlier [CONCEPT:name] tags. The desk renders it as a slip the student can travel from.
TEACH-BACK — when the student has just grasped something, have them restate the load-bearing step in their own words: end your message with [TEACHBACK ask:the restatement you want] on its own line, then stop and wait. Their next block is the attempt — do not answer for them. Your following message ends with [EVALUATION] on its own line and compares their restatement against what the book actually says: name precisely what they got right (quote their words back), correct the exact divergence by pointing at the book's own statement with a page anchor, and keep the tone of a patient colleague — specific, never vague, never harsh. If their restatement is faithful, say so plainly and raise the stakes with one slightly harder follow-up.
```

No changes to `buildProfessorUserMessage`, `composeWorkbenchOpening`, or `composeWorkbenchTurnMessage` (all in lane-A/B seams the professor already reads: the probe chip pick arrives as an ordinary student message, and "I don't know" arrives verbatim in `The student now says: …`). The professor needs no new plumbing to see either signal.

---

## 5. Rendering (`WorkbenchTab.tsx` / `WorkbenchTab.css`)

All strings via `useTranslation()`'s `_()`; protocol tags never displayed; no mid-session buttons except the chip row, which **is** the sanctioned interaction (the chips replace a typed message; after a pick they become inert). Chips follow the existing `wb-chip` face (Special Elite 8.5px, 2px radius, muted border) and the `button.wb-chip` focus ring already in the CSS.

### 5.1 String table (exact `_()` keys — every user-facing string)

| Context | Key | English |
|---|---|---|
| Probe chip | ` _('Lead me')` | `Lead me` |
| Probe chip | ` _('Ask me first')` | `Ask me first` |
| Probe chip | ` _('I will work it')` | `I will work it` |
| Probe chip aria | ` _('Choose how the professor guides you')` | `Choose how the professor guides you` |
| Probe picked (chip suffix, stamp) | ` _('Chosen')` | `Chosen` |
| Probe-signal marker on user block | ` _('Said honestly: not yet known')` | `Said honestly: not yet known` |
| Concept slip caption | ` _('The catalogue so far')` | `The catalogue so far` |
| Map column heads | ` _('KNOWN')` / ` _('EDGE')` / ` _('UNKNOWN')` | `KNOWN` / `EDGE` / `UNKNOWN` |
| Map chip aria | ` _('Open the thread on {{concept}}')` | `Open the thread on {{concept}}` |
| Map empty shelf | ` _('Nothing filed here yet')` | `Nothing filed here yet` |
| Teach-back caption on the attempt block (byline area) | ` _('The professor asked you to restate it — in your own words')` | `The professor asked you to restate it — in your own words` |
| Teach-back ask label | ` _('His question: {{ask}}')` | `His question: {{ask}}` |
| Evaluation marker | ` _('His reading of your restatement')` | `His reading of your restatement` |

(The three stance chip labels are also the exact text sent as the student message on pick: `Lead me`, `Ask me first`, `I will work it` — title case, no punctuation.)

### 5.2 Components

**`ProbeRow`** — new presentational component next to `BlockChips` (line 209):

```ts
const STANCES: { stance: ProbeStance; label: string }[] = [
  { stance: 'lead', label: 'Lead me' },
  { stance: 'ask', label: 'Ask me first' },
  { stance: 'work', label: 'I will work it' },
];

const ProbeRow: React.FC<{
  picked?: ProbeStance;
  onPick: (stance: ProbeStance, message: string) => void;
}> = ({ picked, onPick }) => {
  const _ = useTranslation();
  return (
    <div className='wb-probe-row' role='group' aria-label={_('Choose how the professor guides you')}>
      {STANCES.map(({ stance, label }) => (
        <button
          key={stance}
          type='button'
          className={`wb-chip wb-probe-chip${picked === stance ? ' wb-probe-picked' : ''}`}
          disabled={picked !== undefined}
          onClick={() => onPick(stance, _(label))}
        >
          {_(label)}
          {picked === stance && <span className='wb-probe-tick' aria-hidden='true'> {_('Chosen')}</span>}
        </button>
      ))}
    </div>
  );
};
```

**`ConceptMapSlip`** — new component, props `{ map: ConceptMapData; onOpen: (threadId: string) => void }`. Three shelves in a bordered slip under the professor prose of the block that carries `conceptMap`. Each entry is a `button.wb-chip.wb-map-chip` (`aria-label={_('Open the thread on {{concept}}', { concept: entry.name })}`), disabled (rendered as a muted span) when `threadId === null`. Empty shelf renders `<span className='wb-map-empty'>{_('Nothing filed here yet')}</span>`.

**Teach-back captions** — no new component: in the block render loop (line 859), additive conditionals inside the `<article>`:

```tsx
{b.author === 'user' && b.teachbackAsk && (
  <p className='wb-teachback-caption'>
    {_('The professor asked you to restate it — in your own words')}
    <span className='wb-teachback-ask'>{_('His question: {{ask}}', { ask: b.teachbackAsk })}</span>
  </p>
)}
{b.author === 'professor' && b.teachbackOf && (
  <p className='wb-teachback-caption'>{_('His reading of your restatement')}</p>
)}
```

**The composer (`send`, line 538)** — after `appendBlock(bookKey, userBlock)`, additive:

```ts
const prior = history[history.length - 2]; // the block before the one just appended... use pre-append history
if (prior?.author === 'professor' && prior.teachbackAsk && !prior.teachbackOf) {
  userBlock.teachbackAsk = prior.teachbackAsk;
}
if (isProbeSignal(text)) userBlock.probeSignal = true; // see field note below
```

(Field note: adding `probeSignal?: boolean` to `TranscriptBlock` is acceptable and additive — declare it alongside the §3 fields. It marks the block so the marker chip survives persistence without re-matching the regex at render.)

**Probe pick handler** — a `pickProbe(stance, message)` callback in the tab: sets `probePicked` on the probe block (new store action, §5.4) and then calls the same `send`-path with `message` (goes through `send()` so partial-commit, silent-check, and history all behave identically to a typed message). Because `send()` reads `value`, implement pick as: `setValue(message); send();` inside one handler — or factor `send`'s body to accept an optional override string; keep it minimal.

**`runSilentCheck` (line 432)** — additive guard at the top of the `withMath` filter: never grade a probe signal.

```ts
const withMath = candidates.filter(
  (b) =>
    b.author === 'user' &&
    !b.probeSignal &&
    extractMathSteps(b.content, b.id).length > 0,
);
```

**Marker chip** — in the block loop, next to `BlockChips` (line 867):

```tsx
{b.author === 'user' && b.probeSignal && (
  <div className='wb-chip-row'>
    <span className='wb-chip wb-chip-muted wb-idk' role='img' aria-label={_('Said honestly: not yet known')}>
      {_('Said honestly: not yet known')}
    </span>
  </div>
)}
```

(The chip is a `span`, not a button — it acts on nothing.)

**Concept slip placement** — in the block loop, after `renderContent(b.content)` for a professor block with `conceptMap`:

```tsx
{b.author === 'professor' && b.conceptMap && (
  <ConceptMapSlip map={b.conceptMap} onOpen={scrollToBlock} />
)}
```

`scrollToBlock(id)` (new callback, ~10 lines, mirrors `scrollToBottomAndRepin`'s reduced-motion guard): `scrollRef.current?.querySelector(\`article[data-bid="${id}"]\`)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })`.

**Probe row placement** — professor block with `probe`:

```tsx
{b.author === 'professor' && b.probe && (
  <ProbeRow picked={b.probePicked} onPick={pickProbe} />
)}
```

### 5.3 CSS (`WorkbenchTab.css`, appended, unlayered, light-first)

Follow the existing chip/slip recipes. Corners ≤ 2px, no shadows except `var(--lift-shadow)` on the floating slip, stamp `var(--stamp)` (`#8c3b22` per `src/styles/apothecary.css` line 46) as the only accent besides sage-on-✓.

```css
/* ---------- probe chips (S1) ---------- */
.wb-probe-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.wb-probe-chip:disabled {
  cursor: default;
  opacity: 0.75;
}

.wb-probe-picked,
.wb-probe-picked:disabled {
  color: var(--stamp);
  border-color: var(--stamp);
  opacity: 1;
}

.wb-probe-tick {
  margin-inline-start: 4px;
}

/* ---------- the concept-map slip (S1) ---------- */
.wb-map {
  margin-top: 8px;
  max-width: min(340px, 100%);
  border: 1px solid color-mix(in srgb, var(--ink) 25%, transparent);
  border-radius: 2px;
  background: var(--paper-light);
  padding: 8px 10px;
}

.wb-map-caption {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 8.5px;
  line-height: 1;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 6px;
  user-select: none;
}

.wb-map-cols {
  display: flex;
  gap: 10px;
}

.wb-map-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.wb-map-head {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 8.5px;
  line-height: 1;
  letter-spacing: 0.08em;
  color: var(--muted);
  user-select: none;
}

.wb-map-chip {
  border-color: color-mix(in srgb, var(--ink) 25%, transparent);
  text-transform: none;
  letter-spacing: normal;
  font-size: 9.5px;
  padding: 2px 6px 1px;
}

.wb-map-chip:hover {
  color: var(--stamp);
  border-color: var(--stamp);
}

.wb-map-empty {
  font-family: 'Newsreader', Georgia, serif;
  font-style: italic;
  font-size: 11px;
  color: var(--muted);
}

/* ---------- teach-back captions + the probe-signal marker (S1) ---------- */
.wb-teachback-caption {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 8.5px;
  line-height: 1.5;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 6px 0 0;
  user-select: none;
}

.wb-teachback-ask {
  display: block;
  font-family: 'Newsreader', Georgia, serif;
  font-style: italic;
  font-size: 12px;
  text-transform: none;
  letter-spacing: normal;
  color: var(--ink);
  margin-top: 2px;
}

.wb-idk {
  font-style: italic;
  text-transform: none;
  letter-spacing: normal;
  font-size: 9.5px;
}
```

**Width resilience** (append inside the existing `@container (max-width: 239px)` block): `.wb-map-cols { flex-direction: column; }` and `.wb-probe-row { flex-direction: column; align-items: flex-start; }`. No new animations → the existing `@media (prefers-reduced-motion: reduce)` block needs no additions.

### 5.4 Store addition (`workbenchChat.ts`)

One new action on `WorkbenchChatState` (line 223) and its implementation in `create<…>` (line 232) — additive, mirrors `setCheck`:

```ts
markProbePicked: (bookKey: string, blockId: string, stance: ProbeStance) => void;
```

```ts
markProbePicked: (bookKey, blockId, stance) =>
  set((s) => ({
    blocks: {
      ...s.blocks,
      [bookKey]: (s.blocks[bookKey] ?? []).map((b) =>
        b.id === blockId && b.probe ? { ...b, probePicked: stance } : b,
      ),
    },
  })),
```

---

## 6. Resume & backward compatibility

- **Old 2.1 transcripts load untouched:** `isBlock` (line 195) checks only the four 2.1 fields; new renderers gate on optional fields that old blocks lack → old blocks render exactly as today. `TRANSCRIPT_VERSION` stays `1`.
- **New transcripts under old code:** extra fields are ignored by 2.1's `isBlock` and renderers; blocks display as plain prose. This is the campaign's graceful-degradation rule.
- **Resume flow (`WorkbenchTab.tsx` load effect, ~line 700):** unchanged — the concept map rides in the blocks, so the slip reappears on resume from the last `[CONCEPTS]` block. `probePicked`, `teachbackAsk`, `teachbackOf`, and `probeSignal` all persist inside their blocks with no extra file.
- **Streaming partials:** `stripPartialTagTail` (§2.2) keeps half-tags off the eye during streaming; the streaming placeholder path (line ~873) already passes partials through `parseProfessorTags(stripPartialTagTail(partial))` and gains the new fields for free.
- **`commitPartialIfAny` / error paths:** unchanged — partial professor text commits through `commitProfessorBlock` like a full block.

---

## 7. Tests — new file

**Exact path:** `apps/readest-app/src/__tests__/notebook/workbench-pedagogy.test.ts`

Style follows `workbench-chat.test.ts` (vitest, `describe`/`test`, imports via `@/`). Eight named cases:

```ts
describe('professor pedagogy tags (S1)', () => {
  test('parses [PROBE] and strips it from display');
  test('parses [CONCEPTS known:a, b; edge:c; unknown:d] into three shelves');
  test('captures [CONCEPTS] and [TEACHBACK] even inside an unterminated $$ shield, and leaves [0,1] math intact');
  test('lowercase [concepts:…] and malformed brackets pass through untouched');
});

describe('stripPartialTagTail — space-joined protocol bodies', () => {
  test('hides a partial [CONCEPTS known:Fourier tail mid-stream');
  test('hides a partial [TEACHBACK ask:Why does tail');
});

describe('commitProfessorBlock — pedagogy fields', () => {
  test('carries probe, conceptMap with resolved thread ids, and teachbackAsk');
  test('links an [EVALUATION] block to the latest teach-back attempt block');
});

describe('probe signal', () => {
  test('isProbeSignal matches "I don\'t know" anywhere and never plain prose like "knowledge"');
});

describe('concept map helpers', () => {
  test('latestConceptMap returns the newest shelves; resolveConceptThreads maps names to latest [CONCEPT] blocks and null for new names');
});

describe('transcript round-trip (S1 fields)', () => {
  test('serialize→parse preserves probe/conceptMap/teachback fields, and a 2.1-shape block without them still parses');
});

describe('workbench addendum — pedagogy lines pinned', () => {
  test('probe-first, the three stance phrases, never-grade "I don\'t know", and the three new tag literals are present');
});
```

Concrete assertions to include (writer: make these pass):

- Case 2: input `'Body.\n[CONCEPTS known:Fourier series, orthogonality; edge:convergence; unknown:Parseval]'` → `parsed.conceptMap` equals `{ known: ['Fourier series', 'orthogonality'], edge: ['convergence'], unknown: ["Parseval"] }`; `display` is `'Body.'`; no `[` remains.
- Case 3: raw `'$$x^2+1\n[CONCEPTS known:a; edge:b; unknown:c]'` → shelves parsed, display contains no `CONCEPTS`; and `'$$x \\in [0,1]$$\n[TEACHBACK ask:state the step]'` → `teachbackAsk === 'state the step'`, display contains `[0,1]`.
- Case 4: `'See [concepts:lowercase] untouched.'` → `display` unchanged, `conceptMap` undefined.
- Cases 5–6 (tail): `'…words\n[CONCEPTS known:Fourier'` → returns `'…words'`; `'…words\n[TEACHBACK ask:Why does'` → returns `'…words'`; a complete tag at end is still eaten (`'Body.\n[PROBE]'` → `'Body.'`).
- Case 8 (evaluation link): existing = `[user block u1 with teachbackAsk, professor block, user block u2 with teachbackAsk]`; commit a professor raw ending `[EVALUATION]` → `block.teachbackOf === u2.id`.
- Case 10: `resolveConceptThreads` with blocks carrying `concept: 'fourier transform'` on block `blk_a` (professor) and a user block in between → `known[0].threadId === 'blk_a'`; a name never discussed → `threadId === null`.
- Case 11: build a block with all S1 fields, `parseTranscript(serializeTranscript([block]))` deep-equals the fields; and `parseTranscript` on a literal 2.1 JSON string (four fields only) returns non-null.
- Case 12 (prompt guard, same pattern as `professor-prompt.test.ts`): `PROFESSOR_WORKBENCH_ADDENDUM` contains `'[PROBE]'`, `'[CONCEPTS known:name, name; edge:name; unknown:name]'`, `'[TEACHBACK ask:the restatement you want]'`, `'[EVALUATION]'`, `'lead me'`, `'ask me first'`, `'I will work it'`, and `/never grade it/i`; and `PROFESSOR_SYSTEM_PROMPT` is unchanged (existing guard tests already cover it — do not edit them).

Also add the two `stripPartialTagTail` cases to the **existing** `apps/readest-app/src/__tests__/notebook/workbench-chat.test.ts` `describe('stripPartialTagTail')` block is *not* required — keeping all S1 assertions in the new file is preferred; touch the old test file only if a shared helper changes (it does not).

---

## 8. File-touch list (writer may modify exactly these)

Ownership check against the campaign table: all lane-A files; **no** lane-B (`workbenchSession.ts`, page-lookup), **no** lane-D (`AIAssistant.tsx`, settings), **no** lane-C files.

| File | Change |
|---|---|
| `apps/readest-app/src/services/professor/professorTags.ts` | `PROTOCOL_TAG` regex (line 41), `captureProtocol` cases (line 53), `ConceptMapShelves` + four new fields on `ParsedProfessorMessage` (line 23). Header comment: add the four tags to the documented vocabulary (one line, additive). |
| `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts` | `ProbeStance`, `ConceptMapEntry`, `ConceptMapData`, `probeSignal?` on `TranscriptBlock` (line 22); `PROBE_SIGNAL_PATTERN`/`isProbeSignal`, `latestConceptMap`, `resolveConceptThreads`; `commitProfessorBlock` assignments (line 141); `stripPartialTagTail` regex arm (line 166); `markProbePicked` store action (lines 223/232). |
| `apps/readest-app/src/services/professor/prompt.ts` | Append the one PROBE/CONCEPTS/TEACHBACK paragraph to `PROFESSOR_WORKBENCH_ADDENDUM` (line 117). Nothing else. |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx` | `ProbeRow`, `ConceptMapSlip` components; block-loop conditionals (probe row, concept slip, teach-back captions, probe-signal marker) around lines 859–867; teach-back ask + probe-signal tagging in `send` (line 538); `!b.probeSignal` guard in `runSilentCheck` (line 432); `pickProbe` handler; `scrollToBlock` callback. |
| `apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.css` | Appended S1 section (§5.3) + the two width-resilience rules inside the existing `@container (max-width: 239px)` block. |
| `apps/readest-app/src/__tests__/notebook/workbench-pedagogy.test.ts` | **New file** — the 8 named cases in §7. |

Locale strings: the `_()` keys in §5.1 go through the existing translation pipeline (no locale file edit is required for the writer gate; English fallbacks render verbatim).

## 9. Writer verification gate

`npx tsc --noEmit` + `npx vitest run src/__tests__/notebook/workbench-pedagogy.test.ts src/__tests__/notebook/workbench-chat.test.ts src/__tests__/services/professor-tags.test.ts src/__tests__/services/professor-prompt.test.ts` + no new lint errors in the five touched files.

## 10. Open questions (for the queen, not blockers)

1. **Concept chips when the book view matters:** the spec opens the transcript thread. Should a concept chip also scroll the *book* to the page of that thread's `[Page N]` citation (via the existing `goToPage`)? Deferred — transcript-only keeps this lane self-contained.
2. **`kind` union widening** (`probe`/`concept-map`/`teachback` as literal kinds) was avoided to keep `workbenchSession.ts` (lane B) untouched. If the integration queen wants literal kinds for the whole W2.x block family, that is a one-line additive widening best done by wave B.
3. **Stance persistence across resume:** a picked stance is stored (`probePicked`) but the professor is not re-told it on resume; he re-reads it from the transcript history summary. If resume fidelity feels thin in dogfood, a T3 line in `composeWorkbenchTurnMessage` would be lane B's call.
