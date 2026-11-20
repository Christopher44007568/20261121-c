"""Shared fixtures and small scene builders for the test suite."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from motion_blur.renderer import MotionBlurRenderer  # noqa: E402
from motion_blur.scene import (  # noqa: E402
    SceneObject,
    make_box,
    make_propeller,
    spin_around_z,
)
from motion_blur.transform import Camera, Transform  # noqa: E402


@pytest.fixture
def small_size():
    return 96, 72


def make_camera_factory(width, height, pan_speed=0.0, bob_speed=0.0, z=-5.5):
    def factory(t):
        position = np.array([pan_speed * t,
                             0.2 * np.sin(bob_speed * t) if bob_speed else 0.0,
                             z])
        return Camera(pose=Transform(t=position), width=width, height=height)
    return factory


def make_renderer(width=96, height=72, angular_velocity=6.0, pan_speed=0.0,
                  bob_speed=0.0, with_occluder=False, exposure_fraction=0.5,
                  frame_interval=1.0 / 24.0, reference_samples=12):
    objects = [
        SceneObject(
            "propeller",
            make_propeller(blade_count=4, radius=1.2, object_id=1),
            motion=spin_around_z(angular_velocity),
        )
    ]
    if with_occluder:
        objects.append(
            SceneObject(
                "occluder",
                make_box(np.array([-0.9, 0.0, -2.0]),
                         np.array([0.28, 0.7, 0.15]),
                         np.array([0.25, 0.55, 0.95]), object_id=2),
            )
        )
    return MotionBlurRenderer(
        objects=objects,
        camera_factory=make_camera_factory(width, height, pan_speed, bob_speed),
        frame_interval=frame_interval,
        exposure_fraction=exposure_fraction,
        reference_samples=reference_samples,
    )
