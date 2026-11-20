"""Rotating-blade motion blur: fast motion vectors vs. time multisampling."""

from .blur import fast_motion_vector, reference_multisample, to_uint8
from .error import compute_stats, per_pixel_error, visualize_error
from .motion import MotionVectors, compute_motion_vectors
from .rasterizer import GBuffer, render_gbuffer
from .renderer import FrameResult, MotionBlurRenderer
from .scene import (
    SceneObject,
    linear_translation,
    make_box,
    make_propeller,
    spin_around_z,
)
from .transform import Camera, Transform, rotation_matrix

__all__ = [
    "Camera",
    "FrameResult",
    "GBuffer",
    "MotionBlurRenderer",
    "MotionVectors",
    "SceneObject",
    "Transform",
    "compute_motion_vectors",
    "compute_stats",
    "fast_motion_vector",
    "linear_translation",
    "make_box",
    "make_propeller",
    "per_pixel_error",
    "reference_multisample",
    "render_gbuffer",
    "rotation_matrix",
    "spin_around_z",
    "to_uint8",
    "visualize_error",
]
