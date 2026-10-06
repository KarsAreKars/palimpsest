#!/usr/bin/env python3
"""run_harness — walk a corpus dir, run every case under make_hpub.py with a
wall-clock budget, assert the invariants, emit a matrix.

Usage: run_harness.py <corpus_root> [--case NAME ...] [--runs ROOT] [--matrix OUT]
Exit 0 iff every case passes. A TIMEOUT row is always a failure (I1).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from run_case import run_case  # noqa: E402


def matrix_row(r: dict) -> str:
    gate = ""
    checks = r.get("checks", {})
    fails = [k for k, v in checks.items() if v is False]
    mark = "PASS" if r.get("pass") else "FAIL"
    return (
        f"| {r['case']:30s} | {r.get('tier','?'):3s} | {str(r.get('exit')):>7s} "
        f"| {r.get('status','?'):9s} | {r.get('wall_s','?'):>7} "
        f"| {mark} | {', '.join(fails) or '-'} |"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    _here = Path(__file__).resolve().parent
    ap.add_argument("corpus_root", type=Path, nargs="?", default=_here / "corpus")
    ap.add_argument("--case", action="append", default=None)
    ap.add_argument("--runs", type=Path, default=_here / "runs")
    ap.add_argument("--matrix", type=Path, default=None)
    ap.add_argument("--fast", action="store_true",
                    help="skip nightly-tier cases (extreme-long)")
    ap.add_argument("--extra-args", default=None,
                    help="extra CLI args for make_hpub.py (e.g. '--no-fastpath')")
    args = ap.parse_args()

    case_dirs = sorted(p for p in args.corpus_root.iterdir() if (p / "case.json").is_file())
    if args.case:
        case_dirs = [p for p in case_dirs if p.name in set(args.case)]
    if args.fast:
        case_dirs = [p for p in case_dirs
                     if json.loads((p / "case.json").read_text()).get("tier") != "nightly"]

    extra = args.extra_args.split() if args.extra_args else None
    results = []
    for cd in case_dirs:
        t0 = time.monotonic()
        r = run_case(cd, args.runs, extra)
        r["harness_wall_s"] = round(time.monotonic() - t0, 1)
        results.append(r)
        print(matrix_row(r), flush=True)

    lines = [
        "| case | tier | exit | status | wall_s | verdict | failed checks |",
        "|---|---|---|---|---|---|---|",
        *[matrix_row(r) for r in results],
    ]
    md = "\n".join(lines) + "\n"
    out = args.matrix or (args.runs / "matrix.md")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md)
    (args.runs / "matrix.json").write_text(json.dumps(results, indent=2))
    print(f"\nmatrix -> {out}")
    bad = [r["case"] for r in results if not r["pass"]]
    print(f"{len(results) - len(bad)}/{len(results)} pass" + (f"  FAIL: {bad}" if bad else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
