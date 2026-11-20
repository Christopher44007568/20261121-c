#!/usr/bin/env bash
# 演示边界/UV 接缝的 lock 与 penalize 两种约束策略差异
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-/tmp/testvenv/bin/python}"
"$PY" src/qem_simplify/cli.py lod models/input/perforated_plate.obj models/lod_locked \
    --lock-part bracket --boundary-policy lock --seam-policy lock \
    --ratios 0.5 0.25 0.1
echo "锁定策略输出在 models/lod_locked/，对照默认 models/lod/"
