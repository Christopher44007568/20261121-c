"""Minimal vectorised ray tracer: one plane and one sphere."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Sphere:
    center: np.ndarray
    radius: float


@dataclass(frozen=True)
class Plane:
    offset: float = -0.55


def make_camera(eye, target, fov_deg=42.0):
    eye = np.asarray(eye, dtype=float)
    target = np.asarray(target, dtype=float)
    forward = target - eye
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, np.array([0.0, 0.0, 1.0]))
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    half = np.tan(np.radians(fov_deg) * 0.5)
    return eye, right, up, forward, half


def camera_rays(camera, width, height):
    """Return ray origins and unit directions for every pixel."""
    eye, right, up, forward, half = camera
    aspect = width / height
    xs = np.linspace(-1.0, 1.0, width) * half * aspect
    ys = np.linspace(1.0, -1.0, height) * half
    gx, gy = np.meshgrid(xs, ys)
    dirs = (
        forward[None, None, :]
        + gx[..., None] * right[None, None, :]
        + gy[..., None] * up[None, None, :]
    )
    dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)
    origins = np.broadcast_to(eye, dirs.shape).copy()
    return origins, dirs


def intersect(origins, dirs, sphere: Sphere, plane: Plane):
    """Nearest-hit intersection. Returns hit mask, t, points, normals."""
    n = origins.shape[:-1]
    best_t = np.full(n, np.inf)
    best_n = np.zeros((*n, 3))

    t_plane = (plane.offset - origins[..., 2]) / dirs[..., 2]
    plane_ok = (t_plane > 1.0e-4) & np.isfinite(t_plane)
    best_t = np.where(plane_ok, t_plane, best_t)
    best_n = np.where(plane_ok[..., None], np.array([0.0, 0.0, 1.0]), best_n)

    oc = origins - sphere.center
    b = np.sum(oc * dirs, axis=-1)
    c = np.sum(oc * oc, axis=-1) - sphere.radius**2
    disc = b * b - c
    sphere_ok = disc > 0.0
    t_sphere = -b - np.sqrt(np.maximum(disc, 0.0))
    sphere_ok &= t_sphere > 1.0e-4
    points_s = origins + t_sphere[..., None] * dirs
    normals_s = (points_s - sphere.center) / sphere.radius
    closer = sphere_ok & (t_sphere < best_t)
    best_t = np.where(closer, t_sphere, best_t)
    best_n = np.where(closer[..., None], normals_s, best_n)

    hit = np.isfinite(best_t)
    points = origins + best_t[..., None] * dirs
    return hit, best_t, points, best_n
