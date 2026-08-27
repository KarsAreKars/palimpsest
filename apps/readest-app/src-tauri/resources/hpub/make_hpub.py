#!/usr/bin/env python3
"""Palimpsest extraction sidecar: digital-born PDF -> .hpub dual-layer package.

Pipeline (master plan §3):
  1. Text-layer coverage check (pypdfium2). Scanned/image-only PDFs are
     REJECTED — no OCR path (hard constraint #1).
  2. Marker extraction (math-aware, formula OCR -> LaTeX) via one
     build_document pass rendered to both Markdown and JSON.
  3. manifest.json: page <-> MD char-span alignment (shingle anchoring,
     proven 94% mean containment on the phase-0 worst case) + per-block
     bboxes from Marker's JSON tree.
  4. Quality gate: token containment per page (mean >= 0.90, min >= 0.70).
     Failure = failed import, not a degraded book (hard constraint #2).
  5. Package: --out-dir writes unpacked artifacts; --out-hpub writes the zip.

Stdout protocol: progress lines to stderr; the LAST stdout line is a JSON
result object. Exit codes: 0 ok · 2 scanned rejection · 3 quality gate · 1 error.

Requires the marker-pdf environment (marker 2.x, pypdfium2, pdftext).
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

SHINGLE = 6
MAX_SHINGLE_OCCURRENCES = 25  # shingles too common to anchor a page

# A page whose vote matched this fraction of its shingles (or more) is a
# confident anchor: it may advance the monotonic cursor. Below it, the vote
# is distrusted and the page is demoted to unmatched (healed later by
# interpolation between confident neighbors). One shaky anchor must never
# drag the cursor across a chapter — the Almanack failure mode: a 14-token
# divider page (conf 0.14) carried a quote that reappears later in the book,
# voted the WRONG occurrence ~1900 tokens ahead, and the cursor clamp then
# zeroed pages 157-166's windows even though their own votes were correct.
MIN_ANCHOR_CONFIDENCE = 0.5

# Coverage gate: a page with fewer extractable alnum chars than this has no
# usable text layer. If more than MAX_NOTEXT_FRACTION of pages are no-text,
# the book is a scan.
MIN_PAGE_TEXT_CHARS = 20
MAX_NOTEXT_FRACTION = 0.20

# Quality gate (amendment A2 — class-aware: strict where tokens exist,
# lenient where they legitimately don't):
#   prose pages   — per-page containment >= 0.70, prose mean >= 0.85
#   mixed pages   — per-page containment >= 0.50 (figure tokens legitimately
#                   missing from the text layer)
#   visual pages  — excluded from containment scoring (diagrams became images)
#   drift signal  — >= 3 consecutive failing prose/mixed pages rejects the book
#   backstop      — < 50% of pages anchored rejects outright, any classes
MIN_PROSE_CONTAINMENT = 0.70
MIN_PROSE_MEAN_CONTAINMENT = 0.85
MIN_MIXED_CONTAINMENT = 0.50
MAX_FAILING_RUN = 3
MIN_ANCHORED_FRACTION = 0.50

# Constraint #2 enforced directly: a math-dense PDF whose text layer lost the
# math is a failed import even if prose containment passes.
MIN_EQUATION_REGIONS_FOR_CHECK = 20
MIN_MD_MATH_FRACTION = 0.20

# Page classification by visual-block bbox area share.
VISUAL_BLOCK_TYPES = {"Picture", "Diagram", "Table", "TableOfContents", "Figure", "FigureGroup"}
VISUAL_PAGE_THRESHOLD = 0.50
MIXED_PAGE_THRESHOLD = 0.15


def log(msg: str) -> None:
    print(f"[make_hpub] {msg}", file=sys.stderr, flush=True)


def emit(result: dict, code: int) -> None:
    print(json.dumps(result))
    sys.exit(code)


# ─── 1. coverage ─────────────────────────────────────────────────────────────

def extract_page_texts(pdf_path: str) -> list[str]:
    """Per-page text-layer text. Uses pypdf (the extractor phase-0 alignment
    was validated with); pypdfium2's reading order differs on table-heavy
    pages enough to perturb containment scoring."""
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    return [(page.extract_text() or "") for page in reader.pages]



def despace_page_text(text: str) -> tuple[str, bool]:
    """Letter-spaced text layers ("T h e s a m e w a y …" — every glyph its
    own token) break word-shingle alignment while looking healthy to the
    coverage check. Detect pages whose tokens are >50% single chars and
    rejoin the runs into words."""
    toks = text.split()
    if len(toks) < 20:
        return text, False
    singles = sum(1 for t in toks if len(re.sub(r"[^a-z0-9']", "", t.lower())) <= 1)
    if singles / len(toks) < 0.5:
        return text, False
    out: list[str] = []
    buf: list[str] = []
    for t in toks:
        core = re.sub(r"[^a-z0-9']", "", t.lower())
        if 0 < len(core) <= 1:
            buf.append(core)
        else:
            if buf:
                out.append("".join(buf))
                buf = []
            out.append(t)
    if buf:
        out.append("".join(buf))
    return " ".join(out), True


def coverage_check(page_texts: list[str]) -> None:
    no_text = sum(
        1 for t in page_texts if len(re.sub(r"[^a-z0-9]", "", t.lower())) < MIN_PAGE_TEXT_CHARS
    )
    fraction = no_text / max(len(page_texts), 1)
    log(f"coverage: {no_text}/{len(page_texts)} no-text pages ({fraction:.0%})")
    if fraction > MAX_NOTEXT_FRACTION:
        emit(
            {
                "status": "rejected",
                "reason": "scanned",
                "detail": (
                    f"{no_text}/{len(page_texts)} pages have no text layer. "
                    "OCR is too lossy for our AI features — find the digital PDF."
                ),
                "no_text_pages": no_text,
                "page_count": len(page_texts),
            },
            2,
        )



def ensure_llama_cpp() -> None:
    """surya2's OCR backend shells out to llama-server. GUI apps on macOS get
    a bare launchd PATH (no /opt/homebrew/bin), so resolve the binary
    explicitly. Must run BEFORE marker imports surya — pydantic settings bind
    env vars at import time."""
    if os.environ.get("LLAMA_CPP_BINARY"):
        return
    from shutil import which

    for cand in (
        which("llama-server"),
        "/opt/homebrew/bin/llama-server",
        "/usr/local/bin/llama-server",
    ):
        if cand and Path(cand).exists():
            os.environ["LLAMA_CPP_BINARY"] = cand
            log(f"llama-server resolved: {cand}")
            return
    log("llama-server NOT found — surya's llamacpp backend will fail (brew install llama.cpp)")


# ─── 2. marker extraction ────────────────────────────────────────────────────

def marker_extract(pdf_path: str, cache_dir: Path | None = None, use_llm: bool = False):
    """One build_document pass, rendered to Markdown + JSON. Returns
    (md_text, doc_tree, images{name: PIL.Image}). Caches to disk so
    alignment/gate iteration doesn't pay the ~3.4 s/page Marker cost twice.

    use_llm=True routes blocks through an LLM service (OpenRouter when
    OPENROUTER_API_KEY is set): display equations come back as real LaTeX
    instead of images/silence — the difference between a math book that
    narrates and one that skips every formula (constraint #2)."""
    ensure_llama_cpp()
    cache_key = "llm" if use_llm else "plain"
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        md_cache = cache_dir / f"content.{cache_key}.md"
        tree_cache = cache_dir / f"tree.{cache_key}.json"
        if md_cache.is_file() and tree_cache.is_file():
            log(f"reusing cached marker output ({cache_key})")
            return md_cache.read_text(encoding="utf-8"), json.loads(tree_cache.read_text()), {}

    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.renderers.json import JSONRenderer
    from marker.renderers.markdown import MarkdownRenderer

    config: dict = {"output_format": "markdown"}
    llm_service = None
    if use_llm:
        import os

        key = os.environ.get("PALIMPSEST_LLM_API_KEY")
        if key:
            # Any OpenAI-compatible multimodal endpoint: OpenRouter, OpenAI,
            # Together, vLLM, … Mirrors the app's Settings → AI fields.
            # NB: llm_service is a PdfConverter constructor arg, not a config
            # key — in config it is silently ignored and Gemini is used.
            config["use_llm"] = True
            llm_service = "marker.services.openai.OpenAIService"
            config["openai_api_key"] = key
            base = os.environ.get("PALIMPSEST_LLM_BASE_URL")
            model = os.environ.get("PALIMPSEST_LLM_MODEL")
            if base:
                config["openai_base_url"] = base.rstrip("/")
            if model:
                config["openai_model"] = model
            log(f"llm assist: {model or 'default model'} via {base or 'default endpoint'}")
        else:
            log("llm assist requested but PALIMPSEST_LLM_API_KEY is unset — running plain")

    converter = PdfConverter(
        artifact_dict=create_model_dict(), config=config, llm_service=llm_service
    )
    with converter.filepath_to_str(pdf_path) as temp_path:
        document = converter.build_document(temp_path)
        md_out = converter.resolve_dependencies(MarkdownRenderer)(document)
        json_out = converter.resolve_dependencies(JSONRenderer)(document)
    tree = json_out.model_dump(mode="json", exclude={"metadata"})
    if cache_dir:
        (cache_dir / f"content.{cache_key}.md").write_text(md_out.markdown, encoding="utf-8")
        (cache_dir / f"tree.{cache_key}.json").write_text(json.dumps(tree), encoding="utf-8")
    return md_out.markdown, tree, md_out.images or {}


# ─── 3. alignment (shingle anchoring, from phase-0 align.py) ─────────────────

def norm_tokens_with_offsets(text: str):
    tokens, offsets = [], []
    for m in re.finditer(r"[a-z0-9]+", text.lower()):
        tokens.append(m.group(0))
        offsets.append(m.start())
    return tokens, offsets


def shingle_seq(tokens, n=SHINGLE):
    return [tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


def strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "")


def classify_pages(tree: dict) -> dict[int, str]:
    """Classify each page as prose / mixed / visual by the bbox-area share of
    visual blocks (Picture, Diagram, Table, TableOfContents, ...) in Marker's
    JSON tree. Amendment A2: the narration layer reads this to announce visual
    blocks instead of skipping them silently."""
    classes: dict[int, str] = {}
    for pno, page in enumerate(tree.get("children") or [], start=1):
        page_bbox = page.get("bbox")
        page_area = (
            (page_bbox[2] - page_bbox[0]) * (page_bbox[3] - page_bbox[1]) if page_bbox else 0
        )
        visual_area = 0.0
        visual_blocks = 0

        def walk(node):
            nonlocal visual_area, visual_blocks
            for child in node.get("children") or []:
                bt = child.get("block_type")
                if bt in VISUAL_BLOCK_TYPES:
                    visual_blocks += 1
                    bb = child.get("bbox")
                    if bb:
                        visual_area += max(0.0, (bb[2] - bb[0])) * max(0.0, (bb[3] - bb[1]))
                if child.get("children"):
                    walk(child)

        walk(page)
        if page_area > 0:
            frac = visual_area / page_area
        else:
            frac = 1.0 if visual_blocks else 0.0  # no geometry: count fallback
        classes[pno] = (
            "visual"
            if frac >= VISUAL_PAGE_THRESHOLD
            else "mixed"
            if frac >= MIXED_PAGE_THRESHOLD
            else "prose"
        )
    return classes


def count_equation_regions(tree: dict) -> int:
    count = 0

    def walk(node):
        nonlocal count
        if node.get("block_type") == "Equation":
            count += 1
        for c in node.get("children") or []:
            walk(c)

    walk(tree)
    return count


def count_md_math_spans(md_text: str) -> int:
    display = len(re.findall(r"\$\$[\s\S]+?\$\$", md_text))
    inline = len(re.findall(r"(?<!\$)\$[^$\n]+\$(?!\$)", md_text))
    return display + inline



CLEANUP_CHUNK_CHARS = 4000

CLEANUP_SYSTEM = """You are a precision cleanup pass for machine-extracted Markdown from a PDF book. Repair ONLY mechanical extraction damage:
- broken LaTeX: unbalanced $ or $$ delimiters, commands split across lines (\\frac\n{x}), mangled sub/superscripts — rewrite them as correct inline $...$ or display $$...$$ math
- line-break hyphenation: rejoin words split as "hy- phen" across lines
- welded citation clutter: markers like [3], (12), [14,2] fused into prose — drop the marker, keep the prose
- duplicated running headers/footers and page numbers repeated mid-text — remove them
- broken pipe-table rows from equations — restore as display math when the content is an equation
Hard rules: never summarize, never reorder, never delete real content, never add commentary. Keep every heading, image reference, and paragraph. Output ONLY the cleaned Markdown — no preamble, no fences."""


def llm_config() -> dict | None:
    key = os.environ.get("PALIMPSEST_LLM_API_KEY")
    if not key:
        return None
    return {
        "key": key,
        "base": os.environ.get("PALIMPSEST_LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        "model": os.environ.get("PALIMPSEST_LLM_MODEL", "gpt-4o-mini"),
    }


def chunk_markdown(md_text: str, target: int = CLEANUP_CHUNK_CHARS) -> list[str]:
    """Paragraph-boundary chunks that never split inside a $$ ... $$ block."""
    paras = re.split(r"(\n\n+)", md_text)
    units = [p for p in paras if p]
    chunks: list[str] = []
    cur = ""
    in_display = False
    for u in units:
        if cur and len(cur) + len(u) > target and not in_display:
            chunks.append(cur)
            cur = ""
        cur += u
        if u.count("$$") % 2 == 1:
            in_display = not in_display
    if cur:
        chunks.append(cur)
    return chunks


def cleanup_chunk_ok(original: str, cleaned: str) -> bool:
    """A cleanup can only improve cadence/damage, never lose the book."""
    if not cleaned or len(cleaned.strip()) < 20:
        return False
    ratio = len(cleaned) / max(len(original), 1)
    if not (0.5 <= ratio <= 1.6):
        return False
    if cleaned.count("$$") % 2 == 1:
        return False
    head = cleaned.strip()[:40].lower()
    if head.startswith(("i can't", "i cannot", "sorry", "```")):
        return False
    return True


def llm_cleanup_pass(md_text: str, cfg: dict) -> tuple[str, dict]:
    chunks = chunk_markdown(md_text)
    repaired, kept = 0, 0
    out: list[str] = []
    for i, chunk in enumerate(chunks):
        request: dict = {
            "model": cfg["model"],
            # No temperature: some models (gpt-5-mini family) 400 on it.
            "messages": [
                    {"role": "system", "content": CLEANUP_SYSTEM},
                    {"role": "user", "content": chunk},
                ],
        }
        # Mechanical repair doesn't need deep reasoning; on OpenAI's gpt-5
        # family low effort cuts per-chunk latency several-fold. Only sent to
        # api.openai.com — other OpenAI-compatible endpoints may reject it.
        if "api.openai.com" in cfg["base"]:
            request["reasoning_effort"] = "low"
        body = json.dumps(request).encode("utf-8")
        cleaned: str | None = None
        for _attempt in range(2):
            try:
                req = urllib.request.Request(
                    f"{cfg['base']}/chat/completions",
                    data=body,
                    headers={
                        "Authorization": f"Bearer {cfg['key']}",
                        "Content-Type": "application/json",
                    },
                )
                with urllib.request.urlopen(req, timeout=180) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                cleaned = payload["choices"][0]["message"]["content"]
                break
            except Exception as e:  # noqa: BLE001 — network/parse failures keep the original
                detail = ""
                if hasattr(e, "read"):
                    try:
                        detail = " — " + e.read().decode("utf-8")[:200]
                    except Exception:
                        pass
                log(f"cleanup chunk {i + 1}/{len(chunks)} attempt failed: {e}{detail}")
        if cleaned is not None:
            cleaned = cleaned.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```(?:markdown|md)?\s*", "", cleaned)
                cleaned = re.sub(r"\s*```$", "", cleaned)
        if cleaned is not None and cleanup_chunk_ok(chunk, cleaned):
            out.append(cleaned)
            repaired += 1
        else:
            out.append(chunk)
            kept += 1
        if (i + 1) % 5 == 0 or i + 1 == len(chunks):
            log(f"cleanup progress: {i + 1}/{len(chunks)} chunks")
    stats = {"chunks": len(chunks), "repaired": repaired, "kept": kept}
    return "".join(out), stats


def build_manifest(title: str, md_text: str, page_texts: list[str], tree: dict) -> dict:
    md_tokens, md_offsets = norm_tokens_with_offsets(md_text)

    index = {}
    for i, sh in enumerate(shingle_seq(md_tokens)):
        index.setdefault(sh, []).append(i)
    anchor_index = {sh: pos for sh, pos in index.items() if len(pos) <= MAX_SHINGLE_OCCURRENCES}

    pages = []
    cursor = 0
    for pno, text in enumerate(page_texts):
        toks, _ = norm_tokens_with_offsets(text)
        shs = shingle_seq(toks)
        votes: dict[int, int] = {}
        matched = 0
        for i, sh in enumerate(shs):
            if sh in anchor_index:
                for mdpos in anchor_index[sh]:
                    key = (mdpos - i) // 200
                    votes[key] = votes.get(key, 0) + 1
                matched += 1
        total_sh = max(len(shs), 1)
        confidence = matched / total_sh
        if votes and confidence >= MIN_ANCHOR_CONFIDENCE:
            best_key = max(votes.items(), key=lambda kv: kv[1])[0]
            near = [
                mdpos
                for i, sh in enumerate(shs)
                if sh in anchor_index
                for mdpos in anchor_index[sh]
                if abs(mdpos - i - best_key * 200) < 400
            ]
            if near:
                md_start_tok = max(min(near), 0)
                md_end_tok = min(max(near) + SHINGLE, len(md_tokens) - 1)
            else:
                md_start_tok = max(best_key * 200, 0)
                md_end_tok = min(md_start_tok + len(toks), len(md_tokens) - 1)
            md_start_tok = max(md_start_tok, cursor)
            md_end_tok = max(md_end_tok, md_start_tok + 1)
            cursor = md_start_tok
            pages.append(
                {
                    "page": pno + 1,
                    "md_char_start": md_offsets[md_start_tok],
                    "md_char_end": md_offsets[md_end_tok],
                    "confidence": round(matched / total_sh, 3),
                    "method": "anchored",
                }
            )
        else:
            pages.append(
                {
                    "page": pno + 1,
                    "md_char_start": None,
                    "md_char_end": None,
                    # Demoted low-confidence votes keep their score for
                    # observability (was a vote, just not a trusted one).
                    "confidence": round(confidence, 3),
                    "method": "unmatched",
                }
            )

    anchored = [p for p in pages if p["method"] == "anchored"]
    for p in pages:
        if p["method"] == "unmatched":
            prev = next((a for a in reversed(anchored) if a["page"] < p["page"]), None)
            nxt = next((a for a in anchored if a["page"] > p["page"]), None)
            if prev and nxt:
                gap = nxt["page"] - prev["page"]
                frac = (p["page"] - prev["page"]) / gap
                span = nxt["md_char_start"] - prev["md_char_end"]
                p["md_char_start"] = int(prev["md_char_end"] + span * frac)
                p["md_char_end"] = int(prev["md_char_end"] + span * (frac + 1 / gap))
                p["method"] = "interpolated"
                p["confidence"] = round(min(prev["confidence"], nxt["confidence"]) * 0.5, 3)

    # Per-block bboxes from the Marker JSON tree, in reading order.
    tree_pages = tree.get("children") or []
    for p in pages:
        if p["page"] - 1 >= len(tree_pages):
            break
        tpage = tree_pages[p["page"] - 1]
        blocks = []

        def walk(node):
            for child in node.get("children") or []:
                if child.get("children"):
                    walk(child)
                elif child.get("block_type"):
                    blocks.append(child)

        walk(tpage)
        p["blocks"] = [
            {
                "id": b.get("id"),
                "type": b.get("block_type"),
                "bbox": b.get("bbox"),
                "text_head": strip_html(b.get("html", "")).strip()[:120],
            }
            for b in blocks
        ]
        hierarchy = tpage.get("section_hierarchy") or {}
        if hierarchy:
            p["section_hierarchy"] = {k: v for k, v in hierarchy.items()}

    # Amendment A2: per-page class for the gate and the narration layer.
    classes = classify_pages(tree)
    for p in pages:
        p["page_class"] = classes.get(p["page"], "prose")

    return {
        "format": "hpub/0.1",
        "title": title,
        "view_layer": "book.pdf",
        "text_layer": "content.md",
        "page_count": len(pages),
        "alignment": pages,
    }



# ─── boundary-invariant (char-level) alignment fallback ─────────────────────
# Some digital PDFs have degenerate word geometry: letter-spaced text layers
# ("T h e s a m e w a y") or near-zero word gaps that make extractors join
# words — on BOTH sides (pypdf page text AND marker/surya md). Word-shingle
# alignment needs 6 consecutive matching tokens and dies. Char shingles don't
# care where the spaces are.
CHAR_SHINGLE = 16        # chars per shingle (24 shatters at ~2% VLM char noise)
CHAR_SHINGLE_STEP = 4    # sampling stride (keeps the index ~n/4)
CHAR_MIN_ANCHOR_CONFIDENCE = 0.35  # shingles intact at ~2% char noise ≈ 0.72; margin below
CHAR_VOTE_BUCKET = 800   # vote bucketing in md char space
CHAR_NEAR_WINDOW = 1600  # accepted spread around the winning bucket


def char_norm_with_offsets(text: str) -> tuple[str, list[int]]:
    """Lowercase alnum stream + map back to original string offsets."""
    out: list[str] = []
    offsets: list[int] = []
    for i, ch in enumerate(text.lower()):
        if ch.isalnum():
            out.append(ch)
            offsets.append(i)
    return "".join(out), offsets


def char_shingle_seq(s: str):
    for i in range(0, max(len(s) - CHAR_SHINGLE + 1, 0), CHAR_SHINGLE_STEP):
        yield i, s[i : i + CHAR_SHINGLE]


def build_manifest_chars(title: str, md_text: str, page_texts: list[str], tree: dict) -> dict:
    """Char-shingle variant of build_manifest — same output shape, immune to
    word-boundary damage. Used only as a fallback when token anchoring fails,
    so healthy books keep the tuned token path."""
    md_norm, md_offsets = char_norm_with_offsets(md_text)

    index: dict[str, list[int]] = {}
    for i, sh in char_shingle_seq(md_norm):
        index.setdefault(sh, []).append(i)
    anchor_index = {sh: pos for sh, pos in index.items() if len(pos) <= MAX_SHINGLE_OCCURRENCES}

    pages = []
    cursor = 0
    for pno, text in enumerate(page_texts):
        norm, _ = char_norm_with_offsets(text)
        shs = list(char_shingle_seq(norm))
        votes: dict[int, int] = {}
        matched = 0
        for i, sh in shs:
            if sh in anchor_index:
                for mdpos in anchor_index[sh]:
                    key = (mdpos - i) // CHAR_VOTE_BUCKET
                    votes[key] = votes.get(key, 0) + 1
                matched += 1
        total_sh = max(len(shs), 1)
        confidence = matched / total_sh
        if votes and confidence >= CHAR_MIN_ANCHOR_CONFIDENCE:
            best_key = max(votes.items(), key=lambda kv: kv[1])[0]
            near = [
                mdpos
                for i, sh in shs
                if sh in anchor_index
                for mdpos in anchor_index[sh]
                if abs(mdpos - i - best_key * CHAR_VOTE_BUCKET) < CHAR_NEAR_WINDOW
            ]
            if near:
                md_start = max(min(near), 0)
                md_end = min(max(near) + CHAR_SHINGLE, len(md_norm) - 1)
            else:
                md_start = max(best_key * CHAR_VOTE_BUCKET, 0)
                md_end = min(md_start + len(norm), len(md_norm) - 1)
            md_start = max(md_start, cursor)
            md_end = max(md_end, md_start + 1)
            cursor = md_start
            pages.append(
                {
                    "page": pno + 1,
                    "md_char_start": md_offsets[md_start],
                    "md_char_end": md_offsets[md_end],
                    "confidence": round(confidence, 3),
                    "method": "anchored-chars",
                }
            )
        else:
            pages.append(
                {
                    "page": pno + 1,
                    "md_char_start": None,
                    "md_char_end": None,
                    "confidence": round(confidence, 3),
                    "method": "unmatched",
                }
            )

    anchored = [p for p in pages if p["method"] == "anchored-chars"]
    for p in pages:
        if p["method"] == "unmatched":
            prev = next((a for a in reversed(anchored) if a["page"] < p["page"]), None)
            nxt = next((a for a in anchored if a["page"] > p["page"]), None)
            if prev and nxt:
                gap = nxt["page"] - prev["page"]
                frac = (p["page"] - prev["page"]) / gap
                span = nxt["md_char_start"] - prev["md_char_end"]
                p["md_char_start"] = int(prev["md_char_end"] + span * frac)
                p["md_char_end"] = int(prev["md_char_end"] + span * (frac + 1 / gap))
                p["method"] = "interpolated"
                p["confidence"] = round(min(prev["confidence"], nxt["confidence"]) * 0.5, 3)

    # Per-block bboxes + classes: identical to the token path.
    tree_pages = tree.get("children") or []
    for p in pages:
        if p["page"] - 1 >= len(tree_pages):
            break
        tpage = tree_pages[p["page"] - 1]
        blocks = []

        def walk(node):
            for child in node.get("children") or []:
                if child.get("children"):
                    walk(child)
                elif child.get("block_type"):
                    blocks.append(child)

        walk(tpage)
        p["blocks"] = [
            {
                "id": b.get("id"),
                "type": b.get("block_type"),
                "bbox": b.get("bbox"),
                "text_head": strip_html(b.get("html", "")).strip()[:120],
            }
            for b in blocks
        ]
        hierarchy = tpage.get("section_hierarchy") or {}
        if hierarchy:
            p["section_hierarchy"] = {k: v for k, v in hierarchy.items()}

    classes = classify_pages(tree)
    for p in pages:
        p["page_class"] = classes.get(p["page"], "prose")

    return {
        "format": "hpub/0.1",
        "title": title,
        "view_layer": "book.pdf",
        "text_layer": "content.md",
        "page_count": len(pages),
        "alignment": pages,
    }


def containment_check_chars(md_text: str, page_texts: list[str], alignment: list[dict]) -> dict:
    """Char-multiset containment: what fraction of the page's normalized
    chars appear in the aligned md window. Boundary-invariant sibling of
    containment_check — same output shape."""
    from collections import Counter

    scores = []
    for p, text in zip(alignment, page_texts):
        if p["md_char_start"] is None:
            scores.append(0.0)
            continue
        page_norm, _ = char_norm_with_offsets(text)
        window = md_text[p["md_char_start"] : p["md_char_end"]]
        win_norm, _ = char_norm_with_offsets(window)
        win_counts = Counter(win_norm)
        contained = 0
        for c in page_norm:
            if win_counts.get(c, 0) > 0:
                win_counts[c] -= 1
                contained += 1
        scores.append(contained / max(len(page_norm), 1))

    verdicts: list[bool | None] = []
    for p, score in zip(alignment, scores):
        cls = p.get("page_class", "prose")
        if cls == "visual":
            verdicts.append(None)
        elif cls == "mixed":
            verdicts.append(score >= MIN_MIXED_CONTAINMENT)
        else:
            verdicts.append(score >= MIN_PROSE_CONTAINMENT)

    prose_scores = [s for s, p in zip(scores, alignment) if p.get("page_class", "prose") == "prose"]
    prose_mean = sum(prose_scores) / max(len(prose_scores), 1)

    longest_run = 0
    run = 0
    for v in verdicts:
        if v is False:
            run += 1
            longest_run = max(longest_run, run)
        else:
            run = 0

    return {
        "mean": round(sum(scores) / max(len(scores), 1), 3),
        "min": round(min(scores) if scores else 0.0, 3),
        "prose_mean": round(prose_mean, 3),
        "per_page": [round(s, 3) for s in scores],
        "verdicts": verdicts,
        "longest_failing_run": longest_run,
        "page_classes": {
            cls: sum(1 for p in alignment if p.get("page_class") == cls)
            for cls in ("prose", "mixed", "visual")
        },
        "mode": "chars",
    }


# ─── 4. quality gate: token containment ──────────────────────────────────────

def containment_check(md_text: str, page_texts: list[str], alignment: list[dict]) -> dict:
    """Per-page token containment, then the class-aware gate (amendment A2).
    Returns stats; `verdicts` carries per-page pass/fail/None(excluded)."""
    from collections import Counter

    scores = []
    for p, text in zip(alignment, page_texts):
        if p["md_char_start"] is None:
            scores.append(0.0)
            continue
        page_tokens, _ = norm_tokens_with_offsets(text)
        window = md_text[p["md_char_start"] : p["md_char_end"]]
        win_tokens, _ = norm_tokens_with_offsets(window)
        win_counts = Counter(win_tokens)
        contained = 0
        for t in page_tokens:
            if win_counts.get(t, 0) > 0:
                win_counts[t] -= 1
                contained += 1
        scores.append(contained / max(len(page_tokens), 1))

    verdicts: list[bool | None] = []
    for p, score in zip(alignment, scores):
        cls = p.get("page_class", "prose")
        if cls == "visual":
            verdicts.append(None)  # excluded: diagram/TOC pages have no tokens to contain
        elif cls == "mixed":
            verdicts.append(score >= MIN_MIXED_CONTAINMENT)
        else:
            verdicts.append(score >= MIN_PROSE_CONTAINMENT)

    prose_scores = [s for s, p in zip(scores, alignment) if p.get("page_class", "prose") == "prose"]
    prose_mean = sum(prose_scores) / max(len(prose_scores), 1)

    # Drift signal: a run of consecutive failing prose/mixed pages means the
    # extraction wandered, not that a chapter has diagrams.
    longest_run = 0
    run = 0
    for v in verdicts:
        if v is False:
            run += 1
            longest_run = max(longest_run, run)
        else:
            run = 0

    return {
        "mean": round(sum(scores) / max(len(scores), 1), 3),
        "min": round(min(scores) if scores else 0.0, 3),
        "prose_mean": round(prose_mean, 3),
        "per_page": [round(s, 3) for s in scores],
        "verdicts": verdicts,
        "longest_failing_run": longest_run,
        "page_classes": {
            cls: sum(1 for p in alignment if p.get("page_class") == cls)
            for cls in ("prose", "mixed", "visual")
        },
    }


def gate_book(manifest: dict, md_text: str, tree: dict, containment: dict) -> None:
    """The full import gate (constraint #2 + amendment A2). Emits a rejection
    and exits on failure; returns silently on pass."""
    alignment = manifest["alignment"]
    anchored = sum(1 for p in alignment if p["method"] == "anchored")
    anchored_fraction = anchored / max(len(alignment), 1)

    # Backstop: under 50% anchored = failed extraction, reject outright.
    if anchored_fraction < MIN_ANCHORED_FRACTION:
        emit(
            {
                "status": "rejected",
                "reason": "alignment_backstop",
                "detail": (
                    f"Only {anchored}/{len(alignment)} pages could be anchored "
                    f"to the text layer ({anchored_fraction:.0%} < "
                    f"{MIN_ANCHORED_FRACTION:.0%}). Extraction failed."
                ),
            },
            3,
        )

    # Constraint #2, direct: math-dense source, math-less text layer.
    equation_regions = count_equation_regions(tree)
    md_math_spans = count_md_math_spans(md_text)
    if (
        equation_regions >= MIN_EQUATION_REGIONS_FOR_CHECK
        and md_math_spans < MIN_MD_MATH_FRACTION * equation_regions
    ):
        emit(
            {
                "status": "rejected",
                "reason": "math_not_preserved",
                "detail": (
                    f"Marker found {equation_regions} equation regions but the "
                    f"text layer kept only {md_math_spans} LaTeX spans. This "
                    "book's math did not survive extraction."
                ),
                "equation_regions": equation_regions,
                "md_math_spans": md_math_spans,
            },
            3,
        )

    # Class-aware containment.
    failing = [i + 1 for i, v in enumerate(containment["verdicts"]) if v is False]
    if (
        containment["prose_mean"] < MIN_PROSE_MEAN_CONTAINMENT
        or containment["longest_failing_run"] >= MAX_FAILING_RUN
    ):
        emit(
            {
                "status": "rejected",
                "reason": "quality_gate",
                "detail": (
                    f"Prose containment mean={containment['prose_mean']} "
                    f"(need >= {MIN_PROSE_MEAN_CONTAINMENT}); longest failing "
                    f"run={containment['longest_failing_run']} pages "
                    f"(limit {MAX_FAILING_RUN}). Extraction quality is too low "
                    "to bind the text layer to the pages."
                ),
                "failing_pages": failing,
                "containment": containment,
            },
            3,
        )

    manifest["gate"] = {
        "anchored": anchored,
        "anchored_fraction": round(anchored_fraction, 3),
        "equation_regions": equation_regions,
        "md_math_spans": md_math_spans,
        "containment": {
            "prose_mean": containment["prose_mean"],
            "mean_all_pages": containment["mean"],
            "longest_failing_run": containment["longest_failing_run"],
            "failing_pages": failing,
            "page_classes": containment["page_classes"],
        },
    }


# ─── main ────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="PDF -> .hpub extraction sidecar")
    ap.add_argument("pdf", help="input PDF path")
    out = ap.add_mutually_exclusive_group(required=True)
    out.add_argument("--out-hpub", help="write packaged .hpub zip here")
    out.add_argument("--out-dir", help="write unpacked artifacts into this directory")
    ap.add_argument("--title", default=None, help="book title (default: PDF metadata or filename)")
    ap.add_argument(
        "--workdir",
        default=None,
        help="cache directory for marker output (speeds up alignment iteration)",
    )
    ap.add_argument(
        "--epub",
        default=None,
        help="companion EPUB of the SAME edition — fusion lane: publisher text + PDF geometry, no Marker",
    )
    ap.add_argument(
        "--use-llm",
        action="store_true",
        help="route extraction blocks through an LLM service (OpenRouter) for math/table fidelity",
    )
    args = ap.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.is_file():
        emit({"status": "error", "detail": f"not a file: {pdf_path}"}, 1)

    title = args.title or pdf_path.stem

    log("1/6 text-layer coverage check")
    page_texts = extract_page_texts(str(pdf_path))
    page_texts, despaced = zip(*(despace_page_text(t) for t in page_texts))
    if any(despaced):
        log(f"letter-spaced text layer repaired on {sum(despaced)}/{len(page_texts)} pages")
    page_texts = list(page_texts)
    coverage_check(page_texts)

    images: dict = {}
    if args.epub:
        # Fusion lane (A7): EPUB supplies clean text, PDF supplies geometry.
        # No Marker, no llama-server, no GPU grind.
        log(f"2/6 fusion: epub→markdown + pdf geometry ({len(page_texts)} pages)")
        try:
            from fusion import epub_to_markdown, pdf_geometry_tree

            md_text, images, epub_stats = epub_to_markdown(args.epub)
            log(
                f"epub: {epub_stats['chapters']} chapters, {epub_stats['chars']} chars, "
                f"{epub_stats['images']} images"
            )
            tree = pdf_geometry_tree(str(pdf_path))
            # Print hyphenation: the PDF wraps "hyp-\nphen" where the EPUB has
            # "hyphen". Rejoin on the page side so alignment votes and
            # containment score clean-on-clean.
            before = sum(t.count("-\n") for t in page_texts)
            page_texts = [re.sub(r"(\w)-\n(\w)", r"\1\2", t) for t in page_texts]
            log(f"dehyphenated {before} line-break splits in page texts")
        except Exception as e:  # noqa: BLE001
            emit({"status": "error", "stage": "fusion", "detail": str(e)}, 1)
            return
    else:
        log(f"2/6 marker extraction ({len(page_texts)} pages — this is the slow part)")
        try:
            md_text, tree, images = marker_extract(
                str(pdf_path),
                Path(args.workdir) / "marker" if args.workdir else None,
                use_llm=args.use_llm,
            )
        except Exception as e:  # noqa: BLE001 — surface marker failures as import failures
            emit({"status": "error", "stage": "marker", "detail": str(e)}, 1)
            return
    if not md_text or len(md_text.strip()) < 100:
        emit(
            {
                "status": "rejected",
                "reason": "empty_extraction",
                "detail": "Marker produced no usable text layer.",
            },
            3,
        )

    # Asset references: ![](name) -> ![](assets/name) so relative paths resolve
    # inside the package. (Fusion lane emits assets/ names directly.)
    if not args.epub:
        for name in images:
            md_text = md_text.replace(f"]({name})", f"](assets/{name})")

    cfg = llm_config() if not args.epub else None
    if cfg:
        log(f"3/6 llm cleanup pass ({cfg['model']}) — repairing extraction damage")
        md_text, stats = llm_cleanup_pass(md_text, cfg)
        log(f"cleanup: {stats['chunks']} chunks, {stats['repaired']} repaired, {stats['kept']} kept as-is")
    elif args.epub:
        log("3/6 llm cleanup skipped (fusion lane — epub text is publisher-clean)")
    else:
        log("3/6 llm cleanup pass skipped (no API key configured)")

    log("4/6 page alignment + manifest")
    manifest = build_manifest(title, md_text, page_texts, tree)
    anchored_frac = sum(1 for p in manifest["alignment"] if p["method"] == "anchored") / max(
        len(page_texts), 1
    )
    if anchored_frac < MIN_ANCHORED_FRACTION:
        # Boundary-invariant fallback: degenerate word geometry (letter-spaced
        # text layers, zero word gaps) breaks token shingles on BOTH sides.
        log(
            f"token alignment weak ({anchored_frac:.0%} anchored) — retrying with "
            "boundary-invariant char alignment"
        )
        manifest = build_manifest_chars(title, md_text, page_texts, tree)

    log("5/6 class-aware quality gate (A2)")
    if any(p["method"] == "anchored-chars" for p in manifest["alignment"]):
        containment = containment_check_chars(md_text, page_texts, manifest["alignment"])
    else:
        containment = containment_check(md_text, page_texts, manifest["alignment"])
    log(
        f"containment: prose_mean={containment['prose_mean']} "
        f"classes={containment['page_classes']} "
        f"longest_failing_run={containment['longest_failing_run']}"
    )
    if args.epub:
        from fusion import edition_check

        ed = edition_check(manifest["alignment"])
        log(
            f"edition check: {ed['anchored_pages']}/{ed['total_pages']} pages anchored "
            f"({ed['anchored_fraction']:.0%})"
        )
        if ed["anchored_fraction"] < 0.5:
            emit(
                {
                    "status": "rejected",
                    "reason": "edition_mismatch",
                    "detail": (
                        f"Only {ed['anchored_fraction']:.0%} of PDF pages match the EPUB text. "
                        "These don't look like the same edition — fusion would scramble the "
                        "alignment. Import the PDF alone (Marker lane) or find the matching EPUB."
                    ),
                    **ed,
                },
                4,
            )
    gate_book(manifest, md_text, tree, containment)
    log(f"gate passed: {manifest.get('gate')}")

    log("6/6 writing artifacts")
    if args.out_dir:
        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "content.md").write_text(md_text, encoding="utf-8")
        (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        if images:
            assets = out_dir / "assets"
            assets.mkdir(exist_ok=True)
            for name, img in images.items():
                if isinstance(img, bytes):
                    (assets / name).write_bytes(img)
                else:
                    img.save(assets / name)
        emit(
            {
                "status": "ok",
                "mode": "dir",
                "out_dir": str(out_dir),
                "page_count": manifest["page_count"],
                "anchored": manifest["gate"]["anchored"],
                "gate": manifest["gate"],
            },
            0,
        )
    else:
        out_hpub = Path(args.out_hpub)
        out_hpub.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(out_hpub, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(pdf_path, "book.pdf")
            z.writestr("content.md", md_text)
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
            import io

            for name, img in images.items():
                if isinstance(img, bytes):
                    z.writestr(f"assets/{name}", img)
                else:
                    buf = io.BytesIO()
                    img.save(buf, format=img.format or "PNG")
                    z.writestr(f"assets/{name}", buf.getvalue())
        emit(
            {
                "status": "ok",
                "mode": "hpub",
                "out_hpub": str(out_hpub),
                "size_bytes": out_hpub.stat().st_size,
                "page_count": manifest["page_count"],
                "anchored": manifest["gate"]["anchored"],
                "gate": manifest["gate"],
            },
            0,
        )


if __name__ == "__main__":
    main()
