"""Pinhole camera helpers turning screen positions into view rays.

The brush is always specified by a *world-space* radius.  The camera only
contributes the ray origin/direction; moving the camera therefore never
rescales an ongoing stroke.  A helper converts the world radius to a
screen-space circle purely for cursor preview.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .geometry import normalize


@dataclass
class Camera:
    position: np.ndarray
    target: np.ndarray
    up: np.ndarray
    fov_y_deg: float = 45.0
    aspect: float = 1.0

    def __post_init__(self):
        self.position = np.asarray(self.position, dtype=np.float64)
        self.target = np.asarray(self.target, dtype=np.float64)
        self.up = normalize(np.asarray(self.up, dtype=np.float64))

    def axes(self):
        forward = normalize(self.target - self.position)
        right = normalize(np.cross(forward, self.up))
        true_up = np.cross(right, forward)
        return forward, right, true_up

    def view_direction(self) -> np.ndarray:
        return normalize(self.target - self.position)

    def screen_ray(self, ndc_x: float, ndc_y: float):
        """Return ``(origin, direction)`` for normalized device coords.

        ``ndc_x`` / ``ndc_y`` range from -1 to 1 across the viewport with
        ``+y`` pointing upwards.
        """
        forward, right, up = self.axes()
        half_height = np.tan(np.radians(self.fov_y_deg) * 0.5)
        half_width = half_height * self.aspect
        direction = (forward
                     + right * (ndc_x * half_width)
                     + up * (ndc_y * half_height))
        return self.position.copy(), normalize(direction)

    def world_radius_to_pixels(self, world_radius: float,
                               hit_distance: float,
                               viewport_height_px: int) -> float:
        """Project the constant world radius to a cursor circle in pixels."""
        half_height = np.tan(np.radians(self.fov_y_deg) * 0.5)
        projected = world_radius / max(hit_distance, 1.0e-12)
        ndc_radius = projected / max(half_height, 1.0e-12)
        return 0.5 * viewport_height_px * ndc_radius

    def orbit(self, yaw_delta: float, pitch_delta: float):
        """Rotate the camera around the target without changing scale."""
        offset = self.position - self.target
        distance = float(np.linalg.norm(offset))
        forward, right, _ = self.axes()
        yaw = np.array([[np.cos(yaw_delta), 0, np.sin(yaw_delta)],
                        [0.0, 1.0, 0.0],
                        [-np.sin(yaw_delta), 0, np.cos(yaw_delta)]])
        offset = yaw @ offset
        pitch_axis = right
        pitch = (np.eye(3)
                 + np.sin(pitch_delta) * self._skew(pitch_axis)
                 + (1.0 - np.cos(pitch_delta))
                 * (np.outer(pitch_axis, pitch_axis) - np.eye(3)))
        offset = pitch @ offset
        self.position = self.target + normalize(offset) * distance

    @staticmethod
    def _skew(axis):
        x, y, z = axis
        return np.array([[0.0, -z, y], [z, 0.0, -x], [-y, x, 0.0]])
