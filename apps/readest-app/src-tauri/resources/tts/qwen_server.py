#!/usr/bin/env python3
"""Local Qwen3-TTS narration server for Palimpsest (A9).

Wraps mlx-audio's Qwen3-TTS (Apple Silicon, fully offline) in a tiny HTTP
contract the app's SpeechProvider can talk to:

    GET  /health            -> {"ok": true, "model": ..., "voices": [...]}
    POST /tts               -> audio/wav bytes
       body: {"text": str, "voice"?: str, "speed"?: float, "instruct"?: str}

The model loads once at startup; generation runs under a lock (MLX is not
concurrency-safe). ~2x real-time on Apple Silicon — narration pre-builds per
unit, so playback never waits.

Run:  <venv>/bin/python qwen_server.py [--port 8737] [--model <hf-id>]
Requires: pip install mlx-audio  (M1+ Mac, ~2GB model download on first run)
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"

# Narration defaults — the config the user picked by ear on 2026-08-31
# (Desktop/qwen-ab-new.wav, the 20.6s 'even narration' sample from commit
# b9f0c72's A/B). Later rounds tried restrained-expressive (§8.1), calm
# counter-steer, and flat-fast — all rejected; this b9f0c72 wording at
# temp 0.5 is the chosen operating point. Qwen3-TTS reads drama INTO the
# text when given free rein; this procedural style prompt plus a lowered
# temperature (0.7 default -> predictable acoustic path) is the fix.
# Override per request with {"instruct": ..., "temperature": ...}, or
# server-wide via PALIMPSEST_QWEN_INSTRUCT / PALIMPSEST_QWEN_TEMPERATURE.
DEFAULT_INSTRUCT = (
    "A professional audiobook narrator reading aloud in a calm, neutral, "
    "natural voice. Steady conversational pace, even tone, minimal emotional "
    "inflection, no dramatization, no character voices."
)
DEFAULT_TEMPERATURE = 0.5

# Real speaker ids from the Qwen3-TTS CustomVoice checkpoint
# (model.supported_speakers) — English-leaning subset, lowercase ids.
VOICES = [
    {"id": "vivian", "label": "Vivian (warm female)"},
    {"id": "serena", "label": "Serena (soft female)"},
    {"id": "ryan", "label": "Ryan (clear male)"},
    {"id": "aiden", "label": "Aiden (deep male)"},
    {"id": "eric", "label": "Eric (mellow male)"},
    {"id": "dylan", "label": "Dylan (bright male)"},
]

_lock = threading.Lock()
_model = None
_model_id = MODEL_ID


def get_model():
    global _model
    if _model is None:
        from huggingface_hub import snapshot_download
        from mlx_audio.tts.utils import load_model

        t0 = time.time()
        # load_model takes a LOCAL path; resolve the HF id to a snapshot first.
        local = snapshot_download(_model_id)
        _model = load_model(Path(local))
        print(f"[qwen-tts] model loaded in {time.time() - t0:.1f}s", file=sys.stderr, flush=True)
    return _model


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet default access log
        pass

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True, "model": _model_id, "voices": VOICES})
        elif self.path == "/voices":
            self._json(200, {"voices": VOICES})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/tts":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            self._json(400, {"error": f"bad json: {e}"})
            return

        text = (payload.get("text") or "").strip()
        if not text:
            self._json(400, {"error": "empty text"})
            return
        if len(text) > 4000:
            self._json(400, {"error": "text too long (max 4000 chars)"})
            return
        voice = (payload.get("voice") or "vivian").lower()
        if voice not in {v["id"] for v in VOICES}:
            voice = "vivian"
        speed = float(payload.get("speed") or 1.0)
        instruct = payload.get("instruct") or os.environ.get(
            "PALIMPSEST_QWEN_INSTRUCT", DEFAULT_INSTRUCT
        )
        try:
            temperature = float(
                payload.get("temperature")
                or os.environ.get("PALIMPSEST_QWEN_TEMPERATURE", DEFAULT_TEMPERATURE)
            )
        except (TypeError, ValueError):
            temperature = DEFAULT_TEMPERATURE
        temperature = min(max(temperature, 0.05), 1.5)

        from mlx_audio.tts.generate import generate_audio

        t0 = time.time()
        with _lock, tempfile.TemporaryDirectory() as td:
            try:
                generate_audio(
                    text=text,
                    model=get_model(),
                    voice=voice,
                    speed=speed,
                    instruct=instruct,
                    temperature=temperature,
                    stt_model=None,  # no whisper verification pass — narration trusts the text
                    output_path=td,
                    file_prefix="out",
                    save=True,
                    verbose=False,
                )
            except Exception as e:
                self._json(500, {"error": f"generation failed: {e}"})
                return
            wavs = sorted(Path(td).glob("*.wav"))
            if not wavs:
                self._json(500, {"error": "no audio produced"})
                return
            data = wavs[0].read_bytes()
        print(
            f"[qwen-tts] {len(text)} chars -> {len(data)} bytes in {time.time() - t0:.1f}s",
            file=sys.stderr,
            flush=True,
        )
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    global _model_id
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8737)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--preload", action="store_true", help="load the model at startup")
    args = ap.parse_args()
    _model_id = args.model
    if args.preload:
        get_model()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[qwen-tts] listening on http://127.0.0.1:{args.port} (model {_model_id})", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
