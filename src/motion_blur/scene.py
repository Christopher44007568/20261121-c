"""Scene description: meshes, the rotating propeller and animated objects."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .transform import Transform


@dataclass
class Mesh:
    """Triangle mesh in local/model space.

    Colors are linear RGB in [0, 1], one per vertex. ``object_id`` is a
    non-negative integer used by the G-buffer (0 is reserved for background).
    """

    vertices: np.ndarray
    triangles: np.ndarray
    colors: np.ndarray
    object_id: int

    def __post_init__(self) -> None:
        self.vertices = np.asarray(self.vertices, dtype=np.float64)
        self.triangles = np.asarray(self.triangles, dtype=np.int64)
        self.colors = np.asarray(self.colors, dtype=np.float64)


def make_box(center: np.ndarray, half_extents: np.ndarray, color: np.ndarray,
             object_id: int) -> Mesh:
    """Axis-aligned box centred at ``center`` with given half extents."""
    cx, cy, cz = np.asarray(center, dtype=np.float64)
    hx, hy, hz = np.asarray(half_extents, dtype=np.float64)
    vertices = np.array([
        [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
        [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
        [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
        [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
    ])
    triangles = np.array([
        [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
        [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3],
    ])
    colors = np.tile(np.asarray(color, dtype=np.float64), (len(vertices), 1))
    return Mesh(vertices, triangles, colors, object_id)


def make_propeller(blade_count: int = 4, radius: float = 1.6,
                   blade_color: np.ndarray = (0.9, 0.25, 0.2),
                   hub_color: np.ndarray = (0.75, 0.75, 0.8),
                   object_id: int = 1) -> Mesh:
    """Build a propeller in the local XY plane, spinning around local +Z.

    Each blade is a thin tapered quad (two triangles) extending from the hub
    to ``radius``; the hub is a small flat box. The flat geometry keeps the
    software rasterizer cheap while still showing curved screen-space motion.
    """
    vertices: list[list[float]] = []
    triangles: list[list[int]] = []
    colors: list[np.ndarray] = []
    inner = radius * 0.18
    tip_half_width = radius * 0.05
    root_half_width = radius * 0.11
    thickness = radius * 0.03
    base = np.asarray(blade_color, dtype=np.float64)
    for blade in range(blade_count):
        angle = 2.0 * np.pi * blade / blade_count
        ca, sa = np.cos(angle), np.sin(angle)
        # Local blade points along +X before rotating around Z.
        outline = np.array([
            [inner, -root_half_width, -thickness],
            [radius, -tip_half_width, -thickness],
            [radius, tip_half_width, thickness],
            [inner, root_half_width, thickness],
        ])
        rot_z = np.array([[ca, -sa, 0.0], [sa, ca, 0.0], [0.0, 0.0, 1.0]])
        outline = outline @ rot_z.T
        start = len(vertices)
        vertices.extend(outline.tolist())
        triangles.append([start, start + 1, start + 2])
        triangles.append([start, start + 2, start + 3])
        shade = 0.85 + 0.15 * np.cos(angle)
        colors.extend([base * shade] * 4)
    hub = make_box(np.zeros(3), np.full(3, inner * 0.9), hub_color, object_id)
    offset = len(vertices)
    vertices.extend(hub.vertices.tolist())
    triangles.extend((hub.triangles + offset).tolist())
    colors.extend(hub.colors.tolist())
    return Mesh(np.asarray(vertices), np.asarray(triangles),
                np.asarray(colors), object_id)


@dataclass
class SceneObject:
    """An animated mesh.

    ``motion(t)`` returns the extra rigid transform at world time ``t``
    (seconds). The full world pose is ``base.compose(motion(t))``.
    """

    name: str
    mesh: Mesh
    base: Transform = field(default_factory=Transform.identity)
    motion: object = None

    def world_transform(self, t: float) -> Transform:
        extra = self.motion(t) if self.motion is not None else Transform.identity()
        return self.base.compose(extra)


def spin_around_z(angular_velocity: float, pivot: np.ndarray | None = None):
    """Constant angular velocity (rad/s) about the world +Z axis.

    ``pivot`` lets an off-centre propeller spin in place; identity rotation
    is returned at t = 0 so the first frame has a well-defined pose.
    """
    pivot = np.zeros(3) if pivot is None else np.asarray(pivot, dtype=np.float64)

    def motion(t: float) -> Transform:
        angle = angular_velocity * t
        rot = Transform.from_axis_angle(np.array([0.0, 0.0, 1.0]), angle)
        # R @ (p - pivot) + pivot: translate to pivot, rotate, translate back.
        to_pivot = Transform(t=-pivot)
        from_pivot = Transform(t=pivot)
        return from_pivot.compose(rot).compose(to_pivot)

    return motion


def linear_translation(velocity: np.ndarray):
    """Constant linear velocity, zero translation at t = 0."""
    velocity = np.asarray(velocity, dtype=np.float64)

    def motion(t: float) -> Transform:
        return Transform(t=velocity * t)

    return motion
