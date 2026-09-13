#!/bin/bash
# Palimpsest first-run voice bootstrap (idempotent).
#
# Guarantees a working Python environment for resources/tts/qwen_server.py:
#   1. PALIMPSEST_TTS_PYTHON, if set and its imports already work -> done.
#   2. ~/.palimpsest/venv, if it already imports the voice stack  -> done.
#   3. Otherwise create the venv and pip-install the server requirements
#      (READ qwen_server.py before editing: it serves on stdlib http.server,
#      so the deps are mlx-audio / mlx-whisper / huggingface_hub — NOT
#      fastapi/uvicorn).
# On success ~/.palimpsest/ready is touched. The onboarding overlay streams
# this script's stdout line-by-line.

set -euo pipefail

PALIMPSEST_DIR="$HOME/.palimpsest"
VENV="$PALIMPSEST_DIR/venv"
READY="$PALIMPSEST_DIR/ready"

imports_ok() {
  # The server dies at runtime without all four; verify together. `misaki`
  # is Kokoro's phonemizer — mlx-audio imports without it, then every
  # Kokoro request 500s and the narration cursor races in silence.
  "$1" -c 'import mlx_audio, mlx_whisper, huggingface_hub, misaki' >/dev/null 2>&1
}

# 1. Env-provided interpreter (dev machine: a fully working venv).
if [ -n "${PALIMPSEST_TTS_PYTHON:-}" ] && imports_ok "$PALIMPSEST_TTS_PYTHON"; then
  echo "VOICE ENVIRONMENT READY (PALIMPSEST_TTS_PYTHON)"
  mkdir -p "$PALIMPSEST_DIR"
  touch "$READY"
  exit 0
fi

# 2. Managed venv already works.
if [ -x "$VENV/bin/python" ] && imports_ok "$VENV/bin/python"; then
  echo "VOICE ENVIRONMENT READY ($VENV)"
  touch "$READY"
  exit 0
fi

# 3. Build the managed venv.
echo "CREATING PYTHON VENV AT $VENV"
mkdir -p "$PALIMPSEST_DIR"
python3 -m venv "$VENV"

echo "INSTALLING VOICE PACKAGES (MLX-AUDIO, MLX-WHISPER, MISAKI, HUGGINGFACE-HUB)"
echo "NEURAL MODELS DOWNLOAD ON FIRST NARRATION, NOT NOW"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet \
  "mlx-audio>=0.1" \
  "mlx-whisper>=0.1" \
  "huggingface_hub>=0.20" \
  "misaki[en]>=0.7"

if imports_ok "$VENV/bin/python"; then
  echo "VOICE ENVIRONMENT READY"
  touch "$READY"
else
  echo "ERROR: VOICE ENVIRONMENT INCOMPLETE — IMPORT CHECK FAILED"
  exit 1
fi
