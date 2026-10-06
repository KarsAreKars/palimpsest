#!/usr/bin/env python3
"""hellgen — synthesized nasty-PDF generator for the HPUB 2.0 hell corpus.

No reportlab in the venv, so we hand-roll minimal PDF syntax. That is a
feature, not a compromise: the nasty cases ARE about PDF internals —
ToUnicode presence/content, font encodings, xref integrity, content-stream
order — and hand-rolled objects give bit-level control reportlab never would.

Deps: stdlib + Pillow (venv). Generation is instant; no GPU.

Each case builder returns (pdf_bytes, ground_truth, meta):
  ground_truth = {"page_texts": [str per page],   # what a PERFECT reader gets
                  "quotes": [{"page": 1-based, "text": str}, ...]}
The harness re-derives every metric from these — no human ever reads the PDF.
"""
from __future__ import annotations

import io
import json
import random
import tempfile
import zlib
from pathlib import Path

# ─── tiny PDF writer ─────────────────────────────────────────────────────────

class PDF:
    """Objects are raw bytes; xref computed at write time."""

    def __init__(self) -> None:
        # obj 1 = Catalog, obj 2 = Pages — reserved up front so every later
        # object number (and every cross-reference written during build) is stable.
        self.objs: list[bytes | None] = [None, None]

    def add(self, body: str | bytes) -> int:
        if isinstance(body, str):
            body = body.encode("latin-1")
        assert self.objs[0] is not None or len(self.objs) >= 2
        self.objs.append(body)
        return len(self.objs)  # 1-based object number

    def stream(self, dict_entries: str, data: bytes) -> int:
        return self.add(
            f"<< {dict_entries} /Length {len(data)} >>\nstream\n".encode("latin-1")
            + data
            + b"\nendstream"
        )

    def write(self, path: str, corrupt_startxref: bool = False) -> None:
        assert self.objs[0] is not None and self.objs[1] is not None, "finish() not called"
        out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, body in enumerate(self.objs, 1):
            assert body is not None, f"object {i} never written"
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode("latin-1") + body + b"\nendobj\n"
        xref_pos = len(out)
        n = len(self.objs) + 1
        out += f"xref\n0 {n}\n".encode("latin-1")
        out += b"0000000000 65535 f \n"
        for off in offsets:
            out += f"{off:010d} 00000 n \n".encode("latin-1")
        out += (
            f"trailer\n<< /Size {n} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
        ).encode("latin-1")
        if corrupt_startxref:
            # Point startxref at garbage: readers must repair or die loudly (I1),
            # never hang. pypdf (non-strict) rebuilds by scanning.
            out = out.replace(
                f"startxref\n{xref_pos}\n".encode("latin-1"),
                f"startxref\n{max(xref_pos - 137, 17)}\n".encode("latin-1"),
            )
        Path(path).write_bytes(bytes(out))


def escape_lit(s: str) -> str:
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def tounicode_cmap(mapping: dict[int, int], two_byte: bool = True) -> str:
    """mapping: code -> unicode codepoint. Emits Adobe-Identity-UCS CMap."""
    lo, hi = ("<0000>", "<FFFF>") if two_byte else ("<00>", "<FF>")
    items = "".join(
        f"<{c:04X}> <{u:04X}>\n" if two_byte else f"<{c:02X}> <{u:04X}>\n"
        for c, u in sorted(mapping.items())
    )
    return (
        "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
        "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n"
        f"1 begincodespacerange\n{lo} {hi}\nendcodespacerange\n"
        f"{len(mapping)} beginbfchar\n{items}endbfchar\n"
        "endcmap CMapName currentdict /CMap defineresource pop end end"
    )


# ─── fonts ───────────────────────────────────────────────────────────────────

def simple_font(pdf: PDF, base: str = "Helvetica", encoding: str | None = None) -> int:
    enc = f" /Encoding /{encoding}" if encoding else ""
    return pdf.add(f"<< /Type /Font /Subtype /Type1 /BaseFont /{base}{enc} >>")


