#!/usr/bin/env python3
"""T1.b unit test (Ruling 3): the R1 acquire wrapper against a stdlib
slow-drip HTTP server — drip past the per-connection timeout must retry on
a fresh connection and succeed; a truncating download must fail LOUDLY with
the file named. Also pins the HF_* env defaults + HF_TOKEN passthrough.

No marker internals are touched: the wrapper takes any callable, so the
tests inject plain urllib downloads against http.server.

Run:  python -m unittest test_acquire_wrapper -v   (hpub venv; stdlib only)
"""
from __future__ import annotations

import http.client
import http.server
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parents[1]))  # resources/hpub — make_hpub importable

import make_hpub  # noqa: E402

WEIGHTS = "test-weights.bin"  # the file name a loud error must name


class _QuietHandler(http.server.BaseHTTPRequestHandler):
    """Request 1: stall — headers then bytes slower than the client timeout
    (the R1 failure: a connection that accepts and drips forever).
    Later requests: serve the full payload fast (the fresh-connection win)."""

    protocol_version = "HTTP/1.1"
    n_requests = 0
    payload = b"full-weights-content"

    def do_GET(self) -> None:  # noqa: N802 — stdlib API
        type(self).n_requests += 1
        if type(self).n_requests == 1:
            self.send_response(200)
            self.send_header("Content-Length", "1000000")
            self.end_headers()
            try:
                for _ in range(20):
                    time.sleep(2.0)  # > the client's 0.5 s per-read timeout
                    self.wfile.write(b"x")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass  # client gave up — that IS the timeout under test
        else:
            body = type(self).payload
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, *args) -> None:
        pass


class _TruncatingHandler(http.server.BaseHTTPRequestHandler):
    """Every response claims 1000 bytes and delivers 10 — the mid-download
    death that must surface as a loud, file-naming error."""

    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802 — stdlib API
        try:
            self.send_response(200)
            self.send_header("Content-Length", "1000")
            self.end_headers()
            self.wfile.write(b"10bytes!!")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True

    def log_message(self, *args) -> None:
        pass


def _start_server(handler_cls) -> http.server.ThreadingHTTPServer:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _downloading_acquire(url: str, calls: list):
    """One acquisition attempt: urllib with a short per-read timeout, loud
    on truncation — the shape marker's own download failures take."""

    def acquire() -> bytes:
        calls.append(1)
        with urllib.request.urlopen(url, timeout=0.5) as resp:
            try:
                data = resp.read()
            except http.client.IncompleteRead as e:
                got = len(e.partial or b"")
                raise RuntimeError(
                    f"truncated download of {WEIGHTS}: {got} of {e.expected} bytes"
                )
        return data

    return acquire


class TestAcquireWrapper(unittest.TestCase):
    def setUp(self) -> None:
        self._saved_env = {k: os.environ.get(k) for k in (
            "HF_HUB_DOWNLOAD_TIMEOUT", "HF_HUB_ETAG_TIMEOUT", "HF_TOKEN",
            "HUGGING_FACE_HUB_TOKEN",
        )}

    def tearDown(self) -> None:
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_drip_times_out_then_fresh_connection_succeeds(self) -> None:
        _QuietHandler.n_requests = 0
        server = _start_server(_QuietHandler)
        try:
            url = f"http://127.0.0.1:{server.server_port}/{WEIGHTS}"
            calls: list = []
            t0 = time.monotonic()
            result = make_hpub._acquire_with_retry(
                _downloading_acquire(url, calls), label=WEIGHTS
            )
            elapsed = time.monotonic() - t0
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(result, _QuietHandler.payload)
        self.assertEqual(len(calls), 2, "drip must fail once, fresh connection must win")
        self.assertLess(elapsed, make_hpub.ACQUIRE_TOTAL_DEADLINE_S)

    def test_truncation_raises_loud_error_naming_the_file(self) -> None:
        server = _start_server(_TruncatingHandler)
        try:
            url = f"http://127.0.0.1:{server.server_port}/{WEIGHTS}"
            calls: list = []
            with self.assertRaises(RuntimeError) as ctx:
                make_hpub._acquire_with_retry(
                    _downloading_acquire(url, calls), label=WEIGHTS
                )
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(len(calls), make_hpub.ACQUIRE_MAX_ATTEMPTS)
        message = str(ctx.exception)
        self.assertIn(WEIGHTS, message)  # loud = names the file
        self.assertIn("truncated", message)

    def test_hf_env_defaults_unless_user_set(self) -> None:
        for k in ("HF_HUB_DOWNLOAD_TIMEOUT", "HF_HUB_ETAG_TIMEOUT"):
            os.environ.pop(k, None)
        make_hpub._acquire_with_retry(lambda: "ok", label="t")
        self.assertEqual(os.environ["HF_HUB_DOWNLOAD_TIMEOUT"], "30")
        self.assertEqual(os.environ["HF_HUB_ETAG_TIMEOUT"], "30")

        os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "99"
        make_hpub._acquire_with_retry(lambda: "ok", label="t")
        self.assertEqual(os.environ["HF_HUB_DOWNLOAD_TIMEOUT"], "99")

    def test_hf_token_passthrough(self) -> None:
        os.environ["HF_TOKEN"] = "test-token"
        os.environ.pop("HUGGING_FACE_HUB_TOKEN", None)
        make_hpub._acquire_with_retry(lambda: "ok", label="t")
        self.assertEqual(os.environ["HUGGING_FACE_HUB_TOKEN"], "test-token")


if __name__ == "__main__":
    unittest.main()
