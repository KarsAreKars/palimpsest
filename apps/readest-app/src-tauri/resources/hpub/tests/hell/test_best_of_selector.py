#!/usr/bin/env python3
"""T2.1 unit test (Ruling 3, receipt R3 / r5 evidence E1): the best-of
selector and the E1 backstop fix.

Selector (R3/I4): token and char manifests are BOTH built and scored
(anchored_fraction x containment prose_mean); the MAX wins — never the
last-run lane. P26 fixture shape: token 0.45/cont 0.93 vs char
0.52/cont 0.61 — the 0.93 manifest wins.

Backstop (E1): gate_book must count the SELECTED manifest's anchored +
anchored-chars pages. Today it counts only method == "anchored", so a
char-fallback book (every method "anchored-chars") scores 0 anchored and
is unconditionally rejected — the dead-fallback bug.

Run:  python -m unittest test_best_of_selector -v   (from this directory)
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parents[1]))  # resources/hpub — make_hpub importable

import make_hpub  # noqa: E402


def _manifest(methods: list[str]) -> dict:
    return {
        "format": "hpub/0.1",
        "title": "t",
        "page_count": len(methods),
        "alignment": [
            {
                "page": i + 1,
                "md_char_start": 0,
                "md_char_end": 10,
                "confidence": 0.9,
                "method": m,
            }
            for i, m in enumerate(methods)
        ],
    }


def _containment(prose_mean: float) -> dict:
    return {
        "mean": prose_mean,
        "min": prose_mean,
        "prose_mean": prose_mean,
        "per_page": [],
        "verdicts": [True] * 5,
        "longest_failing_run": 0,
        "page_classes": {"prose": 5, "mixed": 0, "visual": 0},
    }


class TestBestOfSelector(unittest.TestCase):
    def test_p26_fixture_token_wins_by_score(self) -> None:
        """P26: token 0.45 anchored / 0.93 containment vs char 0.52 / 0.61.
        Scores: token 0.45*0.93=0.4185 > chars 0.52*0.61=0.3172 — the 0.93
        manifest must win even though the char lane anchored 'better'
        (R3: the best result wins, never the last)."""
        token = (_manifest(["anchored"] * 45 + ["unmatched"] * 55), _containment(0.93))
        chars = (_manifest(["anchored-chars"] * 52 + ["unmatched"] * 48), _containment(0.61))
        winner, containment, best_of = make_hpub.select_best_manifest(token, chars)
        self.assertIs(winner, token[0])
        self.assertIs(containment, token[1])
        self.assertEqual(best_of["selected"], "token")
        self.assertAlmostEqual(best_of["scores"]["token"], 0.45 * 0.93, places=3)
        self.assertAlmostEqual(best_of["scores"]["chars"], 0.52 * 0.61, places=3)

    def test_char_manifest_wins_when_genuinely_better(self) -> None:
        """Best-of is symmetric: when the char fallback anchors AND contains
        better, it must win (this is what revives the dead fallback)."""
        token = (_manifest(["anchored"] * 20 + ["unmatched"] * 80), _containment(0.5))
        chars = (_manifest(["anchored-chars"] * 80 + ["unmatched"] * 20), _containment(0.9))
        winner, _, best_of = make_hpub.select_best_manifest(token, chars)
        self.assertIs(winner, chars[0])
        self.assertEqual(best_of["selected"], "chars")


class TestBackstopCountsSelectedManifest(unittest.TestCase):
    """E1: a char-fallback book (methods 'anchored-chars') must pass the
    backstop at its true anchored fraction — 3/5 = 0.6 >= 0.5 — and the
    gate record must agree with the manifest (r4 M2 / i4 check)."""

    def _gate(self, manifest: dict) -> dict:
        containment = _containment(0.9)
        make_hpub.gate_book(manifest, "x" * 100, {"children": []}, containment)
        return manifest["gate"]

    def test_anchored_chars_count_at_gate(self) -> None:
        manifest = _manifest(["anchored-chars"] * 3 + ["unmatched"] * 2)
        gate = self._gate(manifest)
        self.assertEqual(gate["anchored"], 3)
        self.assertAlmostEqual(gate["anchored_fraction"], 0.6)

    def test_token_and_char_methods_count_together(self) -> None:
        manifest = _manifest(["anchored"] * 2 + ["anchored-chars"] * 1 + ["unmatched"] * 2)
        gate = self._gate(manifest)
        self.assertEqual(gate["anchored"], 3)

    def test_backstop_still_rejects_weak_alignment(self) -> None:
        manifest = _manifest(["anchored-chars"] * 2 + ["unmatched"] * 3)  # 0.4 < 0.5
        with self.assertRaises(SystemExit) as ctx:
            make_hpub.gate_book(
                manifest, "x" * 100, {"children": []}, _containment(0.9)
            )
        self.assertEqual(ctx.exception.code, 3)


if __name__ == "__main__":
    unittest.main()
