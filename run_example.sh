#!/usr/bin/env bash
# End-to-end demo: generate sample parts, run unit tests, then batch-render.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

python3 -m unittest tests.test_frame_math -v
./run_blender.sh --background --python blender_card_render/make_examples.py
./run_blender.sh --background --python blender_card_render/render_cards.py \
    -- --config blender_card_render/examples/job_config.json

echo "Done. See blender_card_render/output/render_manifest.json"
