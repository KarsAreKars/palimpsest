# Research: Hardening the hpub PDF→Markdown pipeline against hangs (2025–2026)

Date: 2026-09-10 · Scope: marker-pdf/pdftext failure modes, Rust/Tauri sidecar watchdogs, LLM cleanup/verification gating.

## Summary

Your current design (stderr progress protocol, containment gate, targeted cleanup, `kill_on_drop`) already matches most published best practice. The two real gaps are: (1) **no stall watchdog anywhere** — `hpub.rs` awaits `child.wait()` with no timeout and no stderr-silence detection, so a wedged llama-server or hung LLM socket blocks forever; and (2) **`urllib.request.urlopen(timeout=180)` is a per-read timeout, not a total deadline** — a slow-dripping or accept-but-never-respond server can defeat it (this is almost certainly your 2-hour narration-polish freeze class). Marker 2.x's auto-spawned surya inference server (llama.cpp on macOS) is a known wedge point, and marker's `--use_llm` path degrades *silently to WARNING log lines* when the LLM endpoint misbehaves.

## Findings

### A. marker-pdf / pdftext landmines

1. **Claim:** Marker 2.x spawns its own surya VLM inference server — vLLM (docker) on NVIDIA, **llama.cpp everywhere else (incl. macOS)** — on first use; you can repoint it with `SURYA_INFERENCE_URL=http://host:port/v1` and tune with `SURYA_INFERENCE_BACKEND`, `SURYA_INFERENCE_PARALLEL`, `SURYA_INFERENCE_KEEP_ALIVE`, `VLLM_GPUS`. **Sources:** [marker-pdf PyPI/README](https://pypi.org/project/marker-pdf/). **Support:** direct evidence. **Confidence:** high. *Implication (researcher inference):* a wedged llama-server socket = marker blocked indefinitely with no stderr output — your exact past failure. Marker exposes no server health probe; the watchdog has to live in your Rust parent, or you run the server yourself behind `SURYA_INFERENCE_URL` and health-check it.

2. **Claim:** Marker's `--use_llm` path **fails soft and silently**: on LLM endpoint errors it logs `Ollama inference failed: 500...` / `LLM did not return a valid response` as WARNING and continues, producing output that looks fine but skipped table/math correction. **Sources:** [marker issue #907](https://github.com/datalab-to/marker/issues/907). **Support:** direct evidence (issue log trace). **Confidence:** high. *Implication:* stderr WARNING scraping is your only signal that LLM assist degraded; surface these lines in the conversion report and badge.

3. **Claim:** marker→Ollama structured output was broken by `$ref/$defs` JSON schemas ("invalid JSON schema in format"); workaround is schema flattening; a fix PR ([#977](https://github.com/datalab-to/marker/issues/907)) was only submitted 2026-01-25 and users reported the bug still present in "the latest version" days earlier. You use the OpenAI-compatible service instead — but any endpoint with strict schema handling can hit the same class. **Sources:** [marker issue #907](https://github.com/datalab-to/marker/issues/907). **Support:** direct evidence. **Confidence:** high for the bug; medium for current merge status (unverified).

4. **Claim:** Marker exposes per-service knobs `--max_retries`, `--timeout`, `--max_concurrency` (and per-processor overrides like `LLMTableProcessor_max_concurrency`). **Sources:** [marker issue #907 command line](https://github.com/datalab-to/marker/issues/907). **Support:** direct evidence. **Confidence:** high. *Gap:* default timeout value unverified (missing evidence).

5. **Claim:** Headline marker throughput ("25 pages/sec" era claims, current bench 2.9 pg/s balanced on a B200) is datacenter-GPU; real laptop/CPU users report ~6–20 pages/**minute** and overnight non-completion on a 3 MB PDF; Mac users advised downgrading to 1.8 for a performance regression (#960). **Sources:** [marker issue #982](https://github.com/datalab-to/marker/issues/982), [PyPI benchmarks](https://pypi.org/project/marker-pdf/). **Support:** direct evidence. **Confidence:** high. *Implication:* any global job timeout must be derived from measured per-page cost on target hardware (your 0.65–3.8 s/page), never from vendor benchmarks.

6. **Claim:** Official mitigations for bad/garbled text layers: `--force_ocr` (re-OCR everything), `--strip_existing_ocr` (keep digital text, drop prior OCR), `TORCH_DEVICE`, and `--mode balanced|fast` (fast mode does "surgical block-level repair of individual garbled/empty blocks"; `--disable_ocr` = pure text layer). **Sources:** [PyPI README](https://pypi.org/project/marker-pdf/). **Support:** direct evidence. **Confidence:** high. Your glyph-garbage (U+FFFD/PUA) fastpath already implements the detection half of this — that matches the community-standard ToUnicode-mojibake diagnosis ([pdf-tounicode-fix](https://github.com/thomasSong03/pdf-tounicode-fix) confirms the math-font/missing-ToUnicode mojibake pattern you documented).

7. **Claim:** `marker_server` (FastAPI) is explicitly "not a very robust API... only intended for small-scale use" and doesn't expose `use_llm`/`disable_ocr`. **Sources:** [PyPI README](https://pypi.org/project/marker-pdf/). **Support:** direct evidence. **Confidence:** high. You correctly avoid it (in-process `PdfConverter`).

### B. Rust/Tauri sidecar watchdog patterns

8. **Claim:** The canonical failure of naive spawn: **if you don't continuously drain stdout/stderr, the OS pipe buffer (~64 KB) fills and the child blocks on write — a silent stall that looks exactly like a hang.** You already stream both pipes — keep it that way; also bound memory with a ring buffer if logs get chatty. **Sources:** [Managing a CLI Subprocess from Rust (Tauri)](https://dev.to/chenxxpro/managing-a-cli-subprocess-from-rust-lifecycle-logs-and-graceful-shutdown-tauri-3g66). **Support:** direct evidence. **Confidence:** high.

9. **Claim:** "Process exists" ≠ "healthy". Field-tested Tauri pattern: drive a small state machine from the child's own log lines, plus a **fallback timer (~30 s in the cited app) that flips Connecting→Error when no decisive line ever arrives**. Shutdown = SIGTERM, grace period, then SIGKILL (`child.kill()` + `wait()`). **Sources:** same dev.to article. **Support:** direct evidence. **Confidence:** high. Your `[make_hpub +Xs]` timestamped stderr lines are a ready-made heartbeat source — the missing piece is only the timer.

10. **Claim:** tokio idiom for hard deadlines: `time::timeout(dur, child.wait()).await` → on `Err`, `child.kill().await` and return an error; `kill_on_drop(true)` (you have it) only covers handle-drop, not a wedged-but-alive child. Note `kill()` sends SIGKILL — no cleanup chance; for marker's spawned llama-server grandchildren, killing the process **group** may be needed (researcher inference: kill_on_drop on the python parent may orphan llama-server — verify on macOS). **Sources:** [tokio Child docs](https://docs.rs/tokio/latest/tokio/process/struct.Child.html), [tokio discussion #7132](https://github.com/tokio-rs/tokio/discussions/7132), [users.rust-lang timeout pattern](https://users.rust-lang.org/t/spawn-process-with-timeout-and-capture-output-in-tokio/128305). **Support:** direct evidence + labeled inference. **Confidence:** high / medium.

11. **Claim (timeout numbers worth adopting):** LLM streaming watchdog: per-chunk silence **5–12 s** by model tier (frontier 8–12 s, mid 6–10 s, budget 5–8 s; medians under normal load, peak hours 3–4× gaps), plus a **total wall-clock cap** and optional throughput trip (<2 tokens/15 s = slow drip). Standard request timeouts *do not* catch mid-stream stalls — the connection is "successful" once headers arrive. **Sources:** [llmtest.io stall detection](https://llmtest.io/blog/llm-stream-stall-detection-production-2026). **Support:** direct evidence (vendor-observed medians — treat as calibration starting points, not gospel). **Confidence:** medium-high.

12. **Claim:** Timeout stacks fail in layers: OpenAI Python SDK default = **10 min**; nginx `proxy_read_timeout` default 60 s; vLLM's streaming timeout clock starts at *request arrival, not first token*. Set every layer explicitly. A timeout should be computed from your latency distribution, not copied ("30 s is a number somebody typed"). **Sources:** [GIGAGPU](https://gigagpu.com/request-timeout-tuning-inference-server/) (search summary; page 403'd on fetch), [The Neural Base vLLM timeouts](https://theneuralbase.com/vllm/learn/advanced/request-timeout-configuration/), [Multigrid](https://multigrid.ai/learn/llm-timeouts). **Support:** direct evidence / interpretation. **Confidence:** high for SDK defaults; the GIGAGPU recommended-values table itself was not retrievable (see Missing evidence).

13. **Derived numbers for this pipeline (researcher inference, from your measured costs + sources):**
    - Sidecar heartbeat: emit a tick line every **10–15 s** during long phases (marker extraction, LLM cleanup, model load); Rust: **warn at 90 s** stderr silence, **kill at 300 s** silence. 300 s > your worst legitimate inter-line gap (cleanup chunk: 180 s timeout × 2 attempts would be 360 s — hence the tick requirement makes a single threshold safe).
    - Total job deadline: `pages × 10 s + 15 min` floor (covers 3.8 s/page worst VLM slices + cleanup), enforced via `time::timeout` around `wait()`.
    - LLM HTTP: connect **10 s**, per-read **30–60 s**, **total deadline 300 s per request** (the piece urlopen does NOT give you), max 2 retries with backoff+jitter.
    - Kill escalation: SIGTERM → 5 s grace → SIGKILL; verify llama-server grandchildren die (process-group kill or pre-job stale-server reaping).

### C. LLM cleanup/verification pass patterns

14. **Claim:** Production consensus pipeline = parse → schema-validate (Pydantic) → bounded retry **with the error message fed back into the prompt** (~8% first-pass failure → <1% on retry-with-feedback) → safe default / degrade / human review. **2–3 retries is the sweet spot**; beyond that it's a prompt problem. Your `cleanup_chunk_ok` (length-ratio 0.5–1.6, `$$` balance, refusal-prefix, fence strip) + keep-original fallback already matches the "validate then fall back to safe default" pattern; the delta is (a) feed the validation failure reason into attempt 2's prompt, (b) log validation failures structured (model, prompt version, failure type) for weekly review, (c) circuit-breaker: if >X% of chunks fail validation, abort cleanup and keep the whole original. **Sources:** [AI/TLDR LLM output validation](https://ai-tldr.dev/learn/production-llmops/guardrails-reliability/llm-output-validation/), [wisgate](https://wisgate.ai/blogs/llm-structured-output-validation). **Support:** direct evidence for pattern; the 8%→<1% stat is the source's claim (medium confidence).

15. **Claim:** Stall-abort is a *retriable* failure class distinct from hard API errors — route it to retry/fallback, and **partial output is worth keeping for prose** (threshold ~150 chars) but not for structured output. **Sources:** [llmtest.io](https://llmtest.io/blog/llm-stream-stall-detection-production-2026). **Support:** direct evidence. **Confidence:** medium-high. For your cleanup chunks, keeping the original on abort is already the right "partial".

16. **Claim (your targeting is validated by the literature, inverted):** blind full-document rewrite passes degrade good output — the published analog is "bounded correction only when safe to repeat; unresolved → review queue" ([wisgate](https://wisgate.ai/blogs/llm-structured-output-validation)). Your containment+glyph-garbage-targeted spans implement exactly this. **Support:** interpretation. **Confidence:** medium.

## Contradictions

- **Vendor throughput vs reality:** datalab's olmocr-bench table (2.9 pg/s balanced, B200, concurrent) vs issue #982's >8 h for a 3 MB PDF on a laptop GPU and ~20 pg/min on free Colab. Not truly contradictory (different hardware/parallelism) but the marketing numbers must never feed timeout math.
- **Ollama-LLM "fixed" vs not:** issue #907 is closed-as-completed, yet users in Jan 2026 report the bug persists in latest release; PR #977 merge status unverified.
- **llmtest.io chunk-timeout ranges are proxy-observed medians for hosted frontier APIs** — a local llama-server under memory pressure has a different (worse-tailed) distribution; treat 8–12 s as a floor, not a target, for local inference.

## Missing evidence

- Default value of marker's LLM-service `timeout` config (users pass `--timeout 120` explicitly; default not documented in fetched sources).
- Whether marker PR #977 (Ollama `$defs` schema fix) is merged as of 2026-09.
- GIGAGPU's concrete per-layer recommended timeout table (HTTP 403 on fetch; only the layered model was recoverable from search snippets).
- No direct source found for "typical stall-timeout values for PDF-extraction sidecars" specifically — the numbers in Finding 13 are researcher inference from LLM-streaming practice + your measured per-page costs.
- Unverified: whether `kill_on_drop`/SIGKILL on the python sidecar reliably reaps marker's auto-spawned llama-server grandchild on macOS.

## Sources

- Kept: [marker-pdf PyPI/README](https://pypi.org/project/marker-pdf/) — authoritative flags, env vars, inference-server architecture, benchmarks
- Kept: [marker issue #982 (Performance)](https://github.com/datalab-to/marker/issues/982) — real-world slowness, H100-benchmark caveat, 1.8 downgrade advice
- Kept: [marker issue #907 (Ollama LLM broken)](https://github.com/datalab-to/marker/issues/907) — silent WARNING degradation, $defs schema bug, max_retries/timeout knobs
- Kept: [llmtest.io — stalled LLM stream watchdogs](https://llmtest.io/blog/llm-stream-stall-detection-production-2026) — chunk-timeout numbers, slow-drip, partial-output recovery
- Kept: [Managing a CLI Subprocess from Rust/Tauri (dev.to)](https://dev.to/chenxxpro/managing-a-cli-subprocess-from-rust-lifecycle-logs-and-graceful-shutdown-tauri-3g66) — pipe-drain stall, log-driven health state machine, SIGTERM→SIGKILL
- Kept: [tokio Child docs](https://docs.rs/tokio/latest/tokio/process/struct.Child.html) + [timeout pattern](https://users.rust-lang.org/t/spawn-process-with-timeout-and-capture-output-in-tokio/128305) — kill_on_drop semantics, timeout+kill idiom
- Kept: [AI/TLDR — LLM output validation](https://ai-tldr.dev/learn/production-llmops/guardrails-reliability/llm-output-validation/) — parse/validate/retry/fallback hierarchy, retry-with-error-feedback numbers
- Kept: [The Neural Base — vLLM request timeouts](https://theneuralbase.com/vllm/learn/advanced/request-timeout-configuration/) — streaming clock starts at arrival; health endpoints exempt
- Kept: [pdf-tounicode-fix](https://github.com/thomasSong03/pdf-tounicode-fix) — corroborates math-font ToUnicode mojibake class
- Deprioritized: GIGAGPU timeout tuning (403 on fetch; layered model kept from snippet), markaicode Ollama timeouts (SEO-heavy), voicebox DeepWiki (secondhand architecture summary), multigrid.ai (fetch aborted; thesis captured via snippet)

## Next steps

1. Check whether killing the sidecar orphans `llama-server` on macOS (`pgrep -f llama-server` after a kill); if so, spawn with process-group + group kill, or pre-job stale-server reaping.
2. Grep marker's installed source for `class BaseService` / `timeout` defaults to pin down Finding 4's default.
3. Instrument one week of cleanup-chunk validation-failure logs before tuning retry count (the 8% base rate is a hosted-API number; local endpoints differ).

---

## Appendix: OCR-engine evaluations

### baidu/Unlimited-OCR (evaluated 2026-09-12) — REJECTED for Palimpsest

Baidu's June-2026 "one-shot long-horizon parsing" model (arXiv 2606.23050, MIT license, HF weights `baidu/Unlimited-OCR`), positioned as a step past DeepSeek-OCR. Strong points: multi-page one-shot parsing (32k ctx), <|det|> bbox markers in output, OmniDocBench lineage, vLLM/SGLang/Transformers paths.

Why not for us:
1. **Hardware (corrected 2026-09-12 after user challenge)**: the model is only 3B BF16 (~6.7GB) — it FITS our Mac fine, and issue #81 confirms CPU inference works after patching out hardcoded `.cuda()` calls in the trust_remote_code modeling files. But: **MPS (Apple Silicon GPU) crashes mid-generation** (same issue, open/unresolved), the llama.cpp route produces broken output (issue #82: infinite repetition), and there's an open "🍎 Add Mac App" request — zero official Mac support. CPU-only means a 3B VLM per 1024px page at minutes/page → a 300-page book = hours vs our measured 82 s for a 51-page paper — while fighting Kokoro/Qwen for RAM. Patching vendor remote code is also a maintenance tar-baby for a pipeline whose contract is "never breaks". So: runnable in principle, impractical and unsupported in practice.
2. **Constraint #1 makes full-page OCR unnecessary**: we REJECT scanned PDFs; every admitted book has a perfect embedded text layer. OCR-everything would discard a perfect signal to re-read pixels — strictly worse prose (OCR confusions on clean text) at VLM prices.
3. **Our garbage problem was never an OCR-quality problem** — it was a ToUnicode-mapping lie, already fixed by glyph-garbage detection + targeted LLM cleanup (Nemotron: 0 FFFD, math spans 31→94).
4. Alignment: our containment gate/block geometry is built on matching the text layer; OCR output would need the whole alignment story rebuilt.

Revisit only if: (a) an NVIDIA box or acceptable cloud OCR endpoint appears AND (b) the plan amends to admit scanned books — then Unlimited-OCR's one-shot multi-page parsing + bbox markers would make it the leading scan-lane candidate.
