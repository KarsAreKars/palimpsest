# S2 Spec — The Page-Look-Up Tool ("consulting the book")

**Campaign:** Workbench 2.x — "The Living Desk" (`docs/WORKBENCH_2_X_CAMPAIGN.md`, owner item 2)
**Lane:** B (after A's s1 batch merges) · **Files owned by this lane:** new `apps/readest-app/src/services/professor/pageLookup.ts`, `apps/readest-app/src/services/professor/workbenchSession.ts`
**Design world:** The Antiquarian Catalogue — librarian voice, stamp `#8C3B22` (CSS `var(--stamp)`) sole accent, light mode, unlayered CSS, `wb-` class prefix.
**Read-only scout:** no code under `apps/` was edited by this spec.

---

## 1. What exists today (grounding — read before writing)

Every claim below was verified against the source. Cite these anchors when in doubt.

- The book manifest is `HpubManifest` in `apps/readest-app/src/services/narration/script.ts:59-78`:

  ```ts
  export interface HpubManifest {
    format: string;
    page_count: number;
    alignment: Array<{
      page: number;
      md_char_start: number | null;
      md_char_end: number | null;
      page_class?: 'prose' | 'mixed' | 'visual';
      blocks?: HpubBlock[];
    }>;
  }
  ```

  Page text is `md.slice(entry.md_char_start, entry.md_char_end)` — the exact pattern used by
  `buildContextPack` at `apps/readest-app/src/services/professor/contextPack.ts:97-109`.

- **Whitelist honesty pattern:** `buildTieredPack` at `contextPack.ts:307-356` computes
  `pages_included: number[]` — "the citation whitelist the prompt lists as *Pages in your context*".
  Only pages whose text actually rides in the prompt are listed (current page only when anchored +
  excerpt non-empty, chapter window via `chapter.includedPages ?? chapter.pages`, T2 concept pages,
  or **all anchored pages when the whole book fits**). `ChapterSlice.includedPages`
  (`apps/readest-app/src/services/professor/session.ts:37-48`) is the precedent: an honest subset —
  "a page whose span begins at or past the truncation cut contributes no text to the prompt — it
  must not wear the whitelist."
- The whitelist reaches the prompt as the literal line `Pages in your context: ${...}` emitted by
  `packTierSections` at `apps/readest-app/src/services/professor/workbenchSession.ts:275-300`, and
  the addendum constrains the professor: *"Citations: pages you can cite this turn are listed in
  'Pages in your context'; cite only those; if the answer lives on another page, say 'I will
  look'."* (`apps/readest-app/src/services/professor/prompt.ts:125`).
- **Book source plumbing already exists:** `readBookSource(bookKey)` at
  `workbenchSession.ts:142-171` returns `{ md, manifest, toc } | null` — narration controller first
  (`getNarration(bookKey)?.controller` with in-memory `md` + `manifest`), else `content.md` +
  `manifest.json` via the AppService file API. Both turns already rebuild the pack every turn
  (`startWorkbenchSession` :386-, `sendWorkbenchTurn` :437-464; "Finding B — the pack rides in
  EVERY turn").
- **Tag parsing:** `parseProfessorTags` at `apps/readest-app/src/services/professor/professorTags.ts:45`
  scans `[CONCEPT|QKIND|WORKBENCH|POINT](:value)?` first (even inside `$$` shields), returns
  `ParsedProfessorMessage` (:7-15). `commitProfessorBlock` at
  `apps/readest-app/src/app/reader/components/notebook/workbenchChat.ts:143-157` copies parsed
  metadata onto `TranscriptBlock` (:17-27, which extends `WorkbenchBlock` from workbenchSession).
- **Transcript persistence** (`workbenchChat.ts:164-211`): `serializeTranscript` /
  `parseTranscript`, `version: 1`, `isBlock` checks only `id`/`author`/`content`/`at` — extra
  fields on blocks round-trip untouched. Constitution non-negotiable #5: every 2.1 transcript must
  load cleanly; block extensions are additive.
- **PageChip precedent** (`apps/readest-app/src/app/reader/components/notebook/WorkbenchTab.tsx:245-261`):
  a `wb-chip wb-page-chip` button, `_('P. {{page}}', { page })`, hover `Slip` (`wb-slip`), and
  `goToPage` at :802-815 scrolls the book via
  `useReaderStore.getState().getView(bookKey)?.goTo?.(page - 1)` (0-based foliate index).
- **Existing test idiom:** `apps/readest-app/src/__tests__/services/professor-workbench-session.test.ts`
  mocks `ai.streamText` via `vi.hoisted`, mocks `@/services/ai/providers` and
  `@/services/narration/speakMode`, and builds a three-page `HpubManifest` fixture inline. Reuse it.

---

## 2. The `[LOOK]` tag (shape — parsed in A's s1 batch)

Grammar (additive to the protocol vocabulary; conforms to the existing `NAME:value` scanner):

```
[LOOK page:N]          one 1-based page
[LOOK page:N,M,…]      several pages, comma-separated, ascending preferred
```

- Case-sensitive, exactly like `[CONCEPT:…]`; the value after `page:` is `/\d+(?:\s*,\s*\d+)*/`.
  A malformed value (`page:`, `page:0`, `page:abc`) captures **nothing** — the professor simply
  loses the lookup that turn, same posture as an empty `[CONCEPT:]`.
- Multi-page is allowed because a question sometimes straddles a leaf (a definition on p. 40, the
  example on p. 41). Cap at **`LOOK_MAX_PAGES = 4`** — parsed array sliced; excess pages are
  silently dropped at lookup time (deterministic, no model-facing complaint).
- The tag lives **only at the very end of the professor's block, on its own line**, per the output
  contract already in the addendum. It is never displayed (non-negotiable #2); the parser strips it
  into metadata.
- **s1 delivers:** `ParsedProfessorMessage` gains `look?: number[]`; `PROTOCOL_TAG` at
  `professorTags.ts:45` gains `LOOK`; `commitProfessorBlock` gains one line —
  `if (parsed.look !== undefined) block.lookedUp = parsed.look;` — and `TranscriptBlock` inherits
  `lookedUp?: number[]` from `WorkbenchBlock` (see §4; no `workbenchChat.ts` type edit needed).

---

## 3. Decision: frontend resolution over a sidecar endpoint — **FRONTEND. Resolved.**

The lookup runs **entirely in the app, over the already-loaded book's manifest and `content.md`**.

Justification, all verified in code:

1. **Every input is already client-side.** `readBookSource` (`workbenchSession.ts:142-171`) already
   resolves `{ md, manifest, toc }` twice per turn with an in-memory fast path via the narration
   controller. A sidecar endpoint would re-read the same `content.md`/`manifest.json` over the same
   file API to answer a question the frontend can answer with one `Array.find`.
2. **The manifest type is trivially traversable.** `HpubManifest.alignment` is a flat array of
   `{page, md_char_start, md_char_end}` — the exact slice the pack builder already performs at
   `contextPack.ts:97-109`. There is no server-side index to exploit; a sidecar adds a network hop
   and a failure surface for zero new capability.
3. **Constitution alignment.** The voice lane's contract already bans new sidecar endpoints
   ("Voice: … No new sidecar endpoints"); the same economy applies here. The frontend owns the
   honesty invariant (§6) — the whitelist is computed where the prompt is composed, not across a wire.
4. **Failure posture is already designed.** When the book source is unreadable, the existing turn
   fallback fires verbatim: `"(The book's text layer is not available this turn — answer from the
   transcript alone, and say "I will look" when a claim needs the book.)"`
   (`workbenchSession.ts:330-334`). The lookup degrades to a no-op and the honesty rule keeps the
   professor from citing what never arrived.

**Estimate check (the plan said "~60 lines over `manifest.alignment`"):** the slice-and-package
core of `lookupPages` is genuinely ~45–60 lines including guards. The *lane* is larger because the
pack plumbing and indicator ride with it: `pageLookup.ts` ≈ 130 lines (of which the lookup core is
~60; the rest is the moved book-source reader + types), `workbenchSession.ts` delta ≈ 60 lines,
render branch ≈ 15 lines, tests ≈ 200. The campaign estimate holds for the core; do not promise it
for the lane.

---

## 4. `pageLookup.ts` — exact service API (new file, lane B owns it)

Path: **`apps/readest-app/src/services/professor/pageLookup.ts`**

```ts
/**
 * pageLookup — the desk answers "I will look" (Workbench 2.x, campaign item 2).
 *
 * The professor emits [LOOK page:N]; the desk resolves that page's span from
 * the book manifest's alignment and shows a "consulting the book" indicator.
 * Resolution is pure and frontend-side: the same { md, manifest } the tiered
 * pack builder slices (contextPack.ts). Honesty contract: a page is returned
 * only when its text will actually be injected into the next turn's prompt —
 * unanchored or missing pages are reported as `missing`, never as empty text.
 */
import type { HpubManifest } from '@/services/narration';

/** Hard cap on pages per [LOOK] (parser slices to this too). */
export const LOOK_MAX_PAGES = 4;
/** Per-page character cap for looked-up text (mirrors the T0 excerpt cap). */
export const LOOKUP_PAGE_MAX_CHARS = 6000;

export interface LookedUpPage {
  /** 1-based page. */
  page: number;
  /** The page's text from the book's machine layer. */
  text: string;
  truncated: boolean;
  page_class: 'prose' | 'mixed' | 'visual' | null;
}

export interface PageLookupResult {
  /** Pages whose text was actually fetched, ascending, deduped. */
  pages: number[];
  results: LookedUpPage[];
  /** Requested pages that were out of range, unanchored, or empty — the
   *  honesty guard: these must never enter the citation whitelist. */
  missing: number[];
}

/**
 * Pure lookup over the manifest's alignment — the ~60-line core. For each
 * requested page: find `manifest.alignment.find(a => a.page === page)`; the
 * page qualifies only when `md_char_start !== null && md_char_end !== null`
 * AND the sliced, trimmed text is non-empty. Qualifying text is capped at
 * maxCharsPerPage (record `truncated`). Requests are deduped and sorted
 * ascending before resolving; pages < 1 or > manifest.page_count are missing.
 */
export function lookupPages(args: {
  md: string;
  manifest: HpubManifest;
  /** 1-based pages; deduped, sorted, sliced to LOOK_MAX_PAGES. */
  pages: number[];
  maxCharsPerPage?: number; // default LOOKUP_PAGE_MAX_CHARS
}): PageLookupResult;

/**
 * Book-level convenience for the UI and the turn seam: resolves the same
 * { md, manifest } the pack uses — narration controller first, content.md +
 * manifest.json via the AppService file API second — then lookupPages.
 * Returns null when the book source cannot be read (the caller treats the
 * lookup as a quiet no-op, matching readBookSource's defensive posture).
 *
 * IMPLEMENTATION NOTE (lane B owns both files): move the private
 * readBookSource() at workbenchSession.ts:142-171 into this module, export it
 * as loadBookSource(bookKey), and let workbenchSession.ts import it back —
 * this kills the circular import that would result from pageLookup importing
 * workbenchSession. loadBookSource's body, docstring behavior, and null
 * posture are unchanged.
 */
export async function lookupBookPages(
  bookKey: string,
  pages: number[],
): Promise<PageLookupResult | null>;
```

**Do not** edit `contextPack.ts` (not lane B's file, and unnecessary — see §6).

---

## 5. Where the looked-up pages travel (ephemeral text, persisted numbers)

**Decision: the page *text* is ephemeral (re-derived from the manifest each turn, never persisted);
the page *numbers* are persisted on the professor's transcript block. Justification:**

- The campaign contract says the lookup "injects as an ephemeral context block (not persisted as
  prose)". Persisting page text would duplicate the book inside `workbench-transcript.json`, bloat
  every resume, and invite staleness — the manifest is the single source of truth and is re-read
  every turn anyway ("Rebuilt every turn", `workbenchSession.ts:448-452`).
- But the honesty whitelist must survive **resume**. If looked-up pages lived only in component
  memory, a resumed sitting would let the professor cite pages no longer whitelisted (or would
  silently drop legitimate citations). Persisting `lookedUp: [12, 14]` — a few bytes per block — is
  the honest, back-compat-safe choice.
- **No new block kind.** The indicator is *derived UI* from metadata on the existing professor
  block, not a new transcript block. This sidesteps the "unknown block kinds render as plain prose"
  rule entirely and keeps `parseTranscript`'s `isBlock` (:191-201) untouched.

Concretely:

1. `WorkbenchBlock` in `workbenchSession.ts:79-86` gains one additive optional field
   (lane B owns this file; `TranscriptBlock` in `workbenchChat.ts:17` extends it, so no
   `workbenchChat.ts` type edit is needed):

   ```ts
   /** [LOOK page:N] — pages the professor asked the desk to consult.
    *  Numbers only; the text is re-derived from the manifest each turn. */
   lookedUp?: number[];
   ```

2. s1's batch adds the parser field + the one-line copy in `commitProfessorBlock`
   (`workbenchChat.ts:143-157`). `serializeTranscript`/`parseTranscript` round-trip it
   automatically (they pass blocks through verbatim; `version` stays **1**).

---

## 6. `workbenchSession.ts` changes (lane B) — the lookup tier + whitelist merge

All edits are inside this file; `contextPack.ts` is untouched.

1. **Collect looked-up pages from history.** `sendWorkbenchTurn` already receives
   `history: WorkbenchBlock[]` (:437). Add a pure helper (top of the prompt-assembly section):

   ```ts
   /** Pages the professor has consulted so far this sitting, ascending,
    *  deduped — from the persisted lookedUp metadata on professor blocks. */
   export function collectLookedUpPages(history: WorkbenchBlock[]): number[]
   ```

2. **Inject the lookup tier.** In `sendWorkbenchTurn`, after the pack build (:448-458), call
   `lookupBookPages(bookKey, collectLookedUpPages(history))`. When the result is non-null and
   `results.length > 0`, pass it into `composeWorkbenchTurnMessage` as a new optional arg
   `lookup?: PageLookupResult` (additive; the opening composer gains the same optional arg for
   symmetry but the UI passes nothing there — the professor cannot LOOK before his first block).

3. **Compose the tier.** In `composeWorkbenchTurnMessage` (`workbenchSession.ts:386-`), after
   `parts.push(...packTierSections(pack, page))` and before the transcript summary, when
   `lookup?.results.length`:

   ```ts
   const blocks = lookup.results.map((r) => `[Page ${r.page}]\n${r.text}`);
   parts.push(
     'Pages you asked to consult (fetched from the book at your request — ' +
       'ground your next answer in these and cite them with a page anchor):\n' +
       blocks.join('\n\n'),
   );
   ```

4. **Merge the whitelist — inside `packTierSections` (lane B owns it, :275-300).** Add an optional
   parameter `consultedPages: number[] = []` (defaults preserve every existing call site) and
   change only the whitelist emission:

   ```ts
   if (pack.pages_included && pack.pages_included.length + consultedPages.length > 0) {
     parts.push(
       `Pages in your context: ${[...new Set([...consultedPages, ...(pack.pages_included ?? [])])]
         .sort((a, b) => a - b)
         .join(', ')}`,
     );
   }
   ```

   **Honesty guard (the load-bearing rule):** `consultedPages` passed here is exactly
   `lookup?.pages ?? []` — the pages whose text **was actually injected** this turn. A looked-up
   page that came back `missing` (unanchored, out of range, empty) is *not* in `lookup.pages` and
   therefore never in the whitelist. This is the `ChapterSlice.includedPages` discipline applied to
   the lookup tier: nothing wears the whitelist that the prompt does not carry. When
   `wholeBook` is true the merge is a no-op (every anchored page is already listed) — harmless.

5. **Byte-stability:** the consulted-pages list is derived from persisted block metadata (no
   timestamps), sorted ascending, so the tier order stays deterministic — the shared-prefix
   cache-friendliness invariant in `buildTieredPack`'s docstring is preserved.

---

## 7. Prompt addendum — additive paragraph (A's `prompt.ts`, lands with s1)

Constitution non-negotiable #4: new prompt material is **additive-only** to
`PROFESSOR_WORKBENCH_ADDENDUM` (`prompt.ts:117-125`). Nothing above or below changes. Append
exactly this paragraph to the addendum string (after the Citations line):

```
Looking things up: when the answer lives on a page NOT listed in "Pages in your context",
say "I will look" in your prose, then end your block with [LOOK page:N] (one page) or
[LOOK page:N,M] (several, at most four). The desk fetches those pages from the book and
their text rides in your NEXT turn's context, joined to "Pages in your context" — cite
them with a page anchor like any other page. Until the fetched text is in your context,
do not cite the page. If a looked-up page brings nothing (a picture page, an unanchored
page), it will not appear in the list — say so honestly rather than inventing its text.
```

(Model-facing prompt text is English and untranslated, matching the existing addendum; `_()`
applies only to reader-facing UI strings — non-negotiable #1.)

---

## 8. The "consulting the book" indicator (render contract)

**Ownership note:** the campaign table assigns the indicator block to lane B, but `WorkbenchTab.tsx
/.css` belong to A. The branch below is additive and co-located with `PageChip`
(`WorkbenchTab.tsx:245-261`); the queen lands it either with s1's batch (A already touches this
file's neighborhood) or as the B-merge integration step — same pattern as lane C's "WorkbenchTab
coupling".

**When a committed professor block carries `lookedUp`:** immediately beneath its content (inside
the same `<article>`, after `<div className='wb-content'>`), render:

```tsx
const ConsultMark: React.FC<{ pages: number[] }> = ({ pages }) => {
  const _ = useTranslation();
  return (
    <p className='wb-consult' role='status'>
      <span className='wb-consult-mark' aria-hidden='true'>
        ❧
      </span>
      {pages.length > 0
        ? _('Consulted page {{pages}}', { pages: pages.join(', ') })
        : _('The book had nothing on that page.')}
    </p>
  );
};
```

Wire: `{b.author === 'professor' && b.lookedUp && <ConsultMark pages={b.lookedUp} />}` in the
block map at `WorkbenchTab.tsx:866-878`, plus a transient in-flight state — when the commit happens,
the desk shows the searching copy for the brief resolve, then settles:

| Reader-facing string | `_()` key (English source) | Where |
|---|---|---|
| Searching copy | `Consulting the book…` | in-flight, replaces the settled line until `lookupBookPages` resolves (reuse the existing `wb-dots` animated dots from the checking chip, `WorkbenchTab.tsx:213-224`) |
| Settled, pages found | `Consulted page {{pages}}` (pages joined `', '`, e.g. `"12, 14"`) | `ConsultMark` |
| Settled, nothing found | `The book had nothing on that page.` | `ConsultMark` (all requested pages came back `missing`) |
| aria/status | the `<p role='status'>` above carries the copy; no separate label needed | — |

Librarian register, no machinery talk: the desk "consults" and "opens" the book; nothing about
fetches, spans, or manifests reaches the reader. The indicator never scrolls the book by itself;
the existing `PageChip` remains the only travel control (non-negotiable: no mid-session buttons).

**CSS (additive to `WorkbenchTab.css`, light mode, `var(--stamp)` = #8C3B22):**

```css
/* Consulting-the-book mark — a quiet catalogue slip, stamp accent only. */
.wb-consult {
  margin: 4px 0 0;
  font-size: 0.8em;
  font-style: italic;
  color: var(--stamp);
}
.wb-consult-mark {
  margin-right: 6px;
}
```

No new animations (reuse `.wb-dots`), no new colors, no shadows.

---

## 9. Tests — new file: `apps/readest-app/src/__tests__/services/professor-page-lookup.test.ts`

Idiom: mirror `professor-workbench-session.test.ts` (vi.hoisted mocks of `ai`, `@/services/ai/providers`,
`@/services/narration/speakMode`; inline three-page `HpubManifest` fixture with `page 3` visual and
**unanchored** via `md_char_start: null` in a second fixture). Seven cases:

1. **`lookupPages` slices exact spans** — fixture manifest + md; requesting `[2]` returns page 2's
   exact text, `pages: [2]`, `missing: []`.
2. **Multi-page: dedupe, sort, cap** — `[3,1,1,2]` → `pages: [1,2,3]`; five pages → sliced to
   `LOOK_MAX_PAGES` (4), excess reported in `missing`.
3. **Honesty: unanchored page is `missing`, never empty text** — `md_char_start: null` entry → in
   `missing`, no `LookedUpPage` emitted, `results` text never `''`.
4. **Out-of-range pages** — `0` and `page_count + 1` land in `missing`.
5. **Truncation** — a page longer than `maxCharsPerPage` returns `truncated: true` and exactly
   `maxCharsPerPage` chars.
6. **`collectLookedUpPages`** — history with two professor blocks carrying `lookedUp: [12]` and
   `lookedUp: [7, 12]` → `[7, 12]` (dedupe, sort, user blocks ignored).
7. **Turn composition honesty guard (mocked stream, like the Finding B regression test)** —
   `sendWorkbenchTurn` with history whose professor block has `lookedUp: [2]`: the composed user
   message (assert on `streamTextMock.mock.calls[0][0].messages[0].content`) contains the looked-up
   page's text, and the line `Pages in your context: 1, 2, 3` includes page 2; with page 2
   **unanchored** in the manifest, page 2 appears **neither** in the lookup text **nor** in the
   whitelist line.
8. **Back-compat round-trip** — a block with `lookedUp: [2]` passes through
   `serializeTranscript`/`parseTranscript` (imported from `workbenchChat.ts`) with the field intact,
   and a 2.1-era block without it parses unchanged (both `version: 1`).

(The `[LOOK page:N]` parser cases themselves belong to `professor-tags.test.ts` — A's s1 batch.
B's suite deliberately tests only from `lookedUp` metadata downward, the seam B owns.)

**Writer gates:** `npx tsc --noEmit` + `npx vitest run src/__tests__/services/professor-page-lookup.test.ts`
+ no new lint errors in the two touched files.

---

## 10. Back-compat & constitution checklist

- Transcript schema: additive optional field only; `version` stays 1; 2.1 transcripts load
  unchanged; new transcripts load in 2.1 (extra field ignored by its `isBlock`).
- No new block **kind** — indicator is derived from `lookedUp` metadata; the "unknown block kinds
  render as plain prose" rule is not exercised.
- Addendum additive-only; tag at end-of-block on its own line; tag never displayed; no chat
  bubbles, no mid-session buttons.
- Tiered context T0–T4 preserved: the lookup tier rides *outside* `buildTieredPack`, as an
  additional section in `composeWorkbenchTurnMessage` — the pack and its local-mode caps are
  untouched. (Looked-up text can push a local-mode prompt past `LOCAL_PACK_MAX_CHARS`; accepted:
  the professor asked for exactly this text and the lookup cap of 4 × 6000 chars is bounded.
  Documented honestly here rather than silently dropping tiers.)
- Every user-facing string via `_()`; error posture unchanged (kinds, never raw provider detail);
  a failed lookup is quiet (indicator's nothing-found copy), never an `onError`.

---

## 11. Integration note — the queen's hook between s1's parser and this service

Three seams, all small, in merge order:

1. **s1 (A) parses:** `professorTags.ts` — `LOOK` joins `PROTOCOL_TAG`, `ParsedProfessorMessage`
   gains `look: number[]` (value split on `/\s*,\s*/`, numbers only, sliced to `LOOK_MAX_PAGES` by
   import from `pageLookup.ts` — one cross-lane import, types/constants only, no cycle).
2. **s1 (A) persists:** `workbenchChat.ts` `commitProfessorBlock` — one line copying
   `parsed.look` to `block.lookedUp`; the field type arrives via `WorkbenchBlock` (lane B's edit).
3. **B consumes:** `workbenchSession.ts` collects `lookedUp` from history → `lookupBookPages` →
   lookup tier + whitelist merge (§6); `WorkbenchTab.tsx` renders `ConsultMark` for blocks carrying
   `lookedUp` (§8).

Merge-order hazard: (2) references a field type that lands in (3). If A merges first, one interim
`// @ts-expect-error`-free path is for A to declare `lookedUp?: number[]` directly on
`TranscriptBlock` and B to **not** redeclare it on `WorkbenchBlock` (declaration merging makes the
optional field compatible) — or simply sequence B's workbenchSession.ts edit in the same merge
window. The queen picks; either way the field is optional and additive.

**Open questions for the queen/owner:** (a) should a `[LOOK]` whose pages all come back missing
earn a professor-visible nudge in the *next* turn's prompt (one line: "page 12 brought no text —
it is a picture page or unanchored"), or is the UI's nothing-found copy sufficient? (b) Confirm the
`ConsultMark` render branch lands with s1's batch vs. at B-merge (§8 ownership note).
