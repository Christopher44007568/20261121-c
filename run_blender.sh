#!/usr/bin/env bash
# Local wrapper: run the portable Blender with bundled system libraries.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLENDER_DIR="$ROOT/work/blender-5.0.1-linux-x64"
export LD_LIBRARY_PATH="$ROOT/work/local-libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

exec "$BLENDER_DIR/blender" "$@"