def cid_font(
    pdf: PDF,
    tounicode: dict[int, int] | None,
    base: str = "AAAAAA+HelvSub",
) -> int:
    """Type0 / Identity-H font, CIDToGIDMap Identity. tounicode=None omits the
    CMap entirely (subset font that never shipped one — the R2 lie)."""
    fd = pdf.add(
        f"<< /Type /FontDescriptor /FontName /{base} /Flags 4 "
        "/FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 "
        "/CapHeight 700 /StemV 80 >>"
    )
    cid = pdf.add(
        f"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{base} /DW 600 "
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
        f"/FontDescriptor {fd} 0 R /CIDToGIDMap /Identity >>"
    )
    tu = ""
    if tounicode is not None:
        cmap_ref = pdf.stream("", tounicode_cmap(tounicode).encode("latin-1"))
        tu = f" /ToUnicode {cmap_ref} 0 R"
    return pdf.add(
        f"<< /Type /Font /Subtype /Type0 /BaseFont /{base} /Encoding /Identity-H "
        f"/DescendantFonts [{cid} 0 R]{tu} >>"
    )


def page(
    pdf: PDF,
    kids: list[int],
    width: float,
    height: float,
    contents: int,
    resources: str,
    rotate: int | None = None,
) -> int:
    rot = f" /Rotate {rotate}" if rotate else ""
    return pdf.add(
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
        f"/Resources {resources} /Contents {contents} 0 R{rot} >>"
    )


