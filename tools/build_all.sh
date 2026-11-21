#!/usr/bin/env bash
# Regenerates every offline artifact for the SSS demo.
# Requires numpy, matplotlib and pillow on PYTHONPATH.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export MPLBACKEND=Agg
export PYTHONPATH="${PYTHONPATH:-}:${ROOT}/tools"

python3 "${ROOT}/tools/check_parity.py"
python3 "${ROOT}/tools/validate_diffusion.py"
python3 "${ROOT}/tools/run_edge_sweep.py"
python3 "${ROOT}/tools/figures/plot_cross_sections.py"
python3 "${ROOT}/tools/figures/plot_edge_views.py"
python3 "${ROOT}/tools/figures/plot_scene_figures.py"
python3 "${ROOT}/tools/figures/plot_id_gate.py"
python3 "${ROOT}/tools/figures/make_preview_gif.py"

echo
echo "All artifacts written to ${ROOT}/artifacts/generated"
