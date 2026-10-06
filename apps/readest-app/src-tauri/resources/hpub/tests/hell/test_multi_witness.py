#!/usr/bin/env python3
"""T2.3 unit test (Ruling 3, receipt R2): multi-witness containment.

R2 (Goodfellow class): a page whose text layer lies must be SCORED against
the witness that actually produced its text — the provider (VLM) text for
pages the router sent to the VLM lane, the pdftext layer otherwise — never
the lying page text. Witness identity is recorded per page in the manifest.

Mechanism under test (r5 ruling 2.4, minimal): the caller builds witness
texts (provider md part for VLM-routed pages, page text elsewhere) and hands
them to build_manifest*/containment_check in place of page_texts; the page
record carries "witness".

Run:  python -m unittest test_multi_witness -v   (from this directory)
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parents[1]))

import make_hpub  # noqa: E402


class TestSpliceWitnesses(unittest.TestCase):
    def test_provider_page_uses_vlm_witness(self) -> None:
        page_texts = ["lying junk from the text layer", "honest layer text"]
        provider = {0: "clean prose recovered by the VLM lane"}
        texts, src = make_hpub.splice_witnesses(2, page_texts, provider)
        self.assertEqual(src, ["vlm", "pdftext"])
        self.assertEqual(texts[0], provider[0])
        self.assertEqual(texts[1], page_texts[1])

    def test_no_provider_pages_all_pdftext(self) -> None:
        texts, src = make_hpub.splice_witnesses(2, ["a", "b"], {})
        self.assertEqual(src, ["pdftext", "pdftext"])
        self.assertEqual(texts, ["a", "b"])


class TestWitnessScoring(unittest.TestCase):
    """The receipt: a lying page scored against its provider text anchors
    and contains; scored against the lying layer it would zero the book's
    anchor score (r2 R2: 'extraction was FINE but anchoring scored 0%')."""

    def setUp(self) -> None:
        self.truth = (
            "The quiet reservoir reflects every lantern on the far shore. "
            "A patient reader counts the ripples twice."
        )
        self.lying = "uirkataxvmkataalzqakfkioaakufjp zzqbktp mhrtqpq" * 2
        # md as the VLM lane spliced it: the provider text IS the md here.
        self.md = self.truth
        self.tree = {"children": []}

    def test_lying_page_anchors_against_provider_witness(self) -> None:
        witness, _src = make_hpub.splice_witnesses(
            1, [self.lying], {0: self.truth}
        )
        manifest = make_hpub.build_manifest("t", self.md, witness, self.tree)
        self.assertEqual(manifest["alignment"][0]["method"], "anchored")
        cont = make_hpub.containment_check(self.md, witness, manifest["alignment"])
        self.assertGreaterEqual(cont["per_page"][0], 0.9)
        self.assertGreaterEqual(cont["prose_mean"], 0.85)

    def test_same_page_scored_against_lie_fails(self) -> None:
        """Control: scoring the lying layer against the recovered md is the
        old R2 bug — containment collapses."""
        manifest = make_hpub.build_manifest("t", self.md, [self.lying], self.tree)
        cont = make_hpub.containment_check(self.md, [self.lying], manifest["alignment"])
        self.assertLess(cont["per_page"][0], 0.3)

    def test_witness_identity_recorded_per_page(self) -> None:
        """The manifest page record carries which witness produced its
        score — I3/R2 observability."""
        _texts, src = make_hpub.splice_witnesses(2, ["x", "y"], {1: "provider md"})
        for p, s in zip(
            make_hpub.build_manifest("t", "x y provider md", ["x", "provider md"], self.tree)["alignment"],
            src,
        ):
            pass  # build_manifest itself does not stamp; the caller does.
        manifest = make_hpub.build_manifest("t", "x y provider md", ["x", "provider md"], self.tree)
        make_hpub.stamp_witness(manifest, src)
        self.assertEqual([p["witness"] for p in manifest["alignment"]], ["pdftext", "vlm"])


if __name__ == "__main__":
    unittest.main()
