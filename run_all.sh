#!/usr/bin/env bash
# Full pipeline: regenerate test model, LOD levels, silhouette study, tests.
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-/tmp/testvenv/bin/python}"

echo "[1/4] 生成测试模型 (薄板 + 薄孔/槽孔 + 双色硬边 + UV 接缝 + 锁边零件)"
"$PY" src/qem_simplify/cli.py generate models/input/perforated_plate.obj

echo "[2/4] 逐级 LOD 简化 (默认 penalize 约束, bracket 零件锁边)"
"$PY" src/qem_simplify/cli.py lod models/input/perforated_plate.obj models/lod \
    --lock-part bracket --ratios 0.75 0.5 0.35 0.2 0.1

echo "[3/4] 多相机轮廓偏差测量与折衷曲线"
"$PY" src/qem_simplify/cli.py experiment models/input/perforated_plate.obj report \
    --ratios 0.75 0.5 0.35 0.2 0.1 \
    --cameras +z +x +y iso --resolution 256 --lock-part bracket

echo "[4/4] 单元测试"
"$PY" tests/test_simplifier.py
"$PY" tests/test_silhouette.py

echo "完成。查看 report/silhouette_metrics.csv 与 report/figures/。"
echo "浏览视图: $PY viewer/serve.py  然后打开 http://127.0.0.1:8123/"
