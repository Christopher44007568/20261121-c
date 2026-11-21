import numpy as np

from meshbrush import (BrushEngine, BrushSettings,
                       painted_area_by_component, painted_face_count,
                       fraction_painted, sliver_painted_faces)
from tests.meshes import grid_mesh, recessed_pocket, sliver_mesh


def test_depth_guard_blocks_connected_recessed_wall():
    mesh = recessed_pocket()
    engine = BrushEngine(
        mesh,
        BrushSettings(radius=2.5, depth_tolerance_ratio=0.1))
    engine.begin_stroke()
    report = engine.dab_from_ray(np.array([0.5, 1.0, 3.0]),
                                 np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    assert 0 in report.painted_faces
    assert report.rejected_depth
    blocked = report.rejected_depth[0]
    assert blocked not in report.painted_faces
    recessed = {3, 4, 5}
    assert not recessed.intersection(report.painted_faces)


def test_painted_area_accounting_matches_triangle_areas():
    mesh = grid_mesh(4, 4, spacing=0.5)
    engine = BrushEngine(mesh, BrushSettings(radius=0.9))
    engine.begin_stroke()
    report = engine.dab_from_ray(np.array([1.0, 1.0, 3.0]),
                                 np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    quality = mesh.quality()
    expected = float(quality.area[report.painted_faces].sum())
    assert abs(report.painted_area - expected) < 1.0e-12
    assert painted_face_count(engine.layer) == len(report.painted_faces)
    assert 0.0 < fraction_painted(mesh, engine.layer) <= 1.0


def test_stats_group_area_by_component():
    mesh = grid_mesh(3, 3, spacing=0.5)
    engine = BrushEngine(mesh, BrushSettings(radius=0.6))
    engine.begin_stroke()
    engine.dab_from_ray(np.array([0.75, 0.75, 3.0]),
                        np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    totals = painted_area_by_component(mesh, engine.layer)
    assert list(totals) == [0]
    assert totals[0] > 0.0


def test_sliver_statistics_list_painted_thin_faces():
    mesh = sliver_mesh()
    engine = BrushEngine(mesh, BrushSettings(radius=3.0))
    engine.begin_stroke()
    engine.dab_from_ray(np.array([0.4, 0.4, 2.0]),
                        np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    assert 1 in sliver_painted_faces(mesh, engine.layer)


def test_strength_blends_colors_without_clamping_geometry():
    mesh = grid_mesh(2, 2, spacing=0.5)
    engine = BrushEngine(
        mesh, BrushSettings(radius=0.8, strength=0.5,
                            color=(1.0, 0.0, 0.0)))
    engine.begin_stroke()
    report = engine.dab_from_ray(np.array([0.5, 0.5, 3.0]),
                                 np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    assert report.painted_faces
    colors = engine.layer.vertex_colors
    assert np.all(colors[:, 1] > 0.0)
    assert np.all(colors <= 1.0 + 1e-12)
