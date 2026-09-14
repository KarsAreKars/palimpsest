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
import socket
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
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

# Kokoro-82M (mlx-community bf16) — the round-2 ear-test winner for long-form
# listening (2026-09-05): ~13x real-time, no instruct/temperature knobs, style
# lives in voice choice. Ids can't collide with Qwen's (af_/am_/bf_/bm_).
KOKORO_VOICES = [
    {"id": "af_heart", "label": "Heart — Kokoro (warm female)"},
    {"id": "am_adam", "label": "Adam — Kokoro (clear male)"},
    {"id": "af_bella", "label": "Bella — Kokoro (bright female)"},
    {"id": "af_nicole", "label": "Nicole — Kokoro (soft female)"},
    {"id": "am_michael", "label": "Michael — Kokoro (calm male)"},
    {"id": "bf_emma", "label": "Emma — Kokoro (British female)"},
    {"id": "bm_george", "label": "George — Kokoro (British male)"},
]
ALL_VOICES = VOICES + KOKORO_VOICES

# Cloned voices (2026-09-07) — designed in VoiceStudio.app (OmniVoice), which
# bakes each design into a reference wav. Qwen3-TTS clones the identity from
# ref_audio; our pinned narration instruct still steers the STYLE. ref_text
# transcribed by our own Whisper (/stt model) — both wavs are the design-
# preview sentence. Paths point into OmniVoice's app-support dir; if the user
# deletes VoiceStudio the voices vanish from /voices (existence-checked).
_OMNIVOICE_DIR = Path.home() / "Library/Application Support/OmniVoice/voices"
_CLONE_REFS = {
    "storyteller": {
        "label": "The Storyteller — elderly British male (clone)",
        "wav": _OMNIVOICE_DIR / "a029d1dd.wav",
        "ref_text": (
            "The valley had been quiet for a hundred years, and tonight, for "
            "the first time, something stirred beneath the old stone bridge."
        ),
    },
    "librarian": {
        "label": "The Librarian — middle-aged British female (clone)",
        "wav": _OMNIVOICE_DIR / "3cec9ff5.wav",
        "ref_text": (
            "The valley had been quiet for a hundred years, and tonight for "
            "the first time, something stirred beneath the old stone bridge."
        ),
    },
}
CLONE_VOICES = [
    {"id": vid, "label": meta["label"]}
    for vid, meta in _CLONE_REFS.items()
    if meta["wav"].exists()
]
ALL_VOICES = ALL_VOICES + CLONE_VOICES

_kokoro_pipe = None


def get_kokoro():
    """Lazy-load the Kokoro pipeline (~2s warm; snapshot is disk-cached)."""
    global _kokoro_pipe
    if _kokoro_pipe is None:
        import glob
        import json as _json
        from dataclasses import fields

        import mlx.core as mx
        from huggingface_hub import snapshot_download
        from mlx_audio.tts.models.kokoro.kokoro import (
            KokoroPipeline,
            Model,
            ModelConfig,
        )

        local = snapshot_download("mlx-community/Kokoro-82M-bf16")
        raw = _json.load(open(Path(local) / "config.json"))
        known = {f.name for f in fields(ModelConfig)}
        model = Model(ModelConfig(**{k: v for k, v in raw.items() if k in known}))
        weights = {}
        for f in sorted(glob.glob(str(Path(local) / "*.safetensors"))):
            weights.update(mx.load(f))
        # sanitize() maps the torch LSTM/CNN weight names to MLX's — skipping
        # it loads a silently broken model.
        model.load_weights(list(model.sanitize(weights).items()))
        _kokoro_pipe = KokoroPipeline(
            lang_code="a", model=model, repo_id="mlx-community/Kokoro-82M-bf16"
        )
        print("[kokoro] model loaded", flush=True)
    return _kokoro_pipe


def synth_kokoro(text: str, voice: str, speed: float) -> bytes:
    import io
    import wave

    import mlx.core as mx
    import numpy as np

    pipe = get_kokoro()
    # ThreadingHTTPServer runs every request on a FRESH thread, and MLX binds
    # eval streams per-thread — without this the pipeline dies with "There is
    # no Stream(cpu, 1) in current thread" (app-side: every sentence 500s,
    # the highlight cursor races off-screen in silence, 2026-09-06).
    with mx.stream(mx.new_stream(mx.gpu)):
        parts = [np.array(r.audio).flatten() for r in pipe(text, voice=voice, speed=speed)]
        if not parts:
            raise RuntimeError("kokoro produced no audio")
        audio = np.concatenate(parts)
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    return buf.getvalue()

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


WHISPER_ID = "mlx-community/whisper-large-v3-turbo"
WHISPER_LOCAL = os.path.expanduser(
    "~/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo/snapshots/main"
)
_whisper_ready = {"ok": None}  # None = not tried; True/False after first attempt


def whisper_repo() -> str:
    """Model source for mlx_whisper: the manually-fetched flat dir if it's
    complete (curl resume beat HF's downloader on tonight's flaky network),
    else the repo id for hub download."""
    if os.path.exists(os.path.join(WHISPER_LOCAL, "weights.safetensors")):
        return WHISPER_LOCAL
    return WHISPER_ID


