"""Headless correctness tests for the displacement transfer addon.

Run with:
    blender --background --factory-startup --python tests/test_transfer.py

Writes artifacts/test_results.json and exits non-zero on failure.
"""
import json
import math
import os
import sys
import time

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "addons"))
sys.path.insert(0, os.path.join(REPO, "scripts"))

import bpy  # noqa: E402

from mesh_displacement_transfer import analysis, core  # noqa: E402
from sole_builder import build_sole  # noqa: E402
from sole_deform import deform_positions  # noqa: E402

LENGTH = 0.28


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)


def rotation_matrix(axis, angle):
    axis = np.asarray(axis, dtype=np.float64)
    axis /= np.linalg.norm(axis)
    x, y, z = axis
    c, s = math.cos(angle), math.sin(angle)
    C = 1.0 - c
    return np.array([
        [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
        [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
        [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
    ])


def test_demo_scene():
    reset_scene()
    low = build_sole("T_Low", rings=8, segments=16)
    high = build_sole("T_High", rings=24, segments=32)
    seam = analysis.find_seam_vertices(high, "part_group")
    analysis.assign_lock_group(high, seam, "MDT_SeamLock", falloff=1)
    binding = core.bind(low, high)
    low_rest, _ = core._triangulated(low.data)
    high_rest = binding["high_rest"]
    pos = core.transfer(binding, low_rest)
    rest_error = float(np.abs(pos - high_rest).max())
    low_def = deform_positions(low_rest, LENGTH, bend_deg=25.0, twist_deg=30.0)
    pos_def = core.transfer(binding, low_def)
    lock = binding["lock"]
    locked_mask = lock >= 0.999
    seam_error = float(np.abs(pos_def[locked_mask]
                              - high_rest[locked_mask]).max()) \
        if locked_mask.any() else 0.0
    interior = lock < 0.001
    interior_motion = float(np.linalg.norm(
        pos_def[interior] - high_rest[interior], axis=1).max())
    core.apply_positions(high, pos_def)
    thick_after, mask_after = analysis.measure_thickness(high)
    core.apply_positions(high, high_rest)
    thick_before, mask_before = analysis.measure_thickness(high)
    stats_b = analysis.thickness_stats(thick_before, mask_before)
    stats_a = analysis.thickness_stats(thick_after, mask_after)
    return {
        "rest_error": rest_error,
        "seam_error": seam_error,
        "interior_motion": interior_motion,
        "thickness_before": stats_b.get("mean", 0.0),
        "thickness_after": stats_a.get("mean", 0.0),
    }


def test_rigid_rotation():
    """A rigid transform of the low mesh must rigidly move the high mesh."""
    reset_scene()
    low = build_sole("R_Low", rings=6, segments=12)
    high = build_sole("R_High", rings=12, segments=24)
    binding = core.bind(low, high)
    low_rest, _ = core._triangulated(low.data)
    high_rest = binding["high_rest"]
    rot = rotation_matrix([0.3, 1.0, 0.2], math.radians(63.0))
    shift = np.array([0.05, -0.02, 0.08])
    low_moved = low_rest @ rot.T + shift
    expected = high_rest @ rot.T + shift
    pos = core.transfer(binding, low_moved)
    return {"rigid_rotation_error": float(np.abs(pos - expected).max())}


def main():
    t0 = time.perf_counter()
    results = {}
    results["demo"] = test_demo_scene()
    results["rigid_rotation"] = test_rigid_rotation()
    checks = [
        ("rest_error", results["demo"]["rest_error"] < 1e-5),
        ("seam_error", results["demo"]["seam_error"] < 1e-6),
        ("interior_motion", results["demo"]["interior_motion"] > 1e-3),
        ("thickness_before", 0.005 < results["demo"]["thickness_before"] < 0.08),
        ("thickness_after", 0.005 < results["demo"]["thickness_after"] < 0.08),
        ("rigid_rotation_error",
         results["rigid_rotation"]["rigid_rotation_error"] < 1e-5),
    ]
    failures = [name for name, ok in checks if not ok]
    out = {
        "passed": not failures,
        "elapsed_seconds": time.perf_counter() - t0,
        "results": results,
        "failures": failures,
    }
    os.makedirs(os.path.join(REPO, "artifacts"), exist_ok=True)
    path = os.path.join(REPO, "artifacts", "test_results.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2)
    print("TEST_RESULTS", json.dumps(out))
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
