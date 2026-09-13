Palimpsest
============

**The book that reads aloud.** A TTS-first PDF book reader for macOS, forked from
[Readest](https://github.com/readest/readest) (AGPL-3.0).

Every book narrates beautifully the moment you open it. The Prof — an always-present
tutor — points at the page while he speaks, answers questions through a Socratic
disclosure ladder (he never just hands you the answer), and runs chapter sessions
that turn what you just read into objectives, quizzes, and a study report. A notebook
panel resurfaces your highlights and Feynman reviews, backed by a persistent learner
model.

Why Palimpsest instead of Readest upstream
------------------------------------------

- **Dual-layer books**: each imported PDF becomes an `.hpub` — the original PDF
  (the only rendered layer) plus a machine text layer (Markdown + LaTeX) plus a
  manifest aligning every page to spans and block geometry. Scanned PDFs are
  rejected at import; extraction that can't align fails loudly instead of shipping
  a broken book.
- **Math preservation**: glyph-garbage detection finds pages whose text layer
  lies (U+FFFD/PUA), routes them through a vision pass, and an LLM cleanup pass
  reconstructs inline math as speakable LaTeX — verified to zero garbage chars on
  math-heavy technical papers.
- **Hang-proof pipeline**: Rust stall watchdog (10 min of stderr silence → kill
  and report), Python progress heartbeats, and total deadlines on every LLM call.
  An import can fail; it cannot silently wedge.
- **Local-first voice**: Kokoro/Qwen3 TTS via a bundled MLX sidecar (plus cloned
  voice support), Whisper STT, and the Prof through your own OpenAI-compatible
  key. No subscription, no cloud lock-in.

Status: **private→public beta**. macOS only for now (Apple Silicon).

Build
-----

Prereqs: Node 22+, pnpm, Rust (stable), Python 3.12 venv with the `marker-pdf`
stack for the import sidecar (see `apps/readest-app/src-tauri/resources/hpub/`
and `make_hpub.py`'s header), plus the TTS sidecar venv
(`apps/readest-app/src-tauri/resources/tts/qwen_server.py`).

```sh
pnpm install
pnpm --filter @palimpsest/app build
cd apps/readest-app && pnpm tauri build
```

The app loads its Python sidecars from `src-tauri/resources` in release builds;
the two venvs and the models (Kokoro, Qwen3-TTS, Whisper, marker) are expected on
the machine — first-launch bootstrap is on the roadmap.

License
-------

AGPL-3.0-or-later, inherited from Readest. Palimpsest modifications are
`Copyright (C) Palimpsest Contributors`. See `NOTICE`.
