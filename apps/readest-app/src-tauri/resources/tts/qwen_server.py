#!/usr/bin/env python3
"""Local Qwen3-TTS narration server for Palimpsest (A9).

Wraps mlx-audio's Qwen3-TTS (Apple Silicon, fully offline) in a tiny HTTP
contract the app's SpeechProvider can talk to:

    GET  /health            -> {"ok": true, "model": ..., "voices": [...],
                               "engines": {"kokoro": bool, "math": bool},
                               "token": ...}   # token only with --token
                               # engines = cheap IMPORT-level self-test
                               # (no model loading; cold start stays lazy)
    POST /tts               -> audio/wav bytes
       body: {"text": str, "voice"?: str, "speed"?: float, "instruct"?: str}
    POST /check             -> deterministic per-step math verdicts (CAS)
       body: {"steps": [{"id", "latex"}], "goal_latex"?, "assumptions"?}
       resp: {"steps": [{"id", "status", "verdict", "basis",
                          "counterexample"?, "elapsed_ms"}], "goal",
              "engine": {"name": "sympy", "version": ...}}
       Verdicts are three-valued: a step is never called wrong without a
       counterexample, and "unknown" (sympy couldn't decide) is a
       first-class verdict, never a failure. The CAS decides correctness;
       the LLM only diagnoses. Requires sympy + latex2sympy2 (lazy import);
       without them /check returns 503 and voice routes keep working.

The model loads once at startup; generation runs under a lock (MLX is not
concurrency-safe). ~2x real-time on Apple Silicon — narration pre-builds per
unit, so playback never waits.

Run:  <venv>/bin/python qwen_server.py [--port 8737] [--model <hf-id>] [--token <hex>]
Requires: pip install mlx-audio  (M1+ Mac, ~2GB model download on first run)
           pip install sympy latex2sympy2  (optional, only for /check)
"""

from __future__ import annotations

import argparse
import concurrent.futures
import itertools
import json
import os
import re
import socket
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

try:  # SIGALRM is the clean per-pair timeout kill; Unix-only (macOS: fine)
    import signal
except ImportError:  # pragma: no cover - non-Unix fallback exists below
    signal = None

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
# Auth token echoed by /health when the app spawns us with --token <hex>.
_TOKEN = None


def _probe_engines() -> dict:
    """Cheap import-level engine self-test, run ONCE at startup. NO model
    loading — the cold start stays lazy; this only checks that the voice
    stack's import-time dependency surface is intact.

    Why (2026-09-15): `import misaki` top-level DEFERS its submodule deps
    (spacy, num2words, ...), so a venv missing them passed every probe the
    app had — then /health stayed green while every Kokoro request 500'd
    with Broken pipe. The same check as bootstrap_voice.sh's probe, so
    "healthy" now actually means "can synthesize"."""
    out = {}
    try:
        import mlx_audio, mlx_whisper, huggingface_hub, misaki.en  # noqa: F401
        out["kokoro"] = True
    except Exception as e:
        print(f"[health] kokoro engine import failed: {e}", file=sys.stderr, flush=True)
        out["kokoro"] = False
    try:
        import sympy, latex2sympy2  # noqa: F401
        out["math"] = True
    except Exception as e:
        print(f"[health] math engine import failed: {e}", file=sys.stderr, flush=True)
        out["math"] = False
    return out


_ENGINES = _probe_engines()


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


# ---------------------------------------------------------------------------
# /check — deterministic math checking (M2). The CAS decides correctness;
# the LLM only diagnoses. Everything here is lazy: sympy/latex2sympy2 import
# on first /check so voice-only installs keep working without them.
# ---------------------------------------------------------------------------

_engine_cache = None          # (sympy, latex2sympy) once imported OK
_engine_failed = False        # import already failed once — don't retry


def _get_engine():
    """Lazy import of the math engine. Returns (sympy, latex2sympy) or None."""
    global _engine_cache, _engine_failed
    if _engine_cache is not None:
        return _engine_cache
    if _engine_failed:
        return None
    try:
        import sympy as sp
        from latex2sympy2 import latex2sympy
    except Exception as e:  # ImportError or the antlr runtime breakage
        _engine_failed = True
        print(f"[check] math engine unavailable: {e}", file=sys.stderr, flush=True)
        return None
    _engine_cache = (sp, latex2sympy)
    print(f"[check] math engine ready (sympy {sp.__version__})", flush=True)
    return _engine_cache


