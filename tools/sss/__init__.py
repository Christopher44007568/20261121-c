"""Offline reference model for the HDRP screen-space SSS custom pass.

Every constant in this package mirrors SSSProfile.hlsl / SSSDiffusion.hlsl so
that the analytic numbers can be compared against Unity ScreenCapture output.
"""

from .profile import (
    LOBE_RADIUS_M,
    LOBE_WEIGHT,
    MEAN_FREE_PATH_M,
    SCATTER_TINT,
    effective_radius_m,
    transmission,
)
from .camera import CameraSpec, pixels_per_metre
from .diffusion import (
    diffuse_1d,
    half_plane_response,
    edge_radius_px,
    discrete_step_response,
)
from .scene_sim import (
    SceneBuffers,
    apply_screen_space_sss,
    build_auricle_scene,
    encode_id_buffer,
    encode_thickness_buffer,
)

__all__ = [
    "LOBE_RADIUS_M",
    "LOBE_WEIGHT",
    "MEAN_FREE_PATH_M",
    "SCATTER_TINT",
    "effective_radius_m",
    "transmission",
    "CameraSpec",
    "pixels_per_metre",
    "diffuse_1d",
    "half_plane_response",
    "edge_radius_px",
    "discrete_step_response",
    "SceneBuffers",
    "apply_screen_space_sss",
    "build_auricle_scene",
    "encode_id_buffer",
    "encode_thickness_buffer",
]
