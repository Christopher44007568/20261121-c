"""Headless end-to-end demonstration of the view-ray brush.

Run with ``python -m examples.headless_demo`` from the project root.  No
windowing system is required: the script builds the diagnostic meshes,
simulates camera rays by hand, and prints what the brush painted and which
guards fired.  It also verifies that cancelling a stroke restores colors.
"""

from __future__ import annotations

import numpy as np

from meshbrush import (BrushEngine, BrushSettings, Camera,
                       painted_area_by_component)
from tests.meshes import (forked_sheet, grid_mesh, recessed_pocket,
                          sliver_mesh, two_parallel_sheets)


def section(title):
    print(f"\n=== {title} ===")


def demo_circular_brush():
    section("circular world-radius brush")
    mesh = grid_mesh(10, 10, spacing=0.2)
    engine = BrushEngine(mesh, BrushSettings(radius=0.5))
    engine.begin_stroke()
    report = engine.dab_from_ray((1.0, 1.0, 4.0), (0.0, 0.0, -1.0))
    engine.end_stroke()
    print(f"painted {len(report.painted_faces)} faces, "
          f"area={report.painted_area:.4f}")


def demo_back_layer():
    section("close but disconnected back layer")
    mesh, front_count = two_parallel_sheets(gap=0.02)
    engine = BrushEngine(mesh, BrushSettings(radius=0.6))
    engine.begin_stroke()
    engine.dab_from_ray((0.6, 0.6, 3.0), (0.0, 0.0, -1.0))
    engine.end_stroke()
    print("painted area by component:",
          painted_area_by_component(mesh, engine.layer))
    print("back-sheet paint weight:",
          float(engine.layer.face_paint[front_count:].sum()))


def demo_fork_and_depth():
    section("bifurcation and depth guards")
    fork = forked_sheet()
    engine = BrushEngine(fork, BrushSettings(radius=1.5))
    engine.begin_stroke()
    report = engine.dab_from_ray((1.0, 1.0, 3.0), (0.0, 0.0, -1.0))
    engine.end_stroke()
    print(f"fork painted={report.painted_faces} "
          f"blocked={report.rejected_bifurcation}")

    pocket = recessed_pocket()
    engine2 = BrushEngine(
        pocket, BrushSettings(radius=2.5, depth_tolerance_ratio=0.1))
    engine2.begin_stroke()
    report2 = engine2.dab_from_ray((0.5, 1.0, 3.0), (0.0, 0.0, -1.0))
    engine2.end_stroke()
    print(f"pocket painted={report2.painted_faces} "
          f"depth-blocked={report2.rejected_depth}")


def demo_camera_motion():
    section("constant world radius while the camera moves")
    mesh = grid_mesh(8, 8, spacing=0.25)
    engine = BrushEngine(mesh, BrushSettings(radius=0.45))
    camera = Camera(position=(1.0, 1.0, 4.0), target=(1.0, 1.0, 0.0),
                    up=(0.0, 1.0, 0.0))
    engine.begin_stroke()
    before = engine.dab_from_ray(*camera.screen_ray(0.0, 0.0))
    camera.orbit(0.7, 0.15)
    after = engine.dab_from_ray(*camera.screen_ray(0.0, 0.0))
    engine.end_stroke()
    print(f"first dab={len(before.painted_faces)} faces, "
          f"second dab after orbit={len(after.painted_faces)} faces, "
          f"radius stayed 0.45 world units")


def demo_sliver_and_cancel():
    section("sliver reporting and stroke cancellation")
    mesh = sliver_mesh()
    engine = BrushEngine(mesh, BrushSettings(radius=2.0))
    engine.begin_stroke()
    colors_before = engine.layer.vertex_colors.copy()
    report = engine.dab_from_ray((0.4, 0.4, 2.0), (0.0, 0.0, -1.0))
    print(f"sliver faces touched: {report.sliver_faces}")
    engine.cancel_stroke()
    restored = np.allclose(colors_before, engine.layer.vertex_colors)
    print(f"colors restored after cancel: {restored}")


if __name__ == "__main__":
    demo_circular_brush()
    demo_back_layer()
    demo_fork_and_depth()
    demo_camera_motion()
    demo_sliver_and_cancel()
