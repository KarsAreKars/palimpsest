Palimpsest
============

**The book that reads aloud.** A TTS-first reading machine for macOS — every
book narrates itself in a real voice, an AI professor teaches from its margins,
and a math workbench checks your derivations with a computer algebra system.
Forked from [Readest](https://github.com/readest/readest) (AGPL-3.0).

Palimpsest is what a codex becomes when you let it speak. You import a PDF;
the book is re-bound as a layered object — the original pages you see, a
faithful machine text layer underneath, and a manifest stitching every page
to every passage. On that layer sits the voice (local, neural, offline), and
on the voice sits the Prof: a tutor who points at the page while he teaches,
never flatters, and refuses to hand you an answer you haven't earned. For
math books there is a workbench — a desk where the two of you derive things
together while a silent examiner (sympy) marks every line. macOS-first,
built for Apple Silicon, private by construction. Status: **public beta**.

The Library — every book is two books bound as one
--------------------------------------------------

Import a PDF and Palimpsest binds it as an **`.hpub`**: a package holding
the original PDF (the *only* rendered layer — what you see is the author's
page), a machine text layer (Markdown with LaTeX math preserved), and a
manifest aligning every page to spans and per-block geometry. Scanned PDFs
are rejected at the door; a book that cannot align its two layers fails the
import loudly. No manifest, no book.

The text layer matters because everything else — voice, professor,
workbench, search — reads *that* layer while you read the page.

**Math preservation.** Technical PDFs lie. Font tables rot, and an equation
that renders beautifully arrives as glyph garbage — U+FFFD replacement chars
and private-use-area symbols where variables should be. The importer detects
these lying pages (math-font spans, glyph-garbage counts), routes them through
a vision extraction pass, and an LLM cleanup pass rebuilds the damaged math as
speakable LaTeX — targeted, so healthy prose is never rewritten. On
math-heavy papers the pipeline is verified to zero garbage characters.

**A pipeline that cannot hang.** Import runs behind a Rust stall watchdog
(ten minutes of silence → killed and reported), progress heartbeats that go
quiet when a phase is genuinely wedged, and total deadlines on every LLM
call. An import can fail. It cannot silently wedge.

The Voice — the book reads to you, in your house
------------------------------------------------

Palimpsest is TTS-first: every book in the library is readable aloud, and
narration is the default experience, not an afterthought. The narrator is a
small local server bundled inside the app — it starts when the app starts,
owns an auth token so only Palimpsest may speak to it, is supervised and
restarted on crash, and dies when the app exits. It serves neural voices
through MLX on the Apple-Silicon GPU:

- **Kokoro voices**, the long-form storytellers: *Heart* (warm), *Adam*
  (clear), *Bella* (bright), *Nicole* (soft), *Michael* (calm), *Emma* and
  *George* (British). ~160 MB on first playback.
- **Qwen3-TTS voices** — *Vivian* (warm, the server's default) and cloned
  voices such as *The Storyteller* (elderly British) and *The Librarian* —
  with custom-voice cloning of your own. ~2 GB on first use.
- **Built-in / Edge voices** for zero-download, no-key listening.

The text layer is compiled into a *performance* script before reading —
dehyphenated, footnotes re-homed, symbols verbalized — so the voice says
"decision," never "deci dash sion." Narration pre-builds per unit at ~2×
real-time, so playback never waits. Word-by-word highlight follows the voice.

Talking back is deliberate and private: voice input arrives through
**TypeWhisper**, a system-level macOS dictation tool you install yourself. It
owns the microphone and the speech-to-text; Palimpsest never touches the mic.

The Professor — a tutor in the margins
--------------------------------------

The Prof sits next to you like a good tutor in the same room. Ask about
anything on the page and he answers **grounded in the book's text layer** —
the book is the source of truth, quotations are never invented, and when the
real answer lives beyond the page he says so in a few words. Because his prose
is spoken aloud, he points while he speaks: his answers carry ink marks — a
small arrow at the equation, a box around the figure — placed first, then
explained, never announced.

His pedagogy is a **disclosure ladder**: stuck on a problem, you do not get
the answer. You get the *why* (one sentence on what the idea is for), then
*where to look* (a tap on the exact passage and the one question that unlocks
it), then a *partial* (a worked analog, a first step with the rest hidden) —
and only after genuine stuck signals, the full answer, given warmly without
ceremony. Your concept history is evidence to him: ask the same thing three
times and he changes strategy completely, then has you explain it back.
He never says "Great question!" He asks before he tells.

In the workbench he teaches provenance — each idea three ways: **what it is**
(book-grounded, page-cited), **where it came from** (its people, its dates,
its story — told as story), and **why it mattered** (what it made possible).

The Math Workbench — now you
----------------------------

Say "it's time to workbench" (or press the quiet *Start a session* stamp in
the workbench tab) and the Prof opens a blank desk beside the book. What
follows is an Obsidian-style transcript of blocks: **the professor writes a
block, you write one beneath it, Enter sends.** Derivation, handoff — *"now
you"* — watch, review. One writer at a time by design.

Every line of math you type is checked **silently and automatically** by a
computer algebra system (sympy, living in the same local sidecar as the
voice). Verdicts are three-valued and stamped inside your block: ✓ sage, ◌
"the professor will look" (the CAS couldn't decide — and an undecided step is
*never* declared wrong), ✗ with a concrete counterexample on hover. The CAS
decides correctness; the professor diagnoses and teaches. When you go wrong,
he first reconstructs *how* you got there, then offers clues — one rung per
committed attempt — and only reveals the answer when truly stuck, after which
you re-derive the corrected step yourself. No credit without doing.

Context is tiered, not stuffed: every turn the professor receives the current
page, a ≤30k-character chapter window, the pages behind your top three
struggled concepts, session state — and the whole book only when it genuinely
fits. Small enough to keep citations exact; rebuilt every turn so he is
grounded on turn ten as on turn one. Local (Ollama) mode hard-caps the pack
and drops tiers instead of overflowing.

The transcript is a **per-book document** — it survives restarts, resumes
where you left off, and renders all math through KaTeX. The composer takes
prose and `$…$` math, with a MathLive popover (ƒx) for writing mathematics
properly.

The Notebook — the margins come back to you
--------------------------------------------

A drag-resizable panel (15–85% of the window, double-click to reset) with four
tabs:

- **Spine** — a filmstrip of only the pages you touched: typed page labels,
  your quotes, ink counts. A map of your thinking, not a note list.
- **Notes** — your highlights and annotations, exactly where you left them.
- **Study** — learning that resurfaces, weakest-first: chapter sessions the
  Prof turns into objectives and a voice quiz ([PASS]/[RETRY] stamped), your
  own margins handed back as *quiz me* prompts, a review queue of concepts
  ordered by struggle, and the study notes he distilled.
- **Workbench** — the math desk above.

Page-cited chips ride the professor's blocks: hover for the quoted passage,
click and the book scrolls to that page — the notebook sits *on top of* the
book, and the link runs both ways in spirit.

Privacy — your books, your machine, your keys
---------------------------------------------

Your library never leaves the machine unless you say so. The voice stack is
fully local — no key, no cloud, models cached in `~/.cache/huggingface`. The
professor speaks through an **OpenAI-compatible provider you configure**
(OpenRouter, an AI gateway, or a local Ollama) with a key you paste at
onboarding or in Settings → AI — it is your key, on your account, and a
local-model path exists for the fully offline life. Voice input belongs to
the OS-level tool you chose for it. Nothing phones home.

Install
-------

macOS 12+ on Apple Silicon (M1 or later — the neural voice stack is MLX).

1. Download the DMG from the [Releases](../../releases) page and drag
   **Palimpsest** into Applications.
2. First launch: the build is unsigned, so right-click → **Open** (do this
   once; Gatekeeper remembers).
3. The app bootstraps its voice environment on first launch — an onboarding
   panel builds the local Python venv and starts the voice server, with
   progress shown. Voice models download on first use (~160 MB Kokoro, ~2 GB
   Qwen/clones, cached once in `~/.cache/huggingface`; ~4 GB total if you use
   everything).
4. Paste an OpenAI-compatible API key for the Prof, or point Settings → AI
   at a local Ollama. Built-in voices need neither.

Building from source, the import-sidecar venv, and the full first-run
download table live in [docs/INSTALL.md](docs/INSTALL.md).

Keyboard-first
--------------

The reader keeps your hands on the arrow keys the whole way through; press
`?` in the app for the complete list.

| Keys | Action |
|---|---|
| `←` `→` | Previous / next paragraph (follows narration while it reads) |
| `Shift+←` `Shift+→` | Turn the page — always, even mid-narration |
| `d` / `u`, `Shift+↓` / `Shift+↑` | Half page down / up |
| `Space` | Play / pause narration |
| `t` | Toggle text-to-speech |
| `⌘]` / `⌘[` | Next / previous sentence |
| `⌘⇧}` / `⌘⇧{` | Next / previous paragraph |
| `n` | Toggle the notebook |
| `s` | Toggle the sidebar |
| `⌘⇧P` | Command palette |

Roadmap
--------

The shape of what is being built (see
[docs/MATH_WORKBENCH_PLAN.md](docs/MATH_WORKBENCH_PLAN.md)):

- **Probe chips** — professor-issued comprehension probes rendered as
  selectable paper chips (never A/B/C/D), with an honest "I don't know".
- **Page-lookup tool** — the professor fetches any page on demand, giving the
  biggest books unbounded grounding.
- **Diagram blocks** — professor-drawn SVG/mermaid figures rendered in-thread,
  only when the diagram genuinely shows the claim.
- **Voice answers** — push-to-talk replies in the workbench (on-device
  speech recognition; no cloud), ending the type-only asymmetry.
- **Teach-back** — the professor listens to you explain the idea back, probes
  from a per-book misconception library, and schedules spaced re-tests.

Credits
-------

Palimpsest is a fork of **[Readest](https://github.com/readest/readest)**,
and stands on its shoulders. The voice stack builds on
[Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) and
[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) through
[MLX](https://github.com/ml-explore/mlx) and
[mlx-audio](https://github.com/Blaizzy/mlx-audio); math checking rests on
[SymPy](https://www.sympy.org). Typeset math via KaTeX and MathLive.

License
-------

AGPL-3.0-or-later, inherited from Readest. Palimpsest modifications are
`Copyright (C) Palimpsest Contributors`. See `NOTICE`.
