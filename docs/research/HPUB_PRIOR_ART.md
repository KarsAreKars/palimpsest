# HPUB 2.0 — r2 Prior Art: PDF Extraction + Page Alignment

Researcher r2 · 2026-10-06 · read-only lane. Evidence checked live against upstream
repos today (URLs + file:line below). Our baseline: `apps/readest-app/src-tauri/resources/hpub/make_hpub.py`
(fastpath-hybrid lanes, 6-token shingle anchoring with vote buckets + monotonic cursor,
char-shingle fallback, A2 class-aware containment gate).

**The single biggest lesson from this survey:** every serious modern system (Docling,
MinerU, olmOCR, Marker-master's own hybrid) makes page anchoring *a non-problem by
construction* — they never re-derive "which md text came from which page" by matching
text against text. They keep the document page-native until final render. Only we
throw that information away (one concatenated `content.md`) and then pay to rebuild
it with shingles. That reframing drives the recommendation at the end.

---

## 1. Marker 2.x + surya (our current VLM)

Architecture (master, fetched 2026-10-06):
- Pipeline of providers → builders → processors → renderers; `marker/converters/pdf.py:77-78`
  now ships two modes: **fast** (rf-detr/onnx layout + per-block VLM OCR only where the
  text layer is unusable) and **balanced** (VLM layout + full-page OCR).
- `marker/converters/pdf.py:128-129`: fast mode is the default on cpu/mps; "Decide per page
  whether the embedded text is usable; garbled or scanned pages are OCR'd by the VLM"
  (`marker_readme.md:550-558` "How it works"). **Marker upstream converged on our
  fastpath-hybrid design independently.**
- Layout/reading order: surya 2.x `LayoutPredictor` is a VLM that emits layout boxes
  **as JSON in reading-order sequence** — `surya/layout/__init__.py:104-136` assigns
  `position=len(boxes)`, i.e. the order the model writes boxes IS the reading order,
  guided decoding via `LAYOUT_JSON_SCHEMA` (`surya/inference/prompts.py`). No separate
  ordering pass, no geometric sort.
- New since our pin: surya has an **OCR-error detection model** —
  `surya/ocr_error/schema.py:8-14` gives `P(bad)` per text span with a softmax score,
  so callers can gate expensive work on calibrated confidence instead of argmax.
- Honest quality bar: olmocr-bench (1,403 PDFs) — Marker balanced 76.0 / digital-only
  83.5, MinerU 72.7 / 83.3, Docling 50.3 / 64.0, Marker-fast 66.6 / 7.4 pg/s
  (`marker_readme.md:465-476`). Even the best hybrid misses ~1 in 6 books overall.

**Beats us:** (a) our shingle anchoring must reverse-engineer reading order from flat
markdown; surya's VLM just *states* it. (b) their per-page "is the text layer usable"
decision uses a trained error detector with a probability; our `_glyph_garbage()` count
+ `MATH_FONT_RE` font-name regex (`make_hpub.py` fastpath_scan) is a hand-tuned proxy
(the Nemotron-3 miss is already recorded in our own comments). (c) their garbled-page
detection runs *before* deciding to pay VLM cost, same as ours, but with a better signal.

**Steal (concrete):** (1) Use surya's `ocr_error` P(bad) scores as the fastpath flagging
signal and as the provenance confidence for pdftext spans (feeds I3 directly).
(2) Copy the VLM-reading-order principle into our manifest: record block order as
emitted rather than re-deriving. (3) Their per-page text-layer-usability gate is the
exact shape our A2 gate wants per page, not per book.

**Cost:** (1)+(2) are model-weight + config changes inside deps we already ship — near
zero new code, small download. (3) zero. Risk: our marker pin is old; upgrading marker
is cheap in deps but re-tunes all our measured constants (0.65–0.83 s/page etc.).

## 2. IBM Docling

Architecture (main, fetched 2026-10-06):
- Document model is **page-native with provenance by construction**:
  `docling_core/types/doc/common/reference.py:183-193` — `ProvenanceItem {page_no, bbox,
  charspan}`. This is exactly our manifest `alignment[]` entry, but attached to every
  element at extraction time, never reconstructed.
- PDF pipeline: layout model predicts **clusters** (text regions) with reading-order
  index; `docling/pipeline/standard_pdf_pipeline.py:653-655` instantiates
  `ReadingOrderModel`; assembly honors it.
- Reading order itself is rules-based post-processing over geometry:
  `docling/models/postprocessing/reading_order_rb.py` (1,247 lines) — visual separator
  detection (`_candidate_separator`), column/row center logic (`PageElement.__lt__`,
  lines 20-46), fallback "maintext order" comparator.
- Quality/cost: their own scoreboard puts Docling at 50.3 overall on olmocr-bench vs
  Marker 76.0 (`marker_readme.md:471`) — layout quality is not their edge; the *document
  model* is.
- Also has a VLM pipeline (`vlm_pipeline_models/`) that swaps heavy stages for one VLM
  call — same "one VLM instead of five small models" tradeoff Chandra/marker make.

**Beats us:** the ProvenanceItem discipline. Our I3 ("provenance on every span") is a
retrofit in make_hpub (alignment derived after the fact, one source tag implied by
lanes); theirs is the schema's load-bearing wall. Every downstream consumer (professor
grounding, narration) reads `prov` for free.

