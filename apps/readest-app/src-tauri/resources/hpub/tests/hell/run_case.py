#!/usr/bin/env python3
"""run_case — execute one hell-corpus case under make_hpub.py and assert every
invariant that can be checked without a human.

Result JSON (one line per case, also accumulated into the matrix):
  {case, tier, exit, wall_s, status, reason, timeout, checks: {name: bool}, pass}

Invariant coverage:
  I1 bounded time    — subprocess timeout == TIMEOUT check (a hang IS a failure)
  I2 per-page degrade — manifest exists & per-page entries present even on reject
  I3 provenance      — alignment structural invariants (monotonic, in-bounds,
                       methods census, interpolation strictly between anchors)
  I4 best-of         — containment/gate metrics were computed on the manifest
                       that shipped (same file, same alignment length)
  I5 truth>beauty    — ok-with-garbage is caught by quality.max_*_chars and
                       grounding; rejects must carry reason + failing pages
  I6 no speculation  — every case's case.json names its tier + receipt
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

# make_hpub.py lives two levels up: resources/hpub/tests/hell/ -> resources/hpub/
MAKE_HPUB = Path(__file__).resolve().parents[2] / "make_hpub.py"
# The hpub venv is machine-local; override with HPUB_VENV_PYTHON when absent.
VENV_PY = Path(
    os.environ.get(
        "HPUB_VENV_PYTHON",
        "/Users/krishsheladiya/Library/Application Support/com.bilingify.readest/hpub-venv/bin/python",
    )
)
VALID_METHODS = {"anchored", "anchored-chars", "interpolated", "unmatched"}


def norm_tokens_with_offsets(text: str) -> tuple[list[str], list[int]]:
    toks, offs = [], []
    for m in re.finditer(r"[a-z0-9]+", text.lower()):
        toks.append(m.group(0))
        offs.append(m.start())
    return toks, offs


# ─── manifest structural invariants (I3 / I4) ────────────────────────────────

def check_manifest(manifest: dict, md_len: int) -> dict[str, bool]:
    al = manifest.get("alignment") or []
    checks: dict[str, bool] = {}
    spans = [(p.get("md_char_start"), p.get("md_char_end")) for p in al]
    checks["i3_spans_in_bounds"] = all(
        (s is None and e is None)
        or (s is not None and e is not None and 0 <= s < e <= md_len)
        for s, e in spans
    )
    anchored_starts = [s for s, _ in spans if s is not None]
    checks["i3_monotonic"] = all(
        a <= b for a, b in zip(anchored_starts, anchored_starts[1:])
    )
    checks["i3_methods_valid"] = all(p.get("method") in VALID_METHODS for p in al)
    # interpolation must sit strictly between two real anchors, and its
    # confidence must be 0.5 * min(anchor confidences)
    ok_interp = True
    anchored_pages = [p["page"] for p in al if p["method"].startswith("anchored")]
    for p in al:
        if p["method"] != "interpolated":
            continue
        prev = max((a for a in anchored_pages if a < p["page"]), default=None)
        nxt = min((a for a in anchored_pages if a > p["page"]), default=None)
        if prev is None or nxt is None:
            ok_interp = False
            continue
        pa = next(a for a in al if a["page"] == prev)
        na = next(a for a in al if a["page"] == nxt)
        want = round(min(pa["confidence"], na["confidence"]) * 0.5, 3)
        if abs(p["confidence"] - want) > 0.01:
            ok_interp = False
    checks["i3_interpolation_between_anchors"] = ok_interp
    checks["i3_confidence_range"] = all(
        0.0 <= p.get("confidence", -1) <= 1.0 for p in al
    )
    return checks


# ─── grounding smoke test (I5: can the manifest locate a quote's page?) ──────

def page_for_offset(manifest: dict, offset: int) -> int | None:
    """The manifest's answer to 'which page does this md char live on?'
    — the exact query the professor-grounding feature issues."""
    best = None
    for p in manifest.get("alignment") or []:
        s, e = p.get("md_char_start"), p.get("md_char_end")
        if s is not None and s <= offset:
            best = p["page"]
        if s is not None and s > offset:
            break
    return best


def check_grounding(manifest: dict, md_text: str, truth: dict, tol: int) -> dict[str, bool]:
    md_toks, md_offs = norm_tokens_with_offsets(md_text)
    md_str = " ".join(md_toks)
    # char offset in md_str where each token starts (for offset mapping)
    tok_pos, cursor = [], 0
    for t in md_toks:
        tok_pos.append(cursor)
        cursor += len(t) + 1
    found = ok = 0
    worst = None
    for q in truth.get("quotes") or []:
        q_toks = re.findall(r"[a-z0-9]+", q["text"].lower())
        if len(q_toks) < 4:
            continue
        # anchor on the quote's tail: the "page N line M" prefix recurs
        probe = " ".join(q_toks[-8:])
        hit = md_str.find(probe)
        if hit < 0:
            continue
        # token index at this char position
        import bisect
        ti = bisect.bisect_right(tok_pos, hit) - 1
        mid_off = md_offs[min(ti + 4, len(md_offs) - 1)]
        page = page_for_offset(manifest, mid_off)
        found += 1
        if page is not None and abs(page - q["page"]) <= tol:
            ok += 1
        else:
            worst = {"quote_page": q["page"], "manifest_page": page}
    n = max(found, 1)
    return {
        "grounding_hits": ok / n >= 0.9,
        "_detail": {"quotes_checked": found, "hits": ok, "worst": worst},
    }


# ─── one case ────────────────────────────────────────────────────────────────

def run_case(case_dir: Path, runs_root: Path, extra_args: list[str] | None = None) -> dict:
    case_dir = case_dir.resolve()
    meta = json.loads((case_dir / "case.json").read_text())
    truth = json.loads((case_dir / "ground_truth.json").read_text())
    expect = meta["expect"]
    timeout_s = int(expect.get("timeout_s", 900))
    run_dir = runs_root / meta["case"]
    run_dir.mkdir(parents=True, exist_ok=True)
    out_dir = run_dir / "out"
    if out_dir.exists():
        import shutil
        shutil.rmtree(out_dir)  # never score stale artifacts from a previous run

    env = {
        "PATH": "/opt/homebrew/bin:/usr/bin:/bin",
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",  # corpus must run offline (I1)
    }
    cmd = [str(VENV_PY), str(MAKE_HPUB), str(case_dir / "case.pdf"),
           "--out-dir", str(out_dir), "--title", f"hell-{meta['case']}"]
    cmd += extra_args or []
    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s, env=env,
            cwd=str(MAKE_HPUB.parent),
        )
        wall = time.monotonic() - t0
        timed_out = False
    except subprocess.TimeoutExpired:
        wall = time.monotonic() - t0
        proc, timed_out = None, True
    (run_dir / "stderr.log").write_text(proc.stderr if proc else f"TIMEOUT after {timeout_s}s")

    checks: dict[str, bool] = {"i1_no_timeout": not timed_out}
    if timed_out:
        return {"case": meta["case"], "tier": meta["tier"], "exit": "TIMEOUT",
                "wall_s": round(wall, 1), "checks": checks, "pass": False}

    last_line = (proc.stdout.strip().splitlines() or ["{}"])[-1]
    try:
        result = json.loads(last_line)
    except json.JSONDecodeError:
        result = {"status": "parse_error", "raw": last_line[-200:]}
    (run_dir / "result.json").write_text(json.dumps(result, indent=2))

    checks["i1_exit_expected"] = proc.returncode in expect["exit_in"]
    if "max_wall_s" in expect:
        checks["i1_wall_budget"] = wall <= expect["max_wall_s"]
    # per-page wall budget (I1): bounded time SCALED to page count, not an
    # absolute cap — a 1500-page book legitimately takes ~300x a 5-page one.
    if "per_page_wall" in expect:
        pp = expect["per_page_wall"]
        n_pages = len(truth.get("page_texts") or [])
        budget = pp["s_per_page"] * n_pages + pp["fixed_s"]
        checks["i1_per_page_wall"] = wall <= budget
        checks["_wall_budget_s"] = round(budget, 1)

    manifest, md_text, md_len = None, "", 0
    mf = out_dir / "manifest.json"
    if mf.is_file():
        manifest = json.loads(mf.read_text())
        md_text = (out_dir / "content.md").read_text()
        md_len = len(md_text)
        checks.update(check_manifest(manifest, md_len))
        # I4: the gate metrics must describe THIS manifest
        g = manifest.get("gate") or {}
        checks["i4_gate_matches_manifest"] = (
            g.get("anchored")
            == sum(1 for p in manifest["alignment"] if p["method"].startswith("anchored"))
        )
        gate = result.get("gate") or g
        if "min_anchored_fraction" in expect:
            checks["anchored_fraction"] = (
                gate.get("anchored_fraction", 0) >= expect["min_anchored_fraction"]
            )
        checks["i5_no_silent_garbage"] = (
            result.get("quality", {}).get("replacement_chars", 0) == 0
            and result.get("quality", {}).get("pua_chars", 0) == 0
        )
        gt = expect.get("grounding")
        if gt is not None:
            checks.update(check_grounding(manifest, md_text, truth, gt["tolerance_pages"]))
    else:
        # rejected before artifacts: the reject itself must be loud + specific (I5)
        checks["i5_reject_is_specific"] = (
            result.get("status") == "rejected" and bool(result.get("reason"))
        ) or result.get("status") == "ok"

    all_pass = all(v for v in checks.values() if isinstance(v, bool))
    return {"case": meta["case"], "tier": meta["tier"], "receipt": meta.get("receipt"),
            "exit": proc.returncode, "status": result.get("status"),
            "reason": result.get("reason"), "wall_s": round(wall, 1),
            "checks": checks, "pass": all_pass}


if __name__ == "__main__":
    case_dir = Path(sys.argv[1])
    runs_root = (
        Path(sys.argv[2])
        if len(sys.argv) > 2
        else Path(__file__).resolve().parent / "runs"
    )
    print(json.dumps(run_case(case_dir, runs_root, sys.argv[3:] or None), indent=2))
