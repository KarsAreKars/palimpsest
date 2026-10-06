# HPUB 2.0 — Failure Taxonomy (r1)

**Scope:** every real-world PDF pathology we can name, mapped against the *actual*
pipeline in `apps/readest-app/src-tauri/resources/hpub/make_hpub.py` (1718 lines)
and the app-side spawner `apps/readest-app/src-tauri/src/hpub.rs` (326 lines).
Method: trace each pathology through the 6 stages, classify today's behavior
(**works** / **degrades** / **rejects** / **hangs**), name the receipt (R1–R4) or
invariant (I1–I6) that covers it, and give r4 a concrete hell-corpus test.

Evidence citations are `make_hpub.py:LINE` / `hpub.rs:LINE`.

---

## 0. The 6 stages (as implemented, not as imagined)

| # | Stage | Code | Notes |
|---|-------|------|-------|
| 1 | **coverage** | `extract_page_texts` 1396 → `despace_page_text` 1397 → ligature expand 1409 → `coverage_check` 178 | pypdf, not pdfium (comment at 141–148: pdfium reading order perturbs containment). Uncaught exceptions here escape to the Rust layer with **no JSON result**. |
| 2 | **lane extraction** | fusion lane 1415–1442 (`--epub`) / fastpath scan 1438 → `hybrid_marker_extract` 436 / full `marker_extract` 229 | VLM = Marker+surya+llama-server; prose lane = pdftext blocks (`_prose_block_text` 422). `ensure_llama_cpp` 201 only *resolves* the binary, never enforces it (227). |
| 3 | **llm-cleanup** | `llm_config` 668 → targeted spans 1492–1513 → `llm_cleanup_pass` 762 → `_post_chat_completion` 734 | Skipped silently when no key (1527). Watchdog-aware (heartbeat beats per chunk, 783). 2 attempts, original kept on failure (797–807). |
| 4 | **alignment** | `build_manifest` 828 (token shingles) → fallback `build_manifest_chars` 979 (char shingles, triggered at 1576–1588) | Monotonic cursor + confidence floor 0.5 (43) + interpolation for unmatched pages 888–905. `[a-z0-9]+` tokenization at 577 — **the ASCII bias that kills CJK/RTL**. |
| 5 | **gate** | `containment_check` 1217 (or `_chars` 1100) → `gate_book` 1276 | Class-aware A2: prose ≥0.70/page, mean ≥0.85; mixed ≥0.50; visual excluded (59–62, 1238–1246). Backstop ≥50% anchored (1285). Math check (1298). Drift run ≥3 (1259–1267). |
| 6 | **packaging** | `--out-dir` / `--out-hpub` 1659–1705 | Also writes `conversion_report.json` (1555–1566) with replacement/PUA counts — the only "warning flag" surface (I5), and it is a sidecar file, not user-visible. |

Exit protocol (hpub.rs 22–24, 295–301): 0 ok · 2 scanned · 3 gate · 1 error.
**Exit 4 (edition_mismatch, 1623) is not in the Rust match** — surfaces as a
generic `Err`, not a structured rejection. Watchdog: 10 min stderr silence →
kill (hpub.rs 33–36, 240–257); 2 h hard cap (hpub.rs 38). Progress streamed on
`hpub-progress` events (hpub.rs 160–168).

---

## 1. Font-level pathologies (the text layer lies)

