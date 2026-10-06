# HPUB 2.0 CAMPAIGN — "Every PDF Reads" (constitution, binding)

**Owner ruling 2026-10-01:** generalise the PDF→hpub pipeline from first principles.
North star: *any PDF the user drops either becomes a good .hpub, or fails fast with a
clear actionable reason. It never hangs, never fails silently, never ships garbage.*

## The four empirical receipts (hard requirements — we watched these fail)

R1. **HF download stall**: Surya model download died mid-file; pipeline slept at 0% CPU
    forever. No timeout/retry/resume/error. (fixed by hand: kill + relaunch)
R2. **Lying text layer**: Goodfellow 2015 PDF — glyphs without Unicode maps. Extraction
    was FINE (0 PUA after cleanup) but anchoring scored 0% and the gate rejected a good
    book. Gate cannot distinguish "extraction garbage" from "PDF lies, we recovered".
R3. **Worse retry won**: token anchoring 12% → char-shingle retry 0% → gate judged the
    RETRY. Best-of-two violation.
R4. **Scanned books die**: coverage check rejects image-only PDFs (exit 2); no OCR rescue
    even though the full-VLM lane exists.

Plus: no progress surface in-app (user thought it was stuck); no HF_TOKEN path.

## First-principles invariants (every design decision is tested against these)

I1. **Bounded time or loud death**: every network call, every download, every model
    inference has a watchdog. Stall → retry with fresh connection → bounded retries →
    loud, specific error. 0% CPU sleeps are bugs.
I2. **Per-page, per-chapter degradation**: one broken chapter must not fail an 800-page
    book. Quality thresholds apply at the smallest useful unit, then aggregate.
I3. **Provenance on every span**: every text span in content.md knows its source
    (pdftext / vlm / ocr / epub / llm-repaired). The manifest records confidence per page.
    Downstream (professor grounding, narration) reads provenance, not just text.
I4. **Best-of**: when a fallback runs, the BEST result wins, never the last.
I5. **Truth over beauty**: a book that reads with degraded grounding ships with a warning
    flag; a book that doesn't read is rejected with the exact pages/classes and why.
I6. **No speculative generality**: every mechanism traces to a named failure mode or a
    hell-corpus test case. (Karpathy: no features beyond what was asked.)

## Binding process rules

- Karpathy guidelines bind every writer: minimum code, surgical diffs, verifiable goal
  per wave ("write the failing test first" where feasible).
- Queen protocol: this constitution → parallel research (r1–r4) → audit (r5) → writer
  waves (one per tier) → tester → reviewer → commit. One writer per file at a time.
- Gates: pipeline unit tests + hell-corpus harness green; tsc; no regression in the
  12 campaign suites; biome. Full conversion verified on ≥2 real books (incl. one lying
  text-layer book and one math-heavy book) before merge.
- Non-negotiables: the pipeline stays a self-contained sidecar script; deps already in the
  venv (no new heavyweight deps without an r5 ruling); light-mode librarian UX for any
  user-facing surface.

## Research lanes (parallel, read-only)

- **r1 failure-taxonomy**: exhaustive catalog of real-world PDF pathologies; which stage
  of the current pipeline each one hits; which receipt/invariant covers it.
- **r2 prior-art**: how Marker/surya, Docling, MinerU, GROBID, PyMuPDF, olmOCR handle
  extraction+alignment; what to steal; sequence-alignment prior art for page mapping.
- **r3 first-principles design**: the minimal universal pipeline, designed from scratch
  (PDF → content/geometry/render → provenance-tagged text → page map), then mapped
  against what exists. Output: target architecture + what stays/goes.
- **r4 hell-corpus**: synthesized nasty-PDF generator + harness + quality metrics that
  define "reads" without a human in the loop.

Audit r5 arbitrates conflicts and issues the wave plan. Tiers: T1 no-hangs, T2 smart
gate/anchoring, T3 coverage (scans), T4 progress UX.
