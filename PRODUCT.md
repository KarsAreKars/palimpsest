# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop (macOS Tauri build; cross-platform Tauri + Next.js codebase inherited from Readest)

## Users

An owner of a personal library of digital-born PDFs — technical, math-heavy books and papers — who wants to **listen** to them and **learn** from them, alone, at their own desk. Secondary audience: none confirmed.

## Product Purpose

Palimpsest is a TTS-first PDF book reader. It reads digital-born PDFs aloud with a local neural voice (Kokoro for speed, Qwen3-TTS for quality), highlights the spoken text over the rendered page, and hosts "the Prof": a tutoring layer that quizzes the reader per chapter, answers questions about the page, and keeps a private learning record. Success = a reader finishes chapters by ear, retains more, and never fights the app to start listening.

## Positioning

Dual-layer hpub: every book carries its rendered PDF **and** an extraction-preserving text layer with narration timing, so listening, highlighting, search, and tutoring all work on math-heavy pages where plain-text extraction collapses. Local-first: voices, tutor, and library run on the reader's machine. A neighboring reader cannot truthfully copy this without rebuilding the dual-layer pipeline.

## Brand Commitments

- Name: **Palimpsest**. Voice: speaks like a librarian, not an ad — no exclamation marks, no emoji as icons, never mentions machinery (sidecar, venv, port, pipeline) in user-facing copy.
- Visual world (brief-pinned by the owner, 2026-09-14): **bohemian museum-catalog** — warm paper grounds, letterpress serif, specimen-plate discipline. Full visual contract lives in DESIGN.md (repo root).
- Voice input is **TypeWhisper only** (owner decision). No app-owned speech-to-text.
- Dark (`theme-dark`) and e-ink variants must survive every visual change.

## Product Decisions (durable)

- **Digital-born PDFs only.** Scanned books are out of scope; math-preserving extraction is mandatory; the hpub dual-layer format is the canonical book unit.
- **Library = one uniform grid.** Grid view only, ~10 books per row at common desktop widths, covers cropped to a single aspect so every book carries equal visual weight. Removed from the library surface: list view, manual column control, fit/cover toggle, hide-covers, "show recently read" toggle, group-by, sort-by menus. Recent reading is still tracked in-session; it is simply not a library organizing feature.
- **Integrations = AI only.** The integrations surface offers AI providers (LLM endpoint for the Prof; voice/TTS providers). Cloud sync, KOReader/Orbit sync, Readwise, audiobook servers, WebDAV/S3/cloud drives, and share/send channels are removed from the product surface (upstream code remains dormant).
- Settings otherwise strip to what a listener-tutor reader actually touches; no promotional surfaces.

## Open Decisions

- Apple Developer enrollment (paid) for signed/notarized distribution — pending owner action.
- Prof model choice (Kimi K3 key parked) — pending.
