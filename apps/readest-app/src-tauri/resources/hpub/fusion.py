#!/usr/bin/env python3
"""EPUB+PDF fusion lane (A7).

Two files, one book: the EPUB supplies publisher-clean text (no Marker
damage, no cleanup pass needed); the PDF supplies page geometry (block
bboxes in PDF points, straight from the text layer via pdftext). The
output is a marker-shaped synthetic tree + clean markdown, so the rest
of the pipeline (shingle alignment, manifest, gate, narration, Professor)
runs unchanged.

Failure = failed import, never a degraded book: the edition check rejects
PDF/EPUB pairs that aren't the same book.
"""

from __future__ import annotations

import html
import re
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET


def log(msg: str) -> None:
    print(f"[make_hpub] {msg}", file=sys.stderr, flush=True)


# ─── EPUB → markdown ────────────────────────────────────────────────────────

# Minimal presentation-MathML → LaTeX. Covers the common STEM-EPUB subset;
# anything weirder falls back to bare text content (still speakable).
def _ml_conv(el) -> str:
    tag = el.tag.split("}")[-1]
    kids = [_ml_conv(c) for c in el]
    tail = el.tail or ""
    out = ""
    if tag in ("math", "mrow", "semantics", "mstyle", "mpadded", "mphantom"):
        out = (el.text or "") + "".join(kids)
    elif tag in ("mi", "mn", "mo", "mtext"):
        out = el.text or ""
    elif tag == "msup" and len(kids) >= 2:
        out = f"{kids[0]}^{{{kids[1]}}}"
    elif tag == "msub" and len(kids) >= 2:
        out = f"{kids[0]}_{{{kids[1]}}}"
    elif tag == "msubsup" and len(kids) >= 3:
        out = f"{kids[0]}_{{{kids[1]}}}^{{{kids[2]}}}"
    elif tag == "mfrac" and len(kids) >= 2:
        out = f"\\frac{{{kids[0]}}}{{{kids[1]}}}"
    elif tag == "msqrt":
        out = f"\\sqrt{{{''.join(kids)}}}"
    elif tag == "mroot" and len(kids) >= 2:
        out = f"\\sqrt[{kids[1]}]{{{kids[0]}}}"
    elif tag == "mfenced":
        out = f"{el.get('open', '(')}{''.join(kids)}{el.get('close', ')')}"
    elif tag == "mtable":
        rows = []
        for row in el:
            cells = [_ml_conv(c) for c in row]
            rows.append(" & ".join(cells))
        out = " \\\\ ".join(rows)
    elif tag in ("mover", "munder", "munderover") and kids:
        out = "".join(kids)  # accents lost; content preserved
    elif tag == "mspace":
        out = " "
    else:
        out = (el.text or "") + "".join(kids)
    return out + tail


def mathml_to_latex(fragment: str) -> str:
    """Best-effort presentation MathML → LaTeX. Never raises."""
    try:
        # html entities are not XML-defined; resolve before parsing.
        cleaned = html.unescape(fragment).replace("&", "&amp;")
        cleaned = re.sub(r"&amp;(#\d+|#x[0-9a-fA-F]+);", r"&#\1;", cleaned)
        root = ET.fromstring(cleaned if "<math" in cleaned else f"<math>{cleaned}</math>")
        body = _ml_conv(root).strip()
        display = 'display="block"' in fragment
        return f"$${body}$$" if display else f"${body}$"
    except Exception:
        text = re.sub(r"<[^>]+>", "", fragment)
        return f"${text.strip()}$" if text.strip() else ""


