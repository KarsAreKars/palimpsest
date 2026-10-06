# HPUB 2.0 DESIGN — first-principles derivation and target architecture

Researcher r3 · 2026-10-06 · read-only deliverable · supersedes nothing yet (r5 arbitrates)

Method: derive the minimal universal model from the invariant, unconstrained by the
current code; then map the existing `make_hpub.py` (1718 lines) and `fusion.py` (351
lines) onto it. Every mechanism below is traced either to a campaign receipt (R1–R4)
or to a named failure mode documented in the code's own comments (Tadelis, Almanack,
Goodfellow, South, Nemotron-3 incidents). Where a proposed mechanism traces to nothing,
it is listed in §8 "would NOT build".

---

## 1. The invariant, unpacked

**A PDF is** `(content streams, fonts/cmaps, geometry, renderable pages)`. Nothing else
is guaranteed. Any subset of these may be absent or lying:

- content streams may be empty (scans) or garbage (glyphs without ToUnicode maps —
  Goodfellow R2);
- fonts/cmaps may map to PUA codepoints or glyph names (`bracehtipupleft`) that are not
  text (Nemotron-3 incident);
- geometry may be degenerate (letter-spaced text, zero word gaps — `despace_page_text`
  incident);
- renderability is the *only* hard guarantee: if the PDF opens, its pages rasterize.

**An .hpub needs** exactly three artifacts:

1. `content.md` — a reading-order text stream (the narration/Professor layer);
2. `manifest.json` — for every PDF page: where that page's text lives in `content.md`
   (char span), how confident we are, what class of page it is, per-block bboxes;
3. `assets/` — extracted images referenced from `content.md`.

From this the minimal job is: **turn renderable pages into a provenance-tagged text
stream, and prove a monotonic correspondence between the page sequence and the text
stream.** Every design decision below is one of those two sentences specialized.

## 2. The theoretically minimal set of extraction primitives

Five. Not one per lane — five total, of which the pipeline needs exactly these.

### P-1 `probe(pdf) -> per-page Facts`  *(measurement, not extraction)*

For each page, cheap deterministic facts: alnum char count, U+FFFD/PUA count, font
census (math-font hits), image-area share, span-size stats. Cost ≪ 1 s/book. This
already exists as `fastpath_scan` (make_hpub.py:342) + `_glyph_garbage` (:332) +
`coverage_check`'s inputs (:178) — currently scattered across three call sites and
used only to *route* lanes. In the target model probe output is a first-class artifact:
`facts.json`, the input to escalation decisions (§4 stage 2).

### P-2 `read(pdf, pages) -> Spans`  *(the text layer, where it tells the truth)*

Direct text-layer extraction with geometry (pdftext `dictionary_output` is the
implementation). Cost ~0.01 s/page. This is the cheapest witness and must be tried
first on every page — the fastpath philosophy (make_hpub.py:313) is correct and becomes
permanent, not a "lane".

### P-3 `recognize(render(page), hint) -> Spans`  *(one primitive, many providers)*

Given a raster (guaranteed by renderability) and a hint (math fonts present? plate?
garbage chars?), produce text + per-span confidence. Marker/surya-VLM, plain OCR, and
any future vision model are **parameterizations of this one primitive**, not separate
lanes. A page either needs P-3 or it doesn't; the probe decides, per page.

### P-4 `repair(text, evidence) -> text`  *(verified transformation only)*

LLM cleanup, but only ever applied where evidence (containment failure or surviving
garbage chars) localizes damage, and only accepted when a deterministic verifier says
the repair didn't lose the book (`cleanup_chunk_ok`, make_hpub.py:708). Never blind,
never unverified. (Targeted-only is already the shipped behavior, :1625–1642; the
target model makes the verifier a stage boundary, not an inline check.)

### P-5 `render(page) -> raster`  *(the floor)*

Rasterization at working DPI. Only needed where P-3 runs. Guaranteed available; this
is why scanned books (R4) are rescuable: P-5 + P-3 has no dependency on the text layer
at all.

