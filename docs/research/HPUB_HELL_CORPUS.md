# HPUB 2.0 — Hell Corpus (r4 deliverable)

**Lane:** r4 (hell corpus) · **Date:** 2026-10-06 · **Status:** harness designed,
generator + runner **built and verified against the real pipeline**
(scratch: `/tmp/hpub-hell/`)

> North star test: *a synthesized nasty PDF either becomes a good .hpub or
> fails fast with a specific reason — and the harness can prove which,
> without a human ever opening the PDF.*

---

## 0. Headline findings from the feasibility run (do these change the plan?)

1. **The corpus catches real bugs on its first run.** `sanity-5p` — the most
   boring case, 5 pages of clean prose — **fails today with exit 1**:
   `fastpath_scan` flags 0 pages → `main()` takes the hybrid lane →
   `marker_extract(pdf_path, page_range=[])` → marker asserts
   `max(self.page_range) < len(doc)` → `ValueError: max() iterable argument
   is empty`. Any sufficiently clean prose book (nothing math-font,
   glyph-garbage, or low-text to flag) dies. Reproduced three times
   (sanity, rotated, broken-xref all collateral). **The gate "every mechanism
   traces to a test case" (I6) is now enforced by construction.**
   Expected-after-fix: `exit 0`.

2. **R2 (lying text layer) reproduced synthetically in 55 KB.** `lying-cmap-5p`
   ships a ToUnicode that maps every glyph to a *different plausible letter*.
   pypdf extracts clean, grammatical-looking garbage; Marker extracts the
   same garbage; both sides agree; the gate scores **anchored_fraction 1.0,
   prose_mean 0.993, quality.ok true** and **ships the scrambled book with
   zero warnings**. `content.md` begins `uirkataxvmkataalzqakfkioaakufjp…`.
   The current gate literally cannot see this lie — the T2 mechanism that
   detects it (render-vs-textlayer cross-check, or VLM vote on flagged-font
   pages) now has a deterministic, instant test.

3. **R4 (scanned) rejection is already loud, specific, and fast** — `scanned-4p`
   → exit 2, `reason: scanned`, `no_text_pages: 4/4`, 0.1 s. The T3 OCR lane
   must turn this row green (exit 0 + provenance=ocr on those pages); until
   then the row pins today's behavior so T3 can't silently regress it.

4. **The pipeline runs fully offline in the venv** (surya layout + OCR-gguf
   cached, llama-server at `/opt/homebrew/bin`). `HF_HUB_OFFLINE=1` is forced
   in the harness so a hell run can never half-download (I1) and CI is
   hermetic. 5-page full-Marker conversion: ~5 s.

---

## 1. Environment facts (what the generator may use)

| Dependency | Status in hpub venv | Consequence |
|---|---|---|
| `reportlab` | **MISSING** | generator hand-rolls PDF syntax (see §2 — this is an advantage) |
| `pypdf` 6.16.2 | present | extraction probe + `broken-xref` repair behavior |
| `pypdfium2` 5.10.1 | present | available for render-side checks later (not needed yet) |
| `marker-pdf` 2.0.0 + surya models | cached offline | full pipeline runs hermetically |
| `Pillow` 10.4.0 | present | scanned-simulator page images |
| `qpdf` | **MISSING** | broken-xref done by byte-patching `startxref` instead |
| `llama-server` | `/opt/homebrew/bin` | surya OCR backend resolves |

Pipeline CLI contract (from `make_hpub.py` main): last stdout line is the
JSON result; progress on stderr (`[+t.s]`); exit codes `0 ok · 2 scanned ·
3 quality gate · 4 edition · 1 error`. Gate metrics already computed and
emitted: `gate.anchored_fraction`, `gate.containment.{prose_mean,
mean_all_pages,longest_failing_run,failing_pages,page_classes}`,
`quality.{replacement_chars,pua_chars}`, `page_count`. The manifest already
carries per-page `{page, md_char_start/end, confidence, method, page_class,
blocks}` where `method ∈ {anchored, anchored-chars, interpolated,
unmatched}` — the harness asserts structure, the campaign adds provenance.

