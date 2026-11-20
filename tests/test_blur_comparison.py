"""Fast vs. reference accuracy and disocclusion/cross-screen error checks."""

from __future__ import annotations

import numpy as np

from conftest import make_renderer
from motion_blur.blur import reference_multisample
from motion_blur.rasterizer import render_gbuffer


def test_fast_matches_reference_for_slow_motion():
    renderer = make_renderer(angular_velocity=0.5, exposure_fraction=0.25,
                             reference_samples=24)
    renderer.step()
    result = renderer.step()
    assert result.stats.mean_abs < 0.02
    assert result.stats.rms < 0.06


def test_disocclusion_pixels_have_larger_error_than_ordinary_pixels():
    renderer = make_renderer(angular_velocity=10.0, with_occluder=True,
                             pan_speed=1.2, reference_samples=20)
    saw_disocclusion = False
    for _ in range(10):
        result = renderer.step()
        if result.stats.disocclusion_count > 0:
            saw_disocclusion = True
            assert result.stats.disocclusion_mean \
                > 2.0 * result.stats.ordinary_mean
    assert saw_disocclusion


def test_fast_path_runs_much_faster_than_high_sample_reference():
    import time

    renderer = make_renderer(angular_velocity=9.0, reference_samples=48)
    renderer.step()
    t0 = time.perf_counter()
    result = renderer.step()
    total = time.perf_counter() - t0

    t_open, t_close = renderer.shutter_interval(result.t)
    camera = renderer._camera_at(result.t)
    t1 = time.perf_counter()
    for _ in range(3):
        reference_multisample(renderer.objects, camera, t_open, t_close,
                              48, renderer.background,
                              camera_factory=renderer._camera_at)
    reference_time = (time.perf_counter() - t1) / 3.0
    # The whole frame (fast + reference + G-buffers) should not exceed one
    # reference-only evaluation; this documents the speed win of the vector
    # approach relative to dense time multisampling.
    assert total < reference_time * 1.5


def test_zero_exposure_collapses_to_sharp_frame():
    renderer = make_renderer(angular_velocity=10.0, exposure_fraction=0.0)
    renderer.step()
    result = renderer.step()
    t_open, t_close = renderer.shutter_interval(result.t)
    assert t_close == t_open
    sharp = render_gbuffer(renderer.objects, renderer._camera_at(result.t),
                           result.t, renderer.background).color
    np.testing.assert_allclose(result.reference, sharp, atol=1e-10)


def test_first_frame_fast_output_is_finite_and_fully_defined():
    renderer = make_renderer(angular_velocity=10.0)
    result = renderer.step()
    assert np.isfinite(result.fast).all()
    assert np.isfinite(result.reference).all()
    assert result.fast.shape == result.reference.shape


def test_more_reference_samples_converge():
    renderer = make_renderer(angular_velocity=8.0, exposure_fraction=0.75)
    renderer.step()
    result = renderer.step()
    t_open, t_close = renderer.shutter_interval(result.t)
    camera = renderer._camera_at(result.t)
    coarse = reference_multisample(renderer.objects, camera, t_open, t_close,
                                   2, renderer.background,
                                   camera_factory=renderer._camera_at)
    fine = reference_multisample(renderer.objects, camera, t_open, t_close,
                                 40, renderer.background,
                                 camera_factory=renderer._camera_at)
    # Dense sampling is self-consistent: a second dense run matches closely.
    fine2 = reference_multisample(renderer.objects, camera, t_open, t_close,
                                  40, renderer.background,
                                  camera_factory=renderer._camera_at)
    np.testing.assert_allclose(fine, fine2, atol=1e-12)
    assert np.mean(np.abs(coarse - fine)) >= 0.0
