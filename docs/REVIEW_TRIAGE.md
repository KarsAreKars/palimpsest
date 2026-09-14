# Pre-release review triage (2026-09-13)

Four-lane adversarial review (code / architecture / security / UX) of the
fork delta, run before the public beta. Findings were verified against the
actual code before action. Fixed in `149f0eb8f`; this file tracks the rest.

## Fixed in 149f0eb8f

- **P0** `qwen_server.py`: `clone_ids` NameError — every non-Kokoro voice
  500'd (all four lanes, verified: zero definitions, live 500). Defined
  `clone_ids = set(_CLONE_REFS)`; clone ids now survive voice validation.
  Verified live: `vivian` returns WAV (first time since cloned voices landed).
- **P0** Zip-slip in `.hpub` import: `assets/../../../settings.json` entries
  passed the prefix filter and wrote outside the book dir (sec lane BLOCK,
  verified in `utils/hpub.ts` + `bookService.ts`). Fixed at both sites.
- **P1** Learner model: `[RETRY]`-graded check-me exchanges counted as
  resolved → Bloom inflation. `LearnerExchange.verdict` persisted; Bloom
  credit uses the verdict when present.
- **P1** `TAG_RE` truncated WRITE/CAPTION bodies at the first `]` (LaTeX
  intervals like `[0,1]` broke). WRITE/CAPTION now capture to the last `]`
  at end-of-line.
- **P1** Professor voice synthesize had no timeout (hung socket wedged the
  voice loop). Now `AbortSignal.timeout(30s)` per attempt.
- **P1** Narration player retained every unit's WAV for the whole session
  (multi-hour listen = whole book in RAM). Played units evict.
- **P1** Voice hot-swap ignored `qwenVoiceId` changes mid-play. Added to the
  rebuild trigger.
- **P1** Onboarding TEST hardcoded `gpt-4o-mini` → false FAIL on valid
  endpoints. Empty model now omits the field (server-side default).
- **P1** NarrationPanel claimed built-in voices "work offline" — Edge TTS
  streams from Microsoft. Copy corrected.

## Deferred (ranked)

1. **Voice-server token auth** (sec P1). Local server answers any website's
   POST (`ACAO: *`) → GPU-burn; `/stt` body unbounded (but `/stt` has zero
   app callers — dead path). Fix: per-launch token, Rust → env → required
   header; provider sends it. Cross-layer, ~half a day.
2. **ElevenLabs key in localStorage** → OS keychain via the keyring plugin
   (arch P1; the file header already flags it).
3. **Onboarding voice-beat dead end** (ux P1): successful bootstrap leaves
   voices offline until restart, no guidance. Spawn-or-restart prompt.
4. **Voice chip shows configured, not actual engine** (ux P1): after an
   Edge/ElevenLabs fallback the chip still says a Kokoro/Qwen name.
5. **Engine failure is silent** (ux P1): the circuit breaker stops playback
   with only a log line. Needs a NarrationBar status surface.
6. **manifest.json unversioned, content.md hash unchecked** (arch P1/P2):
   alignment contract has no integrity check. Add `format` validation and a
   content hash at load.
7. **Voice-server orphan adoption** (arch P2): after a hard crash the orphan
   server survives and the next launch never owns it. Pidfile adopt-or-kill.
8. **Session verdict timeout** (ux P2): model omitting `[PASS]/[RETRY]` leaves
   the objective at "ASKING" indefinitely.
9. **Design-system polish** (ux P2): StudyTab daisyUI mixing, mutedink
   contrast ~3.5:1 (below AA), no `:focus-visible` treatment, `.stamp-btn:
   disabled` unstyled.
10. **Prof discovery** (ux P2): no visible affordance beyond ⌥Space.
11. **Onboarding polish** (ux P2): unsaved key discarded on Continue; final
    beat doesn't open the book; no re-run after Skip.
12. **Upstream service cleanup** (ship list): Share/Transfer/Novel-import
    dialogs call readest.com backends → 404 for strangers. Strip or hide.
13. **Dead code**: `/stt` + `mlx-whisper` unused by the app (TypeWhisper
    owns voice input) — remove or wire, and trim bootstrap accordingly.

## UI critique loop follow-ups (2026-09-14, post round-2)

- **globals.css:1014-1026** — `outline: none !important` on all inputs kills the global stamp focus ring on typed surfaces. Pre-existing. Fix: scope that reset to the specific widget it was written for.
- **globals.css:379-380** — `.drag-over` still blue `#4a90e2`. Pre-existing. Move to stamp.
- **SettingsDialog e23d5ff0d `!important`** — scoped, leaks nowhere, but the cleaner fix is layering `.plate-modal` chrome properly (non-blocking).
- **NarrationBar i18n** — aria-labels and VOICES strings still hardcoded English (adjudicated out of the fix pass; sweep with the next translation pass).
- **MobileFooterBar** — still uses shared daisyUI `Button.tsx` (needs a lane that owns `components/`).
- **ProfBlob** — unused on disk; its canvas palette is token-constant based; reskin would mean drawing-API changes.