---

## 2. Generator design (`/tmp/hpub-hell/hellgen.py`, ~500 lines)

### Why hand-rolled PDF syntax

reportlab is absent from the venv — but even if present it would be the
wrong tool: the nasty cases are *PDF-internal* (ToUnicode content, font
encoding, xref integrity, content-stream emission order). reportlab always
emits correct structures; we need to emit incorrect ones deliberately. The
generator is a 60-line object writer (`PDF.add` / `PDF.stream` / `PDF.write`
with computed xref + optional `startxref` corruption) plus per-case content
streams. Full control, zero deps beyond Pillow, generation of all 12 cases
including 1500 pages in < 1 s.

### Ground truth is generated with the PDF

Every case builder returns `(pdf_bytes, ground_truth, meta)` where
`ground_truth = {page_texts: [...], quotes: [{page, text}, ...]}` — the
text a *perfect* reader would get. All metrics are derived from that; no
human ever reads the PDF. Prose is deterministic (`random.Random(seed-case)`)
and every sentence is unique (`"Page N line M: <9 rare words>"`) so the
anchor index can never confuse two pages (the Almanack divider failure mode
is designed out of the corpus itself).

### Case catalog

| case | tier | pathology / what it tests | expected today |
|---|---|---|---|
| `sanity-5p` | T1 | clean 5-page prose, Type1 font | exit 0, anchored ≥ 0.9, grounding exact |
| `rotated-4p` | T1 | `/Rotate 90`, content unrotated | exit 0 (rotation must not break extraction) |
| `broken-xref-3p` | T1/I1 | `startxref` points at garbage | repair → exit 0, wall < 120 s, no hang |
| `extreme-short-5p` | T1 | minimal input | exit 0 |
| `extreme-long-1500p` | T1/I1 | 1500 pp plain prose (zlib streams, 80 ms to make) | exit 0, wall budget/nightly |
| `lying-cmap-5p` | T2/R2 | ToUnicode maps glyphs to *wrong plausible* letters | **reject (exit 3) — currently ships garbage: exit 0** |
| `no-tounicode-4p` | T2/R2 | subset CID font, no ToUnicode at all | reject 2/3, loud |
| `pua-mapped-4p` | T2/R2 | ToUnicode maps everything to U+E000+ | reject 2/3; if ok, `pua_chars == 0` (VLM rescued) |
| `ligature-3p` | T2 | MacRoman `fi/fl` baked into text layer | exit 0 (_LIGATURES path) |
| `two-column-interleaved-4p` | T2 | content stream emits L1 R1 L2 R2 … | exit 0 (layout recovers) or honest 3 — never 0-with-garbage |
| `scanned-4p` | T3/R4 | full-page JPEG, zero text operators | exit 2, `reason=scanned`, fast (measured 0.1 s) |
| `hybrid-6p` | T3/R4/I2 | alternating text / scan pages (50% no-text) | exit 2 today; T3: text pages survive + scan pages get provenance=ocr |

Expected-vs-actual is stored per-case in `case.json` (`expect.exit_in`,
`min_anchored_fraction`, `grounding.tolerance_pages`, `max_wall_s`,
`timeout_s`, `note` for the tier goal). Expectations are **pinned to today's
behavior for T1, pinned to the tier goal for T2/T3** — a T2 writer flips
`lying-cmap-5p` to `exit_in: [3]` (or `[0]` + provenance check) and that
flip *is* the wave's receipt.

### Verified generation (feasibility §4 actuals)

All 12 cases generate; pypdf-extraction probe confirms each pathology is
real: `lying-cmap` → clean-looking `uirkataxvm…`; `no-tounicode` → control
chars; `pua-mapped` → 9987 PUA chars; `scanned` → 4/4 no-text; `hybrid` →
exactly 3/6 no-text; `ligature` → 20 `\ufb01/\ufb02` chars in the text
layer; `broken-xref` → pypdf logs `incorrect startxref pointer`, repairs,
extracts perfectly.

---

## 3. Metrics — defining "reads" without a human

