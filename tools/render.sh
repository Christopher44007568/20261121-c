#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GODOT_BIN="${GODOT_BIN:-godot}"
PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
FRAME_DIR="$(mktemp -d)"
trap 'rm -rf "$FRAME_DIR"' EXIT

mkdir -p artifacts/generated
"$GODOT_BIN" \
  --path . \
  --rendering-method gl_compatibility \
  --resolution 1280x720 \
  --write-movie "$FRAME_DIR/frame.png" \
  --fixed-fps 30 \
  -- --capture

ffmpeg -y -v error \
  -framerate 30 \
  -i "$FRAME_DIR/frame%08d.png" \
  -c:v libx264 \
  -preset medium \
  -crf 18 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  artifacts/normal_prefilter_lab.mp4

"$PYTHON_BIN" tools/analyze.py \
  --input "$FRAME_DIR" \
  --out artifacts \
  --generated artifacts/generated \
  --calibration calibration.json