def finish(pdf: PDF, kids: list[int]) -> bytes:
    pdf.objs[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kids_s = " ".join(f"{k} 0 R" for k in kids)
    pdf.objs[1] = f"<< /Type /Pages /Kids [{kids_s}] /Count {len(kids)} >>".encode("latin-1")
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
        tmp = tf.name
    try:
        pdf.write(tmp)
        return Path(tmp).read_bytes()
    finally:
        Path(tmp).unlink(missing_ok=True)


# ─── prose source (deterministic, distinctive shingles) ──────────────────────

WORDS = (
    "anchor matrix lantern compass bracket violin orchard plateau glacier "
    "theorem furnace cider vector hammock prudence quotient marble nutmeg "
    "sprocket talisman vineyard whisper calculus ember kazoo lanternhorn "
    "buckwheat prism quorum sigil trundle warp yonder zephyr quill harbinger "
    "obsidian parchment rucksack fiddlehead glockenspiel hinterland juniper"
).split()


def make_prose(rng: random.Random, n_pages: int, lines_per_page: int = 28) -> list[list[str]]:
    """Distinctive pseudo-prose: every sentence unique (index-dotted) so the
    anchor index never confuses two pages (the Almanack divider failure)."""
    pages: list[list[str]] = []
    for p in range(n_pages):
        lines = []
        for li in range(lines_per_page):
            w = rng.sample(WORDS, 9)
            sent = f"Page {p + 1} line {li + 1}: " + " ".join(w[:4]) + " " + " ".join(w[4:]) + "."
            lines.append(sent)
        pages.append(lines)
    return pages


def truth_from_pages(pages: list[list[str]]) -> dict:
    return {
        "page_texts": ["\n".join(ls) for ls in pages],
        "quotes": [
            {"page": i + 1, "text": ls[5]} for i, ls in enumerate(pages) if len(ls) > 5
        ],
    }


# ─── case builders ───────────────────────────────────────────────────────────

def build_sanity(rng):
    pdf = PDF()
    f1 = simple_font(pdf)
    kids, pages = [], make_prose(rng, 5)
    for lines in pages:
        stream = "BT /F1 11 Tf 72 740 Td 14 TL\n" + "\n".join(
            f"({escape_lit(l)}) Tj T*" for l in lines
        ) + "\nET"
        c = pdf.stream("", stream.encode("latin-1"))
        kids.append(page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>"))
    return finish(pdf, kids), truth_from_pages(pages), {}


def build_rotated(rng):
    """Rotated page: /Rotate 90, content written unrotated. Extraction must
    still yield the text (rotation handled by the reader)."""
    pdf = PDF()
    f1 = simple_font(pdf)
    kids, pages = [], make_prose(rng, 4)
    for lines in pages:
        stream = "BT /F1 11 Tf 72 520 Td 14 TL\n" + "\n".join(
            f"({escape_lit(l)}) Tj T*" for l in lines
        ) + "\nET"
        c = pdf.stream("", stream.encode("latin-1"))
        kids.append(
            page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>", rotate=90)
        )
    return finish(pdf, kids), truth_from_pages(pages), {}


def build_lying_cmap(rng):
    """R2 exactly: glyph ids are correct in the embedded font, but ToUnicode
    maps every glyph to a DIFFERENT plausible letter. pypdf extracts clean,
    grammatical-looking garbage. A perfect pipeline detects the lie (anchor
    votes collapse); a naive one ships scrambled text."""
    pdf = PDF()
    pages = make_prose(rng, 5)
    letters = "abcdefghijklmnopqrstuvwxyz"
    code_of, cmap = {}, {}
    code = 1
    for ch in set("".join("".join(ls) for ls in pages).lower()):
        if ch.isalnum():
            code_of[ch] = code
            cmap[code] = ord(letters[(code * 7 + 3) % 26])  # deterministic lie
            code += 1
    f1 = cid_font(pdf, cmap)
    kids = []
    for lines in pages:
        hexlines = []
        for l in lines:
            codes = "".join(
                f"{code_of.get(ch.lower(), code_of.get('z')):04X}" for ch in l
            )
            hexlines.append(f"<{codes}> Tj T*")
        stream = "BT /F1 11 Tf 72 740 Td 14 TL\n" + "\n".join(hexlines) + "\nET"
        c = pdf.stream("", stream.encode("latin-1"))
        kids.append(page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>"))
    return finish(pdf, kids), truth_from_pages(pages), {}


def build_no_tounicode(rng):
    """Subset font, NO ToUnicode CMap at all. pypdf gets nothing; the page
    looks like a scan to naive coverage even though it renders as prose."""
    pdf = PDF()
    pages = make_prose(rng, 4)
    code_of = {}
    code = 1
    for ch in set("".join("".join(ls) for ls in pages).lower()):
        if ch.isalnum():
            code_of[ch] = code
            code += 1
    f1 = cid_font(pdf, None)
    kids = []
    for lines in pages:
        hexlines = [
            "<" + "".join(f"{code_of.get(ch.lower(), 1):04X}" for ch in l) + "> Tj T*"
            for l in lines
        ]
        stream = "BT /F1 11 Tf 72 740 Td 14 TL\n" + "\n".join(hexlines) + "\nET"
        c = pdf.stream("", stream.encode("latin-1"))
        kids.append(page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>"))
    return finish(pdf, kids), truth_from_pages(pages), {}


def build_pua_mapped(rng):
    """ToUnicode maps every glyph into U+E000..U+F8FF. Extraction 'succeeds'
    with private-use chars — _glyph_garbage ground truth for the fastpath."""
    pdf = PDF()
    pages = make_prose(rng, 4)
    code_of, cmap = {}, {}
    code = 1
    for ch in set("".join("".join(ls) for ls in pages).lower()):
        if ch.isalnum():
            code_of[ch] = code
            cmap[code] = 0xE000 + code  # PUA lie
            code += 1
    f1 = cid_font(pdf, cmap)
    kids = []
    for lines in pages:
        hexlines = [
            "<" + "".join(f"{code_of.get(ch.lower(), 1):04X}" for ch in l) + "> Tj T*"
            for l in lines
        ]
        stream = "BT /F1 11 Tf 72 740 Td 14 TL\n" + "\n".join(hexlines) + "\nET"
        c = pdf.stream("", stream.encode("latin-1"))
        kids.append(page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>"))
    return finish(pdf, kids), truth_from_pages(pages), {}


def build_ligature_heavy(rng):
    """MacRoman Helvetica: 0xDE=fi, 0xDF=fl baked into the text layer. Tests
    the _LIGATURES translation on both alignment and containment."""
    pdf = PDF()
    f1 = simple_font(pdf, encoding="MacRomanEncoding")
    kids, pages = [], make_prose(rng, 3)
    lig = lambda s: s.replace("fi", "\xde").replace("fl", "\xdf")
    for lines in pages:
        stream = "BT /F1 11 Tf 72 740 Td 14 TL\n" + "\n".join(
            f"({escape_lit(lig(l))}) Tj T*" for l in lines
        ) + "\nET"
        c = pdf.stream("", stream.encode("latin-1"))
        kids.append(page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>"))
    truth = truth_from_pages(pages)
    truth["ligatures_in_text_layer"] = True
    return finish(pdf, kids), truth, {}


def build_two_column_interleaved(rng):
    """Two columns, content stream emits row-interleaved (L1 R1 L2 R2 …).
    pdftext plain extraction returns scrambled word order — anchoring and
    containment must survive or the gate must reject honestly."""
    pdf = PDF()
    f1 = simple_font(pdf)
    kids, pages = [], make_prose(rng, 4)
    for lines in pages:
        left, right = lines[::2], lines[1::2]
        ops = ["BT /F1 9 Tf"]
        y = 740.0
        for i in range(max(len(left), len(right))):
            if i < len(left):
                ops.append(f"1 0 0 1 60 {y} Tm ({escape_lit(left[i])}) Tj")
            if i < len(right):
                ops.append(f"1 0 0 1 320 {y} Tm ({escape_lit(right[i])}) Tj")
            y -= 12
        ops.append("ET")
        c = pdf.stream("", "\n".join(ops).encode("latin-1"))
        kids.append(page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>"))
    return finish(pdf, kids), truth_from_pages(pages), {}


def _page_image(pages_lines: list[list[str]]):
    """Render synthetic page(s) to JPEG via PIL — the scanned simulator."""
    from PIL import Image, ImageDraw

    out = []
    for lines in pages_lines:
        img = Image.new("RGB", (1275, 1650), "white")  # 150 dpi A4
        d = ImageDraw.Draw(img)
        y = 120
        for l in lines:
            d.text((110, y), l, fill="black")
            y += 44
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        out.append(buf.getvalue())
    return out


def build_scanned(rng):
    """Pure scan: every page is a full-page JPEG, zero text operators."""
    pdf = PDF()
    kids, pages = [], make_prose(rng, 4)
    for jpeg in _page_image(pages):
        img = pdf.stream(
            "/Type /XObject /Subtype /Image /Width 1275 /Height 1650 "
            "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
            jpeg,
        )
        stream = b"q 612 0 0 792 0 0 cm /Im0 Do Q"
        c = pdf.stream("", stream)
        kids.append(
            page(pdf, kids, 612, 792, c, f"<< /XObject << /Im0 {img} 0 R >> >>")
        )
    return finish(pdf, kids), truth_from_pages(pages), {}


def build_hybrid(rng):
    """Half digital text, half scan-image (alternating). I2 test: one kind of
    page must not fail the other; per-page provenance required."""
    pdf = PDF()
    f1 = simple_font(pdf)
    kids, pages = [], make_prose(rng, 6)
    jpegs = _page_image(pages)
    for i, lines in enumerate(pages):
        if i % 2 == 1:
            img = pdf.stream(
                "/Type /XObject /Subtype /Image /Width 1275 /Height 1650 "
                "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
                jpegs[i],
            )
            c = pdf.stream("", b"q 612 0 0 792 0 0 cm /Im0 Do Q")
            kids.append(
                page(pdf, kids, 612, 792, c, f"<< /XObject << /Im0 {img} 0 R >> >>")
            )
        else:
            stream = "BT /F1 11 Tf 72 740 Td 14 TL\n" + "\n".join(
                f"({escape_lit(l)}) Tj T*" for l in lines
            ) + "\nET"
            c = pdf.stream("", stream.encode("latin-1"))
            kids.append(
                page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>")
            )
    return finish(pdf, kids), truth_from_pages(pages), {}


def build_broken_xref(rng):
    """Valid 3-page prose PDF whose startxref points at garbage. Reader must
    repair (pypdf non-strict) or die loudly — never hang (I1)."""
    pdf = PDF()
    f1 = simple_font(pdf)
    kids, pages = [], make_prose(rng, 3)
    for lines in pages:
        stream = "BT /F1 11 Tf 72 740 Td 14 TL\n" + "\n".join(
            f"({escape_lit(l)}) Tj T*" for l in lines
        ) + "\nET"
        c = pdf.stream("", stream.encode("latin-1"))
        kids.append(page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>"))
    data = finish(pdf, kids)
    marker = f"startxref\n".encode()
    idx = data.rindex(marker) + len(marker)
    eol = data.index(b"\n", idx)
    data = data[:idx] + b"99" + data[eol:]
    return data, truth_from_pages(pages), {}


def build_extreme_short(rng):
    return build_sanity(rng)  # 5 pages — same code path, tiny input


def build_extreme_long(rng):
    """1500 pages of plain prose. Generator-side this is instant (zlib
    compresses repetitive content). The runner enforces a wall-clock
    budget scaled to page count (I1)."""
    pdf = PDF()
    f1 = simple_font(pdf)
    kids, pages = [], make_prose(rng, 1500, lines_per_page=8)
    for lines in pages:
        stream = "BT /F1 11 Tf 72 740 Td 14 TL\n" + "\n".join(
            f"({escape_lit(l)}) Tj T*" for l in lines
        ) + "\nET"
        c = pdf.stream("/Filter /FlateDecode", zlib.compress(stream.encode("latin-1")))
        kids.append(page(pdf, kids, 612, 792, c, f"<< /Font << /F1 {f1} 0 R >> >>"))
    return finish(pdf, kids), truth_from_pages(pages), {}


CASES = {
    "sanity-5p": (build_sanity, {"tier": "T1", "receipt": None,
        "expect": {"exit_in": [0], "min_anchored_fraction": 0.9,
                   "grounding": {"tolerance_pages": 0}}}),
    "rotated-4p": (build_rotated, {"tier": "T1", "receipt": None,
        "expect": {"exit_in": [0], "min_anchored_fraction": 0.9,
                   "grounding": {"tolerance_pages": 0}}}),
    "lying-cmap-5p": (build_lying_cmap, {"tier": "T2", "receipt": "R2",
        "expect": {"exit_in": [2, 3],  # must NOT ship ok (status 0) today;
                   "note": "T2 goal: detect lie -> VLM rescue -> ok with provenance=vlm"}}),
    "no-tounicode-4p": (build_no_tounicode, {"tier": "T2", "receipt": "R2",
        "expect": {"exit_in": [2, 3]}}),
    "pua-mapped-4p": (build_pua_mapped, {"tier": "T2", "receipt": "R2",
        "expect": {"exit_in": [2, 3, 0],
                   "max_pua_chars": 0 if False else None,
                   "note": "if ok: report.quality.pua_chars must be 0 (VLM rescued); else loud reject"}}),
    "ligature-3p": (build_ligature_heavy, {"tier": "T2", "receipt": None,
        "expect": {"exit_in": [0], "min_anchored_fraction": 0.9,
                   "grounding": {"tolerance_pages": 0}}}),
    "two-column-interleaved-4p": (build_two_column_interleaved, {"tier": "T2", "receipt": None,
        "expect": {"exit_in": [0, 3],
                   "note": "0 if layout engine recovers column order; 3 (honest reject) acceptable, 0-with-garbage is NOT"}}),
    "scanned-4p": (build_scanned, {"tier": "T3", "receipt": "R4",
        "expect": {"exit_in": [2],  # today: coverage rejection — must be FAST and SPECIFIC
                   "note": "T3 goal: OCR rescue lane -> ok; until then assert reason=scanned + no hang"}}),
    "hybrid-6p": (build_hybrid, {"tier": "T3", "receipt": "R4/I2",
        "expect": {"exit_in": [2],
                   "note": "T3: text pages survive + scan pages get provenance=ocr; today: scanned reject listing text pages"}}),
    "broken-xref-3p": (build_broken_xref, {"tier": "T1", "receipt": "I1",
        "expect": {"exit_in": [0, 1], "max_wall_s": 120}}),
    "extreme-short-5p": (build_extreme_short, {"tier": "T1", "receipt": None,
        "expect": {"exit_in": [0]}}),
    "extreme-long-1500p": (build_extreme_long, {"tier": "T1", "receipt": "I1",
        "expect": {"exit_in": [0], "timeout_s": 3600,
                   # bounded per-page time (K5/r4 §4): budget = a·pages + b,
                   # a calibrated from the sanity full-lane run (~0.7 s/page
                   # extraction + ~2 s fixed) with ~2.5x headroom for the
                   # 200-page chunk reload overhead (K5).
                   "per_page_wall": {"s_per_page": 2.0, "fixed_s": 180},
                   "note": "nightly tier: asserts bounded time per page, not absolute green"}}),
}


def generate(case: str, out_dir: Path, seed: int = 42) -> None:
    builder, meta = CASES[case]
    rng = random.Random(f"{seed}-{case}")
    pdf_bytes, truth, _ = builder(rng)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "case.pdf").write_bytes(pdf_bytes)
    (out_dir / "case.json").write_text(json.dumps({"case": case, **meta}, indent=2))
    (out_dir / "ground_truth.json").write_text(json.dumps(truth, indent=2))


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("case", choices=sorted(CASES) + ["all"])
    ap.add_argument(
        "--corpus-root",
        default=str(Path(__file__).resolve().parent / "corpus"),
    )
    args = ap.parse_args()
    names = sorted(CASES) if args.case == "all" else [args.case]
    for name in names:
        generate(name, Path(args.corpus_root) / name)
        print(f"generated {name}")