class _CheckTimeout(Exception):
    """Raised when a single pair check blows its 2s budget -> verdict unknown."""


def _alarm_handler(signum, frame):
    raise _CheckTimeout()


def _with_timeout(fn, seconds=2):
    """Run fn with a hard `seconds` budget; _CheckTimeout on overrun.

    Uses SIGALRM on the main thread (the production server runs
    serve_forever there, so signal handlers bind). Any other thread
    (threaded servers, tests) falls back to a future with a timeout — the
    worker thread may leak if sympy is stuck in C, but the request still
    answers on time.
    """
    if signal is not None and threading.current_thread() is threading.main_thread():
        prev = signal.signal(signal.SIGALRM, _alarm_handler)
        signal.setitimer(signal.ITIMER_REAL, seconds)
        try:
            return fn()
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, prev)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(fn)
        try:
            return fut.result(timeout=seconds)
        except concurrent.futures.TimeoutError:
            raise _CheckTimeout()


class _ParseError(Exception):
    """LaTeX we can't turn into math — a parse problem, NOT wrong math."""


# Relation operators at brace-depth 0, longest-first so \neq beats \ne etc.
_REL_OPS = ("\\neq", "\\leq", "\\geq", "\\approx", "\\ne", "\\le", "\\ge", "=", "<", ">")
_REL_BUILDERS = {}  # filled lazily from sympy


def _strip_environments(latex: str) -> str:
    """Drop \\begin{...}/\\end{...} wrappers (aligned, gather, cases, ...)."""
    return re.sub(r"\\(?:begin|end)\{[^}]*\}", " ", latex)


def _last_line(latex: str) -> str:
    """Multi-line/aligned input: keep the LAST relation — the current line
    of working. Steps are sequential, so the final line is the claim."""
    s = _strip_environments(latex)
    lines = [ln.strip() for ln in re.split(r"\\\\|\n", s)]
    lines = [ln for ln in lines if ln]
    if not lines:
        raise _ParseError("empty")
    return lines[-1].replace("&", " ").rstrip(".,;").strip()


def _split_disjunction(s: str) -> list:
    """"x=1 \\lor x=4" / \\vee / bare ' or ' -> list of disjunct strings."""
    parts = re.split(r"\\lor|\\vee| or ", s)
    return [p.strip() for p in parts if p.strip()]


