# Context Architecture — Professor Workbench Sessions

Status: decision spec (2026-09-15) · Scope: `apps/readest-app/src/services/professor/{contextPack,prompt,session,workbenchSession}.ts`
Method: agent-arch-system-design decision framework (quality attributes → constraints → trade-offs → risks).

## 1. The question

Whole-book stuffing (just shipped, `buildWorkbenchContextPack`) vs chapter-window (pre-existing) vs tiered assembly vs agentic page-lookup vs hybrid — for multi-turn Socratic math tutoring with mandatory page citations.

## 2. Measured reality (this machine's library, `wc -c` on content.md)

| Book | chars | ~tokens (÷4) | pages | Current whole-book mode |
|---|---|---|---|---|
| Attention Is All You Need | 48k | 12k | 15 | fits — trivially |
| The Stranger | 193k | 48k | 83 | fits |
| Naval Almanack | 265k | 66k | 242 | fits |
| Lean Learning | 377k | 94k | 208 | fits |
| Impro | 487k | 122k | 232 | fits (just under 600k cap) |
| Game Theory: An Introduction | 1,257k | 314k | 417 | **falls back** — and it's the math book |
| South | 843k | 211k | 420 | falls back |
| Science of Being | 878k | 220k | 440 | falls back |
| Monte Cristo | 2,878k | 720k | 1,426 | falls back |

**Finding A:** the 600k cap splits the real library 5/5, and the biggest, most math-heavy book fails silently. "Whole book" is not a strategy, it's a coin flip.
**Finding B (code, load-bearing):** `sendWorkbenchTurn` never builds a pack — each turn is a stateless single message (`streamText(messages:[{user}])`) carrying only a 12-block × 1200-char history summary. The whole book is injected **only in the opening turn**. So in whole-book mode the professor is grounded on turn 1 and *cannot see the book at all* on turns 2+ — worse than the chapter window it replaced. Citation drift is guaranteed, not hypothetical.

## 3. Evidence

