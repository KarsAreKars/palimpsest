# Research: THU-MAIC/OpenMAIC — usefulness for Palimpsest

## What OpenMAIC is

OpenMAIC (Open Multi-Agent Interactive Classroom) is a Tsinghua University (THU-MAIC) open-source web platform that turns a topic or uploaded document into a fully generated interactive "classroom": slides, quizzes, simulations, and project-based-learning activities, delivered by a multi-agent cast (AI teacher, TA, AI classmates) orchestrated by a LangGraph "director," with TTS narration, ASR input, and a shared whiteboard the agents draw on. It is a **course generator and playback engine**, not a document reader — v1.0.0 (2026-08-27) added a chat-first "agent workbench" that builds/revises whole courses. Backed by a peer-reviewed paper: *From MOOC to MAIC* (JCST 41(1):394–414, Jan 2026, DOI 10.1007/s11390-025-6000-0), based on 100k+ learning records from 500+ Tsinghua students. [Repo](https://github.com/THU-MAIC/OpenMAIC) · [Paper](https://jcst.ict.ac.cn/en/article/doi/10.1007/s11390-025-6000-0)

## Architecture / dependencies

- **Stack**: Next.js 16 + React 19 + TypeScript 5, Tailwind 4, Zustand, shadcn/ui; pnpm monorepo with published `@openmaic/*` packages (dsl, renderer, editor, importer, generation, storage).
- **Orchestration**: LangGraph director graph (`lib/orchestration/director-graph.ts`) picks which agent speaks next; agents emit an interleaved JSON stream of `{type:"action",name,params}` + `{type:"text",content}` items executed by a 28+-action engine (`lib/action/`) — speech, whiteboard draw (text/shape/chart/**LaTeX**/table/code), spotlight, laser pointer, video.
- **Generation**: two-stage pipeline (outline → per-scene content) in `@openmaic/generation`.
- **LLM deps**: cloud-first (OpenAI, Azure, Anthropic, Bedrock, Gemini, DeepSeek, Qwen, Kimi, MiniMax, Grok, GLM, …) plus **local options** (Ollama, Lemonade for LLM/image/TTS/ASR). Any OpenAI-compatible endpoint works.
- **TTS**: provider factory (`lib/audio/tts-providers.ts`, 35 KB) — OpenAI, Azure, GLM, Qwen, MiniMax, Doubao, ElevenLabs, browser-native, plus local **VoxCPM2** (voice cloning, via vLLM-Omni `/v1/audio/speech` OpenAI-compatible, Python, or Nano-vLLM backends) and Lemonade. No Kokoro/Qwen3-TTS adapter.
- **ASR**: FunASR (local, OpenAI-compatible), Azure STT, OpenAI, Lemonade.
- **PDF/doc extraction** (`lib/pdf/`, `lib/document/`, `app/api/parse-pdf`): built-in **unpdf** (basic text+images), **MinerU** (self-hosted or cloud API — Markdown layout, tables, **LaTeX formula extraction**, OCR), AliDocMind (cloud), ffmpeg-based local audio/video transcript extraction. Extracted content feeds slide generation; the PDF itself is never the rendered layer.
- **Persistence**: browser storage by default; optional Postgres/S3 server persistence + durable agent sessions (leases, resume/steer).
- **Maturity**: created 2026-03-11; ~29.5k stars, 3.6k forks, 40 contributors, 190 open issues; very active (v0.1.0 → v1.0.0 in ~6 months, latest release 2026-08-27). Production-usable but fast-moving.
- **License**: MIT (root, since v0.3.0 — relicensed from AGPL-3.0 on 2026-06-28; current LICENSE file confirmed MIT). Bundled exceptions: `packages/mathml2omml` is LGPL-3.0, `packages/pptxgenjs` is MIT.

## Coverage vs. Palimpsest's five questions

| Area | OpenMAIC has it? | Notes |
|---|---|---|
| (a) PDF understanding/extraction | Partially | Provider-abstracted extraction (unpdf/MinerU/AliDocMind); MinerU gives Markdown+LaTeX. But it's a *content source* for generation, not a reader. No math-preserving page-anchored extraction for digital-born PDFs. |
| (b) TTS/voice/narration | Yes, extensively | Multi-provider TTS factory, per-agent voice personas, voice cloning, speech-guidelines prompt snippet for TTS-clean output. |
| (c) Interactive teaching / Socratic dialogue | Yes — strongest overlap | Multi-agent discussion, Q&A, and especially the PBL v2 instructor with a proficiency-tiered **Socratic disclosure ladder** and stuck-signal gating (`lib/pbl/v2/agents/tier-guidance.ts`). |
| (d) Learning science (SR / Feynman / active recall) | Mostly **no** | Quizzes with AI grading, PBL milestone evaluations with stars/reflection, proficiency tiers. **No spaced repetition, no Feynman protocol, no persistent per-concept learner model** ("learner runtime records" are session state, not a learner.json analog). |
| (e) Multimodal LLM orchestration | Yes | Provider-neutral model routing, action-engine multimodal output (speech + ink + spotlight), image/video gen, ASR in, LangGraph state machine. |

## Concrete reuse opportunities (ranked by value)

1. **The PBL v2 "disclosure ladder" + proficiency-tier prompt blocks** — *highest value, direct learner-model fit.* `lib/pbl/v2/agents/tier-guidance.ts` encodes a 4-rung hint ladder (L0 why → L1 how/where-to-look → L2 partial/analogous example → L3 literal answer) with per-tier release gates: beginner releases L3 after ONE genuine stuck signal, intermediate after TWO, advanced essentially only on explicit request. It also gives an operational definition of a "stuck signal" (repeated error on same point / second failed genuine attempt / explicit ask / visible frustration; off-topic never counts) and anti-patterns (false-binary questions, interrogating beginners, never releasing the answer). **HOW:** port the ladder and tier rules into the Prof's system prompt, keyed off Palimpsest's existing `learner.json` Bloom-level per concept; map Bloom level → starting rung and ask-count/stuck flags → release gate. This is prompt text and design, not code — trivially portable, and it is the most learning-science-literate Socratic scaffolding we've seen in an OSS repo. MIT-licensed.
2. **The interleaved action+speech output protocol for the voice-first, ink-on-page Prof.** `lib/orchestration/tool-schemas.ts` + `prompt-builder.ts` define the wire format: the LLM streams a JSON array mixing gesture actions (`wb_draw_latex`, `wb_draw_line` with arrow markers, `spotlight`, `laser`) and speech text, with an explicit ordering rule ("spotlight/laser BEFORE the corresponding text — point first, then speak; whiteboard actions interleave WITH text"). **HOW:** adopt the same interleaved action/text JSON grammar for the Prof, with actions retargeted to Palimpsest's PDF-page gesture layer (highlight region, underline, margin LaTeX note, arrow) instead of a slide canvas. Solves the exact "speaks answers aloud and inks gestures on the page" coordination problem, including TTS alignment.
3. **The `speech-guidelines` prompt snippet for TTS-clean output.** `lib/prompts/snippets/speech-guidelines.md`: never announce actions ("let me add…"), never describe what you're drawing, NEVER use markdown in spoken text "it is spoken aloud, not rendered," speech must flow regardless of action success. **HOW:** lift nearly verbatim into the Prof's prompt for Kokoro/Qwen3-TTS output quality — this is a distilled, battle-tested version of a prompt Palimpsest needs anyway.
4. **Whiteboard-discipline prompt patterns for gesture hygiene.** `lib/prompts/templates/agent-system-wb-teacher/system.md`: draw conservatively (1–3 elements per response), check current board state before drawing, clear when crowded (>5 elements triggers a director warning in `director-prompt.ts`), animated step-reveals via stable `elementId` (delete `step1`, draw `step2`). **HOW:** apply to Palimpsest's ink layer so the Prof's annotations don't accumulate into clutter across a study session; the elementId delete/replace pattern maps to updating an annotation as an explanation evolves.
5. **File-based prompt asset system with regression tests.** `lib/prompts/` (loader + `templates/<id>/system.md` + `snippets/*.md`) supports `{{vars}}`, `{{snippet:}}` includes, `{{#if}}` conditionals, and — critically — tests asserting no `{{…}}` placeholder survives rendering (a real failure mode: silent passthrough of typos). **HOW:** adopt this structure for Palimpsest's Prof/curriculum prompts so prompt iteration is diffable and testable.
6. **OpenAI-compatible local-provider adapter pattern (TTS/ASR/PDF).** OpenMAIC treats every local capability as an OpenAI-compatible HTTP service with a `<CAP>_<PREFIX>_BASE_URL` env var and a documented "how to add a provider" factory recipe (`tts-providers.ts` header, `lib/pdf/README.md`). VoxCPM2-via-`/v1/audio/speech` and FunASR-via-`/v1` are exactly the shape of Palimpsest's local Python server (Kokoro/Qwen3-TTS/Whisper). **HOW:** mirror their provider-registry shape (constants entry + config + factory switch) in the Readest fork's settings layer; also validates the architecture choice.
7. **MinerU as a reference (not a dependency) for formula extraction.** `lib/pdf/` shows a clean provider seam for Markdown+LaTeX PDF extraction with an image-id→data mapping (`img_1` → base64) so extracted figures stay referenceable. Palimpsest already commits to its own math-preserving pipeline for digital-born PDFs, but if a fallback/advanced parser is ever wanted, their MinerU client (`mineru-parser.ts`, `mineru-cloud.ts`) and the `ParsedPdfContent` schema (formulas with page+position, layout blocks) are a proven contract to copy.
8. **Playwright visual-eval harness pattern.** `app/eval/whiteboard/page.tsx` exposes `window.__setElements(...)` / `__evalReady` so Playwright can inject DSL elements and screenshot the renderer. **HOW:** same trick to regression-test Palimpsest's gesture/ink rendering — cheap, useful once the ink layer exists.

## What to ignore, and why

- **The entire course-generation pipeline** (`@openmaic/generation`, outline→scene generation, agent workbench, skills): Palimpsest studies existing dense books; it does not generate courses. Fundamental product mismatch.
- **The slide DSL / renderer / editor / PPTX importer + pptxgenjs + mathml2omml**: Palimpsest's hard constraint is "PDF is the only rendered layer." Slides are antithetical. (Also avoids the LGPL mathml2omml package entirely.)
- **Multi-agent classroom cast** (AI classmates, roundtable debates, LangGraph director): Palimpsest has a single Prof. The director graph's value is routing among personas — needless complexity for one tutor.
- **Video/image generation, MP4 export render-service, ComfyUI, OpenClaw skill, voice cloning**: out of scope for a local-first reader.
- **Postgres persistence / agent-session runtime / access codes**: Palimpsest is local-first single-user on macOS; `learner.json` + Readest's local storage already cover the need.
- **Their cloud-provider sprawl and quiz scene machinery**: keep Palimpsest's single OpenAI-compatible LLM seam; their quiz UI assumes generated slides.
- **Do not expect (d):** no spaced repetition, Feynman, or per-concept learner modeling exists there — Palimpsest's Study tab + `learner.json` design is *ahead* of OpenMAIC here. Borrow only the tier/ladder scaffolding (item 1), not a learner model.

## License compatibility

Root repo is **MIT** (confirmed in `LICENSE`; relicensed from AGPL-3.0 at v0.3.0, 2026-06-28 — older GitHub API snapshots still showing AGPL are stale). MIT is fully compatible with borrowing prompt text, design patterns, and code in Palimpsest (a Readest fork) with attribution. Only caveat: `packages/mathml2omml` is LGPL-3.0 and `packages/pptxgenjs` is third-party MIT — irrelevant since none of the recommended reuse touches those packages. Citing the JCST paper is appropriate if the disclosure-ladder design informs published work.

## Sources

- Kept: [GitHub repo + README](https://github.com/THU-MAIC/OpenMAIC) — architecture, releases, license, feature inventory (read directly from a full clone).
- Kept: [JCST paper page](https://jcst.ict.ac.cn/en/article/doi/10.1007/s11390-025-6000-0) — abstract, citation, evaluation scale.
- Kept (read in clone): `LICENSE`, `lib/orchestration/{director-prompt,prompt-builder,tool-schemas}.ts`, `lib/prompts/{README.md,snippets/speech-guidelines.md,templates/agent-system-wb-teacher/system.md}`, `lib/pbl/v2/agents/{tier-guidance,evaluator}.ts`, `lib/pdf/README.md`, `app/api/parse-pdf/route.ts`, `app/api/pbl/v2/evaluate/route.ts`, `app/eval/whiteboard/page.tsx`, `lib/audio/tts-providers.ts` — primary evidence for every reuse claim above.
- Dropped: openmaic.io / openmaic.chat marketing pages — restate README, no primary evidence.
- Dropped: GitHub code-search result pages — login-walled, unrenderable.

## Gaps

- Did not exhaustively read the 91 KB PBL instructor agent or `@openmaic/generation` prompt templates; if item 1–2 adoption proceeds, a full read of `lib/pbl/v2/agents/instructor.ts` and `lib/prompts/snippets/whiteboard-reference.md` (17 KB) is the next step.
- Star/activity numbers are point-in-time (2026-09-10); the repo moves fast, so re-verify API stability of anything before vendoring code.
- No hands-on run of the demo; claims about runtime behavior are from code/docs, not execution.