**Steal (concrete):** the triple `(page_no, charspan, bbox)` per content span as our
manifest alignment entry shape (we already have all three fields — just stop deriving
charspan by shingles for hybrid-lane pages). Also `use_reading_order_separators`
(`standard_pdf_pipeline.py:615`) — a rendering convention for where page/section breaks
land, useful for content.md debugging.

**Cost:** adopting the *schema idea* ≈ zero. Importing docling as a dep: **NO** — torch,
layout+table models, ~GB-scale; and its extraction quality is below our current lane
anyway. Ideas only.

## 3. MinerU (opendatalab)

Architecture (master, MinerU 4.0, fetched 2026-10-06):
- Four tiers (Flash/Basic/Standard/Advanced); small models on ONNX CPU, VLM via
  llama.cpp/vLLM (`README.md:46-53,119`).
- Layout: PP-DocLayoutV2 (`mineru/model/layout/pp_doclayout_v2_*.py`); OCR: PaddleOCR
  internals (`mineru/model/_internal/pytorchocr`); tables/formulas: dedicated models;
  plain-page text order from geometric span/line sort helpers
  (`mineru/backend/analysis/pdf/text/lines.py:41-110` — vertical merge then y-sort then
  x-sort, same algorithm family as pdftext's `sort_blocks`).
- **Output is page-native**: Middle JSON 2.0 = `pages: list[PageInfo] → blocks →
  inline_spans` (`docs/next/middle-json/README.md` "当前事实"). Markdown is a *render
  target*, never the storage. "The old Line/Span with bbox duties will not be restored."
- Doclib layer adds **stable page/block locators for agents** (`mineru/doclib/locators.py`)
  — `read_content("doc:…/tier:standard/page:1")` — and citation traceability to
  page/block/bbox/source-hash is their declared P0.

**Beats us:** same lesson as Docling but more extreme: we treat flat markdown as the
source of truth and re-derive pages; they treat pages as the source of truth and render
markdown. Their locator concept is a ready-made answer to how downstream features
(narration position, professor citations) should address content.

**Steal (concrete):** (1) page-native internal representation — manifest alignment
becomes derived data for the *full-marker* lane only. (2) The locator string idea for
our manifest: stable `page:N/block:M` ids so future features don't re-solve alignment.
(3) Tiering vocabulary (Flash/Basic/Standard) matches our T1-T4 waves nicely for UX
words.

**Cost:** as a dep — **NO** (paddle/onnx stack, multi-GB, JVM-free but still heavy).
As ideas — zero; (2) is a manifest schema addition.

## 4. GROBID

Architecture (grobidOrg/grobid master, fetched 2026-10-06 — note repo moved from
kermitt2/grobid):
- Document parsing as a **cascade of sequence-labeling models** (CRF via Wapiti by
  default, RNN/transformer via DeLFT for GPU): segmentation, header, citations, dates,
  affiliations, figures/tables (`Readme.md:56-58,107`).
- Operates directly on pdfalto's token stream (text + layout features); output is TEI
  XML, with **PDF coordinates** for extracted structures (`Readme.md:27`) — again
  provenance by construction, never matched back.
- Key conceptual point: it never *reconstructs* a reading-order text and never aligns
  anything to anything. Segmentation labels the original token sequence; structure is a
  labeling, not a reordering. 18 years of production hardening.

**Beats us:** not in engineering we can use — but the philosophy is the cleanest
anti-anchoring argument in this survey: *keep the original sequence; label it; never
re-align.* Our whole shingle/anchoring apparatus exists because we destroyed the
sequence when we flattened to markdown.

**Steal (concrete):** the cascade idea at the *gate* level: instead of one A2 threshold
set for all page classes, a small cascade of cheap per-page classifiers (prose/mixed/
visual/math/lying) each with its own decision — that's I2's "degradation at the
smallest useful unit" operationalized. Also: confidence-calibrated rejection (their
models emit probabilities; our gate emits booleans).

