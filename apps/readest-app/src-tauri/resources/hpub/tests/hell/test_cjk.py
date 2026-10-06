#!/usr/bin/env python3
"""T2.5 unit test (King ruling K1, r1 P18): script-aware tokenization.

CJK text previously produced ZERO tokens ([a-z0-9]+ only) — every CJK book
died at the alignment backstop (anchored 0%) or the coverage check (CJK
chars stripped by [^a-z0-9]) before the gate ever saw it. K1: CJK
ideographs/kana/hangul/fullwidth forms are tokens in their own right.

Run:  python -m unittest test_cjk -v   (from this directory)
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parents[1]))

import make_hpub  # noqa: E402

JP = "静かな貯水池は岸の灯りをすべて映す"  # "The quiet reservoir reflects every shore light"
JP_PAGE = (
    "第1頁 行1：静かな貯水池は岸の灯りをすべて映す。読者は波紋を二度数える。"
)


class TestScriptAwareTokenizers(unittest.TestCase):
    def test_norm_tokens_treats_cjk_chars_as_tokens(self) -> None:
        toks, offs = make_hpub.norm_tokens_with_offsets(f"prefix {JP} suffix")
        self.assertEqual(toks[0], "prefix")
        self.assertEqual(toks[-1], "suffix")
        cjk_toks = toks[1:-1]
        self.assertEqual(len(cjk_toks), len(JP))  # one token per CJK char
        self.assertEqual("".join(cjk_toks), JP)
        # offsets point back into the original string
        src = f"prefix {JP} suffix"
        for t, o in zip(cjk_toks, offs[1:-1]):
            self.assertEqual(src[o : o + len(t)], t)

    def test_pure_ascii_tokenization_unchanged(self) -> None:
        """K1 must not perturb the tuned Latin path (sanity golden)."""
        toks, offs = make_hpub.norm_tokens_with_offsets("Anchor matrix 42 lanterns.")
        self.assertEqual(toks, ["anchor", "matrix", "42", "lanterns"])

    def test_containment_tokens_include_cjk(self) -> None:
        toks = make_hpub.containment_tokens(JP_PAGE, is_md=False)
        self.assertIn("静", toks)
        self.assertIn("貯", toks)
        # Single-char tokens = 17 content-script CJK chars in the page
        # (ideographs — kana/punctuation are intentionally not gate tokens)
        # + the two '1' digits in '第1頁 行1：'. The pre-implementation
        # expectation (len(JP)-1+JP.count('貯') == 17) forgot the digits.
        self.assertEqual(len([t for t in toks if len(t) == 1]), 19)

    def test_cjk_page_anchors_and_contains(self) -> None:
        """P18 receipt: a CJK page anchors against a CJK md window and the
        containment gate scores it like prose (would be 0 tokens before K1).
        """
        md = JP_PAGE
        manifest = make_hpub.build_manifest("t", md, [JP_PAGE], {"children": []})
        self.assertEqual(manifest["alignment"][0]["method"], "anchored")
        cont = make_hpub.containment_check(md, [JP_PAGE], manifest["alignment"])
        self.assertGreaterEqual(cont["per_page"][0], 0.85)
        self.assertGreaterEqual(cont["prose_mean"], 0.85)

    def test_coverage_counts_cjk_as_text(self) -> None:
        """r1 P18: the coverage probe stripped CJK to zero chars, so a CJK
        book read as 'scanned' and died exit 2 before alignment."""
        self.assertGreaterEqual(make_hpub._text_layer_chars(JP_PAGE), 20)
        self.assertGreaterEqual(
            make_hpub._text_layer_chars("only twenty latin characters 12345"), 20
        )


if __name__ == "__main__":
    unittest.main()