That is the complete set. Everything in the current 1718-line script and 351-line
fusion module is an instance of one of these five. Anything that cannot be named as
one of these five is orchestration — and orchestration belongs in one thin `main`.

## 3. What every span must carry (I3 — provenance/confidence)

The current `content.md` is a single undifferentiated string: 400 lines of `md_parts`
joined with `\n\n` (make_hpub.py:530, :571). The manifest knows per-page `method`
(`anchored`/`interpolated`/`anchored-chars`) but that is **alignment** provenance,
not **text-source** provenance. Nothing records that page 217's text came from the
VLM while page 218's came from pdftext, or that a paragraph was LLM-repaired.

Minimal provenance record per span — three fields, nothing more:

```
source:   pdftext | vlm | ocr | epub | llm-repair     # which primitive produced it
confidence: [0,1]                                      # producer's own estimate
evidence:   {glyph_garbage: int, containment: float}   # the verifier's answer, if checked
```

Why this is sufficient: every downstream question decomposes into these three.
"Can the Professor quote this?" → source ≠ `ocr` with low confidence.
"Should the narration speak this?" → glyph_garbage == 0 (the NarrationBar "beep boop"
incident, make_hpub.py:1630). "Is the book degraded?" → aggregate of confidences
against the I2 thresholds at the smallest useful unit.

Storage: provenance lives **in the manifest as a span map**, not inline in content.md
(keep the md byte-identical to what alignment scored; inline tags would invalidate
every offset and every shingle). The manifest gains one parallel array:

```json
"spans": [
  {"md_char_start": 10420, "md_char_end": 10988,
   "source": "vlm", "confidence": 0.93, "page": 217,
   "evidence": {"glyph_garbage": 0}}
]
```

Per-page provenance in the alignment array is then a *view* (group spans by page),
computed, not stored twice. One source of truth.

## 4. The correct page-mapping abstraction

**A monotonic alignment between two noisy sequences.** Sequence A = `content.md`
character stream (the extracted text, whatever mixture of sources produced it).
Sequence B = the PDF's page sequence, each page carrying one or more *witness texts*
(page text layer; optionally provider texts for that page). The deliverable is a
monotonic map `page_i -> [md_char_start, md_char_end) ∪ {unbound}` with a confidence
per page, such that `start_i ≤ start_j` for `i < j` — pages cannot reorder, skip
backwards, or overlap in reverse.

This is precisely a **sequence-alignment / monotonic-path problem** (the same family
as Needleman–Wunsch, DTW, and monotonic regression — r2's prior-art lane validates
this). The current implementation is one greedy approximation of it:

- build a sparse anchor index over A (shingles with ≤25 occurrences, :33),
- per page in B, vote on a diagonal offset bucket (:884–898), accept if confidence
  ≥ 0.5 and offset ≥ monotonic cursor (:904), interpolate unmatched pages between
  confident neighbors (:916–935).

That approximation is *good* — it survived Almanack (cursor-clamp fix, :35–41) and
Tadelis (ligature repair, :1431–1434). What is wrong is not the algorithm but its
packaging:

1. **It is coupled to one witness.** `build_manifest` (:828) aligns md against the
   pypdf page texts only. When the text layer lies (R2), confidence collapses even
   though extraction recovered the book — the gate cannot distinguish "extraction
   garbage" from "PDF lies, we recovered". The abstraction must accept **a ranked
   list of witnesses per page** and report per-page confidence against the *best
   agreeing* witness, with the witness identity recorded (§3).
2. **The retry is a lane switch, not best-of (R3).** `build_manifest_chars` (:979)
   replaces the token result when anchored fraction < 0.5 (:1487–1494). The gate then
   judges whichever ran last. The abstraction must return **candidate alignments with
   scores; the caller keeps the max** (I4). Token path and char path become two
   parameterizations of one aligner — the char path is the boundary-invariant distance
   function, already derived, keep it.
3. **Failure is book-binary (R2, R4).** One broken chapter fails an 800-page book
   (I2 violation). The abstraction must score at page granularity and let the gate
   aggregate at chapter granularity (I2), never the reverse.

