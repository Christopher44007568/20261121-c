"""Rigid-body transforms, rotations and a pinhole camera model.

Conventions
-----------
* Right-handed world coordinates. The default camera looks down +Z, with +X
  to the right and +Y up.
* A :class:`Transform` maps local/model points into world points with
  ``p_world = R @ p_local + t`` (a proper rigid motion, det(R) = +1).
* Camera poses are also expressed as :class:`Transform` objects (camera-to-
  world); ``pose.inverse()`` gives the world-to-camera transform.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def rotation_matrix(axis: np.ndarray, angle: float) -> np.ndarray:
    """Rodrigues rotation matrix for a unit axis and angle in radians."""
    axis = np.asarray(axis, dtype=np.float64)
    norm = np.linalg.norm(axis)
    if norm == 0.0:
        raise ValueError("rotation axis must be non-zero")
    axis = axis / norm
    x, y, z = axis
    c = np.cos(angle)
    s = np.sin(angle)
    one_minus_c = 1.0 - c
    return np.array(
        [
            [c + x * x * one_minus_c, x * y * one_minus_c - z * s, x * z * one_minus_c + y * s],
            [y * x * one_minus_c + z * s, c + y * y * one_minus_c, y * z * one_minus_c - x * s],
            [z * x * one_minus_c - y * s, z * y * one_minus_c + x * s, c + z * z * one_minus_c],
        ],
        dtype=np.float64,
    )


class Transform:
    """Rigid transform ``p' = R @ p + t``."""

    __slots__ = ("R", "t")

    def __init__(self, R: np.ndarray | None = None, t: np.ndarray | None = None) -> None:
        self.R = np.eye(3) if R is None else np.asarray(R, dtype=np.float64).copy()
        self.t = np.zeros(3) if t is None else np.asarray(t, dtype=np.float64).copy()

    @staticmethod
    def identity() -> "Transform":
        return Transform()

    @staticmethod
    def from_axis_angle(axis: np.ndarray, angle: float, t: np.ndarray | None = None) -> "Transform":
        return Transform(rotation_matrix(axis, angle), t)

    def transform_points(self, points: np.ndarray) -> np.ndarray:
        """Apply this transform to an (N, 3) array of points."""
        points = np.asarray(points, dtype=np.float64)
        return points @ self.R.T + self.t

    def inverse(self) -> "Transform":
        """Return the inverse rigid transform."""
        inv_R = self.R.T
        return Transform(inv_R, -(inv_R @ self.t))

    def compose(self, other: "Transform") -> "Transform":
        """Return ``self o other`` (apply ``other`` first, then ``self``)."""
        return Transform(self.R @ other.R, self.R @ other.t + self.t)

    def copy(self) -> "Transform":
        return Transform(self.R, self.t)

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"Transform(t={self.t.tolist()})"


@dataclass
class Camera:
    """Pinhole camera.

    ``pose`` is the camera-to-world transform. The camera looks down its
    local +Z axis with +X right and +Y up.
    """

    pose: Transform
    fov_y_deg: float = 45.0
    width: int = 320
    height: int = 240
    near: float = 0.05

    @property
    def focal_y(self) -> float:
        # Pixel units: image plane sits one focal length from the centre.
        return (0.5 * self.height) / np.tan(np.deg2rad(0.5 * self.fov_y_deg))

    @property
    def focal_x(self) -> float:
        # Square pixels.
        return self.focal_y

    def world_to_camera(self, points_world: np.ndarray) -> np.ndarray:
        return self.pose.inverse().transform_points(points_world)

    def project(self, points_world: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Project world points to pixel coordinates.

        Returns
        -------
        xy : (N, 2) pixel coordinates (x right, y down), may be off-screen
        depth : (N,) camera-space z, negative values lie behind the camera
        valid : (N,) bool, True when the point is in front of the near plane
        """
        cam = self.world_to_camera(points_world)
        depth = cam[:, 2]
        valid = depth > self.near
        safe_depth = np.where(valid, depth, 1.0)
        x = cam[:, 0] * self.focal_x / safe_depth + 0.5 * self.width
        y = -cam[:, 1] * self.focal_y / safe_depth + 0.5 * self.height
        xy = np.stack([x, y], axis=1)
        return xy, depth, valid

    def unproject(self, xy: np.ndarray, depth: np.ndarray) -> np.ndarray:
        """Inverse of :meth:`project`: pixels + camera-space z -> world points."""
        xy = np.asarray(xy, dtype=np.float64)
        depth = np.asarray(depth, dtype=np.float64)
        cam_x = (xy[:, 0] - 0.5 * self.width) * depth / self.focal_x
        cam_y = -(xy[:, 1] - 0.5 * self.height) * depth / self.focal_y
        cam = np.stack([cam_x, cam_y, depth], axis=1)
        return self.pose.transform_points(cam)
