"""Software triangle rasterizer producing a G-buffer.

The G-buffer keeps everything needed to derive screen-space motion vectors
and to compare renderings:

* ``depth``    camera-space z (inf for background)
* ``object_id`` 0 for background
* ``world``    interpolated world position
* ``color``    shaded linear color (background color for empty pixels)
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .scene import SceneObject
from .transform import Camera


@dataclass
class GBuffer:
    depth: np.ndarray
    object_id: np.ndarray
    world: np.ndarray
    color: np.ndarray

    @property
    def height(self) -> int:
        return self.depth.shape[0]

    @property
    def width(self) -> int:
        return self.depth.shape[1]

    @property
    def background_mask(self) -> np.ndarray:
        return self.object_id == 0


def _rasterize_object(obj: SceneObject, camera: Camera, t: float,
                      g_depth: np.ndarray, g_id: np.ndarray,
                      g_world: np.ndarray, g_color: np.ndarray) -> None:
    world_transform = obj.world_transform(t)
    world_points = world_transform.transform_points(obj.mesh.vertices)
    xy, depth, in_front = camera.project(world_points)
    height, width = g_depth.shape
    for tri in obj.mesh.triangles:
        if not np.all(in_front[tri]):
            continue
        p0, p1, p2 = xy[tri[0]], xy[tri[1]], xy[tri[2]]
        d0, d1, d2 = depth[tri[0]], depth[tri[1]], depth[tri[2]]
        w0, w1, w2 = world_points[tri[0]], world_points[tri[1]], world_points[tri[2]]
        c0, c1, c2 = obj.mesh.colors[tri[0]], obj.mesh.colors[tri[1]], obj.mesh.colors[tri[2]]
        area = ((p1[0] - p0[0]) * (p2[1] - p0[1])
                - (p2[0] - p0[0]) * (p1[1] - p0[1]))
        if abs(area) < 1e-12:
            continue
        min_x = max(int(np.floor(min(p0[0], p1[0], p2[0]))), 0)
        max_x = min(int(np.ceil(max(p0[0], p1[0], p2[0]))), width - 1)
        min_y = max(int(np.floor(min(p0[1], p1[1], p2[1]))), 0)
        max_y = min(int(np.ceil(max(p0[1], p1[1], p2[1]))), height - 1)
        if min_x > max_x or min_y > max_y:
            continue
        grid_x, grid_y = np.meshgrid(
            np.arange(min_x, max_x + 1), np.arange(min_y, max_y + 1))
        px = grid_x + 0.5
        py = grid_y + 0.5
        w0_b = ((p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py)) / area
        w1_b = ((p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py)) / area
        w2_b = 1.0 - w0_b - w1_b
        inside = (w0_b >= 0.0) & (w1_b >= 0.0) & (w2_b >= 0.0)
        if not np.any(inside):
            continue
        interp_depth = w0_b * d0 + w1_b * d1 + w2_b * d2
        rows = grid_y[inside]
        cols = grid_x[inside]
        tri_depth = interp_depth[inside]
        closer = tri_depth < g_depth[rows, cols]
        if not np.any(closer):
            continue
        rows, cols, tri_depth = rows[closer], cols[closer], tri_depth[closer]
        b0 = w0_b[inside][closer]
        b1 = w1_b[inside][closer]
        b2 = w2_b[inside][closer]
        g_depth[rows, cols] = tri_depth
        g_id[rows, cols] = obj.mesh.object_id
        g_world[rows, cols] = (b0[:, None] * w0 + b1[:, None] * w1
                               + b2[:, None] * w2)
        g_color[rows, cols] = (b0[:, None] * c0 + b1[:, None] * c1
                               + b2[:, None] * c2)


def render_gbuffer(objects: list[SceneObject], camera: Camera, t: float,
                   background: np.ndarray | None = None) -> GBuffer:
    """Rasterize every object at world time ``t`` into a fresh G-buffer."""
    height, width = camera.height, camera.width
    g_depth = np.full((height, width), np.inf, dtype=np.float64)
    g_id = np.zeros((height, width), dtype=np.int64)
    g_world = np.zeros((height, width, 3), dtype=np.float64)
    bg = np.full(3, 0.08) if background is None else np.asarray(background, np.float64)
    g_color = np.tile(bg, (height, width, 1)).astype(np.float64)
    # Painter-independent ordering: the per-pixel depth test handles overlaps.
    for obj in objects:
        _rasterize_object(obj, camera, t, g_depth, g_id, g_world, g_color)
    return GBuffer(g_depth, g_id, g_world, g_color)
