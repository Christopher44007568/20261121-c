"""Motion-vector reprojection, exposure scaling and edge-case masks."""

from __future__ import annotations

import numpy as np
import pytest

from conftest import make_renderer
from motion_blur.transform import Transform


def test_first_frame_has_no_history_and_zero_vectors():
    renderer = make_renderer()
    result = renderer.step()
    assert not result.motion.history_valid.any()
    np.testing.assert_array_equal(result.motion.displacement, 0.0)


def test_reprojected_vector_matches_independent_rotation():
    renderer = make_renderer(angular_velocity=7.0)
    renderer.step()
    result = renderer.step()
    mv, gb = result.motion, result.gbuffer
    prop = renderer.objects[0]
    omega = 7.0
    dt = renderer.frame_interval
    fg = gb.object_id == 1
    assert fg.any()

    # Independent reimplementation: world -> local -> previous world.
    current_tf = prop.world_transform(result.t)
    prev_tf = prop.world_transform(result.t - dt)
    local = current_tf.inverse().transform_points(gb.world[fg])
    expected_prev_world = prev_tf.transform_points(local)
    prev_camera = renderer._prev_camera
    expected_xy, _d, valid = prev_camera.project(expected_prev_world)
    assert valid.all()
    t_open, _t_close = renderer.shutter_interval(result.t)
    scale_open = (t_open - result.t) / dt
    current_xy = np.stack(np.meshgrid(
        np.arange(gb.width) + 0.5, np.arange(gb.height) + 0.5), axis=2)
    expected_start = current_xy[fg] + (expected_xy - current_xy[fg]) * scale_open
    np.testing.assert_allclose(mv.start[fg], expected_start, atol=1e-6)


def test_vectors_are_nonzero_with_object_and_camera_moving():
    renderer = make_renderer(angular_velocity=8.0, pan_speed=1.5, bob_speed=2.0)
    renderer.step()
    result = renderer.step()
    fg = result.gbuffer.object_id == 1
    assert result.motion.magnitude[fg].max() > 1.0


def test_exposure_interval_scales_vector_length_linearly():
    renderer_half = make_renderer(exposure_fraction=0.5)
    renderer_full = make_renderer(exposure_fraction=1.0)
    for r in (renderer_half, renderer_full):
        r.step()
    half = renderer_half.step().motion
    full = renderer_full.step().motion
    fg = half.history_valid
    ratio = np.linalg.norm(half.displacement[fg], axis=1).sum() \
        / np.linalg.norm(full.displacement[fg], axis=1).sum()
    assert ratio == pytest.approx(0.5, abs=1e-6)


def test_shutter_open_close_match_configured_interval():
    renderer = make_renderer(exposure_fraction=0.5)
    result = renderer.step()
    t_open, t_close = renderer.shutter_interval(result.t)
    expected_width = 0.5 * renderer.frame_interval
    assert t_close - t_open == pytest.approx(expected_width)
    assert t_open < result.t < t_close


def test_paused_frame_produces_zero_motion_vectors():
    renderer = make_renderer(angular_velocity=9.0)
    renderer.step()
    moving = renderer.step()
    assert moving.motion.magnitude.max() > 0.0
    frozen_time = renderer.sim_time
    renderer.pause()
    paused = renderer.step()
    np.testing.assert_array_equal(paused.motion.displacement, 0.0)
    # Pausing freezes the simulation clock while frame counting continues.
    assert renderer.sim_time == frozen_time
    assert paused.t == frozen_time
    assert paused.frame_index == moving.frame_index + 1


def test_reset_restores_first_frame_conditions():
    renderer = make_renderer(angular_velocity=9.0)
    renderer.step()
    renderer.step()
    renderer.reset()
    assert renderer.frame_index == 0
    assert renderer.sim_time == 0.0
    assert renderer._prev_gb is None
    result = renderer.step()
    assert result.frame_index == 0
    assert not result.motion.history_valid.any()
    np.testing.assert_array_equal(result.motion.displacement, 0.0)


def test_previous_transform_is_retained_between_frames():
    renderer = make_renderer(angular_velocity=5.0)
    first = renderer.step()
    retained = renderer._prev_transforms[1]
    expected = renderer.objects[0].world_transform(first.t)
    np.testing.assert_allclose(retained.R, expected.R)
    np.testing.assert_allclose(retained.t, expected.t)


def test_cross_screen_mask_fires_at_viewport_edge():
    renderer = make_renderer(angular_velocity=14.0, pan_speed=6.0,
                             exposure_fraction=1.0)
    found = False
    for _ in range(20):
        result = renderer.step()
        if result.stats.cross_screen_count > 0:
            found = True
            break
    assert found