def _split_top_level_relation(s: str):
    """Find a relation operator at brace-depth 0. Returns (op, lhs, rhs)."""
    depth = 0
    i = 0
    while i < len(s):
        c = s[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth = max(0, depth - 1)
        elif depth == 0:
            for op in _REL_OPS:
                if s.startswith(op, i):
                    return op, s[:i].strip(), s[i + len(op):].strip()
        i += 1
    return None


def _parse_side(sp, latex2sympy, s: str):
    """Parse one expression side. Equations are split BEFORE this, so a bare
    number/symbol/expr is expected — latex2sympy2 pre-SOLVES whole equations
    ("2x+3=7" -> [Eq(x,2)]), which is why relations never reach it whole."""
    if not s:
        raise _ParseError("empty side")
    out = latex2sympy(s)
    if isinstance(out, list):
        if len(out) == 1:
            out = out[0]
        else:
            raise _ParseError("unexpected list")
    if isinstance(out, sp.Expr):
        return out
    raise _ParseError(f"not an expression: {type(out).__name__}")


def _rel_from_op(sp, op: str, lhs, rhs):
    if op in ("=", "\\approx"):
        return sp.Eq(lhs, rhs)
    if op in ("\\ne", "\\neq"):
        return sp.Ne(lhs, rhs)
    if op in ("\\le", "\\leq"):
        return sp.Le(lhs, rhs)
    if op in ("\\ge", "\\geq"):
        return sp.Ge(lhs, rhs)
    if op == "<":
        return sp.StrictLessThan(lhs, rhs)
    return sp.StrictGreaterThan(lhs, rhs)


def _parse_item(latex: str, sp, latex2sympy) -> dict:
    """LaTeX -> {"kind": expr|rel|or|and, ...}. Raises _ParseError."""
    line = _last_line(latex)
    disjuncts = _split_disjunction(line)
    items = [_parse_single(d, sp, latex2sympy) for d in disjuncts]
    if len(items) == 1:
        return items[0]
    # "x = 1 or x = 4" claims ANY disjunct — a solution-set union.
    return {"kind": "or", "items": items}


def _parse_single(s: str, sp, latex2sympy) -> dict:
    split = _split_top_level_relation(s)
    if split is None:
        return {"kind": "expr", "expr": _parse_side(sp, latex2sympy, s)}
    op, lhs_s, rhs_s = split
    # chained "a = b = c": all segments must agree (conjunction of Eq).
    segs = [lhs_s]
    rest = rhs_s
    while True:
        nxt = _split_top_level_relation(rest)
        if nxt is None:
            segs.append(rest)
            break
        n_op, n_lhs, n_rhs = nxt
        if n_op != op:
            raise _ParseError("mixed relation chain")
        segs.append(n_lhs)
        rest = n_rhs
    parts = [_parse_side(sp, latex2sympy, g) for g in segs]
    rels = [_rel_from_op(sp, op, parts[0], p) for p in parts[1:]]
    if len(rels) == 1:
        return {"kind": "rel", "rel": rels[0]}
    return {"kind": "and", "items": [{"kind": "rel", "rel": r} for r in rels]}


_ASSUMPTION_KEYS = {"real", "positive", "negative", "integer", "nonzero", "complex"}


def _apply_assumptions(item: dict, ctx: dict) -> dict:
    """Rebuild symbols per the request's assumptions (e.g. x: {real: true})
    so domain solving and numeric probes respect them."""
    sp = ctx["sp"]
    assumed = ctx.setdefault("assumed", {})
    spec = ctx.get("sym_assumptions") or {}

    def map_sym(sym):
        want = spec.get(sym.name) or {}
        kwargs = {k: bool(v) for k, v in want.items() if k in _ASSUMPTION_KEYS}
        key = (sym.name, tuple(sorted(kwargs.items())))
        if key not in assumed:
            assumed[key] = sp.Symbol(sym.name, **kwargs) if kwargs else sym
        return assumed[key]

    def map_obj(obj):
        repl = {s: map_sym(s) for s in obj.free_symbols}
        return obj.subs(repl, simultaneous=True) if repl else obj

    out = dict(item)
    if out["kind"] in ("expr", "rel"):
        for fld in ("expr", "rel"):
            if fld in out:
                out[fld] = map_obj(out[fld])
    else:
        out["items"] = [_apply_assumptions(i, ctx) for i in out["items"]]
    return out


def _core_rel(item: dict, sp):
    """The relation whose solution set is the item's zero/validity set."""
    if item["kind"] == "expr":
        return sp.Eq(item["expr"], 0)
    return item["rel"]


def _zero_set(item: dict, ctx):
    """Solution/validity set of an item over the declared domain, or None if
    sympy can't produce one (-> that rung of the ladder is skipped)."""
    sp = ctx["sp"]
    domain = ctx["domain"]
    if item["kind"] == "or":
        parts = [_zero_set(i, ctx) for i in item["items"]]
        return sp.Union(*parts) if all(p is not None for p in parts) else None
    if item["kind"] == "and":
        parts = [_zero_set(i, ctx) for i in item["items"]]
        return sp.Intersection(*parts) if all(p is not None for p in parts) else None
    core = _core_rel(item, sp)
    free = sorted(core.free_symbols, key=str)
    if not free:
        # Constant statement: an equality is either tautological or empty.
        try:
            if isinstance(core, sp.Equality):
                return domain if bool(core.lhs == core.rhs) else sp.S.EmptySet
            return sp.S.EmptySet  # constant inequalities: treat as undecidable
        except Exception:
            return None
    if len(free) == 1:
        x = free[0]
        try:
            return sp.solveset(core, x, domain=domain)
        except Exception:
            pass
        try:
            sols = sp.solve(core, x)
            flat = [s[x] if isinstance(s, dict) else s for s in sols]
            return sp.FiniteSet(*flat)
        except Exception:
            return None
    try:  # multivariate: solve returns lists of tuples
        sols = sp.solve(core, free)
        tuples = []
        for s in sols:
            if isinstance(s, dict):
                tuples.append(tuple(s.get(v) for v in free))
            elif isinstance(s, (tuple, list)):
                tuples.append(tuple(s))
            else:
                tuples.append((s,))
        return sp.FiniteSet(*tuples)
    except Exception:
        return None


def _is_zero(sp, e) -> bool:
    try:
        if e.is_zero is True:
            return True
    except Exception:
        pass
    try:
        return bool(sp.simplify(e) == 0)
    except Exception:
        return False


def _vals_equal(sp, a, b) -> bool:
    try:
        if bool(a == b):
            return True
    except Exception:
        pass
    try:
        if _is_zero(sp, a - b):
            return True
    except Exception:
        pass
    try:
        return bool(abs((a - b).evalf()) < 1e-9)
    except Exception:
        return False


def _sample_points(n_symbols: int, sp):
    ints = list(range(-5, 6))
    if n_symbols == 1:
        rats = [sp.Rational(k, 2) for k in range(-9, 10, 2)]
        return ints + rats
    return ints


def _residual(item: dict, sp):
    """lhs-rhs for relations, the expression itself for bare expressions."""
    if item["kind"] == "expr":
        return item["expr"]
    return item["rel"].lhs - item["rel"].rhs


def _satisfied(item: dict, env, sp) -> bool:
    """Truth of the item under an assignment (expr means expr = 0)."""
    if item["kind"] == "or":
        return any(_satisfied(i, env, sp) for i in item["items"])
    if item["kind"] == "and":
        return all(_satisfied(i, env, sp) for i in item["items"])
    if item["kind"] == "expr":
        return _is_zero(sp, item["expr"].subs(env))
    try:
        return bool(item["rel"].subs(env))
    except Exception:
        return False


def _json_number(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except Exception:
        return str(v)


def _find_counterexample(prev: dict, step: dict, ctx):
    """Rung 5: hunt for ONE concrete assignment where the lines disagree.
    Integer (and half-integer, single-var) points in [-5, 5]. Returns the
    mission-shaped counterexample dict or None (no evidence -> unknown)."""
    sp = ctx["sp"]
    free = sorted(
        {s for it in (prev, step) for s in _core_rel(it, sp).free_symbols},
        key=str,
    )
    if not free or len(free) > 2:
        return None
    points = _sample_points(len(free), sp)
    both_expr = prev["kind"] == "expr" and step["kind"] == "expr"
    r_prev, r_step = _residual(prev, sp), _residual(step, sp)
    for combo in itertools.product(points, repeat=len(free)):
        env = dict(zip(free, combo))
        if both_expr:
            v1, v2 = r_prev.subs(env), r_step.subs(env)
            if not _vals_equal(sp, v1, v2):
                return {
                    "assignments": {s.name: _json_number(env[s]) for s in free},
                    "prev_value": str(sp.simplify(v1)),
                    "step_value": str(sp.simplify(v2)),
                }
            continue
        t1, t2 = _satisfied(prev, env, sp), _satisfied(step, env, sp)
        if t1 == t2:
            continue
        v1, v2 = r_prev.subs(env), r_step.subs(env)
        return {
            "assignments": {s.name: _json_number(env[s]) for s in free},
            "prev_value": str(sp.simplify(v1)),
            "step_value": str(sp.simplify(v2)),
        }
    return None


def _sample_all_equal(sp, e1, e2) -> bool:
    """Numeric probe used when sympy's equals() couldn't decide (None)."""
    free = sorted(e1.free_symbols | e2.free_symbols, key=str)
    if not free or len(free) > 2:
        return False
    for combo in itertools.product(_sample_points(len(free), sp), repeat=len(free)):
        env = dict(zip(free, combo))
        if not _vals_equal(sp, e1.subs(env), e2.subs(env)):
            return False
    return True


def _check_pair(prev: dict, step: dict, ctx):
    """The verdict ladder for one adjacent pair. Returns
    (verdict, basis, counterexample|None). A step is NEVER called wrong
    without evidence; "unknown" is a first-class verdict."""
    sp = ctx["sp"]
    # Rung 2 — algebraic equivalence, proven.
    if prev["kind"] == "expr" and step["kind"] == "expr":
        if _is_zero(sp, prev["expr"] - step["expr"]):
            return "equivalent", "proven", None
    elif (
        prev["kind"] == "rel"
        and step["kind"] == "rel"
        and isinstance(prev["rel"], sp.Equality)
        and isinstance(step["rel"], sp.Equality)
    ):
        d = (prev["rel"].lhs - prev["rel"].rhs) - (step["rel"].lhs - step["rel"].rhs)
        if _is_zero(sp, d):
            return "equivalent", "proven", None
    # Rung 3 — sympy's own equals(); None means "could not decide".
    diff_pair = None
    if prev["kind"] == "expr" and step["kind"] == "expr":
        diff_pair = (prev["expr"], step["expr"])
    elif (
        prev["kind"] == "rel"
        and step["kind"] == "rel"
        and isinstance(prev["rel"], sp.Equality)
        and isinstance(step["rel"], sp.Equality)
    ):
        diff_pair = (prev["rel"].lhs - prev["rel"].rhs, step["rel"].lhs - step["rel"].rhs)
    if diff_pair is not None:
        e1, e2 = diff_pair
        try:
            res = e1.equals(e2)
        except Exception:
            res = None
        if res is True:
            return "equivalent", "numeric_evidence", None
        if res is None:
            if _sample_all_equal(sp, e1, e2):
                return "equivalent", "numeric_evidence", None
            if prev["kind"] == "expr" and step["kind"] == "expr":
                cx = _find_counterexample(prev, step, ctx)
                if cx is not None:
                    return "not_equivalent", "numeric_evidence", cx
                # numeric probe disagreed but no clean counterexample found
                return "unknown", "none", None
            # relations: a disagreeing probe on lhs-rhs isn't a root-set
            # counterexample — fall through to implication rungs.
    # Rung 4 — implication probes over the declared domain (STACK's
    # marks): squaring both sides / cancelling are VALID one-way moves a
    # naive checker flags wrong.
    a_set, b_set = _zero_set(prev, ctx), _zero_set(step, ctx)
    if a_set is not None and b_set is not None:
        fwd = a_set.is_subset(b_set)   # sol(prev) <= sol(step): prev => step
        bwd = b_set.is_subset(a_set)   # sol(step) <= sol(prev): step => prev
        if fwd is True and bwd is True:
            return "equivalent_same_roots", "proven", None
        if fwd is True:
            return "implied_forward", "proven", None
        if bwd is True:
            return "implied_backward", "proven", None
    # Rung 5 — not_equivalent ONLY with a concrete counterexample.
    cx = _find_counterexample(prev, step, ctx)
    if cx is not None:
        return "not_equivalent", "numeric_evidence", cx
    return "unknown", "none", None


def _ms(t0: float) -> int:
    return int((time.time() - t0) * 1000)


def run_check(payload: dict, engine) -> dict:
    """Check every step in isolation (one bad line never blocks others),
    then the goal against the final parsed step."""
    sp, latex2sympy = engine
    assumptions = payload.get("assumptions")
    if not isinstance(assumptions, dict):
        assumptions = {}
    domain = sp.S.Complexes if str(assumptions.get("domain", "real")).lower() in (
        "complex", "c") else sp.S.Reals
    ctx = {
        "sp": sp,
        "domain": domain,
        "sym_assumptions": assumptions.get("symbols")
        if isinstance(assumptions.get("symbols"), dict)
        else {},
        "assumed": {},
    }
    results = []
    prev_item = None
    last_item = last_id = None
    for idx, raw in enumerate(payload.get("steps") or []):
        if not isinstance(raw, dict):
            results.append({"id": f"s{idx+1}", "status": "parse_error", "elapsed_ms": 0})
            continue
        sid = str(raw.get("id") or f"s{idx+1}")
        latex = raw.get("latex")
        t0 = time.time()
        if not isinstance(latex, str) or not latex.strip():
            results.append({"id": sid, "status": "parse_error", "elapsed_ms": _ms(t0)})
            continue
        try:
            item = _apply_assumptions(_parse_item(latex, sp, latex2sympy), ctx)
        except Exception:
            results.append({"id": sid, "status": "parse_error", "elapsed_ms": _ms(t0)})
            continue
        last_item, last_id = item, sid
        if prev_item is None:
            # No predecessor: nothing to judge against — unknown, never wrong.
            results.append(
                {"id": sid, "status": "ok", "verdict": "unknown", "basis": "none", "elapsed_ms": _ms(t0)}
            )
        else:
            try:
                verdict, basis, cx = _with_timeout(
                    lambda p=prev_item, s=item: _check_pair(p, s, ctx), seconds=2
                )
            except _CheckTimeout:
                verdict, basis, cx = "unknown", "none", None
            except Exception as e:
                print(f"[check] pair check error at {sid}: {e}", file=sys.stderr, flush=True)
                verdict, basis, cx = "unknown", "none", None
            rec = {"id": sid, "status": "ok", "verdict": verdict, "basis": basis, "elapsed_ms": _ms(t0)}
            if cx is not None:
                rec["counterexample"] = cx
            results.append(rec)
        prev_item = item
    goal = None
    goal_latex = payload.get("goal_latex")
    if isinstance(goal_latex, str) and goal_latex.strip():
        reached, by_step = False, None
        if last_item is not None:
            try:
                gitem = _apply_assumptions(_parse_item(goal_latex, sp, latex2sympy), ctx)
                verdict, _, _ = _with_timeout(
                    lambda l=last_item, g=gitem: _check_pair(l, g, ctx), seconds=2
                )
                reached = verdict in ("equivalent", "equivalent_same_roots", "implied_forward")
                by_step = last_id
            except _CheckTimeout:
                pass
            except Exception as e:
                print(f"[check] goal check error: {e}", file=sys.stderr, flush=True)
        goal = {"reached": reached, "by_step": by_step}
    return {
        "steps": results,
        "goal": goal,
        "engine": {"name": "sympy", "version": sp.__version__},
    }


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
            body = {"ok": True, "model": _model_id, "voices": ALL_VOICES, "engines": _ENGINES}
            if _TOKEN:
                body["token"] = _TOKEN  # app's spawn-time handshake (fast, side-effect-free)
            self._json(200, body)
        elif self.path == "/voices":
            self._json(200, {"voices": ALL_VOICES})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path == "/check":
            self._handle_check()
            return
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
                f"[kokoro] voice={voice} {len(text)} chars -> {len(data)} bytes in {time.time() - t0:.1f}s",
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
            f"[qwen-tts] voice={voice} {len(text)} chars -> {len(data)} bytes in {time.time() - t0:.1f}s",
            file=sys.stderr,
            flush=True,
        )
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


    def _handle_check(self) -> None:
        engine = _get_engine()
        if engine is None:
            self._json(503, {"error": "math engine unavailable"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            self._json(400, {"error": f"bad json: {e}"})
            return
        if not isinstance(payload, dict) or not isinstance(payload.get("steps"), list):
            self._json(400, {"error": "body must be a JSON object with a 'steps' list"})
            return
        t0 = time.time()
        try:
            result = run_check(payload, engine)
        except Exception as e:
            print(f"[check] internal error: {e}", file=sys.stderr, flush=True)
            self._json(500, {"error": f"check failed: {e}"})
            return
        ok = sum(1 for s in result["steps"] if s.get("status") == "ok")
        print(
            f"[check] {ok}/{len(result['steps'])} steps ok in {time.time() - t0:.2f}s",
            flush=True,
        )
        self._json(200, result)


def main() -> None:
    global _model_id, _TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8737)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--token", default=None, help="hex token echoed by /health")
    ap.add_argument("--preload", action="store_true", help="load the model at startup")
    args = ap.parse_args()
    _model_id = args.model
    _TOKEN = args.token
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
    token_note = " (token-protected)" if _TOKEN else ""
    print(
        f"[qwen-tts] listening on http://127.0.0.1:{args.port} (model {_model_id}){token_note}",
        file=sys.stderr,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
