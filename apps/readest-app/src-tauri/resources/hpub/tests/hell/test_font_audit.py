#!/usr/bin/env python3
"""T2.2 unit test (Ruling 3, receipt R2 / r5 evidence E2): the deterministic
font-cmap audit — the only detector that catches a lying ToUnicode map in
both directions (reject-good AND ship-garbage), with no model and no deps.

Fixtures are generated with hellgen's own builders (deterministic, seed 42):
  lying-cmap-5p  — Type0 font whose ToUnicode maps ~54% of codes to shared
                   letters (a manufactured lie). EVERY page must be flagged.
  sanity-5p      — plain Helvetica Type1, standard encoding. ZERO flags
                   (a clean prose book must never be routed to the VLM).
  no-tounicode-4p — CID font with no ToUnicode at all. EVERY page flagged.

Run:  python -m unittest test_font_audit -v   (from this directory)
"""
from __future__ import annotations

import io
import random
import sys
import tempfile
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parents[1]))  # resources/hpub
sys.path.insert(0, str(_HERE))  # hellgen

import hellgen  # noqa: E402
import make_hpub  # noqa: E402


def _build(case: str, tmp: Path) -> Path:
    builder, _meta = hellgen.CASES[case]
    rng = random.Random(f"42-{case}")
    pdf_bytes, _truth, _ = builder(rng)
    p = tmp / f"{case}.pdf"
    p.write_bytes(pdf_bytes)
    return p


class TestFontCmapAudit(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_lying_cmap_flags_exactly_the_lying_pages(self) -> None:
        """Every page of lying-cmap-5p uses the lying CID font -> all 5
        flagged, and the reason names the many-to-one ToUnicode map."""
        pdf = _build("lying-cmap-5p", self.tmp)
        lying = make_hpub.font_cmap_audit(str(pdf))
        self.assertEqual(sorted(lying), [0, 1, 2, 3, 4])
        for reasons in lying.values():
            self.assertTrue(any("ToUnicode" in r for r in reasons), reasons)

    def test_sanity_has_zero_false_flags(self) -> None:
        """Plain Helvetica + standard encoding is trustworthy — a clean
        prose book must not pay one second of VLM decode (r4 tuning)."""
        pdf = _build("sanity-5p", self.tmp)
        self.assertEqual(make_hpub.font_cmap_audit(str(pdf)), {})

    def test_missing_tounicode_is_flagged(self) -> None:
        pdf = _build("no-tounicode-4p", self.tmp)
        lying = make_hpub.font_cmap_audit(str(pdf))
        self.assertEqual(sorted(lying), [0, 1, 2, 3])
        for reasons in lying.values():
            self.assertTrue(any("ToUnicode" in r for r in reasons), reasons)

    def test_collision_fraction_threshold(self) -> None:
        """The lie detector is the collision fraction of the ToUnicode map:
        injective maps (even into the PUA — pua-mapped is caught by the
        glyph-garbage flag, not here) are trusted; >=half the codes mapping
        to shared targets is a manufactured map."""
        pdf = _build("pua-mapped-4p", self.tmp)
        self.assertEqual(make_hpub.font_cmap_audit(str(pdf)), {})


class TestToUnicodeParsing(unittest.TestCase):
    def _stream(self, cmap_text: str):
        class _S:
            def get_object(self):
                class _O:
                    def get_data(self):
                        return cmap_text.encode("latin-1")

                return _O()

        return _S()

    def _cmap(self, pairs: list[tuple[int, int]]) -> str:
        items = "".join(f"<{c:04X}> <{u:04X}>\n" for c, u in pairs)
        return (
            "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
            "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
            f"{len(pairs)} beginbfchar\n{items}endbfchar\n"
            "endcmap end end"
        )

    def test_injective_map_is_trusted(self) -> None:
        targets = make_hpub._tounicode_codepoints(
            self._stream(self._cmap([(i, 0x4E00 + i) for i in range(1, 30)]))
        )
        self.assertEqual(len(targets), 29)
        self.assertLess(make_hpub._cmap_lying_fraction(targets), 0.5)

    def test_manufactured_map_detected(self) -> None:
        # 30 codes onto 12 shared targets (a letter-shuffle lie)
        pairs = [(i, 0x61 + (i * 7 + 3) % 12) for i in range(1, 31)]
        targets = make_hpub._tounicode_codepoints(self._stream(self._cmap(pairs)))
        self.assertGreaterEqual(make_hpub._cmap_lying_fraction(targets), 0.5)

    def test_bfrange_parsed(self) -> None:
        cmap = (
            "/CIDInit begin begincmap\n"
            "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
            "1 beginbfrange\n<0001> <000A> <4E00>\nendbfrange\n"
            "endcmap end"
        )
        targets = make_hpub._tounicode_codepoints(self._stream(cmap))
        self.assertEqual(targets, list(range(0x4E00, 0x4E0A)))

    def test_tiny_maps_are_not_judged(self) -> None:
        """<8 mapped codes: collision stats are noise — trust rather than
        flag (a real footnote font may legitimately map two codes to 'x')."""
        targets = make_hpub._tounicode_codepoints(
            self._stream(self._cmap([(1, 0x61), (2, 0x61), (3, 0x62)]))
        )
        self.assertEqual(make_hpub._cmap_lying_fraction(targets), 0.0)


class TestShippedFontLieCheck(unittest.TestCase):
    """E2, ship-garbage direction: a page whose fonts lie AND whose lying
    text is still in the shipped md window must be caught (reason names the
    font). A page whose lying text was replaced by recovered provider text
    (VLM rescue) must NOT be caught."""

    def _alignment(self, n: int, start: int = 0) -> list[dict]:
        return [
            {"page": i + 1, "md_char_start": start, "md_char_end": 10_000,
             "confidence": 0.9, "method": "anchored"}
            for i in range(n)
        ]

    def test_lie_still_in_md_is_caught(self) -> None:
        lying_page = "uirkataxvmkataalzqakfkioaakufjp scrambledletters " * 4
        md = "clean heading\n\n" + lying_page
        font_lies = {0: ["AAAAAA+HelvSub: ToUnicode maps 54% of codes to shared chars (manufactured/lie)"]}
        shipped = make_hpub.shipped_font_lies(font_lies, [lying_page], self._alignment(1), md)
        self.assertEqual(list(shipped), [1])  # 1-based page

    def test_rescued_page_is_not_caught(self) -> None:
        """VLM rescue: the provider text (real prose) replaced the lie in
        md -> the lying page text no longer matches the window."""
        lying_page = "uirkataxvmkataalzqakfkioaakufjp scrambledletters " * 4
        md = "clean heading\n\nThe actual printed prose of the page, recovered by the VLM lane."
        font_lies = {0: ["AAAAAA+HelvSub: ToUnicode maps 54% of codes to shared chars (manufactured/lie)"]}
        shipped = make_hpub.shipped_font_lies(font_lies, [lying_page], self._alignment(1), md)
        self.assertEqual(shipped, {})

    def test_unanchored_page_is_not_caught(self) -> None:
        """No md window = the lie cannot be in the shipped text via the
        alignment — leave it to the backstop/drift rules."""
        lying_page = "uirkataxvmkataalzqakfkioaakufjp" * 4
        font_lies = {0: ["F: lie"]}
        al = [{"page": 1, "md_char_start": None, "md_char_end": None,
               "confidence": 0.0, "method": "unmatched"}]
        self.assertEqual(make_hpub.shipped_font_lies(font_lies, [lying_page], al, "clean md"), {})


if __name__ == "__main__":
    unittest.main()
