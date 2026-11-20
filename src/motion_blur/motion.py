"""Screen-space motion vectors from retained previous-frame transforms.

Motion vectors are derived by *reprojection* rather than finite differences
of pixel positions, so they stay exact even when the camera and the object
move at the same time:

1. foreground pixel -> current world point (G-buffer) -> object local space
   via the inverse current object transform;
2. local point -> previous world point via the retained previous transform;
3. project with the previous camera to obtain the previous pixel position;
4. background pixels use a fixed far depth and only inherit camera motion.

The per-frame vector (previous -> current) is then extrapolated to the
configurable shutter interval ``[t_open, t_close]`` assuming constant
velocity across the frame.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .rasterizer import GBuffer
from .scene import SceneObject
from .transform import Camera, Transform


@dataclass
class MotionVectors:
    start: np.ndarray          # (H, W, 2) pixel position at shutter open
    end: np.ndarray            # (H, W, 2) pixel position at shutter close
    history_valid: np.ndarray  # (H, W) bool, False on the first/reset frame
    disocclusion: np.ndarray   # (H, W) bool, hidden in the previous frame
    cross_screen: np.ndarray   # (H, W) bool, an endpoint leaves the viewport

    @property
    def displacement(self) -> np.ndarray:
        """Signed (dx, dy) vector from shutter open to close."""
        return self.end - self.start

    @property
    def magnitude(self) -> np.ndarray:
        return np.linalg.norm(self.displacement, axis=2)


def _reproject_foreground(gb: GBuffer, objects_by_id: dict[int, SceneObject],
                          current_transforms: dict[int, Transform],
                          prev_transforms: dict[int, Transform],
                          prev_camera: Camera) -> tuple[np.ndarray, np.ndarray]:
    """Return previous-frame pixel positions and in-front flags."""
    height, width = gb.height, gb.width
    prev_xy = np.stack(np.meshgrid(np.arange(width) + 0.5, np.arange(height) + 0.5),
                       axis=2).astype(np.float64)
    in_front = np.ones((height, width), dtype=bool)
    for object_id, obj in objects_by_id.items():
        mask = gb.object_id == object_id
        if not np.any(mask):
            continue
        world_pts = gb.world[mask]
        local_pts = current_transforms[object_id].inverse().transform_points(world_pts)
        prev_world = prev_transforms[object_id].transform_points(local_pts)
        xy, _depth, valid = prev_camera.project(prev_world)
        prev_xy[mask] = xy
        in_front[mask] = valid
    return prev_xy, in_front


def _reproject_background(gb: GBuffer, camera: Camera, prev_camera: Camera,
                          background_depth: float) -> tuple[np.ndarray, np.ndarray]:
    mask = gb.background_mask
    height, width = gb.height, gb.width
    px, py = np.meshgrid(np.arange(width) + 0.5, np.arange(height) + 0.5)
    xy = np.stack([px[mask], py[mask]], axis=1)
    depth = np.full(xy.shape[0], background_depth)
    world_pts = camera.unproject(xy, depth)
    prev_xy_all = np.stack([px, py], axis=2).astype(np.float64)
    prev_xy, _d, valid = prev_camera.project(world_pts)
    prev_xy_all[mask] = prev_xy
    in_front = np.ones((height, width), dtype=bool)
    in_front[mask] = valid
    return prev_xy_all, in_front


def compute_motion_vectors(
    gb: GBuffer,
    prev_gb: GBuffer | None,
    objects: list[SceneObject],
    camera: Camera,
    prev_camera: Camera | None,
    current_transforms: dict[int, Transform],
    prev_transforms: dict[int, Transform] | None,
    t_prev: float,
    t_current: float,
    t_open: float,
    t_close: float,
    frame_delta: float | None = None,
    background_depth: float = 30.0,
) -> MotionVectors:
    """Compute shutter-interval motion vectors and edge-case masks.

    ``prev_gb`` / ``prev_transforms`` / ``prev_camera`` are ``None`` on the
    first frame after a reset: vectors are then forced to zero and flagged
    with ``history_valid = False``.
    """
    height, width = gb.height, gb.width
    px, py = np.meshgrid(np.arange(width) + 0.5, np.arange(height) + 0.5)
    current_xy = np.stack([px, py], axis=2).astype(np.float64)

    objects_by_id = {obj.mesh.object_id: obj for obj in objects}
    history_valid = prev_gb is not None and prev_camera is not None \
        and prev_transforms is not None

    if not history_valid:
        zero = current_xy.copy()
        return MotionVectors(
            start=zero, end=zero.copy(),
            history_valid=np.zeros((height, width), dtype=bool),
            disocclusion=np.zeros((height, width), dtype=bool),
            cross_screen=np.zeros((height, width), dtype=bool),
        )

    fg_xy, fg_front = _reproject_foreground(
        gb, objects_by_id, current_transforms, prev_transforms, prev_camera)
    bg_xy, bg_front = _reproject_background(gb, camera, prev_camera, background_depth)
    prev_xy = np.where(gb.background_mask[..., None], bg_xy, fg_xy)
    prev_in_front = np.where(gb.background_mask, bg_front, fg_front)

    dt = (t_current - t_prev) if frame_delta is None else frame_delta
    if dt <= 1e-12:
        # Paused frame: identical transforms, no motion during exposure.
        start = current_xy.copy()
        end = current_xy.copy()
    else:
        scale_open = (t_open - t_current) / dt
        scale_close = (t_close - t_current) / dt
        start = current_xy + (prev_xy - current_xy) * scale_open
        end = current_xy + (prev_xy - current_xy) * scale_close

    def on_screen(points: np.ndarray) -> np.ndarray:
        return ((points[..., 0] >= 0.0) & (points[..., 0] <= width)
                & (points[..., 1] >= 0.0) & (points[..., 1] <= height))

    # Cross-screen: either endpoint of the motion segment leaves the
    # viewport (or the previous position was behind the camera).
    cross_screen = (~on_screen(start)) | (~on_screen(end)) | (~prev_in_front)

    # Disocclusion: a currently visible surface was hidden behind a different
    # surface in the previous frame. Background pixels revealing themselves
    # at the screen edge are reported as cross-screen instead.
    nearest_ix = np.rint(prev_xy[..., 0] - 0.5).astype(np.int64)
    nearest_iy = np.rint(prev_xy[..., 1] - 0.5).astype(np.int64)
    inside = ((nearest_ix >= 0) & (nearest_ix < width)
              & (nearest_iy >= 0) & (nearest_iy < height) & prev_in_front)
    disocclusion = np.zeros((height, width), dtype=bool)
    foreground = ~gb.background_mask
    candidates = inside & foreground
    if np.any(candidates):
        prev_ids = np.zeros((height, width), dtype=np.int64)
        prev_ids[candidates] = prev_gb.object_id[
            nearest_iy[candidates], nearest_ix[candidates]]
        disocclusion = candidates & (prev_ids != gb.object_id)

    return MotionVectors(
        start=start, end=end,
        history_valid=np.ones((height, width), dtype=bool),
        disocclusion=disocclusion, cross_screen=cross_screen)
