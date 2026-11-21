#!/usr/bin/env bash
# Headless geometry analysis. Override GODOT_BIN to use a local engine build.
set -euo pipefail

GODOT_BIN="${GODOT_BIN:-godot}"
cd "$(dirname "$0")"

"$GODOT_BIN" --headless --import >/dev/null 2>&1 || true
"$GODOT_BIN" --headless -- --analyze
echo "Report: artifacts/geometry_analysis.json"