**Cost:** GROBID itself is a hard **NO** (JVM, gradle, service architecture). The
cascade idea costs nothing if we use surya's existing per-span P(bad) + our existing
page classes as the cascade.

## 5. PyMuPDF vs pypdfium2 vs pypdf — text order behavior

Evidence (fetched 2026-10-06):
- pdftext (datalab-to/pdftext, marker's extractor; moved from vikp/pdftext):
  `pdftext/extraction.py:10` imports `pypdfium2`; `pdftext/postprocessing.py:103-118`
  `sort_blocks(tolerance=1.25)`: round block y to 1.25-pt rows, x-sort within row,
  flatten. This "y-bucket then x" is the only reading-order repair any of these tools
  do, and it's geometric, not semantic.
- PyMuPDF docs (`pymupdf.readthedocs.io/en/latest/textpage.html`): `sort=True` (v1.19.1+)
  "sort the output by vertical, then horizontal coordinates. In many cases this should
  suffice to generate a 'natural' reading order." — **identical algorithm** to pdftext.
  Default (no sort) is PDF content-stream order, which is arbitrary authoring order.
- pypdf `extract_text` (used by make_hpub step 1): also content-stream order; our code
  comment at `make_hpub.py extract_page_texts` already records that pypdfium2's order
  "differs on table-heavy pages enough to perturb containment scoring" — which is why
  we use pypdf. pdftext's `sort=True` is available to us via `dictionary_output(...)`
  (already used in fastpath_scan) when we want the geometric order instead.
- olmOCR's `olmocr/prompts/anchor.py:25-44` runs the same experiment for us:
  `get_anchor_text(..., pdf_engine)` supports **pdftotext / pdfium / pypdf / topcoherency
  / pdfreport** — and `topcoherency` *runs all three and picks the most coherent*
  (a tiny perplexity scorer). Upstream treats "which extractor's order is right" as a
  per-page, measurable question, not a global constant.

**Beats us:** the `topcoherency` idea. We picked pypdf globally because it scored better
on Tadelis; olmOCR picks per page per book. A 5-line coherence probe (unique-token
ratio / trigram repetitiveness) would arbitrate pypdf-vs-pdftext-sort per page and
would have caught the table-heavy divergence generically instead of by anecdote.

**Steal (concrete):** per-page extractor arbitration: run both `pypdf.extract_text` and
`pdftext dictionary_output(sort=True)` on pages where they disagree materially, score
coherence, keep winner; record which engine won in the page dict (provenance again).

**Cost:** one extra extraction pass (pypdfium2 is already imported; ~free) + ~20 lines.

## 6. olmOCR (Allen AI)

Architecture (main, fetched 2026-10-06):
- Fully page-native, by construction: each work item = a **page**; page image (≤2,000px)
  + **anchor text from the native text layer** go into the VLM prompt
  (`olmocr/prompts/prompts.py:9-28`); output is per-page JSON (`natural_text`, image
  labels with `page_x_y_w_h` coordinates, line-level `anchor` spans pointing back at
  source words in newer models).
- `olmocr/prompts/anchor.py:25-44`: anchor text selectable per engine incl. the
  `topcoherency` arbiter (see §5).
- **Per-page degradation is a first-class budget**: `--max_page_retries` per page,
  `--max_page_error_rate` default **1/250 pages** (`README.md:451-456`) — a document
  succeeds with a bounded number of broken pages. This is literally invariant I2 as a
  shipped CLI flag, and it's the strongest published evidence that per-page budgets are
  how production systems handle this.
- Cost discipline: filters (fast text-layer probes) decide *whether* a PDF/page needs
  the VLM at all; "< $200 per million pages" (`README.md:36`).

**Beats us:** (a) anchor-text prompting — giving the VLM the lying layer's words as
*context* (clearly labeled as possibly-wrong) beats our binary flag→re-OCR: on
partially-lying pages (Goodfellow R2) the VLM can splice clean glyphs with image
evidence instead of us choosing extract-vs-OCR wholesale. (b) Their error-rate budget
is a cleaner gate than our best-of-two-with-judge (R3): a budget doesn't need a judge,
just a counter with a threshold.

**Steal (concrete):** (1) `max_page_error_rate` as the book-level gate statistic —
replace "worse retry won" with "how many pages are still bad after best-effort; ≤ 1/250
(or our tuned fraction) → ship with warning flag (I5), else reject with the page list".
(2) Anchor-text context in the VLM prompt for glyph-garbage pages: pass the page's
pypdf text alongside the render, instruct "keep what's correct, fix what isn't". This
is a prompt-only change to our marker invocation surface (marker already supports LLM
services; or wrap surya prompts).

**Cost:** (1) ~30 lines, no deps. (2) prompt engineering only where we control the VLM
call; zero new deps.

## 7. GOT-OCR2.0 (stepfun / Haoran Wei)

Architecture (author's repo Ucas-HaoranWei/GOT-OCR2.0 — note: the original
`stepfun-ai/GOT-OCR2.0` GitHub repo is gone as of today; HF weights + paper remain):
- Single 580M-param encoder–decoder VLM (Qwen-ish LM + ViT), 1,024×1,024 input,
  arXiv 2409.01704; Apache-2.0 code.
- Output is *formatted markdown text only* — no boxes, no reading-order metadata; the
  `format` mode emits markdown-ish structure, `--box`/`--color` crop what's fed in,
  multi-page = concatenate page crops with token-level separators (`README.md:118-139`).
- Now merged into HF transformers (`stepfun-ai/GOT-OCR-2.0-hf`), so inference is
  batched via the standard stack; community llama.cpp/onnx ports exist.

**Beats us:** nothing for our needs. It is an OCR engine, not a document pipeline: no
geometry, no page provenance, no tables-as-structure beyond markdown text. On our
invariants it would *create* the exact alignment problem this campaign is fighting.

**Steal:** nothing. **Cost if we touched it:** one more mid-size model (≈1 GB+) to
download/cache/watchdog, overlapping surya's job. Verdict: skip — listed only because
the mandate asked; Karpathy says no.

---

## 8. Sequence-alignment prior art for page mapping

How systems anchor text to pages *when exact matching fails* — the honest answer from
the literature and code:

- **The best systems don't.** Docling/MinerU/olmOCR/GROBID all avoid the problem
  (page-native representation, §1-4). Alignment-by-matching is only needed when a flat
  text must be re-attributed to pages: our situation, and the situation of text-reuse
  research.
- **passim** (dasmiq/passim, Viral Texts/Chronicling America lineage; `README.md:104-121`):
  index char n-grams at word boundaries (alnum-only — exactly our `char_norm_with_offsets`),
  select candidate pairs by shared n-grams, then run **full character-level alignment
  seeded from the matching n-grams**, splitting into separate alignments wherever
  matched passages gap by > `--gap 600` chars. `--floating-ngrams` option: start n-grams
  mid-word when text is very noisy — the general form of our char-shingle fallback.
- **diff-match-patch** (google, public domain; `python3/diff_match_patch.py`):
  - `match_main` (line 1212): fuzzy locate — exact-match the pattern's prefix, then
    suffix, then Levenshtein the center only. The canonical "anchor cheap, align
    expensive-center" strategy.
  - `diff_cleanupSemantic` (line 641): post-pass that merges adjacent diffs by semantic
    line boundaries — i.e. *alignment results are repaired by boundary rules, not trusted
    raw*. Same spirit as our A2 class-aware gate.
  - Single .py file, no deps — vendorable.
- **Needleman–Wunsch / Smith–Waterman with affine gaps**: the standard seed-and-extend
  backbone behind passim/edlib; Smith–Waterman local alignment is what you want when a
  page's text is a *substring* of the md stream (epigraphs, quoted matter — our Almanack
  failure was exactly a local-vs-global confusion).
