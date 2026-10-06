# HPUB 2.0 — r5 AUDIT (binding rulings)

**Auditor:** r5 · 2026-10-06 · read-only lane.
**Method:** read the constitution + all four research docs in full; re-verified
every load-bearing claim against `apps/readest-app/src-tauri/resources/hpub/make_hpub.py`
(1718 lines, read in full), `apps/readest-app/src-tauri/src/hpub.rs` (326 lines),
`fusion.py` (351 lines), the hpub venv (`marker-pdf 2.0.0`, `surya-ocr 0.22.1`,
`pypdf 6.16.2`, `pypdfium2 5.10.1`, `pdftext 0.7.1`, `Pillow 10.4.0`), and ran
live probes against the r4 hell corpus (`/tmp/hpub-hell/`, `HF_HUB_OFFLINE=1`).
Where research docs disagree with the code, the code wins. Where r1/r2/r3/r4
disagree with each other, the simplest mechanism that kills a named receipt wins
(constitution I6 + Karpathy).

**Verification headline:** all four research docs are structurally sound. r1's
line citations are exact (checked ~40 of them; zero structural errors found).
r3's keep/refactor table line numbers drift by up to ~24 lines in four entries
(fallback trigger is at `make_hpub.py:1572-1586`, not `:1487-1494`;
`hybrid_marker_extract` is at `:436`, `_glyph_garbage` at `:332`) — cosmetic,
but writers must re-derive line numbers from HEAD, never from these docs.
**r5 found new evidence (E1–E6 below) that sharpens two receipts.**

---

## 0. Verification ledger (load-bearing claims, checked by r5)

