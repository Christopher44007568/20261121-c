"""Screen projection for 3D annotations.

Pure-python math shared by the live app and the trace verifier.

Conventions
-----------
* Camera looks down its local -Z axis, +Y is up (same as Qt Quick 3D).
* Camera orientation is R = Ry(yaw) @ Rx(pitch), angles in degrees.
* View space: x right, y up, points in front have z_view < 0.
* Screen space: origin top-left, y down, units are pixels.

Off-screen / behind-camera handling
-----------------------------------
Instead of clamping the *projected* position (which diverges as the
point approaches the camera plane and mirrors behind it), we clamp
along a *direction*: the view-space vector (x_view, y_view).

* In front of the camera it agrees with the projected position
* (x_clip = f * x_view, w > 0), so the label leaves the viewport
* edge exactly where the projection exits.
* Behind the camera it points the way the user must turn to face
* the anchor (left/right/up/down), and it is a continuous function
* of the anchor position while crossing the camera plane
* (near-clip pass-through) or sweeping across screen corners.
* It is identical for perspective and orthographic cameras, so
* toggling the projection mode never jumps the clamp direction.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

EPS = 1e-9


def _deg(rad: float) -> float:
    return rad * 180.0 / math.pi


@dataclass
class CameraState:
    x: float = 0.0
    y: float = 5.0
    z: float = 20.0
    yaw: float = 0.0        # degrees, about world Y
    pitch: float = 0.0      # degrees, about local X, positive looks up
    mode: str = "persp"     # "persp" | "ortho"
    fov_y: float = 60.0     # degrees, perspective only
    ortho_height: float = 40.0  # world units visible vertically
    near: float = 0.1
    far: float = 5000.0
    width: int = 1280
    height: int = 720
    margin: float = 48.0    # clamp inset from viewport edges, pixels

    def basis(self):
        """Return (right, up, forward) camera axes as world-space tuples."""
        cy = math.cos(math.radians(self.yaw))
        sy = math.sin(math.radians(self.yaw))
        cp = math.cos(math.radians(self.pitch))
        sp = math.sin(math.radians(self.pitch))
        # R = Ry(yaw) @ Rx(pitch); columns are the camera axes.
        right = (cy, 0.0, -sy)
        up = (sy * sp, cp, cy * sp)
        forward = (-sy * cp, sp, -cy * cp)
        return right, up, forward


@dataclass
class ProjResult:
    sx: float = 0.0          # screen x, pixels (clamped if off-screen)
    sy: float = 0.0
    raw_sx: float = 0.0      # unclamped projection (nan when degenerate)
    raw_sy: float = 0.0
    on_screen: bool = False  # projected inside viewport and depth-valid
    clamped: bool = False    # label sits on the clamp boundary
    behind: bool = False     # anchor is behind the camera plane
    in_depth: bool = False   # near <= depth <= far
    depth: float = 0.0
    angle: float = 0.0       # arrow direction, degrees, screen space
    dir_x: float = 0.0       # unit clamp direction in screen space
    dir_y: float = -1.0


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def world_to_view(px, py, pz, cam: CameraState):
    right, up, forward = cam.basis()
    dx, dy, dz = px - cam.x, py - cam.y, pz - cam.z
    xv = _dot(right, (dx, dy, dz))
    yv = _dot(up, (dx, dy, dz))
    zv = -_dot(forward, (dx, dy, dz))  # camera +Z axis points backwards
    return xv, yv, zv


def _clamp_to_rect(dir_x, dir_y, cam: CameraState):
    """Ray from viewport centre along (dir_x, dir_y) (screen px, y down)
    to the inset rectangle boundary. Returns (sx, sy)."""
    cx, cy = cam.width * 0.5, cam.height * 0.5
    hx = max(cam.width * 0.5 - cam.margin, 1.0)
    hy = max(cam.height * 0.5 - cam.margin, 1.0)
    tx = hx / abs(dir_x) if abs(dir_x) > EPS else math.inf
    ty = hy / abs(dir_y) if abs(dir_y) > EPS else math.inf
    t = min(tx, ty)
    return cx + dir_x * t, cy + dir_y * t


def project(px, py, pz, cam: CameraState, last_dir=(0.0, -1.0)) -> ProjResult:
    res = ProjResult()
    xv, yv, zv = world_to_view(px, py, pz, cam)
    depth = -zv
    res.depth = depth
    res.behind = depth <= 0.0
    res.in_depth = cam.near <= depth <= cam.far
    aspect = cam.width / max(cam.height, 1)

    if cam.mode == "persp":
        f = 1.0 / math.tan(math.radians(cam.fov_y) * 0.5)
        x_clip = f / aspect * xv
        y_clip = f * yv
        w = depth
        if abs(w) > EPS:
            nx, ny = x_clip / w, y_clip / w
        else:
            nx = math.copysign(math.inf, x_clip)
            ny = math.copysign(math.inf, y_clip)
    else:  # ortho: parallel projection, no singularity
        half_h = cam.ortho_height * 0.5
        half_w = half_h * aspect
        nx = xv / half_w if half_w > EPS else 0.0
        ny = yv / half_h if half_h > EPS else 0.0

    # Clamp direction: view-space (x, y). Continuous through the camera
    # plane and identical for both projection modes.
    dx, dy = xv, yv

    # NDC -> pixels (y flipped)
    def to_px(nx_, ny_):
        sx = (nx_ + 1.0) * 0.5 * cam.width
        sy = (1.0 - ny_) * 0.5 * cam.height
        return sx, sy

    finite = math.isfinite(nx) and math.isfinite(ny)
    if finite:
        res.raw_sx, res.raw_sy = to_px(nx, ny)
    else:
        # Degenerate (point on the camera plane): keep NaN for the trace.
        res.raw_sx, res.raw_sy = math.nan, math.nan

    inside = (
        finite
        and not res.behind
        and res.in_depth
        and abs(nx) <= 1.0
        and abs(ny) <= 1.0
    )

    if inside:
        res.on_screen = True
        res.sx, res.sy = res.raw_sx, res.raw_sy
        res.dir_x, res.dir_y = 0.0, 0.0
        res.angle = 0.0
        return res

    # Off-screen: clamp along direction. Screen-space direction flips y.
    dlen = math.hypot(dx, dy)
    if dlen < EPS:
        # Anchor exactly on the camera axis/plane: keep last direction
        # for continuity instead of snapping to an arbitrary edge.
        sx_dir, sy_dir = last_dir
    else:
        sx_dir, sy_dir = dx / dlen, -dy / dlen  # ndc y-up -> screen y-down
    res.dir_x, res.dir_y = sx_dir, sy_dir
    res.angle = _deg(math.atan2(sy_dir, sx_dir))
    res.sx, res.sy = _clamp_to_rect(sx_dir, sy_dir, cam)
    res.clamped = True
    return res


@dataclass
class AnnotationProjector:
    """Stateful per-annotation projector (remembers last clamp direction)."""

    last_dirs: dict = field(default_factory=dict)

    def project(self, ann_id: str, px, py, pz, cam: CameraState) -> ProjResult:
        last = self.last_dirs.get(ann_id, (0.0, -1.0))
        res = project(px, py, pz, cam, last)
        if res.clamped and (res.dir_x or res.dir_y):
            self.last_dirs[ann_id] = (res.dir_x, res.dir_y)
        return res
