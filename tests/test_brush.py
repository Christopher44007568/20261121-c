import numpy as np
import pytest

from meshbrush import (BrushEngine, BrushSettings, Camera, PaintLayer,
                       painted_area_by_component)
from meshbrush.geometry import closest_point_on_triangle
from tests.meshes import (folded_sheet, forked_sheet, grid_mesh,
                          sliver_mesh, two_parallel_sheets)


def _engine(mesh, radius=0.45, **kwargs):
    settings = BrushSettings(radius=radius, **kwargs)
    return BrushEngine(mesh, settings)


def test_dab_paints_circular_world_radius_region():
    mesh = grid_mesh(8, 8, spacing=0.2)
    engine = _engine(mesh, radius=0.45)
    engine.begin_stroke()
    report = engine.dab_from_ray(np.array([0.8, 0.8, 3.0]),
                                 np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    for face_id in report.painted_faces:
        v0, v1, v2 = mesh.face_points(face_id)
        nearest = closest_point_on_triangle(report.hit_point, v0, v1, v2)
        assert np.linalg.norm(nearest - report.hit_point) <= 0.45 + 1e-9
    assert len(report.painted_faces) >= 4
    assert report.painted_area > 0.0


def test_back_layer_is_never_painted_through_front_layer():
    mesh, front_count = two_parallel_sheets(gap=0.02, size=8,
                                            spacing=0.2)
    engine = _engine(mesh, radius=0.8)
    engine.begin_stroke()
    report = engine.dab_from_ray(np.array([0.8, 0.8, 3.0]),
                                 np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    assert report.painted_faces
    assert max(report.painted_faces) < front_count
    by_component = painted_area_by_component(mesh, engine.layer)
    assert set(by_component) == {0}
    back_paint = engine.layer.face_paint[front_count:].sum()
    assert back_paint == 0.0


def test_components_are_labelled_separately_for_close_sheets():
    mesh, front_count = two_parallel_sheets(gap=0.02)
    labels = mesh.connected_components()
    assert set(np.unique(labels)) == {0, 1}
    assert labels[:front_count].max() == 0
    assert labels[front_count:].min() == 1


def test_world_radius_stays_constant_after_camera_moves():
    mesh = grid_mesh(10, 10, spacing=0.2)
    engine = _engine(mesh, radius=0.4)
    camera = Camera(position=(1.0, 1.0, 4.0), target=(1.0, 1.0, 0.0),
                    up=(0.0, 1.0, 0.0))
    engine.begin_stroke()
    first = engine.dab_from_ray(*camera.screen_ray(0.0, 0.0))
    camera.orbit(yaw_delta=0.9, pitch_delta=0.2)
    second = engine.dab_from_ray(*camera.screen_ray(0.0, 0.0))
    engine.end_stroke()
    for report in (first, second):
        center = report.hit_point
        for face_id in report.painted_faces:
            v0, v1, v2 = mesh.face_points(face_id)
            nearest = closest_point_on_triangle(center, v0, v1, v2)
            assert np.linalg.norm(nearest - center) <= 0.4 + 1e-9


def test_bifurcation_blocks_other_fork_branch():
    mesh = forked_sheet()
    engine = _engine(mesh, radius=1.6)
    engine.begin_stroke()
    report = engine.dab_from_ray(np.array([1.0, 1.0, 3.0]),
                                 np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    other_branches = {2, 3, 4, 5}
    assert not other_branches.intersection(report.painted_faces)
    assert other_branches.intersection(report.rejected_bifurcation)
    assert {0, 1}.issubset(set(report.painted_faces))


def test_tangent_grazing_dab_is_rejected():
    mesh = folded_sheet()
    engine = _engine(mesh, radius=1.0, tangent_angle_deg=40.0)
    engine.begin_stroke()
    report = engine.dab_from_ray(
        np.array([2.6, 1.0, 1.5]),
        np.array([-0.5, 0.0, -np.sqrt(0.75)]))
    engine.end_stroke()
    assert report.reason == "tangent_seed"
    assert not report.painted_faces


def test_sliver_triangle_is_flagged_in_report():
    mesh = sliver_mesh()
    engine = _engine(mesh, radius=2.0)
    quality = mesh.quality()
    assert quality.is_sliver[1]
    engine.begin_stroke()
    report = engine.dab_from_ray(np.array([0.4, 0.4, 2.0]),
                                 np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    assert 1 in report.sliver_faces


def test_sliver_cannot_seed_a_stroke():
    mesh = sliver_mesh()
    engine = _engine(mesh, radius=2.0)
    centroid = mesh.face_centroids()[1]
    engine.begin_stroke()
    report = engine.dab_from_ray(centroid + np.array([0.0, 0.0, 2.0]),
                                 np.array([0.0, 0.0, -1.0]))
    engine.end_stroke()
    assert report.reason == "sliver_seed"


def test_cancel_restores_colors_and_clears_paint():
    mesh = grid_mesh(6, 6, spacing=0.25)
    layer = PaintLayer(mesh)
    before = layer.vertex_colors.copy()
    engine = BrushEngine(mesh, BrushSettings(radius=0.5), layer)
    engine.begin_stroke()
    engine.dab_from_ray(np.array([0.75, 0.75, 3.0]),
                        np.array([0.0, 0.0, -1.0]))
    assert not np.allclose(layer.vertex_colors, before)
    engine.cancel_stroke()
    assert np.allclose(layer.vertex_colors, before)
    assert np.count_nonzero(layer.face_paint) == 0
    assert not engine.stroke_active


def test_finished_stroke_keeps_paint():
    mesh = grid_mesh(6, 6, spacing=0.25)
    engine = _engine(mesh, radius=0.5)
    engine.begin_stroke()
    report = engine.dab_from_ray(np.array([0.75, 0.75, 3.0]),
                                 np.array([0.0, 0.0, -1.0]))
    result = engine.end_stroke()
    assert set(result.painted_faces) == set(report.painted_faces)
    assert np.count_nonzero(engine.layer.face_paint) > 0


def test_cancel_after_multiple_dabs_rolls_back_whole_stroke():
    mesh = grid_mesh(10, 10, spacing=0.25)
    layer = PaintLayer(mesh)
    before = layer.vertex_colors.copy()
    engine = BrushEngine(mesh, BrushSettings(radius=0.4), layer)
    engine.begin_stroke()
    for x in (0.5, 1.0, 1.5, 2.0):
        engine.dab_from_ray(np.array([x, 1.0, 3.0]),
                            np.array([0.0, 0.0, -1.0]))
    assert np.count_nonzero(layer.face_paint) > 1
    engine.cancel_stroke()
    assert np.allclose(layer.vertex_colors, before)
    assert np.count_nonzero(layer.face_paint) == 0


def test_dab_requires_active_stroke():
    mesh = grid_mesh(3, 3)
    engine = _engine(mesh)
    with pytest.raises(RuntimeError):
        engine.dab_from_ray(np.array([0.5, 0.5, 2.0]),
                            np.array([0.0, 0.0, -1.0]))
