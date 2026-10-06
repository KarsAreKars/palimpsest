#!/usr/bin/env python3
"""T2.4 unit test (Ruling 3, invariant I3): splice-time provenance spans.

Ruling 1.3 (binding): the manifest gains a `spans` array — every span
{page, md_char_start, md_char_end, source: pdftext|vlm|ocr|epub,
confidence}. In the hybrid lane the source is known at splice time for
free (r2 steal #1); shingle alignment stays the offset authority, so
content.md stays byte-identical and NO inline tags ever appear in it
(Ruling 4.3 — offsets must stay valid).

Run:  python -m unittest test_provenance_spans -v   (from this directory)
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parents[1]))

import make_hpub  # noqa: E402


class TestSpliceSpans(unittest.TestCase):
    def test_offsets_are_exact_and_reconstruct_the_md(self) -> None:
        """build_splice_spans is the inverse of the md join: concatenating
        spans (with the '\\n\\n' separators) must reproduce the md exactly —
        every offset valid, no drift, no inline tags needed."""
        parts = [
            (0, "pdftext", "First page prose."),
            (1, "vlm", "Recovered page text."),
            (2, "pdftext", ""),  # empty part: dropped, no span
            (3, "vlm", "Third page."),
        ]
        spans, md = make_hpub.build_splice_spans(parts)
        self.assertEqual(md, "First page prose.\n\nRecovered page text.\n\nThird page.")
        self.assertEqual(len(spans), 3)
        recon = "\n\n".join(md[s["md_char_start"] : s["md_char_end"]] for s in spans)
        self.assertEqual(recon, md)
        for s in spans:
            self.assertTrue(0 <= s["md_char_start"] < s["md_char_end"] <= len(md))

    def test_sources_recorded_per_span(self) -> None:
        parts = [(0, "pdftext", "a"), (1, "vlm", "b"), (2, "pdftext", "c")]
        spans, _ = make_hpub.build_splice_spans(parts)
        self.assertEqual([s["source"] for s in spans], ["pdftext", "vlm", "pdftext"])
        self.assertEqual([s["page"] for s in spans], [1, 2, 3])

    def test_spans_carry_alignment_confidence(self) -> None:
        """Confidence comes from the offset authority (the alignment), not
        from splice time (which knows position, not quality)."""
        parts = [(0, "pdftext", "alpha"), (1, "vlm", "beta")]
        spans, md = make_hpub.build_splice_spans(parts)
        manifest = {
            "alignment": [
                {"page": 1, "md_char_start": 0, "md_char_end": 5,
                 "confidence": 0.97, "method": "anchored"},
                {"page": 2, "md_char_start": 7, "md_char_end": 12,
                 "confidence": 0.88, "method": "anchored"},
            ]
        }
        make_hpub.attach_span_confidence(spans, manifest)
        self.assertEqual([s["confidence"] for s in spans], [0.97, 0.88])


class TestAlignmentDerivedSpans(unittest.TestCase):
    """Lanes without splice-time parts (full marker, fusion): spans derive
    from the alignment windows — same shape, source from the witness."""

    def test_full_lane_spans_track_alignment(self) -> None:
        manifest = {
            "alignment": [
                {"page": 1, "md_char_start": 0, "md_char_end": 50,
                 "confidence": 0.9, "method": "anchored"},
                {"page": 2, "md_char_start": None, "md_char_end": None,
                 "confidence": 0.0, "method": "unmatched"},
                {"page": 3, "md_char_start": 60, "md_char_end": 99,
                 "confidence": 0.8, "method": "anchored"},
            ]
        }
        spans = make_hpub.alignment_spans(manifest, ["pdftext", "pdftext", "pdftext"])
        self.assertEqual(len(spans), 2)  # unanchored page has no window
        self.assertEqual(spans[0]["source"], "pdftext")
        self.assertEqual((spans[0]["md_char_start"], spans[0]["md_char_end"]), (0, 50))


if __name__ == "__main__":
    unittest.main()