Minimal correct contract for the aligner stage:

```
align(md_text, witnesses: list[Witness], prior: PageFacts) -> Alignment
  Witness = {page, text, source, trust}
  Alignment = {pages: [{page, md_char_start, md_char_end, confidence, method}],
               candidate_id, score}     # candidate_id for best-of bookkeeping
```

Monotonicity is enforced inside, exactly as today (cursor), because the Almanack
lesson is real: a single shaky anchor must never drag the cursor. Do not replace
the shingle-vote core with a full DP aligner — O(n·m) on book-length streams buys
nothing the sparse anchors don't already give (see §8).

## 5. Where the lanes fit: providers, not switches

Current structure: three lanes selected by CLI flags and probe outcomes —
`--epub` fusion (fusion.py), fastpath-hybrid (make_hpub.py:436), full marker
(:229). Each lane re-implements assembly, then funnels into a common align/gate.
This is the source of two receipts:

- R3: the lanes *are* the retries — char alignment retry lives inside the
  non-epub lane only, fusion has its own edition gate, and "best-of" has no
  meaning across lanes because each lane produces one manifest.
- R4: the coverage check (:178) is a lane *admission* test; scans never enter
  any lane, so no provider ever gets a chance to rescue them.

Target: **one assembly, many providers.** A provider is `(name, probe_fit(page_facts)
-> cost, produce(page_range) -> Spans)`. The orchestrator walks pages in order and
asks: for this page, does pdftext already satisfy the witness bar (garbage-free,
contained)? If yes → span source = pdftext (free). If no → escalate to the cheapest
provider whose probe fit says it can do better (ocr < vlm in cost; vlm needed for
math/layout). EPUB is a whole-book provider: it produces spans for every page *it
can*, and the aligner treats EPUB spans as another witness family with high trust —
the edition check (fusion.py:331) becomes "fraction of pages whose best witness is
epub with confidence ≥ 0.5", the same statistic the aligner already computes.

The md stream is then assembled **in page order from chosen spans** — which is
exactly what `hybrid_marker_extract` already does (:436–571) minus the special
casing. The fusion lane's synthetic-tree trick (fusion.py:148, pdf geometry shaped
like a Marker tree) is a compatibility shim the target model deletes: providers
emit spans + bboxes natively; no synthetic tree, no "marker-shaped" contract.

One unified alignment, one gate, one assembly. Lane flags become provider
preferences (`--prefer-epub`, `--force-provider vlm` for debugging).

## 6. Where the four receipts break

| # | Receipt | Breaks today at | Root cause (design level) | Fixed in target by |
|---|---------|-----------------|---------------------------|--------------------|
| R1 | HF download stall, 0% CPU forever | Any model fetch inside marker/surya (silent urllib; no watchdog at all — the `_Heartbeat` only keeps stderr alive, :83) | Network is not a stage; timeouts exist only for LLM chat (:730–731), nothing for downloads | Stage 0 `acquire` with per-file timeout/retry-with-fresh-connection/resume + loud death (I1) |
| R2 | Lying text layer: extraction fine, anchoring 0%, gate rejects a good book | `containment_check` (:1217) scores md against the lying page text; single-witness design | Witness set has cardinality 1 | §4.1: multi-witness alignment; gate scores extraction against the best agreeing witness; provenance-aware verdict |
| R3 | Worse retry won: token 12% → char 0%, gate judged the retry | :1487–1494 fallback replaces; `gate_book` sees only the last manifest | Retry is a lane switch, not a scored candidate | §4.2: aligner returns candidates; selector keeps max (I4) |
| R4 | Scanned books die at exit 2 with no OCR rescue | `coverage_check` (:178) is a book-level binary admission test | No escalation path below the book; no `recognize` floor provider | §5: per-page probe → `recognize(ocr)` → vlm; book rejected only when per-page best-effort fails (I2, I5) |

Common root cause, stated once: **the pipeline confuses routing decisions with
quality decisions.** Probe output currently routes lanes; gate output currently
kills books. In the target model probe output routes *pages to providers* (cheap,
revisable) and the gate only ever consumes per-page evidence to produce per-unit
degradation or rejection (I2, I5).