class _MdHTMLParser(HTMLParser):
    """Streaming HTML→markdown for EPUB chapter files. Handles the tags
    publishers actually use; everything else degrades to text content."""

    def __init__(self, img_map: dict[str, str]):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.img_map = img_map  # zip-internal src -> assets/name
        self._suppress = 0  # inside <style>/<script>
        self._math_depth = 0
        self._math_buf: list[str] = []

    def _emit(self, s: str) -> None:
        if self._math_depth:
            self._math_buf.append(s)
        elif not self._suppress:
            self.out.append(s)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("style", "script"):
            self._suppress += 1
            return
        if self._math_depth:
            attrs_s = "".join(f' {k}="{v}"' for k, v in attrs if v is not None)
            self._math_buf.append(f"<{tag}{attrs_s}>")
            self._math_depth += 1
            return
        if tag == "math":
            self._math_depth = 1
            attrs_s = "".join(f' {k}="{v}"' for k, v in attrs if v is not None)
            self._math_buf = [f"<math{attrs_s}>"]
            return
        if m := re.fullmatch(r"h([1-6])", tag):
            self._emit("\n\n" + "#" * int(m.group(1)) + " ")
        elif tag == "p":
            self._emit("\n\n")
        elif tag == "br":
            self._emit("\n")
        elif tag == "li":
            self._emit("\n- ")
        elif tag == "blockquote":
            self._emit("\n\n> ")
        elif tag in ("em", "i"):
            self._emit("*")
        elif tag in ("strong", "b"):
            self._emit("**")
        elif tag == "img" and a.get("src"):
            name = self.img_map.get(a["src"])
            if name:
                self._emit(f"\n\n![]({name})\n\n")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in ("img", "br"):
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in ("style", "script") and self._suppress:
            self._suppress -= 1
            return
        if self._math_depth:
            self._math_buf.append(f"</{tag}>")
            if tag == "math":
                self._math_depth = 0
                frag = "".join(self._math_buf)
                self._math_buf = []
                self.out.append(mathml_to_latex(frag))
            return
        if re.fullmatch(r"h[1-6]|p|blockquote|ul|ol|table|div|section|article", tag):
            self._emit("\n\n")
        elif tag in ("em", "i"):
            self._emit("*")
        elif tag in ("strong", "b"):
            self._emit("**")

    def handle_data(self, data):
        self._emit(data)

    def result(self) -> str:
        text = "".join(self.out)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def epub_to_markdown(epub_path: str) -> tuple[str, dict[str, bytes], dict]:
    """Returns (markdown, images{assets_name: bytes}, stats)."""
    z = zipfile.ZipFile(epub_path)
    container = ET.fromstring(z.read("META-INF/container.xml"))
    ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
    opf_path = container.find(".//c:rootfile", ns).get("full-path")
    opf_dir = str(PurePosixPath(opf_path).parent)
    if opf_dir == ".":
        opf_dir = ""

    opf = ET.fromstring(z.read(opf_path))
    # Namespaces vary by toolchain; match by local name.
    def lname(el) -> str:
        return el.tag.split("}")[-1]

    manifest: dict[str, tuple[str, str]] = {}
    title = ""
    spine: list[str] = []
    for el in opf.iter():
        ln = lname(el)
        if ln == "item":
            manifest[el.get("id")] = (el.get("href"), el.get("media-type", ""))
        elif ln == "itemref":
            spine.append(el.get("idref"))
        elif ln == "title" and not title:
            title = (el.text or "").strip()

    def resolve(base_doc: str, href: str) -> str:
        base = PurePosixPath(base_doc).parent
        return str(base / href) if str(base) != "." else href

    images: dict[str, bytes] = {}
    md_parts: list[str] = []
    math_spans = 0
    chapters = 0

    for idref in spine:
        item = manifest.get(idref)
        if not item:
            continue
        href, mtype = item
        if "html" not in mtype:
            continue
        doc_path = str(PurePosixPath(opf_dir) / href) if opf_dir else href
        try:
            raw = z.read(doc_path).decode("utf-8", errors="replace")
        except KeyError:
            continue
        chapters += 1

        # Map this document's image refs into the flat assets/ namespace.
        img_map: dict[str, str] = {}
        for src in re.findall(r'<img[^>]+src="([^"]+)"', raw):
            zpath = resolve(doc_path, src)
            try:
                data = z.read(zpath)
            except KeyError:
                continue
            name = f"assets/{PurePosixPath(src).name}"
            img_map[src] = name
            images[name.split("/", 1)[1]] = data

        parser = _MdHTMLParser(img_map)
        parser.feed(raw)
        md = parser.result()
        math_spans += md.count("$")
        if md:
            md_parts.append(md)

    md_text = "\n\n".join(md_parts)
    stats = {
        "title": title,
        "chapters": chapters,
        "chars": len(md_text),
        "math_dollar_chars": math_spans,
        "images": len(images),
    }
    return md_text, images, stats


