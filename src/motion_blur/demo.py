"""Runnable demo: render frames, save comparison images and a stats report."""

from __future__ import annotations

import json
import os

import numpy as np

from PIL import Image

from .blur import to_uint8
from .error import motion_vector_overlay, visualize_error
from .renderer import MotionBlurRenderer
from .scene import SceneObject, make_box, make_propeller, spin_around_z
from .transform import Camera, Transform


def build_renderer(width: int = 240, height: int = 180) -> MotionBlurRenderer:
    """Spinning propeller, foreground occluder and a moving camera."""

    def camera_factory(t: float) -> Camera:
        # Lateral dolly plus a slight vertical bob: camera and object move
        # simultaneously within every exposure interval.
        position = np.array([
            1.8 * np.sin(0.9 * t),
            0.25 * np.sin(1.7 * t),
            -6.0,
        ])
        return Camera(pose=Transform(t=position), width=width, height=height)

    propeller = SceneObject(
        "propeller",
        make_propeller(blade_count=4, radius=1.5, object_id=1),
        motion=spin_around_z(angular_velocity=10.0),
    )
    occluder = SceneObject(
        "occluder",
        make_box(
            center=np.array([-1.1, -0.3, -2.4]),
            half_extents=np.array([0.32, 0.85, 0.18]),
            color=np.array([0.25, 0.55, 0.95]),
            object_id=2,
        ),
    )
    return MotionBlurRenderer(
        objects=[propeller, occluder],
        camera_factory=camera_factory,
        frame_interval=1.0 / 24.0,
        exposure_fraction=0.75,
        reference_samples=24,
    )


def run(output_dir: str, frame_count: int = 12) -> dict:
    os.makedirs(output_dir, exist_ok=True)
    renderer = build_renderer()
    report = {"frames": [], "config": {
        "frame_interval": renderer.frame_interval,
        "exposure_fraction": renderer.exposure_fraction,
        "reference_samples": renderer.reference_samples,
    }}

    for _ in range(frame_count):
        result = renderer.step()
        frame = {
            "frame": result.frame_index,
            "time": result.t,
            "t_open": renderer.shutter_interval(result.t)[0],
            "t_close": renderer.shutter_interval(result.t)[1],
            "mean_abs_error": result.stats.mean_abs,
            "rms_error": result.stats.rms,
            "max_abs_error": result.stats.max_abs,
            "disocclusion_pixels": result.stats.disocclusion_count,
            "cross_screen_pixels": result.stats.cross_screen_count,
            "disocclusion_mean_error": result.stats.disocclusion_mean,
            "cross_screen_mean_error": result.stats.cross_screen_mean,
            "ordinary_mean_error": result.stats.ordinary_mean,
            "history_valid": bool(result.motion.history_valid.any()),
        }
        report["frames"].append(frame)

        comparison = visualize_error(result.fast, result.reference, result.motion)
        Image.fromarray(comparison).save(
            os.path.join(output_dir, f"frame_{result.frame_index:03d}.png"))
        overlay = motion_vector_overlay(result.fast, result.motion)
        Image.fromarray(to_uint8(overlay)).save(
            os.path.join(output_dir, f"vectors_{result.frame_index:03d}.png"))

    with open(os.path.join(output_dir, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    return report


if __name__ == "__main__":  # pragma: no cover
    import sys

    target = sys.argv[1] if len(sys.argv) > 1 else "artifacts/demo"
    summary = run(target)
    print(f"wrote {len(summary['frames'])} frames to {target}")
