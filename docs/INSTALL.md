# Installing & Building Palimpsest

## Requirements

- **macOS 12+** (`tauri.conf.json` `minimumSystemVersion`), **Apple Silicon
  (M1 or later)** — the neural voice stack runs on MLX, Apple's GPU framework.
- ~4 GB of disk for models if you use every voice; the app itself is small.

## Install the app

1. Download the DMG from the [Releases](../../releases) page.
2. Drag **Palimpsest** into Applications.
3. First launch only: right-click → **Open** (the build is unsigned;
   Gatekeeper remembers the choice afterward).
4. Onboarding builds the voice venv (`~/.palimpsest/venv`) and auto-starts
   the voice server, with progress shown. Paste an OpenAI-compatible API key
   for the Prof, or skip and configure Settings → AI later (a local Ollama
   works too).

## First-run downloads

All automatic, cached in `~/.cache/huggingface`, one time each:

| What | Size | When |
|---|---|---|
| pip packages (mlx-audio, mlx-whisper, misaki…) | ~300 MB | Onboarding "Start voice setup" |
| Kokoro voices | ~160 MB | First playback with a neural voice |
| Qwen3-TTS (incl. cloned voices) | ~2 GB | First Qwen/cloned-voice playback |
| Voice input | — | **Not shipped by Palimpsest.** Voice input is TypeWhisper, a system-level macOS dictation tool you install yourself — it owns the mic and the STT; Palimpsest never touches the microphone. |

Built-in/Edge voices work with zero downloads and no key.

## Build from source

Prereqs: Node 22+, pnpm (repo pins `pnpm@11.1.1`), Rust (stable), and a
Python 3.12 venv with the `marker-pdf` stack for the import sidecar — see
`apps/readest-app/src-tauri/resources/hpub/` and the header of
`make_hpub.py` for the exact environment. The TTS sidecar venv is built for
you by onboarding (`apps/readest-app/src-tauri/resources/tts/qwen_server.py`
is the server it runs).

```sh
pnpm install
pnpm --filter @palimpsest/app build
cd apps/readest-app && pnpm tauri build
```

The app loads its Python sidecars from `src-tauri/resources` in release
builds.

Notes:

- The import sidecar (marker-pdf + surya) venv remains a **manual prereq**
  for PDF import on fresh machines; the voice venv is automatic.
- `surya`'s OCR backend shells out to `llama-server` — `brew install
  llama.cpp` before importing math-heavy PDFs.
- Voice-input tooling (TypeWhisper) is installed outside the app, at the OS
  level.

## Layout worth knowing

- `apps/readest-app/src/services/narration/` — narration controller,
  providers, script compiler (text layer → performance script).
- `apps/readest-app/src/services/professor/` — the Prof: persona prompt,
  tiered context packs, workbench sessions, math checking.
- `apps/readest-app/src-tauri/resources/hpub/make_hpub.py` — the import
  pipeline (coverage gate → vision extraction → alignment manifest →
  quality gate → `.hpub`).
- `apps/readest-app/src-tauri/src/voice_server.rs` — sidecar lifecycle:
  ownership token, crash-restart supervision, kill-on-exit.