def ensure_whisper() -> bool:
    """Warm the Whisper model (the Prof's ear, UX_VISION §A). Returns False
    if the model isn't downloaded yet — the /stt route reports 503 then and
    the app falls back to Web Speech. Transcribe itself imports mlx_whisper
    per-call; the model stays cached in memory by mlx-whisper internally."""
    if _whisper_ready["ok"] is not None:
        return _whisper_ready["ok"]
    if whisper_repo() == WHISPER_LOCAL:
        _whisper_ready["ok"] = True
        print("[whisper] using local snapshot", flush=True)
        return True
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(WHISPER_ID)
        _whisper_ready["ok"] = True
        print("[whisper] model present", flush=True)
    except Exception as e:
        _whisper_ready["ok"] = False
        print(f"[whisper] unavailable: {e}", flush=True)
    return _whisper_ready["ok"]


def transcribe_audio(raw: bytes) -> str:
    """webm/opus/wav bytes -> text. ffmpeg normalizes to 16k mono PCM for
    whisper; the single-threaded server keeps us on the main thread, so MLX
    streams are bound (the 2026-09-06 threading bug class)."""
    import subprocess
    import tempfile

    import mlx_whisper

    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as fin:
        fin.write(raw)
        src = fin.name
    wav = src + ".wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", src, "-ar", "16000", "-ac", "1", "-f", "wav", wav],
            check=True,
        )
        result = mlx_whisper.transcribe(
            wav, path_or_hf_repo=whisper_repo(), condition_on_previous_text=False
        )
        return (result.get("text") or "").strip()
    finally:
        for p in (src, wav):
            try:
                os.unlink(p)
            except OSError:
                pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet default access log
        pass

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # The webview (tauri://localhost) is cross-origin to 127.0.0.1:8737 —
        # without this, plain fetch() to /stt is CORS-blocked (2026-09-06).
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True, "model": _model_id, "voices": ALL_VOICES})
        elif self.path == "/voices":
            self._json(200, {"voices": ALL_VOICES})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path == "/stt":
            if not ensure_whisper():
                self._json(503, {"error": "whisper model not downloaded yet"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length)
            except Exception as e:
                self._json(400, {"error": f"bad body: {e}"})
                return
            if not raw:
                self._json(400, {"error": "empty audio"})
                return
            t0 = time.time()
            try:
                text = transcribe_audio(raw)
            except Exception as e:
                self._json(500, {"error": f"stt failed: {e}"})
                return
            print(f"[whisper] {len(raw)}B -> {len(text)} chars in {time.time() - t0:.1f}s", flush=True)
            self._json(200, {"text": text})
            return
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
        voice = (payload.get("voice") or "af_heart").lower()
        kokoro_ids = {v["id"] for v in KOKORO_VOICES}
        clone_ids = set(_CLONE_REFS)
        if (
            voice not in kokoro_ids
            and voice not in {v["id"] for v in VOICES}
            and voice not in clone_ids
        ):
            voice = "af_heart"
        # Cascade breaker (2026-09-05): a degenerate generation once produced
        # 96s of audio for 303 chars; the client gave up at ~30s but the
        # server kept burning GPU under the global lock, so every queued
        # request timed out behind work nobody was waiting on (>1 min of
        # silence in the app). Guard 1: liveness — if the client already
        # hung up, skip generation entirely; zombie work never starts.
        try:
            if self.connection.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT) == b"":
                print("[tts] client gone before generation — skipping", flush=True)
                return
        except BlockingIOError:
            pass  # alive, no pending data
        except OSError:
            return

        if voice in kokoro_ids:
            # Kokoro path: ~13x real-time, so runaway decodes can't cascade —
            # no max_tokens guard needed. Same lock (MLX isn't thread-safe).
            speed = float(payload.get("speed") or 1.0)
            t0 = time.time()
            with _lock:
                try:
                    data = synth_kokoro(text, voice, speed)
                except Exception as e:
                    self._json(500, {"error": f"kokoro failed: {e}"})
                    return
            print(
                f"[kokoro] {len(text)} chars -> {len(data)} bytes in {time.time() - t0:.1f}s",
                flush=True,
            )
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        # Guard 2 (Qwen): runaway cap — healthy synthesis ≈ 2 tokens/char;
        # cap at 3x so a looping decode dies near the client's patience
        # horizon instead of 3x beyond it.
        max_tokens = min(max(len(text) * 3, 600), 4500)
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
                gen_kwargs = {}
                if voice in clone_ids:
                    ref = _CLONE_REFS[voice]
                    gen_kwargs = {"ref_audio": str(ref["wav"]), "ref_text": ref["ref_text"]}
                generate_audio(
                    text=text,
                    model=get_model(),
                    voice=None if voice in clone_ids else voice,
                    speed=speed,
                    instruct=instruct,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stt_model=None,  # no whisper verification pass — narration trusts the text
                    output_path=td,
                    file_prefix="out",
                    save=True,
                    verbose=False,
                    **gen_kwargs,
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
        get_kokoro()  # warm both engines — a cold kokoro first-request costs ~20s
    # Single-threaded on purpose: generation was always serialized by the
    # global lock (MLX isn't thread-safe), and ThreadingHTTPServer gave each
    # request a FRESH thread with no MLX streams bound — every kokoro call
    # 500'd with "no Stream(cpu, 1) in current thread" (2026-09-06). One
    # thread = streams live on the main thread = the whole bug class dies.
    # Cost: /health can't answer mid-generation; acceptable (probes happen
    # at session start).
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[qwen-tts] listening on http://127.0.0.1:{args.port} (model {_model_id})", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
