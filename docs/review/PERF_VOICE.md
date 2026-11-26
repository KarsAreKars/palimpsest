# PERF + VOICE review (r3) — "butter smooth" audit

Reviewer: r3 (performance / smoothness / voice health). Read-only pass, 2026-11-26.
Severity: **P1** = user-perceptible jank or voice failure · **P2** = measurable but minor.
Every finding was verified in code; the voice hiccup was verified against
`~/Library/Logs/com.palimpsest.app/Palimpsest.log` directly.

---

## PART 1 — PERFORMANCE

### P1-1. Drag re-renders the whole sheet per pointermove
`apps/readest-app/src/app/reader/components/desk/DeskCanvas.tsx:429,489`

`startDrag`'s `onMove` calls `setDrag(...)` on every `pointermove` (60–120 Hz).
`drag` is DeskCanvas state, so each move re-renders the entire canvas: the
`blocks.map(...)` spatial stage, every wrapper, and — because **`BlockBody` is not
memoized** (`notebook/blockBody.tsx:396`) — every block subtree: byline, chips,
`DerivationSlip` (its `Tex` children survive via their internal `useMemo`, so KaTeX
does *not* re-run — verified `wbShared.tsx:36-46`), `DiagramSlip`, and worst of all
`PlotSlip`, which **resamples and recompiles every curve on any re-render** (see
P1-3). `Streamdown` is internally `memo()`'d (verified in
`streamdown@1.6.11/dist/chunk-*.js`), so markdown is not re-parsed — the residual
cost is reconciliation of N block subtrees + PlotSlip resampling per move event.
Dragging any block on a sheet that contains a plot visibly drops frames.

**Minimal fix (CANVAS_UX C7, docs/research/CANVAS_UX.md:225,251):** during the drag,
write `element.style.transform = translate(dx, dy)` imperatively on the dragged
cluster item (ref map keyed by block id) and only `setDrag` on `pointerup` to commit
via `updateBlock` (DeskCanvas.tsx:513-531 already does the commit). The alignment
guides can be positioned the same imperative way. Cheaper partial mitigation:
`React.memo(BlockBody)` — but note two props currently defeat shallow compare:
`voice={voicePropsFor(b)}` returns a fresh object per call
(`hooks/useDeskVoice.ts:119-132`) and `onPickProbe` is an inline arrow
(DeskCanvas.tsx:646). Hoist the arrow into a `useCallback` and compare `voice` by
its scalar fields (or pass them separately).

### P1-2. Snap targets rebuilt on every pointermove
`DeskCanvas.tsx:446-458` (definition), `:500` (call site inside the `onMove` updater)

`snapTargets(d.id)` runs inside the per-move `setDrag` updater: it iterates all
blocks, reads `sheetLayout.placements`, and calls `estimateHeight(b)` per block —
an O(n) allocation storm per pointermove. The targets **cannot change during a
drag** (other blocks only move on commit).

**Minimal fix:** compute `const targets = snapTargets(blockId)` once in `startDrag`
before `addEventListener('pointermove', ...)` and close over it. One-line change,
removes the per-move O(n) work entirely.

### P1-3. PlotSlip: curves recompiled + resampled on every render, including hover
`apps/readest-app/src/app/reader/components/notebook/PlotSlip.tsx:282`,
`plotCompute.ts:48-66,69-77,80-98`

Two compounding problems:

1. `sampleFunction(latex, [v.xMin, v.xMax], PLOT_SAMPLE_COUNT)` runs **in the render
   body** (PlotSlip.tsx:282) for every rule — not memoized on the view. Any render
   resamples: 201 points × fns.
2. `sampleFunction` and `evaluateFunctionAt` both call `compileRule(latex)`
   (plotCompute.ts:48), which does a **fresh MathLive ComputeEngine `parse` +
   `compile` per call** — millisecond-scale work, redone constantly. The hover
   crosshair (`onPointerHover`, PlotSlip.tsx:171-179) calls `evaluateFunctionAt`
   per pointermove → recompile per move; and its `setHover` re-renders the
   component → full resample + recompile of all curves per move, even though hover
   doesn't change the view at all.

Trigger surfaces: hovering a plot (P1 jank on its own), panning (resample is
necessary, recompile is pure waste), and any parent re-render — DeskCanvas drag
(P1-1) or streaming tokens — because `BlockBody` isn't memoized.

