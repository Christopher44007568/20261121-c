"""Fail if the HLSL profile constants drift away from the Python reference.

Parses the literal arrays from SSSProfile.hlsl and compares them against
tools/sss/profile.py, so the shader and the offline model cannot silently
diverge.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sss.profile import (  # noqa: E402
    LOBE_RADIUS_M,
    LOBE_WEIGHT,
    MEAN_FREE_PATH_M,
    SEPARABLE_KERNEL_SCALE,
)

HLSL = ROOT / "UnitySSSDemo" / "Assets" / "Shaders" / "SSSProfile.hlsl"


def parse_float3_array(name: str) -> np.ndarray:
    text = HLSL.read_text()
    pattern = rf"{re.escape(name)}\s*(?:\[[^\]]*\])?\s*=\s*(.*?);"
    match = re.search(pattern, text, flags=re.S)
    if match is None:
        raise AssertionError(f"could not find {name} in {HLSL}")
    body = match.group(1)
    rows = re.findall(r"float3\(([^)]*)\)", body)
    return np.array([[float(token) for token in row.split(",")] for row in rows])


def parse_float3(name: str) -> np.ndarray:
    text = HLSL.read_text()
    match = re.search(rf"{re.escape(name)}\s*=\s*float3\(([^)]*)\)", text)
    if match is None:
        raise AssertionError(f"could not find {name} in {HLSL}")
    return np.array([float(token) for token in match.group(1).split(",")])


def parse_scalar(name: str) -> float:
    text = HLSL.read_text()
    match = re.search(rf"{re.escape(name)}\s*=\s*([0-9.eE+-]+)f?", text)
    if match is None:
        raise AssertionError(f"could not find {name} in {HLSL}")
    return float(match.group(1))


def main() -> None:
    hlsl_radii = parse_float3_array("SSS_LobeRadiusM")
    hlsl_weights = parse_float3_array("SSS_LobeWeight")
    hlsl_mfp = parse_float3("SSS_MeanFreePathM")
    hlsl_scale = parse_scalar("SSS_SEPARABLE_KERNEL_SCALE")

    for label, hlsl, python in (
        ("lobe radii", hlsl_radii, LOBE_RADIUS_M),
        ("lobe weights", hlsl_weights, LOBE_WEIGHT),
        ("mean free path", hlsl_mfp, MEAN_FREE_PATH_M),
    ):
        if not np.allclose(hlsl, python, rtol=1e-6, atol=1e-9):
            raise AssertionError(f"{label} mismatch:\nHLSL={hlsl}\nPython={python}")
    if abs(hlsl_scale - SEPARABLE_KERNEL_SCALE) > 1e-6:
        raise AssertionError("separable kernel scale mismatch")

    print("HLSL/Python profile parity OK")
    print(f"  radii      {hlsl_radii.shape} array matched")
    print(f"  weights    {hlsl_weights.shape} array matched")
    print(f"  mfp        {hlsl_mfp}")
    print(f"  kernel     {hlsl_scale}")


if __name__ == "__main__":
    main()
