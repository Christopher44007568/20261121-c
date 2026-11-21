"""Pure-Python camera framing math for orthographic part cards.

No bpy dependency so the framing logic can be unit tested with plain Python.
Convention: a view direction ``d`` points FROM the camera INTO the scene
(camera local -Z). Camera right/up axes are built so that
``right x up = -d`` (Blender camera local axes X=right, Y=up, Z=backward).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence

Vec3 = tuple[float, float, float]


def add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Vec3, k: float) -> Vec3:
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def length(a: Vec3) -> float:
    return math.sqrt(dot(a, a))


def normalize(a: Vec3) -> Vec3:
    n = length(a)
    if n < 1e-12:
        raise ValueError("cannot normalize a near-zero vector")
    return scale(a, 1.0 / n)


def bbox_of_points(points: Iterable[Vec3]) -> tuple[Vec3, Vec3]:
    pts = list(points)
    if not pts:
        raise ValueError("no points to bound")
    mins = [math.inf, math.inf, math.inf]
    maxs = [-math.inf, -math.inf, -math.inf]
    for p in pts:
        for i in range(3):
            mins[i] = min(mins[i], p[i])
            maxs[i] = max(maxs[i], p[i])
    return (tuple(mins), tuple(maxs))  # type: ignore[return-value]


def bbox_corners(lo: Vec3, hi: Vec3) -> list[Vec3]:
    return [
        (lo[0], lo[1], lo[2]),
        (hi[0], lo[1], lo[2]),
        (lo[0], hi[1], lo[2]),
        (hi[0], hi[1], lo[2]),
        (lo[0], lo[1], hi[2]),
        (hi[0], lo[1], hi[2]),
        (lo[0], hi[1], hi[2]),
        (hi[0], hi[1], hi[2]),
    ]


def bbox_center(lo: Vec3, hi: Vec3) -> Vec3:
    return ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)


def bbox_dims(lo: Vec3, hi: Vec3) -> Vec3:
    return (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])


# View direction = direction the camera looks along.
VIEW_LIBRARY: dict[str, tuple[Vec3, Vec3]] = {
    "front": ((0.0, -1.0, 0.0), (0.0, 0.0, 1.0)),
    "back": ((0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
    "right": ((-1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
    "left": ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
    "top": ((0.0, 0.0, -1.0), (0.0, -1.0, 0.0)),
    "bottom": ((0.0, 0.0, 1.0), (0.0, 1.0, 0.0)),
    "iso": ((-1.0, -1.0, -1.0), (0.0, 0.0, 1.0)),
}

DEFAULT_VIEWS = ("front", "right", "top", "iso")


def camera_basis(view_dir: Vec3, up_hint: Vec3) -> tuple[Vec3, Vec3, Vec3]:
    """Return (forward, right, up) orthonormal camera axes."""
    d = normalize(view_dir)
    hint = up_hint
    if abs(dot(d, normalize(hint))) > 0.999:
        hint = (1.0, 0.0, 0.0) if abs(d[0]) < 0.9 else (0.0, 1.0, 0.0)
    right = normalize(cross(d, hint))
    up = cross(scale(d, -1.0), right)
    return d, right, up


def project_points(
    points: Sequence[Vec3], target: Vec3, d: Vec3, right: Vec3, up: Vec3
) -> tuple[float, float, float, float, float, float]:
    """Return (xmin, xmax, ymin, ymax, depth_min, depth_max).

    Larger depth means closer to the camera (camera sits at target - d*dist).
    """
    xmin = ymin = math.inf
    xmax = ymax = -math.inf
    zmin, zmax = math.inf, -math.inf
    for p in points:
        q = sub(p, target)
        x = dot(q, right)
        y = dot(q, up)
        z = dot(q, d)
        xmin, xmax = min(xmin, x), max(xmax, x)
        ymin, ymax = min(ymin, y), max(ymax, y)
        zmin, zmax = min(zmin, z), max(zmax, z)
    return xmin, xmax, ymin, ymax, zmin, zmax


@dataclass
class Framing:
    """Everything needed to place a camera and report the produced margins."""

    view: str
    view_dir: Vec3
    right: Vec3
    up: Vec3
    target: Vec3
    camera_location: Vec3
    near: float
    far: float
    ortho_scale: float
    world_width: float
    world_height: float
    pixels_per_unit: float
    margin_fraction: float
    # projected geometry bounds in world units relative to frame center
    xmin: float
    xmax: float
    ymin: float
    ymax: float
    # margin in output pixels (geometric prediction)
    px_left: float
    px_right: float
    px_top: float
    px_bottom: float

    def as_dict(self) -> dict:
        return {
            "view": self.view,
            "view_dir": list(self.view_dir),
            "camera_location": list(self.camera_location),
            "target": list(self.target),
            "near": self.near,
            "far": self.far,
            "ortho_scale": self.ortho_scale,
            "frame_world_size": [self.world_width, self.world_height],
            "pixels_per_unit": self.pixels_per_unit,
            "pixel_margin_geometric": {
                "left": round(self.px_left, 2),
                "right": round(self.px_right, 2),
                "top": round(self.px_top, 2),
                "bottom": round(self.px_bottom, 2),
            },
            "margin_fraction": round(self.margin_fraction, 5),
        }


def fit_orthographic(
    view: str,
    view_dir: Vec3,
    up_hint: Vec3,
    points: Sequence[Vec3],
    render_width: int,
    render_height: int,
    margin_fraction: float,
    fixed_ortho_scale: float | None = None,
) -> Framing:
    """Frame geometry from its actual world-space bounding volume.

    The projected bounding box (not the object origin) drives the frame, so
    parts with offset origins or far-away attachments stay fully visible.
    A shared ``fixed_ortho_scale`` across views keeps a common pixel scale.
    """
    d, right, up = camera_basis(view_dir, up_hint)
    lo, hi = bbox_of_points(points)
    target = bbox_center(lo, hi)
    corners = bbox_corners(lo, hi)
    xmin, xmax, ymin, ymax, zmin, zmax = project_points(corners, target, d, right, up)

    world_w, world_h = _frame_world_size(
        render_width, render_height, xmin, xmax, ymin, ymax, margin_fraction
    )
    if fixed_ortho_scale is not None:
        world_w, world_h = _apply_fixed_scale(
            fixed_ortho_scale, render_width, render_height
        )
    # Blender ortho_scale is the sensor's largest dimension; HORIZONTAL sensor
    # fit makes it equal to the horizontal world size of the frame.
    ortho_scale = world_w

    diag = length(sub(hi, lo))
    distance = max(diag * 2.0, world_w * 1.5, 1e-3)
    camera_location = sub(target, scale(d, distance))
    pad = max(diag * 0.1, distance * 0.1, 1e-3)
    near = max(distance - zmax - pad, 1e-4)
    far = distance - zmin + pad

    pixels_per_unit = render_width / world_w
    return Framing(
        view=view,
        view_dir=d,
        right=right,
        up=up,
        target=target,
        camera_location=camera_location,
        near=near,
        far=far,
        ortho_scale=ortho_scale,
        world_width=world_w,
        world_height=world_h,
        pixels_per_unit=pixels_per_unit,
        margin_fraction=margin_fraction,
        xmin=xmin,
        xmax=xmax,
        ymin=ymin,
        ymax=ymax,
        px_left=(xmin + world_w / 2) * pixels_per_unit,
        px_right=(world_w / 2 - xmax) * pixels_per_unit,
        px_top=(world_h / 2 - ymax) * pixels_per_unit,
        px_bottom=(ymin + world_h / 2) * pixels_per_unit,
    )


def _frame_world_size(
    render_width: int,
    render_height: int,
    xmin: float,
    xmax: float,
    ymin: float,
    ymax: float,
    margin_fraction: float,
) -> tuple[float, float]:
    geom_w = max(xmax - xmin, 1e-9)
    geom_h = max(ymax - ymin, 1e-9)
    aspect = render_width / render_height
    # Reserve margin_fraction of each output edge as whitespace.
    usable = 1.0 - 2.0 * margin_fraction
    need_w = geom_w / usable
    need_h = geom_h / usable
    if need_w / need_h >= aspect:
        world_w = need_w
        world_h = world_w / aspect
    else:
        world_h = need_h
        world_w = world_h * aspect
    return world_w, world_h


def _apply_fixed_scale(
    ortho_scale: float, render_width: int, render_height: int
) -> tuple[float, float]:
    aspect = render_width / render_height
    return ortho_scale, ortho_scale / aspect


def shared_ortho_scale(
    view_specs: Sequence[tuple[str, Vec3, Vec3]],
    points: Sequence[Vec3],
    render_width: int,
    render_height: int,
    margin_fraction: float,
) -> float:
    """Largest per-view frame width, so every view keeps the same pixel scale."""
    lo, hi = bbox_of_points(points)
    corners = bbox_corners(lo, hi)
    center = bbox_center(lo, hi)
    widths = []
    for _, view_dir, up_hint in view_specs:
        d, right, up = camera_basis(view_dir, up_hint)
        xmin, xmax, ymin, ymax, _, _ = project_points(corners, center, d, right, up)
        world_w, _ = _frame_world_size(
            render_width, render_height, xmin, xmax, ymin, ymax, margin_fraction
        )
        widths.append(world_w)
    return max(widths)
