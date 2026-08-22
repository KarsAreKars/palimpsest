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
import re
import sys
import zipfile
from pathlib import Path

SHINGLE = 6
MAX_SHINGLE_OCCURRENCES = 25  # shingles too common to anchor a page

# Coverage gate: a page with fewer extractable alnum chars than this has no
# usable text layer. If more than MAX_NOTEXT_FRACTION of pages are no-text,
# the book is a scan.
MIN_PAGE_TEXT_CHARS = 20
MAX_NOTEXT_FRACTION = 0.20

# Quality gate (phase-0 evidence: worst-case book scored 0.94 mean / 0.70 min)
MIN_MEAN_CONTAINMENT = 0.90
MIN_PAGE_CONTAINMENT = 0.70


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


# ─── 2. marker extraction ────────────────────────────────────────────────────

def marker_extract(pdf_path: str, cache_dir: Path | None = None):
    """One build_document pass, rendered to Markdown + JSON. Returns
    (md_text, doc_tree, images{name: PIL.Image}). Caches to disk so
    alignment/gate iteration doesn't pay the ~3.4 s/page Marker cost twice."""
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        md_cache = cache_dir / "content.md"
        tree_cache = cache_dir / "tree.json"
        if md_cache.is_file() and tree_cache.is_file():
            log("reusing cached marker output")
            return md_cache.read_text(encoding="utf-8"), json.loads(tree_cache.read_text()), {}

    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.renderers.json import JSONRenderer
    from marker.renderers.markdown import MarkdownRenderer

    converter = PdfConverter(artifact_dict=create_model_dict(), config={"output_format": "markdown"})
    with converter.filepath_to_str(pdf_path) as temp_path:
        document = converter.build_document(temp_path)
        md_out = converter.resolve_dependencies(MarkdownRenderer)(document)
        json_out = converter.resolve_dependencies(JSONRenderer)(document)
    tree = json_out.model_dump(mode="json", exclude={"metadata"})
    if cache_dir:
        (cache_dir / "content.md").write_text(md_out.markdown, encoding="utf-8")
        (cache_dir / "tree.json").write_text(json.dumps(tree), encoding="utf-8")
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
        if votes:
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
                    "confidence": 0.0,
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

    return {
        "format": "hpub/0.1",
        "title": title,
        "view_layer": "book.pdf",
        "text_layer": "content.md",
        "page_count": len(pages),
        "alignment": pages,
    }


# ─── 4. quality gate: token containment ──────────────────────────────────────

def containment_check(md_text: str, page_texts: list[str], alignment: list[dict]) -> dict:
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

    mean = sum(scores) / max(len(scores), 1)
    worst = min(scores) if scores else 0.0
    return {"mean": round(mean, 3), "min": round(worst, 3), "per_page": [round(s, 3) for s in scores]}


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
    args = ap.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.is_file():
        emit({"status": "error", "detail": f"not a file: {pdf_path}"}, 1)

    title = args.title or pdf_path.stem

    log("1/5 text-layer coverage check")
    page_texts = extract_page_texts(str(pdf_path))
    coverage_check(page_texts)

    log(f"2/5 marker extraction ({len(page_texts)} pages — this is the slow part)")
    try:
        md_text, tree, images = marker_extract(
            str(pdf_path), Path(args.workdir) / "marker" if args.workdir else None
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
    # inside the package.
    for name in images:
        md_text = md_text.replace(f"]({name})", f"](assets/{name})")

    log("3/5 page alignment + manifest")
    manifest = build_manifest(title, md_text, page_texts, tree)

    log("4/5 containment quality gate")
    containment = containment_check(md_text, page_texts, manifest["alignment"])
    manifest["containment"] = {"mean": containment["mean"], "min": containment["min"]}
    log(f"containment: mean={containment['mean']} min={containment['min']}")
    if containment["mean"] < MIN_MEAN_CONTAINMENT or containment["min"] < MIN_PAGE_CONTAINMENT:
        # Dump the artifacts for post-mortem analysis before failing.
        if args.workdir:
            debug_dir = Path(args.workdir) / "rejected"
            debug_dir.mkdir(parents=True, exist_ok=True)
            (debug_dir / "content.md").write_text(md_text, encoding="utf-8")
            (debug_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            log(f"debug artifacts written to {debug_dir}")
        emit(
            {
                "status": "rejected",
                "reason": "quality_gate",
                "detail": (
                    f"Alignment containment mean={containment['mean']} "
                    f"min={containment['min']} (need >={MIN_MEAN_CONTAINMENT}/"
                    f">={MIN_PAGE_CONTAINMENT}). Extraction quality is too low "
                    "to bind the text layer to the pages."
                ),
                "containment": containment,
            },
            3,
        )

    log("5/5 writing artifacts")
    if args.out_dir:
        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "content.md").write_text(md_text, encoding="utf-8")
        (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        if images:
            assets = out_dir / "assets"
            assets.mkdir(exist_ok=True)
            for name, img in images.items():
                img.save(assets / name)
        emit(
            {
                "status": "ok",
                "mode": "dir",
                "out_dir": str(out_dir),
                "page_count": manifest["page_count"],
                "anchored": sum(1 for p in manifest["alignment"] if p["method"] == "anchored"),
                "containment": {"mean": containment["mean"], "min": containment["min"]},
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
            for name, img in images.items():
                import io

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
                "anchored": sum(1 for p in manifest["alignment"] if p["method"] == "anchored"),
                "containment": {"mean": containment["mean"], "min": containment["min"]},
            },
            0,
        )


if __name__ == "__main__":
    main()