- **edlib** (Martinsos/edlib): Myers bit-vector global alignment, "handles very large
  sequences while consuming very little memory" (`README.md:31-32`). Prebuilt wheels,
  ~100 KB. The right tool if we want optimal gap alignment inside anchor windows.
- **Monotonic DTW** (Sakoe–Chiba band; Müller, *Information Retrieval for Music and
  Motion*, 2007): aligning two *sequences of lengths* (page char-counts vs md block
  char-counts) under monotonicity + bounded warp. Relevant when the two streams differ
  by repeated/deleted material (front matter, plates) — DTW absorbs length mismatch
  that breaks proportional interpolation. For us: a 1-D fallback when even anchor
  chains fail, operating on per-page char counts (O(P·M) but P,M small after blocking).
- **Cautionary tale — difflib autojunk** (CPython `Lib/difflib.py`, `SequenceMatcher`):
  autojunk=True silently drops any token occurring in >1% of the sequence — a
  "too-common-to-anchor" suppression like our `MAX_SHINGLE_OCCURRENCES=25`, but
  threshold-free and silent. If we ever use stdlib difflib for gap alignment,
  `autojunk=False` is mandatory, and our own constant deserves the same scrutiny
  (a repeated epigraph under 25 occurrences is still an anchor hazard — the Almanack).