- **Lost-in-the-middle** (Liu et al., TACL 2023, https://arxiv.org/abs/2307.03172): retrieval accuracy is U-shaped over context position; relevant info in the *middle* of a 100k+ context is accessed significantly worse, even for long-context models. A 122k-token Impro means the target page is needle-in-haystack *every turn*, while the professor must cite exact pages.
- **RAG vs long-context** (Li et al., EMNLP 2024, https://arxiv.org/abs/2407.16833): long-context beats RAG on quality *when resourced sufficiently*; RAG wins on cost; hybrid routing (Self-Route) keeps ~LC quality at ~RAG cost. → tiered assembly + on-demand lookup, not either/or.
- **Pricing** (https://developers.openai.com/api/docs/pricing, fetched 2026-09-15): flagship-class `gpt-5.6-sol` $4/M input, **$0.40/M cached**, $20/M output (short ctx; long-ctx band 2×: $8/$0.80/$30). Value-class `gpt-5.6-terra` $2/$0.20/$12. (App defaults today are `gpt-5-nano`/`gpt-4o-mini` — far below professor quality; treat as the local-fallback tier, not the target.)
- **Prompt caching** (https://developers.openai.com/api/docs/guides/prompt-caching): automatic, **up to 90% off** reused prefixes, 30-min default TTL. Makes a *stable-prefix* tiered design nearly free; does nothing for a design that rewrites its prefix each turn, and does nothing about attention dilution.

## 4. Cost model — 10-turn session, Impro (~122k tok), ~400 tok out/turn, gpt-5.6-sol

| Design | in-tokens/turn | $/turn | $/session |
|---|---|---|---|
| Whole book EVERY turn, uncached | ~125k | $0.50 | **$5.01** |
| Whole book every turn, cached book prefix | 122k cached +3k | ~$0.055 | **~$1.00** |
| Current code (book once; turns 2+ ungrounded) | 125k, then ~3k | — | ~$0.63 (quality-fail) |
| **Tiered assembly (recommended), uncached** | ~15k | $0.06 | **$0.61** |
| Tiered, cached shared tiers | mostly cached | ~$0.02 | **~$0.20** |
| Local (ollama), tiered ≤60k chars | ~15k | $0 (GPU) | $0 |

Verdict on cost: at flagship prices whole-book-every-turn is ~$5/session — annoying, not fatal, and caching cuts it to ~$1. **Cost is not the decider. Quality is:** middle-position citation accuracy, and the turn-2+ grounding hole.

## 5. Verdict by book size (chars → tokens @4 chars/tok)

- **Small ≤80k chars (≤~20k tok)** — e.g. Attention paper, papers/chapters: **whole book, every turn.** One pack, simplest grounding, fits local models too. No tools needed.
- **Medium 80k–600k chars (~20–150k tok)** — Impro, Naval, Lean Learning: **tiered assembly every turn** (below), cloud only. Whole-book *with caching* is an acceptable v1 for ≤350k chars, but still dilutes citations — tiered is strictly better at 1/8 the tokens.
- **Large >600k chars (>~150k tok)** — Game Theory, Monte Cristo: **tiered assembly + page-lookup tool mandatory.** Whole book is not an option on any model the owner will pay for.
- **Local/ollama mode (any size):** hard cap the assembled pack at **60k chars (~15k tok)**; drop tiers bottom-up (chapter first, concept pages next); never emit `whole_book_text`.

## 6. Tiered assembly spec (every turn, deterministic order for cache-friendliness)

1. **T0 current page** — excerpt (existing `buildContextPack`) + blocks. Always.
2. **T1 chapter window** — `getChapterText` from session.ts (already exists; export it), capped at 30k chars.
3. **T2 concept-anchored pages** — for each of the top-3 `concept_states`, find pages whose excerpt contains the concept name (or reuse the pages where it was logged), include each page's text, 3k chars/page cap. This is the "what they've struggled with follows them" tier.
4. **T3 session state** — last 2 exchanges verbatim + `summarizeLearner` + rolling 3-sentence "where we are" summary appended by the harness (professor's previous answer truncated to 600 chars is fine).
5. **T4 whole book** — only when `md.length ≤ 80k` (small verdict) and not local mode.
6. **Escalation ladder:** if the student names a page/section not in T0–T2 (regex for "page N" / quoted phrases not present in pack), the harness appends that page's excerpt and prefixes the retry: "(added page N)". If still unresolved → professor says "I will look" (prompt already has this rule — reuse it).
7. Citation rule unchanged: every book claim carries a `[Page N]` anchor; anchors come only from pack text (prompt addendum already mandates this).

## 7. Agentic page-lookup tool: build it, second

- **Worth it:** yes. The hard part (page→text via `manifest.alignment`) already exists; the tool is a ~60-line JS function over `md.slice(start,end)`. ai-sdk `streamText` supports tools natively. It gives large books unbounded grounding and lets T2 shrink (fetch on demand instead of prefetch).
- **Not first:** it costs one extra model round-trip per lookup (latency + a second billable call), and tool-calling reliability on small/local models is poor — the offline path must degrade to tier-0-only anyway. Ship §6 first (fixes the turn-2+ hole in under a day), add the tool as the second PR.
- Local mode: tool optional-but-off by default (small models + extra latency).

## 8. contextPack.ts edit list (function-by-function, ≤1 day)

1. `WHOLE_BOOK_BUDGET_CHARS` → rename semantics: replace with `SMALL_BOOK_MAX_CHARS = 80_000`, `LOCAL_PACK_MAX_CHARS = 60_000`, `CHAPTER_TIER_CHARS = 30_000`, `CONCEPT_PAGE_CHARS = 3_000`. Keep the old export as a deprecated alias for one release if workbenchSession imports it (it doesn't — safe to delete).
2. `buildWholeBookText` — keep as-is; callers now gate on `SMALL_BOOK_MAX_CHARS` (and never in local mode).
3. New `buildConceptPages(md, manifest, conceptStates, capPerPage)` → `{[page]: excerpt}` for top-3 concepts (search anchored pages' spans for the concept string; fall back to the page where the concept was last logged in learner.json).
4. New `buildTieredPack(args: {…, localMode?: boolean})` — calls existing `buildContextPack` (T0), `getChapterText` (T1, moved/exported from session.ts), `buildConceptPages` (T2), assembles T3 fields, and appends T4 via `buildWholeBookText` when small. Enforces `LOCAL_PACK_MAX_CHARS` by dropping T1→T2 in local mode. Returns `pages_included: number[]` so the prompt can list them ("you can cite pages: …").
5. `buildWorkbenchContextPack` — keep for backward compat but re-implement as `buildTieredPack` + legacy `wholeBook` flag (true only when T4 fired), so old consumers/tests keep compiling.
6. workbenchSession.ts (caller, same PR): `sendWorkbenchTurn` must take `bookKey` and rebuild the tiered pack each turn — **this is the fix for Finding B**; keep tier order byte-identical across turns so prompt caching works; keep `messages:[{user}]` statelessness (it's fine once the pack rides in every turn).
7. prompt.ts: add one line to `PROFESSOR_WORKBENCH_ADDENDUM`: "Pages you can cite this turn are listed in `Pages in your context`; cite only those; if the answer lives on another page, say 'I will look'." (Tool instruction `[FETCH:page:N]` appended when §7 lands.)

## 9. Quality risks & mitigations (specific)

- **Dilution (middle-position misses):** Impro at 122k tok puts target pages mid-context. → Tiers keep the working set ≤~15k tok; T2 re-injects struggled-with pages near the end of the pack (recency position).
- **Citation drift:** model cites "page 41" from memory on turn 9 of whole-book mode. → every-turn pack + `pages_included` whitelist; anchors must match pack text (verifiable in tests: parse `[Page N]` in output, assert N ∈ pages_included).
- **Stale context after turn 1 (the shipped bug):** fixed by edit #6; add a regression test asserting `sendWorkbenchTurn`'s assembled message contains the current page's excerpt.
- **Silent fallback on big books:** today's `wholeBook:false` path leaves the professor with one page. → tiered design gives T1+T2 by construction; log pack tier sizes to telemetry.
- **Cache misses from nondeterministic packs:** concept-state ordering or timestamps inside the stable prefix kill the 90% discount. → deterministic sort (existing `asked` desc), no timestamps in tiers 0–2; only T3 varies per turn.
- **Local-mode overflow:** a 122k-token pack hard-fails ollama. → `LOCAL_PACK_MAX_CHARS` enforced in `buildTieredPack`, not at the provider.
