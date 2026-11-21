#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GODOT_BIN="${GODOT_BIN:-godot}"

cd "$ROOT_DIR"
"$GODOT_BIN" \
  --path . \
  --display-driver x11 \
  --rendering-driver opengl3 \
  --resolution 1152x648 \
  -- --verify