Three layers, all computed by `run_case.py` from the run's own artifacts
plus the ground truth. **Any layer can fail a run; only all three green is
"reads".**

### M1 — gate metrics (reused from the pipeline, zero new code)

From the result JSON + manifest: `exit`, `status`, `reason`,
`gate.anchored_fraction ≥ min` (case-set), `gate.containment.prose_mean`,
`longest_failing_run`, `page_classes`, `quality.replacement_chars == 0`,
`quality.pua_chars == 0` (I5: silent garbage in the narration layer is a
fail even when containment passes — the Nemotron-3 leak class).

### M2 — per-page provenance / structural invariants (I3, I4)

Asserted on `manifest.json` whenever it exists:

| check | invariant |
|---|---|
| `i3_spans_in_bounds` | every non-null span `0 ≤ start < end ≤ len(content.md)` |
| `i3_monotonic` | anchored `md_char_start` non-decreasing (cursor discipline) |
| `i3_methods_valid` | methods ⊆ `{anchored, anchored-chars, interpolated, unmatched}`; **T3 extends the set with `{pdftext, vlm, ocr}` provenance — this check is where I3 lands in the harness** |
| `i3_interpolation_between_anchors` | interpolated pages sit strictly between two anchors and carry `conf = 0.5·min(anchor confs)` (re-derives the formula — catches a silently changed contract) |
| `i3_confidence_range` | confidences ∈ [0,1] |
| `i4_gate_matches_manifest` | `gate.anchored` equals the anchored count **of the manifest on disk** — best-of (I4) is checkable: the metrics the gate judged must describe the artifact that ships, not a losing sibling (R3: never judge the retry and ship the original) |

### M3 — grounding smoke test (the professor query)

For each ground-truth quote: normalize (`[a-z0-9]+` runs), locate the
quote's tail in `content.md`, map the mid-offset to a page via
`page_for_offset` (the exact query grounding will issue: last page with
`md_char_start ≤ offset`), assert `|manifest_page − truth_page| ≤ tol`
(tol=0 for anchored pages, 1 for interpolated-tolerant cases). ≥90% of
quotes must hit. **This is the test that would have caught R2**: on
`lying-cmap` it grounds quotes to the wrong text and — combined with the
render cross-check in T2 — is the mechanical half of "the PDF lied".

### Wall-clock as a first-class metric (I1)

`subprocess.run(timeout=…)` per case; **timeout ⇒ row is red regardless of
every other check — a hang is a test failure, full stop.** Per-case
`timeout_s` (default 900; `extreme-long` 3600, nightly tier) and
`max_wall_s` where absolute bounds matter (broken-xref: 120 s).

### Metrics matrix (observed on 2026-10-06, venv, offline)

| case | exit | status | wall_s | anchored_frac | prose_mean | PUA+FFFD | grounding | verdict |
|---|---|---|---|---|---|---|---|---|
| sanity-5p (full lane) | 0 | ok | 4.7 | 1.000 | 0.999 | 0 | 5/5 exact | **PASS** |
| sanity-5p (default) | 1 | error | 4.7 | — | — | — | — | FAIL (zero-flag bug) |
| scanned-4p | 2 | rejected/scanned | 0.1 | — | — | 0 | — | PASS (pinned) |
| pua-mapped-4p | 2 | rejected/scanned | 0.2 | — | — | 0 | — | PASS (pinned) |
| broken-xref-3p | 1 | error | 5.2 | — | — | — | — | FAIL (zero-flag collateral) |
| lying-cmap-5p | 0 | **ok (garbage shipped)** | ~20 | 1.000 | 0.993 | 0 | — | FAIL (R2 open — the T2 target) |

---

## 4. Runner (`/tmp/hpub-hell/run_harness.py` + `run_case.py`)

Working skeleton, not pseudo-code — validated end-to-end on sanity. Shape:

```
for case_dir in corpus:                       # case.pdf + case.json + ground_truth.json
    meta      = case_dir/case.json            # tier, receipt, expect{...}, note
    expect    = meta.expect
    rm -rf runs/<case>/out                    # never score stale artifacts
    proc      = subprocess.run([venv_python, make_hpub.py, case.pdf,
                                --out-dir runs/<case>/out, --title hell-<case>],
                               timeout=expect.timeout_s ?? 900,   # I1: timeout == FAIL
                               env={HF_HUB_OFFLINE: 1, ...},      # hermetic (I1/R1)
                               cwd=make_hpub_dir)                 # fusion.py importable
    result    = json.loads(last stdout line)                       # pipeline contract
    checks    = {}
    checks   += {i1_no_timeout, i1_exit_expected, i1_wall_budget?}
    if manifest.json exists:                                       # artifacts shipped
        checks += check_manifest(manifest, len(content.md))        # M2 (I3, I4)
        checks += {i5_no_silent_garbage, anchored_fraction?}
        if expect.grounding: checks += check_grounding(...)        # M3
    else:                                                          # rejected early
        checks += {i5_reject_is_specific}                          # reason + no hang (I5)
    row(case, tier, exit, status, wall_s, verdict, failed checks)
matrix -> runs/matrix.md + matrix.json ; exit 1 iff any row red
```

Invariant → check mapping (the harness is I1–I6 made executable):
I1 = `i1_no_timeout` + `i1_wall_budget`; I2 = per-page M2 checks on
partially-broken books (`hybrid-6p` is the I2 case: T3 must keep text pages
anchored while scan pages get `ocr` provenance); I3 = the `i3_*` family;
I4 = `i4_gate_matches_manifest` + per-case `exit_in` pinning best-of
outcomes; I5 = `i5_no_silent_garbage` + `i5_reject_is_specific` +
grounding; I6 = every `case.json` names `tier` + `receipt` — a case with no
named failure mode does not enter the corpus.

### Integration into the campaign gates

- **Placement:** `apps/readest-app/src-tauri/resources/hpub/tests/hell/` (or
  `scripts/hell/`) — generator + runner committed, *generated corpus not*
  (it is 12 deterministic cases, < 1 s to regenerate: `hellgen.py all`).
- **CI split:** T1 + the cheap rejects (`scanned`, `pua`) run per wave
  (~2 min total offline); full matrix incl. VLM lanes nightly;
  `extreme-long-1500p` asserts *bounded per-page time* (`wall ≤ a·pages + b`
  calibrated from sanity) rather than absolute green.
- **Zero-flag bug:** ships as a failing T1 row now; the one-line-class fix
  (`if not flagged: treat as full marker pass` — or skip hybrid when
  `len(flagged) == 0`) belongs to the T1 writer wave, with
  `sanity-5p`/`rotated-4p`/`broken-xref-3p` flipping green as the receipt.

---

## 5. Deliberately out of scope (I6 — no speculative cases)

- EPUB-mismatch / edition cases (fusion lane has its own `edition_check`;
  add only when a wave touches fusion).
- DRM/encrypted PDFs (owner ruling: user files are unencrypted; add on
  evidence).
- Font-with-0-glyph-width, incremental-update hell, object streams — r1's
  taxonomy owns the catalog; the generator grows **only** when a wave names
  the failure mode it reproduces.
- Math-dense synthesis (equation-region gate): needs marker to detect real
  equation regions on synthetic pages — flagged as follow-up once T2 lands,
  since `MIN_EQUATION_REGIONS_FOR_CHECK = 20` behavior deserves a case but
  is hard to fake convincingly without a math font.

## 6. Files

| path | what |
|---|---|
| `/tmp/hpub-hell/hellgen.py` | generator (12 cases, verified) — §2 |
| `/tmp/hpub-hell/run_case.py` | per-case executor + M1–M3 checks (validated on sanity) |
| `/tmp/hpub-hell/run_harness.py` | matrix runner (validated) |
| `/tmp/hpub-hell/corpus/<case>/` | case.pdf + case.json + ground_truth.json (all 12) |
| `/tmp/hpub-hell/runs/` | real run artifacts incl. `lying-cmap` garbage shipment + matrix |

*Scratch is /tmp by design; the promotion path into the repo is §4.*