## 7. Target architecture — numbered pipeline with data contracts

Stage contracts are JSON-able dataclasses at module boundaries; every stage is
individually testable with a frozen fixture. `main` is a thin orchestrator.

```
P0  ingest(path) -> SourceRef
    Contract: {path, page_count, encrypted: bool, metadata}.
    Deaths: not a file, encrypted (loud, actionable).

P1  acquire(SourceRef) -> ModelEnv            [R1 / I1]
    Contract: {models: {name: {path, sha, bytes}}, env_vars}.
    Every download: total deadline + per-read timeout, retry on a FRESH
    connection, resume from byte offset, bounded retries (3) -> loud error
    naming file+URL+last error. Heartbeat during inference only.
    Emits progress event {stage, pct, eta}.

P2  probe(SourceRef) -> PageFacts[]          [P-1 primitive]
    Contract per page: {alnum_chars, glyph_garbage, fonts[], math_font_hit,
    image_area_share, span_size_median}.
    NO death here. Probe never rejects (R4).

P3  assemble(SourceRef, ModelEnv, PageFacts[], providers) -> Doc
    Doc = {spans: Span[] (P-2/P-3/P-4 outputs in reading order, each with
    §3 provenance), assets: {name: bytes}, bboxes: Block[], page_classes}.
    Per page: cheapest provider whose fit beats the witness bar; escalate
    page-wise. Watchdog wraps every provider call (I1).
    Emits per-page progress.

P4  repair(Doc, evidence) -> Doc            [P-4 primitive]
    Runs ONLY where P5 prelim (or P2 facts) localizes damage; verifier
    gates every accepted chunk; repairs carry source=llm-repair with the
    original source in evidence. No API key -> skipped, never fatal.

P5  align(Doc, witnesses) -> Alignment[]    [§4 contract]
    witnesses = page text layers + any provider texts + (optional) EPUB.
    Produces ≥1 candidates (token-shingle, char-shingle); selector keeps
    max total confidence (I4). Monotonic cursor enforced internally.

P6  gate(Alignment[], Doc) -> Verdict
    Per-page verdicts against class-aware containment thresholds (keep A2,
    make_hpub.py:59–66). Aggregate at chapter granularity (I2): a chapter
    fails on N consecutive failing pages; the book fails only if failing
    chapters exceed budget. Lying-layer pages are judged against their best
    witness, not against the lying layer (R2). Math preservation check kept
    (:67–68). Output: {ship: clean|degraded|reject, reasons per unit}.

P7  package(Doc, Alignment, Verdict) -> .hpub
    content.md + manifest.json (§3 span map + alignment view + gate record)
    + assets/ + book.pdf + conversion_report.json (keep, :1645–1670).
    Degraded ships with warning flag (I5); reject carries exact pages/classes.
```

Exit-code protocol unchanged (0 ok, 2 no-text, 3 gate, 1 error) so the Rust
parent needs no changes in early waves.

## 8. Keep / refactor / replace (mapped to make_hpub.py line ranges)