---

## Steal list (ranked by value ÷ cost)

| # | Steal | Source | Value | Cost |
|---|-------|--------|-------|------|
| 1 | **Assembly-time page provenance**: record md char spans at splice time in the hybrid lane (we already build md per page); shingles demoted to cross-check | Docling `ProvenanceItem`, MinerU Middle JSON, our own `hybrid_marker_extract` | Kills the entire anchoring failure class (R2/R3) for the default lane; gives I3 for free | ~40 lines, no deps |
| 2 | **Error-rate gate**: `--max_page_error_rate` book-level budget replaces best-of-two judge | olmOCR `README.md:451-456` | Fixes R3 structurally; implements I2+I5 with a counter | ~30 lines |
| 3 | **Anchor-candidate + LIS monotonic chain** replacing vote-bucket anchoring for the full-marker lane | passim seeding; SW/NW classic; DMP `match_main` | Global monotonicity instead of per-page thresholds; one knob removed | ~80 lines pure Python |
| 4 | **surya `ocr_error` P(bad) scores** as fastpath flag + span confidence | `surya/ocr_error/schema.py` | Better lying-layer detection than font regex; calibrated I3 confidence | Model weights only (surya already a dep) |
| 5 | **Per-page extractor arbitration** (pypdf vs pdftext-sort, coherence-scored) | olmOCR `anchor.py topcoherency` | Generic fix for the "which order is right" problem we hit anecdotally | ~20 lines, no deps |
| 6 | **Anchor-text prompting**: pass lying layer text to VLM as labeled context | olmOCR prompts | Splice-quality repair on partially-lying pages (Goodfellow class) | Prompt-only |
| 7 | **Banded NW gap fill** between chain anchors (edlib) | edlib/passim | Optimal boundaries inside anchor gaps; confidence from path score | Optional 100 KB wheel, or difflib fallback |
| 8 | Monotonic DTW on page/block length sequences | Sakoe–Chiba | Last-resort structural fallback when anchors < 50% | ~50 lines; only if #3 proves insufficient |

Explicit rejects: Docling/MinerU/GROBID as deps (heavyweight; violates the allergy),
GOT-OCR2.0 (no geometry; redundant with surya), Marker-master upgrade as a wave-1 item
(re-tuning cost; schedule as its own wave after T2 lands).

---

## Recommendation — I2/I3 structural/monotonic anchoring fallback

**The simplest algorithm that beats shingle-only anchoring on lying-text-layer books is
to stop needing shingles for the hybrid lane, and to replace vote-bucket anchoring with
an anchor-chain (LIS) + gap-fill in the full-marker lane.**

Concretely, in dependency order (each step independently shippable):

**Step A (Tier 0 — "structural anchoring", the actual answer to lying text layers).**
`hybrid_marker_extract` already constructs `md_parts` page-by-page and joins them.
Record cumulative char offsets while joining and emit per-page spans directly:
- VLM pages: span = the marker page we spliced (`marker_pages[i]`) — provenance `vlm`.
- pdftext pages: span = the prose we extracted — provenance `pdftext`.
- Result: **every page span is exact by construction, including Goodfellow-class books
  where the text layer lies** — because we never ask the lying layer to prove where the
  text came from; it only supplies *content*, and its lying is caught by quality checks
  (garbage counts, containment where valid) rather than by alignment failure.
- Keep the existing shingle pass as a *verification sample*: anchor every Nth page and
  assert the chain agrees with the construction; on disagreement, log and prefer
  construction (it cannot drift — there is no global string to wander in).
- Manifest gains a `provenance` field per span — I3 satisfied structurally.

