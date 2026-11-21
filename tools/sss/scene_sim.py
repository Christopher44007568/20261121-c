"""2-D offline stand-in for the Unity auricle scene.

Renders the same conceptual buffers the HDRP custom pass uses:
  beauty    : direct radiance with a hard directional key light
  material  : integer material ID per pixel (1 auricle, 2 plate, 0 background)
  thickness : world-space thickness in metres

The diffusion is applied with the same profile and ID gate as the HLSL pass,
so figures generated here document the expected Unity output when a project
with these shaders is opened in the editor.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .diffusion import diffuse_1d
from .profile import SCATTER_TINT, transmission


@dataclass
class SceneBuffers:
    beauty: np.ndarray
    material_id: np.ndarray
    thickness_m: np.ndarray


def _ear_mask(height: int, width: int) -> np.ndarray:
    """Stylised auricle silhouette with a lower-lobe notch and helix pinch."""
    yy, xx = np.mgrid[0:height, 0:width]
    cx, cy = width * 0.50, height * 0.47
    nx = (xx - cx) / (width * 0.155)
    ny = (yy - cy) / (height * 0.245)

    # Slightly tilted, elongated ear outline.
    tilt = 0.22 * nx
    radius2 = nx ** 2 + (ny + tilt) ** 2
    silhouette = radius2 < 1.0

    # Intertragic notch: an inward wedge low on the head-facing side, giving
    # the characteristic heart-shaped lower outline instead of a round blob.
    wedge_x = nx + 0.35
    wedge_y = ny - 0.62
    wedge = (np.abs(wedge_x) < 0.05 + 0.22 * np.maximum(wedge_y + 0.25, 0)) & (wedge_y > -0.30)
    return silhouette & ~wedge


def _rounded_rect_mask(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Rounded rectangle covering the central plate region."""
    x = (u - 0.52) / 0.30
    y = (v - 0.50) / 0.40
    radius = 0.18
    qx = np.abs(x) - (1.0 - radius)
    qy = np.abs(y) - (1.0 - radius)
    outside = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0)
    return outside < radius


def build_auricle_scene(height: int = 720, width: int = 720) -> SceneBuffers:
    yy, xx = np.mgrid[0:height, 0:width]
    u = xx / width
    v = yy / height

    plate_mask = _rounded_rect_mask(u, v)

    ear_mask = _ear_mask(height, width)

    material_id = np.zeros((height, width), dtype=np.int32)
    material_id[plate_mask] = 2
    material_id[ear_mask] = 1

    # Thickness: plate is a solid 40 mm slab; auricle ranges 0.45-2.4 mm,
    # thinnest at the helix rim (silhouette edge) and lobe.
    thickness = np.full((height, width), 0.08)
    thickness[plate_mask] = 0.040
    rim = np.clip(np.hypot((u - 0.50) / 0.155, (v - 0.47) / 0.245), 0, 1)
    ear_thickness_m = 0.00045 + 0.00195 * rim ** 1.6
    thickness[ear_mask] = ear_thickness_m[ear_mask]

    # Direct lighting: diagonal key light with a smooth shading gradient and
    # a bright specular streak in the upper-left of the plate.
    light = np.clip(0.55 - 0.9 * u + 0.7 * (1.0 - v), 0.08, 1.0)
    streak = np.exp(-(((u - 0.34) / 0.045) ** 2 + ((v - 0.22) / 0.15) ** 2))
    plate_color = np.array([0.20, 0.25, 0.30])
    ear_color = np.array([0.86, 0.42, 0.28])

    beauty = np.zeros((height, width, 3))
    for channel in range(3):
        beauty[:, :, channel] = 0.02
        beauty[plate_mask, channel] = (
            plate_color[channel] * light[plate_mask] + 0.35 * streak[plate_mask]
        )
        # Helix rim catches more light; a darker concha ring and bowl give
        # the concentric ear structure instead of a flat shaded ellipse.
        rim_light = np.clip(1.15 - rim, 0.05, 1.0)
        concha_ring = np.exp(-((rim - 0.55) / 0.16) ** 2)
        bowl = np.exp(-((rim - 0.18) / 0.18) ** 2)
        ear_shade = 0.38 + 0.50 * rim_light - 0.18 * concha_ring - 0.10 * bowl
        ear_shade = np.clip(ear_shade, 0.25, 1.0)
        beauty[ear_mask, channel] = ear_color[channel] * ear_shade[ear_mask]

    return SceneBuffers(beauty=beauty, material_id=material_id, thickness_m=thickness)


def apply_screen_space_sss(
    buffers: SceneBuffers,
    metres_per_px: float,
    radius_scale: float = 1.0,
    sss_enabled: bool = True,
    id_gate: bool = True,
) -> np.ndarray:
    """Two separable 1-D passes (horizontal then vertical) plus composite."""
    if not sss_enabled:
        return buffers.beauty.copy()

    height, width = buffers.material_id.shape
    horizontal = np.zeros_like(buffers.beauty)
    for row in range(height):
        horizontal[row] = diffuse_1d(
            buffers.beauty[row],
            buffers.material_id[row],
            metres_per_px,
            radius_scale,
            id_gate=id_gate,
        )

    vertical = np.zeros_like(buffers.beauty)
    for column in range(width):
        vertical[:, column] = diffuse_1d(
            horizontal[:, column],
            buffers.material_id[:, column],
            metres_per_px,
            radius_scale,
            id_gate=id_gate,
        )

    transmit = transmission(buffers.thickness_m)
    participates = (buffers.material_id > 0)[..., None]
    scattered = vertical * transmit * SCATTER_TINT[None, None, :] * participates
    return np.clip(buffers.beauty + scattered, 0, 1)


def encode_id_buffer(material_id: np.ndarray) -> np.ndarray:
    """R = round(ID)/255, visualised with flat per-ID debug colours."""
    image = np.zeros((*material_id.shape, 3))
    colours = {
        0: np.array([0.04, 0.05, 0.07]),
        1: np.array([0.72, 0.50, 0.40]),  # auricle: skin tone
        2: np.array([0.30, 0.68, 0.82]),  # plate: cyan-blue
        3: np.array([0.45, 0.55, 0.85]),
        4: np.array([0.78, 0.62, 0.58]),
    }
    for material, colour in colours.items():
        image[material_id == material] = colour
    return np.clip(image, 0, 1)


def encode_thickness_buffer(thickness_m: np.ndarray) -> np.ndarray:
    """G = thickness / 80 mm; thin slabs render violet, thick slabs lime."""
    normalized = np.clip(thickness_m / 0.08, 0, 1)
    lime = np.array([0.62, 0.85, 0.05])
    violet = np.array([0.55, 0.45, 0.75])
    image = np.zeros((*thickness_m.shape, 3))
    for channel in range(3):
        image[:, :, channel] = lime[channel] * normalized + violet[channel] * (1 - normalized)
    image[thickness_m >= 0.08] = 0.05
    return image