| Lines | Symbol | Verdict | Why / target home |
|-------|--------|---------|-------------------|
| 79–81 | `log` | keep | move to `progress.py` with structured event emission (T4) |
| 83–131 | `_Heartbeat` | keep, refactor | promote to `watchdog.py`; add download/inference watchdogs (R1) |
| 133–136 | `emit` | keep | unchanged contract |
| 140–149 | `extract_page_texts` | keep | becomes P-2 witness reader (one of several witnesses) |
| 151–176 | `despace_page_text` | keep | probe-side repair, P2 output normalization |
| 178–199 | `coverage_check` | **replace** | book-binary admission dies (R4); becomes per-page Facts field feeding P3 escalation |
| 201–225 | `ensure_llama_cpp` | keep, refactor | moves into P1 `acquire` (provider env setup) |
| 229–310 | `marker_extract` | refactor | becomes `VlmProvider.produce` in `providers/`; cache format kept |
| 324–330 | `MATH_FONT_RE`, thresholds | keep | probe heuristics, P2 |
| 332–340 | `_glyph_garbage` | keep | P2 + P4 evidence |
| 342–420 | `fastpath_scan` | keep, refactor | becomes P2 `probe` core minus lane routing |
| 422–434 | `_prose_block_text` | keep | pdftext span assembly |
| 436–571 | `hybrid_marker_extract` | refactor | becomes the P3 assembly loop (its splicing logic IS the target); delete synthetic-tree shim dependence over time |
| 575–588 | `norm_tokens_with_offsets`, `shingle_seq` | keep | `align.py` core |
| 590–592 | `strip_html` | keep | util |
| 594–633 | `classify_pages` | keep | P3 page classes (A2 thresholds kept) |
| 635–654 | `count_equation_regions`, `count_md_math_spans` | keep | P6 math check |
| 656–666 | `CLEANUP_SYSTEM` | keep | P4 prompt |
| 668–677 | `llm_config` | keep | P1 env |
| 679–706 | `chunk_markdown` | keep | P4 chunking |
| 708–728 | `cleanup_chunk_ok` | keep | P4 verifier — promote to stage boundary |
| 730–760 | `LLM_*`, `_post_chat_completion` | keep, generalize | become `net.py`: deadline POST usable by LLM AND downloads (R1) |
| 762–826 | `llm_cleanup_pass` | refactor | becomes `RepairProvider` in P4; targeted-only logic kept |
| 828–948 | `build_manifest` | refactor | becomes `align.py` `align()` — core shingle vote + cursor + interpolation kept verbatim in spirit; input generalized to witnesses; returns candidates |
| 956–978 | char-shingle helpers | keep | second distance function in `align.py` |
| 979–1098 | `build_manifest_chars` | refactor | not a fallback — candidate #2; selector picks max (R3) |
| 1100–1157 | `containment_check_chars` | keep | P6 metric (chars) |
| 1165–1215 | `flatten_math_spans`, `containment_tokens`, ligatures, `_GLYPH_NAME_RE` | keep | P6 tokenization — hard-won, do not touch |
| 1217–1274 | `containment_check` | keep, refactor | P6 per-page scoring; multi-witness input |
| 1276–1356 | `gate_book` | refactor | becomes P6: chapter-granularity aggregation (I2), provenance-aware verdicts (R2), degradation-not-death (I5) |
| 1360–1718 | `main` | refactor | shrinks to the P0–P7 orchestration table above; every stage a function call |

fusion.py: `epub_to_markdown` (fusion.py:159) keep → `EpubProvider`; `pdf_geometry_tree` (:148) keep → native bbox provider (no marker-shaped tree once synthetic-tree consumers are gone); `_MdHTMLParser`/`mathml_to_latex` (:31–156) keep; `edition_check` (:331) replace-by → P5 witness statistics.

## 9. Migration path — waves that never leave main broken

Each wave: write failing test first (Karpathy), ship green, full conversion on ≥2
real books before merge. The script is one file today; the refactor splits it only
where a wave requires the seam. File-level seams come in T2; until then everything
stays in `make_hpub.py` behind functions.

### T1 — no hangs (I1). Receipt R1.
1. Extract `net.py` from `_post_chat_completion` (:734) + `LLM_*` (:730): one
   deadline-aware HTTP primitive with fresh-connection retry and resume.
2. Wrap HF/model downloads in marker's model dict creation with it; verify with a
   test that slow-drips a fake model URL.
3. Add progress events (`progress.py`) emitted on stderr as `JSON\n` lines —
   additive, Rust parent may ignore until T4.
Green: unit tests (slow-drip, mid-file truncation, resume-from-offset) + existing
suites. No behavior change on the happy path.

### T2 — smart gate/anchoring (I2–I4). Receipts R2, R3.
1. Split `align.py` out of `build_manifest`/`build_manifest_chars`; both become
   `align()` candidates; `main` picks max score (R3 closed).
2. Add §3 span-provenance to the manifest (additive JSON fields; the app reads
   text + alignment only, so this is safe).