**Step B (Tier 1 — monotonic chain for the lanes that still need matching:
full-marker `--no-fastpath` and EPUB fusion).** Replace the vote-bucket + cursor clamp:
1. Collect anchor *candidates*: (page, mdpos) pairs joined by shingles occurring ≤
   `MAX_SHINGLE_OCCURRENCES` times (existing index, existing char/token variants).
2. Build the chain = **longest increasing subsequence** ordered by (page, mdpos).
   O(A log A), ~15 lines (`bisect`). Global monotonicity is now enforced across the
   whole book in one shot; the Almanack class of failure (one shaky anchor dragging the
   cursor) becomes impossible because out-of-order candidates simply don't survive the
   LIS — no `MIN_ANCHOR_CONFIDENCE` tuning, no clamp, no demotion cascade.
3. Confidence per page = candidates' local density along the chain, not a threshold.

**Step C (Tier 2 — gap fill).** Between consecutive chain anchors, align the two token
streams with a banded affine-gap alignment (edlib, or DMP `match_main` for the cheap
version). Page boundaries come from the alignment path; unmatched pages interpolate
proportionally (our existing healing) but inherit a confidence from the path score, so
the gate can tell "interpolated between two 0.9 anchors" from "interpolated across a
desert". DTW on length sequences stays in reserve as Step D if hell-corpus books fall
below the anchored-fraction backstop even with the chain.

**Why this beats shingle-only anchoring on lying-text-layer books:** on those books the
text layer is untrustworthy *as evidence*, so any method that scores alignment against
it (ours now; gates that judge containment against it) confuses "PDF lies" with "we
failed". Step A removes the dependency entirely for the lane that imports those books;
Steps B/C make the residual matching lane monotonic and confidence-carrying instead of
thresholded, which is what I2 demands (per-page, degradable, provenance-tagged).

**Budget sanity:** Step A ≈ 40 lines in `hybrid_marker_extract` + manifest schema bump;
Step B ≈ 80 lines replacing the core of `build_manifest` (index reuse); Step C
optional, one small wheel. Zero new heavyweight dependencies; everything traces to a
named receipt (R2 → A, R3 → B+C plus the olmOCR error-rate gate, R4 → T3 wave using
olmOCR's per-page budget pattern).

---

### Evidence index (all fetched/verified 2026-10-06)

- Marker: https://github.com/datalab-to/marker — README "How it works" + benchmark
  table (`marker_readme.md:465-476,540-558`); converters/pdf.py; util.py
- surya: https://github.com/datalab-to/surya — `surya/layout/__init__.py:104-136`,
  `surya/ocr_error/schema.py:8-14`
- Docling: https://github.com/DS4SD/docling — `docling_core/types/doc/common/reference.py:183-193`,
  `docling/pipeline/standard_pdf_pipeline.py:653-655`,
  `docling/models/postprocessing/reading_order_rb.py`
- MinerU: https://github.com/opendatalab/MinerU — README (4.0 tiers),
  `docs/next/middle-json/README.md`, `mineru/backend/analysis/pdf/text/lines.py:41-110`,
  `mineru/model/layout/pp_doclayout_v2_*.py`
- GROBID: https://github.com/grobidOrg/grobid — Readme.md:27,56-58,107
  (repo moved from kermitt2/grobid — old links redirect)
- pdftext: https://github.com/datalab-to/pdftext — `pdftext/extraction.py:10`,
  `pdftext/postprocessing.py:103-118` (moved from vikp/pdftext)
- PyMuPDF docs: https://pymupdf.readthedocs.io/en/latest/textpage.html (sort=True semantics)
- olmOCR: https://github.com/allenai/olmocr — `olmocr/prompts/anchor.py:25-44`,
  `olmocr/prompts/prompts.py:9-28`, README CLI flags 451-456
- GOT-OCR2.0: https://github.com/Ucas-HaoranWei/GOT-OCR2.0 (author mirror;
  stepfun-ai org repo absent today; weights: huggingface.co/stepfun-ai/GOT-OCR2_0;
  paper arXiv:2409.01704)
- passim: https://github.com/dasmiq/passim — README "Indexing and Aligning" 104-121
- diff-match-patch: https://github.com/google/diff-match-patch —
  `python3/diff_match_patch.py:641,1212`
- edlib: https://github.com/Martinsos/edlib — README 26-32
- difflib autojunk: CPython `Lib/difflib.py` (`SequenceMatcher`, popular-element suppression)
- Monotonic DTW: Sakoe & Chiba 1978; Müller, *Information Retrieval for Music and
  Motion* (Springer, 2007), ch. 7