**Minimal fix:** (a) module-level `Map<string, (x:number)=>number|null>` cache for
compiled rules keyed by latex (rules are few and tiny; cap at ~32 entries); (b)
`useMemo` the sampled paths on `[specKey, v.xMin, v.xMax]` so hover-only renders
skip resampling. Also fold in: the wheel-zoom effect re-registers its native
listener on every view change (`}, [base, v])`, PlotSlip.tsx:134) — hold the latest
view in a ref and register once.

### P2-4. Per-streaming-token full-sheet reconciliation
`DeskCanvas.tsx:272-293` (scroll effect deps `[blocks, checks, partial]`), `:644-652`

While the professor streams, `streaming.partial` re-renders DeskCanvas per token;
every `BlockBody` re-renders (unmemoized). Blunted by Streamdown's internal memo
and `Tex`'s `useMemo`, so the residual is React reconciliation of the whole sheet
per token — noticeable only on long sheets. **Fix:** same `React.memo(BlockBody)`
work as P1-1; no separate effort needed.

### P2-5. Scroll handler forces synchronous layout per scroll frame
`DeskCanvas.tsx:198-211` (`refreshAnchor`), called from `handleScroll` (:213)

Every scroll event runs `querySelectorAll('article[data-bid]')` and then
`getBoundingClientRect()` per article until the first visible one — forced sync
layout, O(index of first visible block), per scroll frame. On a long sheet this is
scroll jank. **Minimal fix:** rAF-throttle (dirty flag, one measure per frame), or
maintain article tops from `sheetLayout.placements` (spatial mode already has them)
instead of measuring DOM.

### Verified clean — no action (checked because the scope named them)

- **`layoutSheet` frequency** — memoized: `useMemo(..., [spatial, blocks, stageWidth])`
  (DeskCanvas.tsx:314-317). It does **not** recompute during drag (blocks identity is
  stable until the pointerup commit) nor per streaming token (`partial` is separate
  from `blocks`). When it does run it is O(n) with tiny constants
  (deskLayout.ts:236-307). Fine as-is.
- **`StudyTab.tsx`** — no reload loop: `reload` deps are stable
  (`[bookKey, appService, getBookData]`, :106-128) and the effect fires once per book
  (:130-132). `due` / `route` / `practiceItems` / `graphNodes` / `deck` are
  unmemoized per-render IIFEs (:137-258), but every input is O(tens of items) —
  `dueCards` is a filter+sort of the concept ledger (scheduler.ts:178-187),
  `planRoute` walks ≤40 TOC seeds (planRoute.ts:95-160). Not user-perceptible;
  memoizing would be a micro-optimization. The annotation-bus subscription is bound
  once per book (:454-490). Clean.
