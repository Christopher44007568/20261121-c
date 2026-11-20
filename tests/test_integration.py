"""End-to-end behavior: visualization outputs and playback cycling."""

from __future__ import annotations

import numpy as np

from conftest import make_renderer
from motion_blur.error import motion_vector_overlay, visualize_error


def test_visualization_panels_have_expected_width():
    renderer = make_renderer(width=80, height=60)
    renderer.step()
    result = renderer.step()
    panels = visualize_error(result.fast, result.reference, result.motion)
    assert panels.shape == (60, 80 * 3, 3)
    assert panels.dtype == np.uint8
    overlay = motion_vector_overlay(result.fast, result.motion, stride=8)
    assert overlay.shape == (60, 80, 3)


def test_pause_resume_reset_cycle():
    renderer = make_renderer(angular_velocity=10.0, pan_speed=1.0)
    renderer.step()
    moving = renderer.step()
    assert moving.motion.magnitude.max() > 0.0

    renderer.pause()
    frozen_time = renderer.sim_time
    paused = renderer.step()
    np.testing.assert_array_equal(paused.motion.displacement, 0.0)
    assert renderer.sim_time == frozen_time

    renderer.resume()
    resumed = renderer.step()
    # The clock resumes from the frozen instant; no time is retroactively
    # added for the paused interval.
    assert resumed.t == frozen_time
    assert renderer.sim_time == frozen_time + renderer.frame_interval
    assert resumed.motion.magnitude.max() > 0.0

    renderer.reset()
    first = renderer.step()
    assert not first.motion.history_valid.any()
    assert np.isfinite(first.fast).all()


def test_camera_motion_during_exposure_changes_reference():
    # A moving camera integrated within the shutter must differ from holding
    # the camera still, proving both motion sources enter the reference path.
    moving_renderer = make_renderer(angular_velocity=4.0, pan_speed=3.0,
                                    exposure_fraction=1.0)
    still_renderer = make_renderer(angular_velocity=4.0, pan_speed=0.0,
                                   exposure_fraction=1.0)
    for r in (moving_renderer, still_renderer):
        r.step()
    moving = moving_renderer.step()
    still = still_renderer.step()
    assert not np.allclose(moving.reference, still.reference, atol=1e-4)


def test_error_is_nonnegative_and_bounded():
    renderer = make_renderer(angular_velocity=11.0, with_occluder=True)
    renderer.step()
    result = renderer.step()
    assert np.all(result.error >= 0.0)
    assert np.all(np.isfinite(result.error))
    assert result.stats.max_abs >= result.stats.mean_abs
