"""M2 math-check tests for qwen_server.py's POST /check route.

Three-valued verdict contract:
  - a step is NEVER called wrong without a counterexample,
  - "unknown" (sympy couldn't decide) is first-class, never a failure,
  - one bad line never blocks the others (isolation).

Run with the app venv python:
    ~/.palimpsest/venv/bin/python -m pytest test_math_check.py -v
"""

import http.client
import json
import socket
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import qwen_server  # noqa: E402


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def server_port():
    """Real HTTP server on a random high port — the production Handler,
    single-threaded exactly like main() serves it (the old 8737 voice
    process from manual testing is left alone)."""
    port = _free_port()
    srv = qwen_server.HTTPServer(("127.0.0.1", port), qwen_server.Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield port
    srv.shutdown()
    srv.server_close()


def _post(port: int, path: str, obj: dict):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    conn.request("POST", path, json.dumps(obj), {"Content-Type": "application/json"})
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return resp.status, json.loads(body or b"{}")


def _get(port: int, path: str):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return resp.status, json.loads(body or b"{}")


def _check(port: int, payload: dict):
    status, body = _post(port, "/check", payload)
    assert status == 200, body
    assert body["engine"]["name"] == "sympy"
    assert body["engine"]["version"]
    return body


def _step(body, sid):
    return next(s for s in body["steps"] if s["id"] == sid)


# --- the verdict ladder -----------------------------------------------------

def test_equivalent_expansion(server_port):
    """(x+1)^2 = x^2+2x+1 — rung 2, proven."""
    body = _check(server_port, {
        "steps": [
            {"id": "s1", "latex": "(x+1)^2"},
            {"id": "s2", "latex": "x^2+2x+1"},
        ]
    })
    s2 = _step(body, "s2")
    assert s2["status"] == "ok"
    assert s2["verdict"] == "equivalent"
    assert s2["basis"] == "proven"
    assert "counterexample" not in s2


def test_equivalent_same_roots(server_port):
    """(x-1)(x-4)=0 vs x=1 or x=4 — same solution set, different forms."""
    body = _check(server_port, {
        "steps": [
            {"id": "s1", "latex": "(x-1)(x-4)=0"},
            {"id": "s2", "latex": "x = 1 \\lor x = 4"},
        ]
    })
    s2 = _step(body, "s2")
    assert s2["status"] == "ok"
    assert s2["verdict"] == "equivalent_same_roots"
    assert s2["basis"] == "proven"


def test_implied_forward_squaring(server_port):
    """Squaring both sides is a VALID one-way move: sol(x=2) <= sol(x^2=4).
    A naive checker flags this wrong; the implication probe doesn't."""
    body = _check(server_port, {
        "steps": [
            {"id": "s1", "latex": "x = 2"},
            {"id": "s2", "latex": "x^2 = 4"},
        ]
    })
    s2 = _step(body, "s2")
    assert s2["status"] == "ok"
    assert s2["verdict"] == "implied_forward"


def test_not_equivalent_has_counterexample(server_port):
    """2x+3=7 followed by x=1 — genuinely wrong, WITH evidence."""
    body = _check(server_port, {
        "steps": [
            {"id": "s1", "latex": "2x + 3 = 7"},
            {"id": "s2", "latex": "x = 1"},
        ]
    })
    s2 = _step(body, "s2")
    assert s2["status"] == "ok"
    assert s2["verdict"] == "not_equivalent"
    cx = s2.get("counterexample")
    assert cx is not None, "wrong without a counterexample is forbidden"
    # the FIRST sampled mismatch: x=1 satisfies the step but not the prev line
    assert cx["assignments"] == {"x": 1}
    assert cx["prev_value"] == "-2"   # 2*1 + 3 - 7
    assert cx["step_value"] == "0"    # 1 - 1


def test_unknown_when_sympy_cannot_decide(server_port):
    """Two quintics with distinct real roots and no sampled counterexample:
    no equivalence proof, no implication either way, no witness — unknown,
    never a bare invalid."""
    body = _check(server_port, {
        "steps": [
            {"id": "s1", "latex": "x^5 + x + 1 = 0"},
            {"id": "s2", "latex": "x^5 - x + 3 = 0"},
        ]
    })
    s2 = _step(body, "s2")
    assert s2["status"] == "ok"
    assert s2["verdict"] == "unknown"
    assert s2["basis"] == "none"
    assert "counterexample" not in s2


# --- robustness ---------------------------------------------------------------

def test_parse_error_is_not_wrong_math(server_port):
    body = _check(server_port, {
        "steps": [
            {"id": "s1", "latex": "x+1=2"},
            {"id": "s2", "latex": "\\frac{@@{\\not latex~~"},
        ]
    })
    s2 = _step(body, "s2")
    assert s2["status"] == "parse_error"
    assert "verdict" not in s2  # a parse problem is NOT a math verdict


def test_isolation_one_bad_line_never_blocks_others(server_port):
    """s2 is garbage; s3 must still be checked against the last good line."""
    body = _check(server_port, {
        "steps": [
            {"id": "s1", "latex": "x+1=2"},
            {"id": "s2", "latex": "\\frac{@@{\\not latex~~"},
            {"id": "s3", "latex": "x=1"},
        ]
    })
    assert _step(body, "s2")["status"] == "parse_error"
    s3 = _step(body, "s3")
    assert s3["status"] == "ok"
    assert s3["verdict"] == "equivalent"  # x+1=2 and x=1 are the same line
    # s3 was judged against s1 (the last PARSED step), skipping s2.
    assert "counterexample" not in s3


def test_engine_missing_returns_503(server_port, monkeypatch):
    """Voice-only install (no sympy): /check 503s, everything else alive."""
    monkeypatch.setattr(qwen_server, "_get_engine", lambda: None)
    status, body = _post(server_port, "/check", {"steps": [{"id": "s1", "latex": "x"}]})
    assert status == 503
    assert body["error"] == "math engine unavailable"


def test_bad_request_bodies(server_port):
    status, body = _post(server_port, "/check", {"no_steps": True})
    assert status == 400
    status, _ = _post_raw_bad_json(server_port)
    assert status == 400


def _post_raw_bad_json(port: int):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("POST", "/check", b"{not json", {"Content-Type": "application/json"})
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return resp.status, json.loads(body or b"{}")


# --- goal -------------------------------------------------------------------

def test_goal_reached(server_port):
    body = _check(server_port, {
        "steps": [
            {"id": "s1", "latex": "2x + 3 = 7"},
            {"id": "s2", "latex": "2x = 4"},
            {"id": "s3", "latex": "x = 2"},
        ],
        "goal_latex": "x = 2",
    })
    assert _step(body, "s2")["verdict"] == "equivalent"
    # 2x=4 -> x=2: not a rearrangement (rung 2), same solution set (rung 4)
    assert _step(body, "s3")["verdict"] == "equivalent_same_roots"
    assert body["goal"] == {"reached": True, "by_step": "s3"}


def test_goal_not_reached(server_port):
    body = _check(server_port, {
        "steps": [{"id": "s1", "latex": "x^2 = 4"}],
        "goal_latex": "x = 2",
    })
    # First step has no predecessor — judged against the goal only.
    assert body["goal"] is not None
    assert body["goal"]["reached"] is False  # x^2=4 does not pin down x=2


def test_no_goal_field_when_absent(server_port):
    body = _check(server_port, {"steps": [{"id": "s1", "latex": "x+1"}]})
    assert body["goal"] is None


# --- shape / hygiene ----------------------------------------------------------

def test_every_step_has_elapsed_and_status(server_port):
    body = _check(server_port, {
        "steps": [
            {"id": "s1", "latex": "x+1=2"},
            {"id": "s2", "latex": "x=1"},
        ]
    })
    for rec in body["steps"]:
        assert "elapsed_ms" in rec
        assert rec["status"] in ("ok", "parse_error")


def test_first_step_is_never_called_wrong(server_port):
    body = _check(server_port, {"steps": [{"id": "s1", "latex": "x = 999"}]})
    s1 = _step(body, "s1")
    assert s1["status"] == "ok"
    assert s1["verdict"] == "unknown"  # nothing to compare against


# --- /health token contract ---------------------------------------------------

def test_health_includes_token_when_set(server_port, monkeypatch):
    monkeypatch.setattr(qwen_server, "_TOKEN", "abc123")
    status, body = _get(server_port, "/health")
    assert status == 200
    assert body["ok"] is True
    assert body["token"] == "abc123"
    # existing fields stay — /tts consumers rely on them
    assert body["model"] and body["voices"]


def test_health_omits_token_by_default(server_port, monkeypatch):
    monkeypatch.setattr(qwen_server, "_TOKEN", None)
    status, body = _get(server_port, "/health")
    assert status == 200
    assert body["ok"] is True
    assert "token" not in body


def test_health_is_side_effect_free(server_port, monkeypatch):
    """/health must not touch the engine: with the lazy import poisoned it
    still answers 200 instantly (no model load, no sympy import)."""
    def _boom():
        raise AssertionError("/health must not import the math engine")
    monkeypatch.setattr(qwen_server, "_get_engine", _boom)
    status, body = _get(server_port, "/health")
    assert status == 200
    assert body["ok"] is True