- **`Tex` (wbShared.tsx:36-46)** — `katex.renderToString` is already inside
  `useMemo([latex, display])`: once per latex string per mount, not per render.
  Clean (the residual risk is only unmount/remount churn, which P1-1's memo fixes).
- **Streaming scroll-follow** — writes `scrollTop` imperatively, no layout reads
  (DeskCanvas.tsx:272-293). Clean.

---

## PART 2 — VOICE

### Log evidence (verified directly, Palimpsest.log, 2026-11-26 session)

The captured session contains **zero errors, zero crashes, zero respawns** — every
line is INFO. The one WARNING is cosmetic (see V-5). The user-perceptible hiccup is
fully reconstructable from the narration/kokoro lines:

```
12:52:00  playFrom(154) -> nextSpeakable 154      ← user skips
12:52:00  playFrom(155) -> nextSpeakable 155      ← user skips again
12:52:01  [kokoro] 125 chars -> 501644 bytes in 2.4s   (unit 154 — already skipped)
12:52:03  [kokoro] 108 chars -> 492044 bytes in 1.7s   (unit 155 — the wanted one)
12:52:06  [kokoro] 181 chars -> 651644 bytes in 2.3s   (prefetch 156)
12:52:06  [kokoro]  92 chars -> 312044 bytes in 0.9s   (prefetch 157)
12:52:08  narration: audio unit 155 — 492044 bytes     ← playback can start
```

**~8 seconds of silence after a double-skip.** Unit 154's audio was synthesized but
never played (no `audio unit 154` line ever appears). The server was healthy
throughout — kokoro kept producing audio at 13× real-time. This was not a server
death; it was queue serialization plus a delivery gap (V-3).

Correction to the task framing: **kokoro is not a subprocess.** It runs in-process
in `qwen_server.py` (`get_kokoro`, :133-163); the only subprocess in the server is
`ffmpeg` for `/stt` (:295-299). The "Broken pipe" history is two prior incidents,
both documented in code: 2026-09-15 (venv missing `spacy`/`num2words` — green
`/health`, every kokoro request 500'd; now covered by the import self-test
`_probe_engines`, qwen_server.py:200-220, plus `engine_self_repair`,
voice_server.rs:466-548) and 2026-09-14 (half-dead MLX stack EPIPEing under a live
HTTP server; now covered by the client-side restart watchdog,
narrationQwenProvider.ts:49-71). There is **no idle timeout and no unload** — an
OOM/jetsam kill of the owned child *is* covered by the supervisor (`try_wait` in
`watch`, voice_server.rs:622-640 → respawn with 1–30s backoff). The watchdog's real
gap is the opposite failure: it kills servers that are alive.

### P1-V1. The health watchdog can kill a healthy-but-busy server mid-synthesis
`qwen_server.py:1077` · `voice_server.rs:53-56, 617-650, 731, 588, 572`

The server is deliberately **single-threaded** (`HTTPServer`, qwen_server.py:1077;
rationale at :1070-1076 — ThreadingHTTPServer gave each request a fresh thread with
no MLX streams bound). Consequence, stated in the code: "/health can't answer
mid-generation." But the Rust supervisor declares death after **2 failed health
probes at a 5s cadence with a 3s timeout** (`WATCH_POLL`/`WATCH_STRIKES`,
voice_server.rs:53-56, strikes at :648) — i.e. **any single request that occupies
the server for >~13–16s looks exactly like a dead server.** The kill path: watch →
`Phase::Unhealthy` → loop → `probe` times out (`Probe::Quiet`) → `spawn_child` →
`store_child` **replaces the held child** (voice_server.rs:588), dropping the old
`Child` whose `kill_on_drop(true)` (:572) SIGKILLs the healthy server mid-request.

Realistic triggers, all in normal use:
- **Cold kokoro load ≈ 20s on the first request** (qwen_server.py:1069) —
  `spawn_child` does not pass `--preload` (voice_server.rs:561-568), so this happens
  inside the first `/tts` request. First narration of a session can get the server
  killed *while it is loading the model*, then the respawn pays the same cold load.
- Any **Qwen-voice unit** over ~15s of generation (server docstring: ~2× real-time →
  any unit longer than ~30s of audio; kokoro is safe at 13× RT).
- A long **whisper `/stt`** clip or a slow sympy `/check` pair.

Blast radius: the in-flight synthesis EPIPEs, the respawn needs tens of seconds
(imports + model load), and the client's own failure counter (V-2) can pile a
second restart on top. This is the single largest voice-fragility in the stack.

**Minimal fix (Rust, ~5 lines):** in `watch()`, only count health strikes when
there is **no owned child** (`child.lock()...is_none()` — the adopted-server case).
An owned child that `try_wait` reports alive is *busy*, not dead; its true death is
already caught by the `try_wait` branch. For adopted servers, raise the strike
budget to ≥6 (≈30s) so a busy adopted server survives. Optional belt: pass
`--preload` in `spawn_child` so both engines load before `/health` first answers
and the watch begins (cold cost moves out of the request path; `HEALTH_LIMIT` is
already 120s).

### P1-V2. The client restart watchdog counts *timeouts* as server deaths
`player.ts:113-124` · `narrationQwenProvider.ts:118-128`

The player aborts synthesis at 30s with a `TimeoutError` (`SYNTH_TIMEOUT_MS`,
player.ts:113-118). The provider's catch exempts only `name === 'AbortError'`
(narrationQwenProvider.ts:125) — a `TimeoutError` falls through to
`noteSynthesisFailure()`. **Two slow-but-successful syntheses** (e.g. the ~20s cold
kokoro load plus a queued prefetch behind it, or two long Qwen units) trip
`restart_voice_server`, which kills a healthy server and forces a full cold reload
— manufacturing the very outage it exists to cure. Rate-limited to one restart per
minute (:57-59), so it self-limits, but each false restart is a 30–60s voice
outage. **Minimal fix:** also exempt `e.name === 'TimeoutError'` in that catch — a
timeout means *slow*, not *dead*; true death detection belongs to the (fixed, per
V-1) Rust supervisor.

### P2-V3. Skip-storms serialize dead work ahead of wanted audio (the 2026-11-26 hiccup)
`player.ts:134-152` · `qwen_server.py:934-941` · log evidence above

Two compounding causes for the measured 8s silence:
1. **The player never aborts the in-flight synthesis of a unit the user just
   skipped** — `#synthesize` keeps the promise in `#audioCache` (player.ts:140-152);
   only the 30s timeout aborts. The single-threaded server therefore spent 2.4s
   synthesizing unit 154 *after* the user had already skipped past it, ahead of the
   wanted unit 155. The server's pre-generation liveness peek
   (`recv(MSG_PEEK|MSG_DONTWAIT)`, qwen_server.py:935) never fired because the
   client hadn't hung up.
   **Minimal fix:** on manual next/prev, abort the in-flight fetch of the unit being
   skipped. `AbortError` is already exempt from the failure counter
   (narrationQwenProvider.ts:125), and the server's peek then skips the dead work —
   ~2s saved per skipped unit in a skip-storm.
2. **Unexplained ~5s between the server writing unit 155's bytes (12:52:03) and the
   webview logging receipt (12:52:08).** The server writes the body immediately
   after its log line (qwen_server.py:958-966), so the delay is in transport or the
   client: candidates are `getAIFetch()` (the Tauri HTTP-plugin lane) response
   buffering/queuing, or client-side serialization behind the discarded 154
   response. Needs profiling by the narration owner; flagged, not diagnosed.

### P2-V4. Supervisor gives up silently after 5 genuine crashes
`voice_server.rs:61, 744-752`

After `MAX_RESTART_ATTEMPTS` the supervisor stops for the rest of the app run with
only a log line; the user discovers it as "voice just doesn't work" (Edge fallback
covers playback, but the local voices silently vanish from working). With V-1 fixed,
attempts only burn on genuine crash loops, so this is rare — but the exhausted state
deserves a surfaced UI notice rather than a `log::error!`. Minor.

### V-5. Log noise: phonemizer warning — cosmetic, no action
`Palimpsest.log:78` (12:51:54): `WARNING:phonemizer:words count mismatch on 100.0%
of the lines (1/1)` — misaki/espeak g2p disagreement on a one-line unit (18 chars).
Audio was still produced 0.5s later (29 chars → 172844 bytes). Not a failure mode;
no hardening needed. Noted only so future log-readers don't chase it.

### Watchdog coverage summary (what is and isn't covered)

| Failure mode | Covered? | By |
|---|---|---|
| Owned child process exits (crash, OOM/jetsam) | ✅ | `try_wait` in `watch` → backoff respawn |
| Adopted server dies | ✅ | health strikes (but see V-1 false positives) |
| Missing venv deps (2026-09-15 Broken-pipe class) | ✅ | import self-test + one-shot `engine_self_repair` |
| Half-dead MLX, `/health` green, EPIPE on generate | ✅ | client failure counter → `restart_voice_server` |
| Server **busy** >~15s (cold load, long Qwen unit, /stt) | ❌ **killed as false positive** | **V-1** |
| Slow synthesis (30s client timeout) | ❌ counted as death | **V-2** |
| Skipped unit's in-flight synthesis | ❌ wasted, blocks wanted unit | **V-3** |
| >5 genuine crashes in a run | gives up, silently | V-4 |

---

## Suggested fix order

1. **V-1** (Rust watch: owned-child ⇒ no health strikes) — 5 lines, removes the
   worst voice failure class.
2. **V-2** (exempt `TimeoutError`) — 1 line, stops false restarts.
3. **P1-3** (compile cache + memoized sampling in PlotSlip) — small, removes hover
   and drag jank around plots.
4. **P1-2** (hoist `snapTargets` to drag start) — 1 line.
5. **P1-1** (C7 imperative transform during drag, or memo(BlockBody) + prop
   stabilization) — the CANVAS_UX-endorsed upgrade; biggest smoothness win.
6. **V-3a** (abort skipped unit's fetch), then **P2-4/P2-5** as cleanup.