| Claim (source) | Verdict | Evidence |
|---|---|---|
| r4 #1: zero-flag bug — clean prose book dies `exit 1`, `max() iterable argument is empty` (r4 §0.1) | **CONFIRMED LIVE** | `make_hpub.py:1463` (`flagged=[]` is not None → hybrid lane) → `:229-241` (`page_range=[]` passed to marker) → venv `marker/providers/pdf.py:106` `assert max(self.page_range) < len(doc)`. Probe: `sanity-5p` → `exit 1`, `{"status":"error","stage":"marker","detail":"max() iterable argument is empty"}` |
| r4 #2: lying-cmap ships garbage confidently (R2) | **CONFIRMED LIVE** | Probe `--no-fastpath`: `exit 0`, `anchored_fraction 1.000`, `prose_mean 0.993`, `quality.ok true`, content.md begins `uirkataxvmkataalzqakfkioaakufjp…`. On the **default** lane the same file dies with the zero-flag bug — the bug masks R2 in the default lane today |
| r4 #3: scanned rejection loud/fast (exit 2, 0.1 s) | CONFIRMED | `coverage_check:178-198`, `MAX_NOTEXT_FRACTION=0.20:49`; probe `scanned-4p` exit 2, reason `scanned` |
| r4 #4: venv offline-capable; reportlab/qpdf absent | CONFIRMED | venv probes: `reportlab` MISSING, `qpdf` MISSING, models cached; `HF_HUB_OFFLINE=1` runs green |
| r1 P26/R3: char retry is a lane switch judged by last-run, no best-of | CONFIRMED — and **worse** (E1) | `make_hpub.py:1572-1586` replaces the manifest; `gate_book:1280` counts **only** `method == "anchored"` for the backstop. A char manifest contains zero `"anchored"` pages → backstop fraction 0 → **every char-fallback book is unconditionally rejected at the gate. The retry cannot win at all today**, not just "worse retry won". R3 inverts depending on which lane you look at: token reject-good (Goodfellow) + char-retry-always-loses + lying-cmap-ships-garbage |
| r1 P1/P32: `_glyph_garbage` sees nothing on lying layers; lie detected only downstream | CONFIRMED | `make_hpub.py:332-340` counts U+FFFD/PUA only; r4's `lying-cmap` has zero of both (probe §1 above). Font audit (r1 §9.1) is the only deterministic pre-lane detector — proven by the corpus |
| r1 P9/P10: uncaught stage-1 exceptions → traceback, exit 1, no JSON | CONFIRMED | `extract_page_texts:140` called at `make_hpub.py:1373` outside any try; only the epub (`:1413-1419`) and marker (`:1452-1456`) stages have handlers |
| r1 P18: `[a-z0-9]+` tokenization rejects CJK at the backstop | CONFIRMED | `norm_tokens_with_offsets:577`, `containment_tokens:1206`; `char_norm_with_offsets:963` uses Unicode `isalnum()` (CJK survives char path, but see E1: the char path is dead at the gate) |
| r1 P20: no chunking in marker-full lane; heartbeat has no beat source | CONFIRMED | `marker_extract:229-241` `page_range` only from hybrid lane; `_Heartbeat:83-131` docstring: marker is "a black-box call, no beat source" → ~25 min silence budget then Rust kill |
| r1 P21/R1: no timeout/retry/resume/HF_TOKEN on model downloads | CONFIRMED | no `HF_TOKEN` anywhere (grep across `make_hpub.py` + `hpub.rs`); downloads happen inside marker's `create_model_dict()` (`:289-290`) with no wrapper; urllib timeouts exist only for LLM POST (`:727-728`) |
| r1 P30: exit 4 unmapped in Rust | CONFIRMED | `make_hpub.py:1632` emits exit 4; `hpub.rs:286-301` matches `Some(0)|Some(2)|Exit(3)` → exit 4 surfaces as generic `Err("hpub sidecar failed (status 4)")` |
| r1 P33: progress parses only `N/6` stage lines | CONFIRMED | `hpub.rs:43-65` `parse_stage` + tests at `hpub.rs:304-324` |
| r1 P17: hybrid lane repairs hyphenation into md but page texts stay raw | CONFIRMED | `_prose_block_text:422-434` rejoins into md parts; `page_texts` raw. Fusion lane dehyphenates page side (`:1425-1428`), marker lanes do not |
| r1 P7: fake Picture block injection for edge low-text pages | CONFIRMED | `make_hpub.py:523-537`; marginals dropped at `:540-545` (top 8% / bottom 6%) |
| r2: Marker upstream converged on per-page text-layer-usability + fast/balanced modes | CONFIRMED for our pin | venv `marker/converters/pdf.py:77-80,128-132` — **marker-pdf 2.0.0 already ships fast/balanced**; no upgrade needed for the mode concept |
| r2 steal #4: surya `ocr_error` P(bad) available in venv | HALF-TRUE — **ruled out** (E5) | venv `surya/ocr_error/` exists in 0.22.1, but checkpoint is `s3://ocr_error_detection/2025_02_18` (`surya/settings.py:137`), weights **not cached** (HF cache has only `surya_layout2` + `surya-ocr-2-gguf`), and it is a client/server batch service, not a plain model call. Integration cost ≫ value; deterministic font audit (E2) kills the same receipt with zero deps |
| r3 §6 R4 root cause: `coverage_check` is book-binary lane admission | CONFIRMED | `:178-198`; r3's "delete it last in T3" agrees with r4's pinned exit-2 rows |
| r3 §8 table: most symbol/line claims | CONFIRMED ±24 lines | exact numbers in §4 below |
| r4 §4: harness promotion path, CI split, timeout-as-failure | CONFIRMED design | **but see E4: the stored `runs/matrix.json` is stale/partial** (4 rows; shows `sanity-5p` green, contradicting r4's own doc and r5's live probe). Harness must live in-repo and regenerate per run |

---

## 1. New evidence found by r5 (not in any research doc)

- **E1 — the char retry is dead-on-arrival.** `gate_book:1280` counts only
  `method == "anchored"`; a char manifest's methods are `anchored-chars` →
  backstop fires at 0 anchored → unconditional `alignment_backstop` exit 3.
  Consequence: r1 P14's "works" verdict is wrong at the gate level (the char
  fallback can never ship a book); r1 P26's "worse retry won" is the
  *optimistic* reading. The T2 best-of selector must fix the backstop counting
  as part of the same diff or it inherits the bug.