3. Multi-witness input: page text layer + provider texts; per-page confidence
   against best agreeing witness (R2 closed at the alignment level).
4. Gate: aggregate at chapter granularity; `degraded` verdict path ships with
   warning flag; `reject` payload gains per-unit reasons.
Green: replay fixtures from Almanack/Tadelis/Goodfellow incidents; hell-corpus
harness (r4) must pass; 12 campaign suites.

### T3 — coverage/scans (I2, I5). Receipt R4.
1. `probe.py` from `fastpath_scan` (no routing side effects).
2. `OcrProvider` (recognize primitive, cheapest rung) wired into P3 escalation;
   coverage_check deletion is the last commit of the wave, after escalation is
   proven on hell-corpus scans.
3. Remove the synthetic-tree shim wherever P3/P5 no longer need it.
Green: image-only hell-corpus books convert degraded-not-rejected; lying-layer
golden books still pass; ≥2 real books incl. one scan.

### T4 — progress UX.
1. Structured progress stream (from T1) surfaced through the sidecar protocol to
   the app's import UI (light-mode librarian).
2. Delete dead lanes/flags (`--no-fastpath` becomes `--force-provider`).
Green: in-app import of a 400-page book shows live per-page progress; stall
injection test shows the loud-death path surfacing in UI.

## 10. What I would NOT build (Karpathy simplicity)

1. **A full DP/Needleman–Wunsch aligner.** The sparse shingle-vote + monotonic
   cursor is O(n), empirically survived four named incidents, and a DP aligner is
   O(n·m) on streams of 10⁵–10⁶ tokens for zero measured gain. Only revisit if r4's
   hell-corpus produces a book the greedy path demonstrably scrambles.
2. **A general document-schema (Docling-style uniform document model).** Our
   consumer contract is exactly: md string + per-page spans + bboxes. A richer IR
   is speculative generality (I6).
3. **Per-block provenance in content.md.** Span-level in the manifest suffices;
   inline tags invalidate offsets and every tuned normalizer (:1165–1215).
4. **A pluggable provider registry / plugin system.** Three providers, hardcoded
   dispatch, one file each. A registry is a feature without a named failure mode.
5. **Confidence calibration machinery (isotonic regression, held-out fitting).**
   A heuristic confidence in [0,1] with the right *ordering* properties is enough;
   calibration is a number nobody consumes.
6. **Multi-modal VLM features beyond text** (layout JSON, reading-order models,
   table-structure extraction as data). Tables already degrade gracefully
   (linearization noted at :370); nothing in the receipts asks for more.
7. **Streaming/chunked book assembly.** Books are ≤ 10³ pages; whole-book
   in-memory is fine and simpler. Chunking exists only inside P4 (LLM context).
8. **A second alignment algorithm family** (embeddings, LCS on lines). Two
   parameterizations of one algorithm (token/char) already give best-of; a third
   family is untestable scope creep.
9. **Automatic retry of whole extraction with different global configs.**
   Per-page provider escalation is strictly more surgical (I2); global reruns
   duplicate R3's best-of violation in new clothes.
10. **Rust-side orchestration of the pipeline stages.** The sidecar contract
    (stdout JSON + exit codes) works; keep the brain in one Python process.

## 11. Open questions for r5

1. Witness `trust` weighting: fixed per source, or learned from hell-corpus
   outcomes? (Proposal: fixed constants, tuned once on r4's corpus — anything
   more violates §10.5.)
2. Chapter-granularity aggregation needs chapter boundaries: from EPUB TOC only,
   or also from section_hierarchy already in the tree (:938–944)? Proposal: use
   section_hierarchy when present, else fixed windows of ~20 pages (I2's
   "smallest useful unit" needs a definition in absence of structure).
3. Does the degraded-ship path require app-side UI work in T2, or is a manifest
   flag enough until T4? (Campaign tiers suggest flag-only in T2.)
4. OCR provider backend: surya (already in venv) vs tesseract-class. r2's prior
   art should rule; constraint: no new heavyweight deps without r5 ruling.