# ─── PDF geometry → synthetic marker tree ───────────────────────────────────

MATH_CHARS = set("=±×÷∑∏√∫∞≈≠≤≥∈∂∇∝¬∀∃⊂⊃∪∩←→↑↓αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΧΨΩ")

# Blocks that are just a page number / running footer: pure digits or short
# roman numerals carry no narrative value and pollute the pen's anchor space.
_PAGE_NUM_RE = re.compile(r"^[0-9ivxlcdmIVXLCDM]{1,6}$")


def pdf_geometry_tree(pdf_path: str, page_range: list[int] | None = None) -> dict:
    """Per-page typed blocks with PDF-point bboxes, shaped like Marker's JSON
    tree so build_manifest/classify_pages run unchanged. Block ids follow the
    marker convention: /page/<0-based page>/<Type>/<per-type index>."""
    from pdftext.extraction import dictionary_output

    pages = dictionary_output(pdf_path, page_range=page_range, sort=True)

    # Body font size = character-weighted median span size across the book.
    sizes: list[tuple[float, int]] = []
    for p in pages:
        for b in p["blocks"]:
            for ln in b["lines"]:
                for sp in ln["spans"]:
                    t = (sp.get("text") or "").strip()
                    if t:
                        sizes.append((sp["font"]["size"], len(t)))
    sizes.sort()
    half = sum(w for _, w in sizes) / 2 or 1
    acc = 0.0
    body_size = 10.0
    for size, w in sizes:
        acc += w
        if acc >= half:
            body_size = size
            break

    tree_pages = []
    for pno0, p in enumerate(pages):
        blocks = []
        counters: dict[str, int] = {}
        for b in p["blocks"]:
            spans = [sp for ln in b["lines"] for sp in ln["spans"]]
            text = " ".join((sp.get("text") or "") for ln in b["lines"] for sp in ln["spans"])
            text = re.sub(r"\s+", " ", text).strip()
            if not text or _PAGE_NUM_RE.match(text):
                continue
            nchars = len(text) or 1
            avg_size = sum(sp["font"]["size"] * len(sp.get("text") or "") for sp in spans) / max(
                sum(len(sp.get("text") or "") for sp in spans), 1
            )
            alnum = sum(c.isalnum() for c in text)
            math_density = sum(c in MATH_CHARS for c in text) / max(alnum, 1)
            supsub = sum(
                len(sp.get("text") or "")
                for sp in spans
                if sp.get("superscript") or sp.get("subscript")
            ) / nchars

            if avg_size >= body_size * 1.18 and len(text) < 160:
                btype = "SectionHeader"
            elif math_density > 0.12 or supsub > 0.25:
                btype = "Equation"
            else:
                btype = "Text"

            idx = counters.get(btype, 0)
            counters[btype] = idx + 1
            blocks.append(
                {
                    "id": f"/page/{pno0}/{btype}/{idx}",
                    "block_type": btype,
                    "bbox": list(b["bbox"]),
                    "html": html.escape(text),
                }
            )
        tree_pages.append(
            {
                "block_type": "Page",
                "bbox": list(p["bbox"]),
                "children": blocks,
            }
        )
    return {"children": tree_pages, "body_font_size": body_size}


# ─── edition gate ───────────────────────────────────────────────────────────

def edition_check(alignment: list[dict]) -> dict:
    """Are the PDF and EPUB the same book? Fraction of pages that anchored
    with real confidence. Front/back matter may not anchor (covers, ads);
    the body must."""
    content = [p for p in alignment if p["confidence"] > 0]
    strong = [p for p in alignment if p["method"] == "anchored" and p["confidence"] >= 0.5]
    frac = len(strong) / max(len(alignment), 1)
    return {
        "anchored_pages": len(strong),
        "total_pages": len(alignment),
        "anchored_fraction": round(frac, 3),
    }