- **E2 — R2 is bidirectional, and both directions are live.** Goodfellow:
  good book rejected (anchoring 0% vs lying layer). Lying-cmap: **garbage
  book shipped with confidence 1.0** (probe §0). Any T2 mechanism that only
  stops reject-good (e.g. "trust the VLM more") leaves ship-garbage open.
  The font-cmap audit is the only detector that catches both, and r4's
  corpus tests it deterministically.
- **E3 — the zero-flag bug masks R2 on the default lane.** `lying-cmap` dies
  `exit 1` on the default lane today (probe §0); only `--no-fastpath` reaches
  the gate. The T1 zero-flag fix is therefore a **prerequisite receipt** for
  T2's R2 tests, not just hygiene.
- **E4 — r4's on-disk matrix is stale.** `runs/matrix.json` (4 rows) contradicts
  both r4's doc (7 rows, sanity red) and r5's live probes. Ruling: the harness
  is promoted into the repo in T1 (first commit), generated corpus stays
  uncommitted, matrix regenerates every run.
- **E5 — dep-freeze facts.** venv verified: `reportlab`/`qpdf` absent (keep
  absent — hellgen hand-rolls PDF syntax, an advantage); `pypdfium2` present
  (T3's OCR render floor needs nothing new); marker 2.0.0 already has
  fast/balanced modes; surya `ocr_error` is an S3-backed service, uncached —
  ruled out (Ruling 4).
- **E6 — exit-4 fix is Rust-side, tiny, and safe.** `hpub.rs:286-301`; adding
  `Some(4)` to the Ok-arm is a 1-line change with a unit test; no protocol
  change for Python. Sequenced in T1 (different file from make_hpub.py).

---

## RULING 1 — Target architecture (binding)

The constitution's invariant model stands: `probe → assemble (per-page
provider escalation) → repair (verified, targeted only) → align (monotonic,
best-of candidates, multi-witness) → gate (per-page, class-aware, provenance-
aware) → package`. Concretely, **for this campaign the architecture is the
current `make_hpub.py` function pipeline, hardened in place — not r3's
multi-file P0–P7 module split.**

Binding decisions:

1. **One self-contained sidecar, two Python files.** All Python work stays in
   `apps/readest-app/src-tauri/resources/hpub/make_hpub.py` (existing
   `fusion.py` unchanged except where a wave names it). No new modules, no
   `probe.py`/`align.py`/`net.py`/`watchdog.py`/`providers/` directories this
   campaign. The constitution's non-negotiable ("the pipeline stays a
   self-contained sidecar script") outranks r3's §7 module layout; r3's own §9
   concedes this ("splits only where a wave requires the seam; until then
   everything stays in make_hpub.py"). New seams = new failure modes; I6.
2. **The aligner of record stays the shingle-vote + monotonic cursor**
   (`build_manifest:828-948`, char variant `:979-1098`). It survived Almanack,
   Tadelis, and phase-0 validation. It gains two things, nothing more:
   (a) **best-of candidacy** — both manifests are built and scored, the max
   wins (R3/I4); (b) **multi-witness containment** — each page is scored
   against its best-agreeing witness (page text layer, or provider text for
   pages the font audit routed to the VLM), witness identity recorded (R2).
   No LIS chain, no DP aligner, no DTW (Ruling 4).
3. **Provenance lands as an additive manifest field** (r3 §3 shape, verbatim):
   `spans: [{md_char_start, md_char_end, source: pdftext|vlm|ocr|epub|llm-repair,
   confidence, page, evidence}]`. content.md stays byte-identical to what the
   gate scored (r3 §10.3 agreed by all lanes). In the hybrid lane the source is
   known **at splice time for free** (r2 steal #1) — VLM pages = `marker_pages`
   membership (`:462-466`), pdftext pages = the else-branch; record offsets
   there (~20 lines), keep shingle alignment as the offset authority for T2.
4. **The gate stays page-granular** with the existing A2 class-aware thresholds
   (`:59-66`), drift rule (`MAX_FAILING_RUN=3`), math check, and backstop —
   plus the E1 backstop fix (count the *selected* manifest's anchored +
   anchored-chars). Chapter-granularity aggregation (r3 open question #2) is
   **deferred**: it kills no named receipt; the drift rule already handles the
   P27 false-reject class at page granularity. Revisit only if the hell corpus
   produces a good book the drift rule kills.
5. **Per-page provider escalation replaces lane admission** (r3 §5, r1 §9.1):
   `fastpath_scan` + a new **font-cmap audit** (pypdf `/Resources`/`/Font`
   walk; flag pages whose fonts lack ToUnicode or fail cmap round-trip) become
   the routing input; coverage becomes a per-page fact feeding escalation, not
   a book-binary kill (R4). Lanes as CLI switches stay for debugging only.
6. **Exit protocol unchanged** (0 ok · 2 scanned · 3 gate · 1 error) through
   T4, with `Some(4)` added to the Rust Ok-arm (E6). All new rejections reuse
   exit 2/3 with specific `reason` strings — the Rust JSON passthrough
   (`hpub.rs:286-301`) needs no further changes.

## RULING 2 — Wave plan, file ownership, write order (binding)

`make_hpub.py` is ONE file: **at most one writer holds it at any moment, and
its writers are strictly sequenced T1→T2→T3→T4 with a commit + full gates green
between waves.** Writers on *other* files may run concurrently with a
make_hpub.py writer (one writer per file), since the constitution's rule is
per-file. Write order:

**T1 — no hangs (R1) — receipt class: the pipeline never hangs or dies dumb.**
- *Writer 1 (owns `make_hpub.py`; also owns new `tests/hell/` files):*
  1. Promote r4's harness (`hellgen.py`, `run_case.py`, `run_harness.py`)
     into `apps/readest-app/src-tauri/resources/hpub/tests/hell/` — first
     commit, before any behavior change (fixes E4).
  2. **Zero-flag fix** (prerequisite receipt, E3): `if not flagged: flagged =
     None` → full marker pass. One-line-class; flips `sanity-5p`,
     `rotated-4p`, `broken-xref-3p` green.
  3. **Top-level error envelope**: wrap `main()`'s body so every exception
     maps to `{status:"error"|"rejected", reason, detail}` JSON + mapped exit
     (kills P9 traceback-without-JSON; structured `reason:"encrypted"` /
     `"corrupt"` where detectable).
  4. **Acquire wrapper** (R1): before `create_model_dict()` — set
     `HF_HUB_DOWNLOAD_TIMEOUT`/`HF_HUB_ETAG_TIMEOUT` defaults (30 s) unless
     user-set; pass `HF_TOKEN` through to huggingface_hub when present; wrap
     acquisition in ≤3 bounded attempts on fresh connections with a total
     deadline; a cache-dir-size poller thread emits stderr beats every 30 s
     during acquisition (marker itself stays a black box; no monkey-patching).
  5. **Chunked full-lane marker**: full marker pass runs in `page_range`
     chunks of 200 pages with a heartbeat `beat()` per chunk (~40 lines,
     reuses existing `page_range` + cache machinery). Kills P20's misdiagnosed
     kill and gives T4 per-chunk progress for free. `extreme-long-1500p` is
     the failing test first (nightly tier).
- *Writer 2 (owns `hpub.rs`; may run concurrent with Writer 1 — different
  file):* exit-4 Ok-arm + unit test (E6). Nothing else Rust-side in T1.

**T2 — smart gate/anchoring (R2, R3, I3, I4).**
- *Writer 3 (owns `make_hpub.py`; sequenced after Writer 1 commits):*
  1. **Best-of selector** (R3): build token + char manifests, score each
     (anchored fraction × containment mean), keep the max; fix the E1
     backstop counting in the same diff.
  2. **Font-cmap audit** (E2): per-page font census from pypdf resources;
     flag pages with missing/untrustworthy ToUnicode; route flagged pages to
     the VLM lane *in addition to* the existing glyph-garbage/math-font
     flags. Detector is deterministic — no model, no dep.
  3. **Multi-witness containment** (R2): VLM-routed pages are scored against
     the provider text (the splice-time md for that page), not the lying page
     text; witness identity lands in the page record. Lying-layer pages can no
     longer zero the anchor score of a recovered book, and lying-layer pages
     that *aren't* routed get caught by the font audit (E2's ship-garbage
     direction) and rejected with `reason` naming the font lie.
  4. **Splice-time provenance** (I3): spans array per Ruling 1.3.
  5. **CJK tokenization stretch** (see Open Question 2): `norm_tokens_with_offsets`
     and `containment_tokens` become script-aware; one CJK hell case.
- *Writer 4 (owns `tests/hell/` case files; concurrent with Writer 3):*
  flips `lying-cmap-5p` → `exit_in: [3]` (or `[0]` + `source: vlm` +
  zero-garbage), `no-tounicode-4p`/`pua-mapped-4p` → VLM-rescue expectations,
  and adds the P26 best-of fixture (token 0.45/cont 0.93 vs char
  0.52/cont 0.61 — assert the 0.93 manifest wins and ships, E1).

**T3 — coverage/scans (R4).**
- *Writer 5 (owns `make_hpub.py`; sequenced after Writer 3):*
  1. OCR rescue: no-text pages render via pypdfium2 (present in venv) and
     recognize via surya's existing OCR backend (llama-server, already the
     surya backend) — provenance `ocr`, per-page confidence; low-confidence
     pages escalate to the VLM. Pages with no llama-server reject loudly with
     the P22 install hint in `reason`.
  2. Replace the edge-page Picture-injection hack (`:523-537`) with honest
     provenance (page recorded as `low-text`, excluded with a visible record
     in the report) — no more silently missing chapters (P7/I5).
  3. **`coverage_check` deletion is the last commit of the wave**, only after
     `scanned-4p` and `hybrid-6p` flip green with `ocr`/`vlm` provenance
     (r3 and r4 agree; r4's exit-2 pins hold until then).
- *Writer 6 (owns `tests/hell/` flips; concurrent):* scanned/hybrid
  expectation flips ride with Writer 5's commits.

**T4 — progress UX (R1's "user thought it was stuck").**
- *Writer 7 (owns `make_hpub.py`; sequenced after Writer 5):* emit structured
  progress as `JSON` lines on stderr (stage, page fraction, ETA) from the T1
  beat infrastructure; retire dead flags (`--no-fastpath` → `--force-provider`)
  if still unused.
- *Writer 8 (owns `hpub.rs` + app import UI; concurrent after Writer 2 has
  long committed):* parse structured progress, forward on `hpub-progress`,
  light-mode librarian surface (warning badge from manifest `quality`/gate
  record — I5's "ships with a warning flag" becomes user-visible).

Gates between waves (constitution, restated binding): pipeline unit tests +
hell-corpus rows for all prior tiers green; `tsc`; no regression in the 12
campaign suites; `biome`; full conversion verified on ≥2 real books (one
lying-text-layer, one math-heavy) before merge.

## RULING 3 — Test-first criteria per wave (binding)

Every wave's first commit is its failing test; no production diff precedes it.

- **T1:** (a) harness promoted, `sanity-5p`/`rotated-4p`/`broken-xref-3p` red
  (verified red today — r5 probe §0); (b) unit test: retry wrapper against a
  stdlib slow-drip HTTP server (drip past timeout → fresh connection →
  success; truncation → loud error naming file); (c) unit test: exception in
  stage 1 → JSON result on stdout + mapped exit; (d) `extreme-long-1500p`
  red under per-page wall budget. **Green = those rows/tests green + full
  gates. Happy path byte-identical output** (sanity-5p full-lane content.md
  is the golden).
- **T2:** (a) `lying-cmap-5p` red on *both* directions today (exit 1 default
  lane / exit 0-with-garbage full lane — verified live); (b) unit test of the
  font audit on the `lying-cmap` fixture (flag exactly the lying pages,
  zero false flags on sanity); (c) unit test of the selector on the P26
  fixture; (d) CJK case red at the backstop (if stretch accepted).
  **Green = T2 rows flip, all T1 rows stay green, `i4_gate_matches_manifest`
  (r4 M2) passes on every shipped artifact, real lying-layer book converts.**
- **T3:** `scanned-4p`/`hybrid-6p` pinned exit-2 red-rows flipped to
  exit 0 + `source: ocr` provenance + I2 invariants on the text pages of
  `hybrid-6p`; **green = both rows green, every T1/T2 row still green, ≥2 real
  books incl. one scan.**
- **T4:** UI-level: 400-page import shows page-fraction progress ≥ every 30 s
  during extraction; stall injection surfaces the loud-death copy in-app;
  degraded books show the warning badge. **Green = manual QA script +
  existing suites.**

## RULING 4 — Explicitly NOT built (binding)

1. No full DP / Needleman–Wunsch / DTW aligner (r3 §10.1; r2 Steps B–D). The
   shingle-vote + cursor is kept; LIS chain anchoring, banded NW gap-fill, and
   length-sequence DTW are deferred until the hell corpus produces a book they
   demonstrably fix (I6).
2. No Docling/MinerU/GROBID as deps, no Docling-style uniform document model
   (r3 §10.2, r2 verdicts). Ideas only.
3. No inline provenance tags in content.md (offsets must stay valid; r3 §10.3).
4. No provider registry / plugin system; providers stay hardcoded functions
   (r3 §10.4).
5. No confidence calibration machinery (r3 §10.5). Heuristic confidences with
   correct ordering only.
6. No multi-modal VLM features beyond text (layout JSON as data, table
   structure extraction; r3 §10.6).
7. No streaming/chunked book assembly beyond T1's 200-page marker chunking
   (r3 §10.7).
8. No second alignment family (embeddings, line-LCS; r3 §10.8).
9. No whole-extraction reruns under different global configs (r3 §10.9); per-page
   escalation only.
10. No Rust-side orchestration of pipeline stages (r3 §10.10); the sidecar
    contract stands.
11. **No marker/surya upgrade this campaign** — pin `marker-pdf 2.0.0` /
    `surya-ocr 0.22.1` (E5: fast/balanced modes already present in the pin;
    an upgrade re-tunes every measured constant and is its own wave later).
12. **No surya `ocr_error` P(bad) service** (E5): S3-backed checkpoint,
    uncached, client/server architecture — violates the dep freeze and loses
    to the deterministic font audit on simplicity (I6).
13. **No anchor-text VLM prompting** (r2 steal #6): a refinement, not a
    receipt-killer; deferred.
14. **No chapter-granularity gate aggregation** (Ruling 1.4).
15. **No RTL/bidi handling, no XFA-specific parser, no DRM/encrypted support**
    beyond the T1 loud-structured rejection; r4 §5 keeps these out of the
    corpus on evidence grounds.
16. **No new pip deps, no reportlab/qpdf in the venv** (E5); the hell
    generator hand-rolls PDF syntax deliberately.
17. No progress-surface work before T4 (constitution tiering); T1's progress
    lines are additive stderr JSON the Rust parent may ignore.

## RULING 5 — Dependency freeze (binding)

The only dependencies are those verified present in the hpub venv on
2026-10-06: **stdlib (`urllib`, `json`, `zipfile`, `threading`, …) +
`pypdf 6.16.2`, `pypdfium2 5.10.1`, `pdftext 0.7.1`, `marker-pdf 2.0.0`,
`surya-ocr 0.22.1`, `Pillow 10.4.0`, and the external `llama-server` binary.**
No new pip packages for the entire campaign; any exception requires a fresh r5
ruling with a named receipt. Marker/surya stay pinned (Ruling 4.11). Model
weights: nothing new required — the OCR rescue (T3) uses the already-cached
surya-ocr-2-gguf via the existing llama-server backend; the font audit (T2)
downloads nothing. `HF_TOKEN` is read from the environment and passed through
(T1) — no credential UI this campaign.

---

## 2. Conflict resolutions (r3 vs r1/r2 — simplest mechanism wins)

| # | Conflict | Resolution (binding) |
|---|---|---|
| 1 | r3 §7 multi-file P0–P7 split vs constitution "self-contained sidecar" + r3's own §9 | In-file hardening (Ruling 1.1). No new modules. |
| 2 | r2 Step A "structural splice-time alignment becomes the alignment of record" vs minimal diff + E1 | Splice-time data lands as **provenance spans** (free); shingle alignment stays the offset authority in T2. Rationale: alignment-by-construction shares offsets with the same md string the gate scores — sound — but replacing the alignment core in the same wave as best-of is two risky changes where one kills the receipts; provenance gives I3 without touching offset correctness. |
| 3 | r2 Step B LIS anchoring vs r3 "do not replace the shingle-vote core" | r3 wins (Ruling 4.1): cursor survived Almanack; LIS has no named receipt it fixes. |
| 4 | r3 multi-witness `align()` contract (Witness classes, candidates API) vs simplest R2 kill | Minimal: keep `build_manifest*` signatures; add per-page best-witness choice inside containment scoring + witness record. Same receipt, ~50 lines not ~300. |
| 5 | r3 chapter aggregation (open Q2) vs r2/olmOCR page error budget | Page granularity + existing drift rule (Ruling 1.4). Error-budget vocabulary may name the gate's failing-pages payload, but no new aggregation machinery. |
| 6 | r2 steal #6 anchor-text prompting vs E2's font audit | Font audit is load-bearing (deterministic, dep-free, corpus-tested). Anchor-text prompting deferred (Ruling 4.13). |
| 7 | r2 steal #4 ocr_error P(bad) vs dep freeze | Ruled out (E5, Ruling 4.12). |
| 8 | r3 "replace coverage_check" (§8) vs r4's pinned exit-2 green rows | r4 pins hold; deletion is T3's last commit (Ruling 2 T3.3). Both docs agree once sequenced. |
| 9 | r1 P26's "worse retry won" vs code reality | Code wins (E1): retry always loses today. T2 selector + backstop fix is the same diff. |
| 10 | r3's §8 line citations (fallback `:1487`, hybrid `:436` etc.) vs HEAD | HEAD wins (fallback `:1572-1586`, `_glyph_garbage :332`, `hybrid :436` ✓); writers cite HEAD only. |

---

## 3. Open questions for the king (with r5 recommendations)

1. **CJK stretch inside T2?** The fix is small (script-aware regex in two
   functions) and CJK is the widest gate in r1's table (P18), but no named
   receipt covers it and r4's corpus has no CJK case (I6 tension).
   **Recommend: accept the stretch** — one hell case + ~10 lines, and "every
   PDF reads" is meaningless for a third of the planet otherwise. RTL/bidi
   stays out (no case, real design cost).
2. **Warning-flag UX timing:** T2 ships degradation flags in the manifest
   only; the in-app badge waits for T4. **Recommend: yes** (campaign tiering;
   r3 open question #3 concurs). Risk: degraded books ship invisibly between
   T2 and T4 — acceptable, since today they ship *unknowingly* (P3/P4/E2).
3. **Marker/surya version pin for the campaign** (Ruling 4.11). **Recommend:
   pin 2.0.0 / 0.22.1**; schedule the upgrade as a post-campaign wave with
   its own re-tuning budget.
4. **T3 scan rescue and missing llama-server:** scans on machines without
   llama-server will reject loudly (P22 reason in JSON) rather than silently
   degrade — a behavior change from today's exit 2. **Recommend: accept;**
   the reason string names the install path.
5. **T1 chunk size for full-lane marker:** ruled 200 pages (~2.5–3 min/chunk,
   comfortably inside the 900 s silence budget). **Recommend: accept**;
   `extreme-long-1500p` nightly tier calibrates the per-page wall bound.
6. **HF_TOKEN surface:** env passthrough only, no Settings UI this campaign.
   **Recommend: accept** (R1 names the credential *path*, not a UI).
7. **Real-book merge fixtures:** the T2 merge gate requires a real
   lying-text-layer book (Goodfellow class) and a math-heavy book (Tadelis).
   **Recommend: king confirms both are in the test library** before T2
   starts, or the merge gate is unverifiable.
8. **Harness home:** `apps/readest-app/src-tauri/resources/hpub/tests/hell/`
   (r4 §4's first option — lives beside the pipeline it tests).
   **Recommend: accept.**

*— r5, 2026-10-06. All probes rerunnable: hell corpus at `/tmp/hpub-hell/`,
venv at `~/Library/Application Support/com.bilingify.readest/hpub-venv`,
`HF_HUB_OFFLINE=1`.*