### P1. Fonts without ToUnicode — CID / custom CMaps / subset fonts *(the Goodfellow case, R2)*
- **Stages hit:** 1 (silently), 4, 5.
- **Today:** **rejects** (or degrades then rejects). The lying font produces
  wrong-but-plausible Unicode (CID codes mapped to arbitrary Latin), so
  `_glyph_garbage` (332) sees **zero** U+FFFD/PUA and `fastpath_scan` does not
  flag the page (383–392: math-font name or ≥2 garbage chars, nothing else).
  Prose lane narrates the lie. Token anchoring then scores ~0% against the md
  (R2: *"gate cannot distinguish extraction garbage from PDF lies, we
  recovered"*). Backstop at 1285 or prose_mean at 1318 → exit 3. A **good book
  with a recovered text layer is rejected**, exactly R2.
- **Covers:** R2; I4 (best-of absent), I5 (no "lying layer" verdict class).
- **Hell test:** synthesize a PDF whose subset font maps glyphs → wrong Latin
  codepoints (no ToUnicode), prose content otherwise clean. Assert: pipeline
  detects the lie (font-level ToUnicode audit), routes those pages to the VLM
  lane, and the gate judges the VLM-recovered md, not the lying layer.

### P2. Type3 fonts
- **Stages hit:** 1, 2, 4, 5.
- **Today:** **rejects** usually, with a *wrong reason*. pypdf extracts Type3
  char names or nothing; if <20 alnum chars/page the coverage gate counts
  no-text (184); a born-digital Type3 book can trip the **scanned** rejection
  (189–198) — a false R4 verdict. If it passes coverage, behavior is P1's:
  unflagged garbage → anchoring collapse → exit 3.
- **Covers:** R4 (misclassified rejection), I5 (reason is a lie).
- **Hell test:** Type3-embedded font (e.g. LaTeX with embedded bitmap-ish Type3
  or gnuplot Type3) with real text. Assert: not rejected as "scanned"; if
  extraction is unusable, the VLM lane is invoked and the reason string says
  "font without Unicode map", not "scanned".

### P3. PUA-mapped math fonts (the HTML-print case)
- **Stages hit:** 2 (flag), 3, 6.
- **Today:** **degrades**. `_glyph_garbage` (332) counts PUA U+E000–F8FF; ≥2
  chars flags the page for the VLM (384–386). But (a) a prose page with **1**
  PUA char is never flagged and ships it; (b) with no API key the cleanup pass
  is skipped entirely (1526–1527) and surviving PUA only produces a stderr
  WARNING + `conversion_report.json` entry (1539–1549) — the book **ships with
  spoken garbage** and the user is never told (I5's "warning flag" exists only
  in a debug file).
- **Covers:** I3 (no provenance tag on repaired spans), I5 (warning not
  user-visible).
- **Hell test:** HTML→PDF of a math StackExchange thread (icon-font/PUA math,
  webfont subsets). Assert: zero PUA in content.md **or** an in-app warning
  badge driven by `quality.ok == false`.

### P4. Missing-glyph replacement chars (U+FFFD)
- **Stages hit:** 2, 3, 6.
- **Today:** **degrades**. Same path as P3: ≥2 U+FFFD → VLM flag (332–336);
  surviving singles → WARNING + report only (1543–1549). The Nemotron-3 leak
  (comment at 1501–1505) is precisely the <2-char-per-page case that evades
  flagging; the targeted-cleanup targeting (1507–1513) only runs **with an API
  key**.
- **Covers:** I5; partially I3.
- **Hell test:** PDF where inline math renders as single scattered U+FFFDs
  across many prose pages (1–2 per page). Assert: every \ufffd either gone from
  content.md or covered by a provenance-tagged repair.

### P5. Math-font ToUnicode glyph-name leaks
- **Stages hit:** 4, 5.
- **Today:** **works** (patched 2026-09). `_GLYPH_NAME_RE` (1197) filters
  furniture tokens like `bracehtipupleft` on both tokenization paths (577–580,
  1212–1215). Residual risk: glyph names outside the regex's
  brace/bracket/paren/arrow families leak into votes.
- **Covers:** I6 (mechanism traces to the Tadelis failure).
- **Hell test:** CMEX-heavy page (delimiters, arrows, integral stacks) — assert
  anchoring confidence unaffected by glyph-name tokens.

---

## 2. Document-class pathologies (coverage & lanes)

### P6. Scanned / image-only books *(R4)*
- **Stages hit:** 1.
- **Today:** **rejects**, exit 2, at 178–198. `MAX_NOTEXT_FRACTION` 0.20 (49).
  Message: "OCR is too lossy … find the digital PDF." The VLM lane exists
  (hybrid lane literally runs surya on image content) but is **never offered**
  as a rescue — R4 verbatim. Receipt open.
- **Covers:** R4; I2, I5 (rejection is loud, at least).
- **Hell test:** pure-scan PDF (rasterize a real book, no text layer). Assert:
  exit 2 today; post-T3 the same input enters an OCR/VLM lane with per-page
  confidence and ships as provenance-tagged `ocr`/`vlm` spans or fails with the
  exact page list.

### P7. Hybrid born-digital + scanned chapters
- **Stages hit:** 1, 2, 5.
- **Today:** **degrades silently**. Two holes: (a) a scanned chapter **inside
  the 5% edges** is never fastpath-flagged (comment at 400–403: edge low-text
  pages are deliberately skipped after the South front-matter measurement) —
  the hybrid lane then injects a fake full-page `Picture` block (519–530) so
  `classify_pages` marks it visual and the gate **excludes it from scoring**
  (1238). The book ships with a silently missing chapter. (b) A scanned chapter
  mid-book with a *noisy* OCR layer ≥400 chars evades the low-text flag
  entirely; its garbage prose fails containment → if the run is ≥3 pages the
  whole book is rejected (1318–1335), if <3 the drift rule tolerates garbage.
- **Covers:** R4 (partial coverage), I2 (per-chapter degradation absent), I3
  (no provenance on VLM pages vs skipped pages), I5 (silent).
- **Hell test:** born-digital book with (i) a scanned plate section in the
  front matter and (ii) a 5-page scanned appendix mid-book. Assert: every
  no-text page is either VLM-recovered with provenance or reported to the user;
  never silently Picture-injected.

### P8. XFA forms (born-digital but not extractable by pypdf)
- **Stages hit:** 1.
- **Today:** **rejects with a false reason**. pypdf's `extract_text` on
  XFA-only PDFs returns ~nothing → coverage counts no-text → exit 2
  "scanned" (189). The book is digital; the user is told to "find the digital
  PDF." Same failure class as P2.
- **Covers:** I5 (reason must be truthful), R4-adjacent.
- **Hell test:** Adobe-generated XFA PDF with real text. Assert: rejection
  reason names "form-based PDF, no extractable text layer", not "scanned".

### P9. Encrypted PDFs
- **Stages hit:** 1.
- **Today:** owner-password-only → **works** (pypdf opens without the
  password). User-password → `PdfReader` raises at 1396 **outside any
  try/except** → traceback on stderr, exit 1, **no JSON on stdout** → Rust
  reports "hpub sidecar produced no result" (hpub.rs 276–282) or a bare
  status-1 `Err` (hpub.rs 303–308). Fails, but not with an actionable reason.
- **Covers:** I1 (loud death, wrong words), I5.
- **Hell test:** AES-256 user-password PDF. Assert: structured result
  `status: "rejected", reason: "encrypted"`, exit 2 or 3, no traceback.

### P10. Broken xref tables / truncated PDFs
- **Stages hit:** 1 (or 2).
- **Today:** **mostly works** — pypdf rebuilds xrefs on `strict=False` default;
  pdfium (pdftext/Marker) is even more tolerant. Unrecoverable corruption →
  same uncaught-exception path as P9: exit 1, no JSON, nondescript error.
  Truncated-mid-download (the R1-adjacent "half a PDF" case) lands here.
- **Covers:** I1, I5.
- **Hell test:** (a) xref deliberately zeroed; (b) file truncated at 80%.
  Assert (b) yields "file is truncated/corrupt", not a Python traceback.

---

## 3. Geometry & layout pathologies

### P11. Two-column layouts, interleaved reading order
- **Stages hit:** 1, 4.
- **Today:** **degrades**. Row-interleaved page text ("left line, right line,
  left…") still contains the same token *multiset*, and both voting
  (844–856) and containment (1220–1235) are multiset-based, so the gate
  usually passes. But the winning vote bucket spreads (shingles stride across
  column boundaries that don't exist in md) → coarser windows, lower
  confidence, more `interpolated` pages → page-level grounding is wrong-ish
  while the book "passes." r2's sequence-alignment prior art is the fix.
- **Covers:** I3 (grounding quality), I6.
- **Hell test:** two-column ACM paper with cross-column sentence continuation.
  Assert: per-page md window error < 1 page on ≥95% of pages (needs an
  order-aware metric, not containment).

### P12. pdftext reading order visual-not-logical (headers/footers/captions)
- **Stages hit:** 1, 4. Same family as P11: content-stream order vs logical
  order. Marginals are dropped in the **hybrid lane only** (hybrid
  531–538: short blocks hugging top 8% / bottom 6%); in the marker-full lane
  the md side may keep running heads while the page text has them too — tokens
  match, so it passes; but md is polluted with "SOUTH · 2" repeated. Cleanup
  system prompt asks the LLM to remove them (658–666) — only with an API key.
- **Today:** **degrades**.
- **Covers:** I3, I5.
- **Hell test:** book with running heads + page numbers + footnotes per page.
  Assert: running heads absent from content.md regardless of API-key presence.

### P13. Rotated / landscape pages
- **Stages hit:** 1, 2, 4.
- **Today:** **degrades**. pypdf on `/Rotate 90` pages returns reordered or
  space-corrupted text (coverage and shingles both suffer); pdfium/Marker
  generally handle rotation, so md is clean while page text is scrambled →
  containment misses on exactly those pages; 3 consecutive rotated pages →
  drift rejection (1318) of an otherwise good book. Marginal-dropping geometry
  (532–537) also mis-fires on rotated bboxes.
- **Covers:** I2 (per-page degradation), I6.
- **Hell test:** book with a 4-page rotated landscape table section. Assert:
  pages anchor (char fallback already boundary-tolerant) and no false drift
  rejection.

### P14. Zero-width / merged glyphs (no word gaps)
- **Stages hit:** 4.
- **Today:** **works** (fallback). "thesame way" breaks 6-token shingles on
  both sides → anchored fraction < 0.5 → `build_manifest_chars` retry
  (1576–1588; 956–960). Char shingles are gap-agnostic. This is the inverse of
  the letter-space case handled up front by `despace_page_text` (151–176,
  >50% single-char tokens). Both repairs are pre-gate.
- **Covers:** I4 (the retry exists), I6. Residual: **R3-class risk** — best-of
  between token and char alignment is by threshold, not by score; a book where
  char alignment is *worse* but crosses 0.35 (958) keeps the char manifest.
- **Hell test:** PDF with kerned-to-zero word gaps on every page. Assert: char
  fallback engages and containment passes; plus a Goodfellow-style case where
  token wins and char loses, to pin I4.

### P15. Letter-spaced text layers ("T h e s a m e w a y")
- **Stages hit:** 1, 4.
- **Today:** **works** — `despace_page_text` (151–176) rejoins >50%-singleton
  token runs before coverage/alignment (1397). Threshold risk: exactly 50%
  singles, or books mixing letter-spaced display type with normal body, fall
  through to the char fallback (fine) or fail.
- **Covers:** I6 (named failure mode).
- **Hell test:** title page + chapter heads in letter-spaced small caps, body
  normal. Assert: rejoin fires on the display pages only.

---

## 4. Typography-text pathologies

### P16. Ligature explosions (fi/fl/ffi)
- **Stages hit:** 1, 4, 5.
- **Today:** **works**. `_LIGATURES` (1183–1195) expands ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ on
  **both** sides: page text expanded at the source (1409–1413, so offsets
  stay consistent), md expanded at 1490. Tokenization then splits letter/digit
  runs (1204–1215) so flattened sub/superscripts compare equal. Tadelis ch.16
  was the receipt.
- **Covers:** I6. Residual: ligature codepoints outside U+FB00–FB06 (rare
  vendor PUA ligatures) and `st`-ligature over-expansion (`\ufb05/\ufb06` →
  "st" can create false token matches).
- **Hell test:** page dense with "final", "affinity", "office" (fi/ff/fl/ffi).
  Assert: containment unaffected vs the de-ligatured ground truth.

### P17. Print hyphenation mismatch (pdftext "hy-\nphen" vs md "hyphen")
- **Stages hit:** 1, 4, 5.
- **Today:** **degrades**. The gate compares pypdf page text against md, but
  rejoining happens on *different* text per lane: fusion lane dehyphenates the
  page texts themselves (1425–1428); the hybrid prose lane rejoins in
  `_prose_block_text` (428–432) — but that repaired text goes into **md**, not
  into `page_texts`, which the gate still scores raw. Marker-full lane: md is
  rejoined by Marker, page text keeps the split → "hy","phen" vs "hyphen" =
  guaranteed containment miss per hyphenation. Tolerated in practice by the
  0.70/0.85 thresholds (59–60) on prose-poor pages; dense-hyphenation pages
  (narrow columns, justified TeX) eat real margin.
- **Covers:** I6 (no named mechanism fixes the marker-lane page side).
- **Hell test:** narrow-measure justified book, ≥8 hyphenations/page. Assert
  per-page containment ≥0.95 after a page-side dehyphenation pass.

### P18. CJK text (Chinese/Japanese/Korean)
- **Stages hit:** 4, 5 — fatal.
- **Today:** **rejects every CJK book**. `norm_tokens_with_offsets` (575–583)
  and `containment_tokens` (1202–1215) tokenize `[a-z0-9]+` only; CJK
  codepoints yield **zero tokens** → every page votes 0 → unmatched →
  anchored fraction 0 → backstop exit 3 (1285–1296). Char fallback doesn't
  save it: `char_norm_with_offsets` (963) keeps `ch.isalnum()`, so CJK chars
  *do* form char shingles — but containment then compares CJK page chars
  against an md window whose CJK content is identical, so it could pass…
  except token anchoring already rejected the book at the backstop before the
  char path is even tried for anchoring quality, and `MIN_ANCHORED_FRACTION`
  counts only `method == "anchored"` (1290). I.e. CJK can anchor via chars but
  is judged by the token manifest's failure unless the fallback triggers,
  which itself keys on the token anchored fraction — it *would* trigger
  (0 < 0.5). Char path then works in principle; unverified on real CJK, and
  `MATH_FONT_RE`/cleanup/fusion are all Latin-shaped. Treat as **reject/
  untested**.
- **Covers:** I2 (whole language class fails), I6 violated (no CJK test in
  the corpus).
- **Hell test:** public-domain Japanese novel PDF + a mixed JP/EN math text.
  Assert: anchors, containment, gate all green; add CJK tokenizer
  (`\w` with UNICODE flag or per-script shingles).

### P19. RTL / Arabic / Hebrew text
- **Stages hit:** 2, 4, 6.
- **Today:** **rejects** (same ASCII-token backstop as P18) and, worse, if it
  ever passed, **bidi reordering** would corrupt content.md: pdftext and
  Marker each apply their own bidi resolution, so md and page text can hold
  *different* orderings of the same words; containment is multiset-safe but
  narration reads reversed fragments. No bidi handling anywhere in the
  pipeline (grep: none).
- **Covers:** I2, I5.
- **Hell test:** Arabic short-story PDF. Assert: RTL-aware tokenization and a
  normalized-direction check in the gate.

---

## 5. Scale & robustness pathologies

### P20. Huge page counts (>2000 pages)
- **Stages hit:** 2, 6 (and the Rust watchdog).
- **Today:** **hangs → misdiagnosed kill**. Serial Marker measures 0.65–0.83
  s/page (comment 265–270): 2000 pages ≈ 22–28 min of marker alone. The
  `_Heartbeat` around Marker has **no beat source** (comment 117–121), so
  after its 900 s silence budget it goes quiet (110–122), and 10 min later
  the Rust stall watchdog kills the job (hpub.rs 240–257) — a *legitimate*
  2500-page conversion dies as "no progress for 10m during marker
  extraction". No page-range chunking in the marker-full lane (only the
  hybrid lane passes `page_range`, 287–292). Memory: md/shingle indexes grow
  linearly; 2000 pages ≈ multi-GB RSS risk unmeasured.
- **Covers:** I1 (bounded time exists but misclassifies), I2 (no per-volume
  splitting).
- **Hell test:** 2500-page synthesized prose PDF. Assert: completes (chunked
  marker invocations with progress beats) or fails with "book too large,
  N pages, estimated M min" — never a watchdog kill.

### P21. HF download stall / model-weight download *(R1)*
- **Stages hit:** 2 (`create_model_dict` at 317 downloads surya weights on
  first run; also venv bootstrap outside the script entirely).
- **Today:** **hangs (bounded) → wrong diagnosis, no retry/resume**. No
  timeout/retry/resume on the HF path inside the script (I1 violation,
  receipt open). The heartbeat going quiet after 900 s lets the Rust kill
  fire (~25 min) — better than R1's forever-sleep, but the user gets "no
  progress for 10m during marker extraction", the partial download is
  **not resumed** (Marker cache at 247–256 covers extraction output, not
  weights), and there is **no HF_TOKEN path** (constitution: "no HF_TOKEN
  path" — gated/private models 401 with no credential surface).
- **Covers:** R1; I1 (partially — bounded now, but no retry/resume/loud-specific).
- **Hell test:** stub `HF_ENDPOINT` serving a model file that stalls at 50%
  (byte-drip), then a second run serving it fully. Assert: timeout → fresh
  connection → resume from partial → success; and `HF_TOKEN` env is honored
  and surfaced in errors.

### P22. No llama-server on the machine
- **Stages hit:** 2.
- **Today:** **rejects, indirectly**. `ensure_llama_cpp` logs "NOT found —
  will fail" (227) and **continues**; surya's llamacpp backend then raises
  inside `build_document`, caught at 1452–1456 → `emit(error, stage:
  marker)` exit 1. Loud, but the actionable reason ("brew install
  llama.cpp") is buried one log line above the error, not in the result JSON.
- **Covers:** I5 (reason should be exact), I1.
- **Hell test:** run with `LLAMA_CPP_BINARY` pointed at /bin/false. Assert:
  result JSON carries `reason: "llama-server missing/unrunnable"` with the
  install hint.

### P23. No GPU (CPU-only machine)
- **Stages hit:** 2, then the watchdog.
- **Today:** **hangs → misdiagnosed kill**. Everything runs on CPU at
  ~10–30× decode cost; a 300-page math book exceeds the heartbeat's silence
  budget mid-phase → watchdog kill "wedged". There is no capability probe, no
  CPU fallback estimate, no "this will take N hours" surface (I1: no
  estimated-time budget per machine class).
- **Covers:** I1, I5.
- **Hell test:** force `CUDA_VISIBLE_DEVICES=""` on a GPU-tuned venv, 100-page
  math PDF. Assert: up-front "no GPU: estimated 90 min" estimate or a
  CPU-tuned config (lower `SURYA_INFERENCE_PARALLEL`), not a watchdog kill.

### P24. No API key (LLM cleanup / LLM-assisted extraction)
- **Stages hit:** 2, 3.
- **Today:** **degrades, silently**. `--use-llm` without
  `PALIMPSEST_LLM_API_KEY` downgrades to plain with one stderr line
  (300–303); cleanup is skipped with one line (1526–1527). A math-dense book
  then risks `math_not_preserved` exit 3 (1298–1316) — which per I5 is
  arguably correct (loud rejection beats silent garbage) — but a lying-text-
  layer book (P1/P4) that *needed* cleanup ships un repaired with only a
  debug-file warning.
- **Covers:** I5, I3.
- **Hell test:** P1's Goodfellow-style PDF run with and without a key. Assert:
  without a key the import either engages the VLM lane harder or tells the
  user "an AI key would repair N pages" — never silent degradation.

---

## 6. Alignment & gate pathologies

### P25. Common-shingle pollution / repeated quotes *(the Almanack case)*
- **Stages hit:** 4.
- **Today:** **works** (patched). Three mechanisms: `MAX_SHINGLE_OCCURRENCES`
  25 (33) drops boilerplate shingles from the anchor index; a divider page
  whose vote fraction < 0.5 is demoted to unmatched (857–883, the 14-token
  quote page that voted 1900 tokens ahead); the monotonic cursor clamp
  (872–875) stops one anchor dragging the window forward. Interpolation
  (888–905) heals the demoted pages between confident neighbors at 0.5×
  confidence.
- **Covers:** I4-adjacent; I6 (documented).
- **Hell test:** book with an epigraph quoted verbatim 30 pages later, plus a
  near-empty divider page. Assert: pages between the two occurrences keep
  their own correct windows.

### P26. R3 — "worse retry won" (token → char fallback judging)
- **Stages hit:** 4, 5.
- **Today:** **degrades (latent)**. The char retry (1576–1588) is keyed on
  anchored fraction only; whichever manifest survives goes to **one** gate.
  There is no best-of scoring: if token anchoring hit 0.45 (rejected as
  <0.50) and char hits 0.51 with *worse* containment, the char result is
  judged and the better token result is discarded — R3 structurally intact,
  thresholds merely re-tuned.
- **Covers:** R3; I4 violated in spirit (no best-of comparison).
- **Hell test:** construct a book where token alignment scores 0.45/containment
  0.93 and char scores 0.52/containment 0.61 (e.g. heavy VLM char noise).
  Assert: the 0.93 manifest wins by score, not by which lane ran last.

### P27. Drift runs rejecting good books (page misclassification)
- **Stages hit:** 5.
- **Today:** **rejects occasionally**. `classify_pages` (594–632) keys on
  Marker-tree bbox area of visual blocks; PDFs where Marker emits a `Table`
  block over a full page of *text* (TOC-styled chapter openers, verse), or
  where geometry is missing (`frac = 1.0 if visual_blocks else 0.0`, 621–622)
  misclass prose as visual/mixed and vice versa. Misclassed visual-as-prose
  scores 0 → failing run; three in a row → exit 3 (1318–1335) for a good
  book. The hybrid lane's injected `Picture` blocks (P7) exploit the same
  classifier in reverse.
- **Covers:** I2 (per-page, not per-book), I5 (rejection names pages but not
  classes).
- **Hell test:** book whose chapter openers are full-page typographic tables.
  Assert: class-aware gate counts them as their true class; no false drift.

### P28. Empty extraction / near-empty md
- **Stages hit:** 2.
- **Today:** **rejects** cleanly: `<100` chars → `empty_extraction` exit 3
  (1462–1473). Works.
- **Hell test:** PDF whose only text is a watermark. Assert exit 3 with the
  reason above (regression pin).

### P29. Math not preserved (constraint #2)
- **Stages hit:** 5.
- **Today:** **rejects** cleanly: ≥20 equation regions and <20% LaTeX spans →
  `math_not_preserved` exit 3 (1298–1316). Works, but note the coupling with
  P24: without an LLM key, math-dense lying-layer books funnel here — loud,
  arguably correct per I5.
- **Hell test:** math textbook with formulas as images / unsalvageable glyph
  soup. Assert exit 3 with `equation_regions`/`md_math_spans` in the result.

### P30. EPUB edition mismatch (fusion lane)
- **Stages hit:** 5 (fusion).
- **Today:** **works, with a protocol wrinkle**: `edition_check` → exit 4
  (1609–1627) is *not* one of the exit codes Rust maps to structured results
  (hpub.rs 295–301 matches 0/2/3 only) → generic `Err("hpub sidecar failed
  (status 4)")` — the user sees "failed", not "different edition".
- **Covers:** I5 (message survives only inside the Err string).
- **Hell test:** EPUB of a different printing (shifted pagination). Assert the
  UI shows the edition-mismatch copy; fix Rust match to include 4.

---

## 7. Interaction pathologies (combined stress)

### P31. Fastpath flag-storm (>90% flagged)
- **Stages hit:** 2.
- **Today:** **works, degrades to slow**. >90% flagged → fast path abandoned,
  full Marker pass (1439–1443). A math-on-every-page book (textbooks) loses
  the prose-lane savings and pays full VLM time — with the P20/P23 watchdog
  exposure.
- **Hell test:** textbook with equations on 95% of pages. Assert: completes
  under the hard cap with progress beats, or chunking.

### P32. Low-text page threshold gaming
- **Stages hit:** 2, 5. A page with 399 chars of *garbage OCR* is "low-text"
  and mid-book gets VLM'd (good); 401 chars of garbage evades everything and
  is treated as prose (bad). Same asymmetry as P7. **Today: degrades.**
- **Hell test:** scanned appendix overlaid with a noisy 450-char OCR layer.
  Assert: garbage detected (font audit / entropy check), page VLM-recovered.

### P33. Progress-surface gaps (R1's "user thought it was stuck")
- **Stages hit:** all (Rust layer).
- **Today:** **works partially**. Stage lines parse to the UI only when they
  carry `N/6 ` fractions (hpub.rs 48–65, 156–168); heartbeat lines, scan
  summaries, and cleanup progress lines emit raw text. Steps 1, 4, 5, 6 are
  seconds long — the UI shows one stage for 25 min of Marker. Tier 4.
- **Covers:** R1 (UX half), I1.
- **Hell test:** UI-level — assert a progress event with page fraction at
  least every 30 s during stage 2.

---

## 8. Prioritized table

Priority = (likelihood in the wild) × (severity vs the north star). P0 blocks
the north star today; P1 rejects/maims common book classes; P2 degrades
quality silently; P3 is contained or cosmetic.

| # | Pathology | Stage hit | Today | Receipt/Invariant | r4 hell-corpus test |
|---|-----------|-----------|-------|-------------------|---------------------|
| P18 | CJK text | 4,5 | **rejects** (ASCII `[a-z0-9]+` tokens, 577/1206) | I2, I6 | Japanese novel PDF → must anchor+gate green |
| P19 | RTL/Arabic/Hebrew | 2,4,6 | **rejects** + bidi corruption | I2, I5 | Arabic short-story PDF |
| P6 | Scanned/image-only | 1 | **rejects** exit 2, no OCR rescue | R4, I2, I5 | Pure-scan PDF; post-T3: OCR lane w/ provenance |
| P1 | No ToUnicode (CID/subset, Goodfellow) | 1,4,5 | **rejects good book** (unflagged lie → 0% anchor) | R2, I4, I5 | Subset font w/ wrong Latin cmap, clean prose |
| P20 | >2000 pages | 2 + watchdog | **hangs → misdiagnosed kill** (~25 min silence budget, 110–122) | I1, I2 | 2500-page prose PDF → must chunk or estimate |
| P21 | HF download stall | 2 | **hangs → kill, no resume, no HF_TOKEN** | R1, I1 | Stalling HF endpoint; resume on relaunch; token auth |
| P23 | No GPU | 2 | **hangs → "wedged" kill** | I1, I5 | CUDA hidden, 100-page math PDF → estimate or CPU tune |
| P7 | Hybrid digital+scanned chapters | 1,2,5 | **degrades silently** (edge scans Picture-injected 519–530; gate skips) | R4, I2, I3, I5 | Scanned front-matter plates + mid-book scanned appendix |
| P26 | Worse-retry-won (token vs char) | 4,5 | **degrades (latent R3)** — judged by last lane, not best | R3, I4 | Token 0.45/cont 0.93 vs char 0.52/cont 0.61 fixture |
| P17 | Hyphenation md-vs-pdftext mismatch | 1,4,5 | **degrades** (page side never dehyphenated in marker lane) | I6 | Narrow justified measure, ≥8 hyphens/page |
| P11 | Two-column interleaved order | 1,4 | **degrades** (multiset masks it; windows coarse) | I3, I6 | ACM two-column with cross-column sentences |
| P12 | Visual-not-logical pdftext order | 1,4 | **degrades** (running heads only dropped in hybrid lane 531–538) | I3, I5 | Running heads + footnotes + page numbers |
| P13 | Rotated/landscape pages | 1,2,4 | **degrades** → false drift reject ≥3 pages | I2, I6 | 4-page rotated landscape table section |
| P3 | PUA math fonts (HTML print) | 2,3,6 | **degrades** — singles unflagged; no-key ships garbage, warning only in report (1543–1549) | I3, I5 | Webfont PUA math thread, 1–2 PUA/page |
| P4 | U+FFFD replacement chars | 2,3,6 | **degrades** (same path as P3) | I5 | Scattered single \ufffd inline-math leak |
| P22 | No llama-server | 2 | **rejects** w/ buried reason (227 logs, 1452–1456 emits generic) | I1, I5 | LLAMA_CPP_BINARY=/bin/false → reason in JSON |
| P24 | No API key | 2,3 | **degrades silently** (300–303, 1526–1527) | I5, I3 | P1 book ± key → explicit "N pages need repair" surface |
| P2 | Type3 fonts | 1,4,5 | **rejects**, often mislabeled "scanned" | R4, I5 | Type3-embedded text PDF → truthful reason |
| P8 | XFA forms | 1 | **rejects** as false "scanned" | I5 | XFA-only PDF with real text |
| P9 | User-password encryption | 1 | **fails w/o JSON** (uncaught at 1396) | I1, I5 | AES user-password PDF → structured `encrypted` |
| P10 | Broken xref / truncated | 1 | **mostly works**; else traceback exit 1 | I1, I5 | Zeroed-xref PDF; 80%-truncated PDF |
| P27 | Page misclassification drift | 5 | **rejects occasionally** (visual↔prose, 621–622) | I2, I5 | Full-page typographic "table" chapter openers |
| P32 | Garbage-OCR above 400-char flag bar | 2,5 | **degrades** (evades low-text flag) | I2, I5 | Noisy 450-char OCR layer over scanned pages |
| P31 | >90% fastpath flag-storm | 2 | **works, slow** (1439–1443) | I1 | 95%-math textbook → under cap w/ beats |
| P33 | Progress surface | all | **partial** (only `N/6` lines parse, hpub.rs 48–65) | R1, I1 | ≥1 fractioned progress event / 30 s in stage 2 |
| P30 | EPUB edition mismatch | 5 | **works; exit 4 not matched in Rust (hpub.rs 295)** | I5 | Mispaginated EPUB → UI shows edition copy |
| P14 | Zero-width merged glyphs | 4 | **works** (char fallback 1576–1588) | I4, I6 | Zero word-gap PDF + best-of pin (with P26) |
| P15 | Letter-spaced layers | 1,4 | **works** (despace 151–176) | I6 | Small-caps display + normal body |
| P16 | Ligature explosions fi/fl | 1,4,5 | **works** (both-side expand 1183–1215) | I6 | fi/ff/fl/ffi-dense page vs ground truth |
| P25 | Common-shingle pollution | 4 | **works** (33, 43, cursor 872–875) | I6 | Epigraph repeated 30 pages later + divider page |
| P5 | Glyph-name leaks | 4,5 | **works** (1197 filter) | I6 | CMEX delimiter/arrows page |
| P28 | Empty extraction | 2 | **works** (exit 3, 1462–1473) | I5 | Watermark-only PDF |
| P29 | Math not preserved | 5 | **works** (exit 3, 1298–1316) | I5, c#2 | Formula-images textbook |

---

## 9. Cross-cutting gaps the taxonomy exposes (inputs for r3/r5)

1. **No font-layer audit.** Every "the layer lies" pathology (P1, P2, P3, P4,
   P32) is detected downstream of the damage, by character inspection. A
   per-font ToUnicode sanity check at stage 1 (do cmap values round-trip?
   what's the PUA/replacement fraction per font?) would classify pages
   *before* lane selection and give the gate an honest verdict class (R2's
   "PDF lies, we recovered" vs "extraction garbage").
2. **ASCII-only tokenization** (577, 1206) is the single widest gate: P18/P19
   reject entire writing systems. Any r3 design must make tokenization
   script-aware from the first line.
3. **Best-of is structural, not threshold luck** (P26): token and char
   manifests should both be built cheaply and scored, then judged — I4.
4. **The watchdog can't tell "slow" from "wedged"** (P20, P21, P23): progress
   beats need to flow from *inside* Marker (page callbacks) and model
   downloads (byte counters), or stages must self-report ETA. Until then, big
   books and CPU machines are false-kill victims.
5. **Warning flags stop at a debug file** (P3, P4, P7): `quality.ok` and the
   conversion report (1539–1566) must surface in-app per I5's "ships with a
   warning flag".
6. **Uncaught stage-1 exceptions** (P9, P10) bypass the JSON protocol
   entirely — a top-level `try/except` around `main()` mapping every failure
   to `{status, reason, detail}` closes the I1 "loud, specific" requirement
   for free.

*— r1, 2026-10-06. Evidence: `make_hpub.py` (1718 lines, read in full),
`hpub.rs` (326 lines, read in full), `fusion.py` (351 lines, skimmed for lane
behavior), `docs/HPUB_2_0_CAMPAIGN.md`.*
