#!/usr/bin/env python3
"""T1.c unit test (Ruling 3): an exception in stage 1 (text-layer coverage
probe) must produce a structured {status, reason, detail} JSON result on
stdout + a mapped exit code — never a bare traceback with an unparseable
stdout protocol (r1 P9).

Run:  python -m unittest test_error_envelope -v   (from this directory,
      with the hpub venv; stdlib unittest only — no new pip deps, Ruling 5)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
MAKE_HPUB = _HERE.parents[1] / "make_hpub.py"
VENV_PY = os.environ.get(
    "HPUB_VENV_PYTHON",
    str(Path.home() / "Library/Application Support/com.bilingify.readest/hpub-venv/bin/python"),
)


class TestErrorEnvelope(unittest.TestCase):
    def _run(self, pdf: Path) -> subprocess.CompletedProcess:
        env = {
            "PATH": "/opt/homebrew/bin:/usr/bin:/bin",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
        }
        return subprocess.run(
            [VENV_PY, str(MAKE_HPUB), str(pdf), "--out-dir", tempfile.mkdtemp()],
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
            cwd=str(MAKE_HPUB.parent),
        )

    def test_stage1_exception_yields_json_and_mapped_exit(self) -> None:
        """A non-PDF input dies in extract_page_texts (stage 1). The process
        must still speak the protocol: last stdout line is the structured
        envelope, exit is mapped, stdout carries no traceback."""
        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tf:
            tf.write(b"this is not a pdf at all\n")
            bad = Path(tf.name)
        try:
            proc = self._run(bad)
        finally:
            bad.unlink(missing_ok=True)
        self.assertNotEqual(proc.returncode, 0, "a fatal stage-1 error must not exit 0")
        stdout_lines = proc.stdout.strip().splitlines()
        self.assertTrue(stdout_lines, "stdout must carry the JSON result line")
        result = json.loads(stdout_lines[-1])  # raises if the protocol broke
        self.assertEqual(result["status"], "error")
        self.assertIn(result["reason"], ("error", "corrupt", "encrypted"))
        self.assertTrue(result["detail"])
        # the traceback belongs on stderr, never on the stdout protocol
        self.assertNotIn("Traceback", proc.stdout)

    def test_envelope_reason_corrupt_for_broken_pdf(self) -> None:
        """The reason field must be specific where detectable: a structurally
        unreadable input classifies as 'corrupt' (pypdf's Pdf*Error family)."""
        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tf:
            tf.write(b"this is not a pdf at all\n")
            bad = Path(tf.name)
        try:
            proc = self._run(bad)
        finally:
            bad.unlink(missing_ok=True)
        result = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertEqual(result["reason"], "corrupt")
        self.assertEqual(proc.returncode, 1)


if __name__ == "__main__":
    unittest.main()
