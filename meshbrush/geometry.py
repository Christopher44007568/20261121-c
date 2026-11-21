"""Geometric primitives for the view-ray mesh brush.

Only ``numpy`` is required.  All vectors are plain ``numpy`` arrays of
``float64``; barycentric helpers and the Moeller-Trumbore ray/triangle
intersection live here so that the rest of the package stays independent of
any particular GUI or rendering backend.
"""

from __future__ import annotations

import numpy as np

EPS = 1.0e-12


def normalize(v: np.ndarray) -> np.ndarray:
    """Return the unit vector of ``v`` (zero vectors map to zero)."""
    n = np.linalg.norm(v)
    if n <= EPS:
        return np.zeros_like(v, dtype=np.float64)
    return v / n


def ray_triangle(origin, direction, v0, v1, v2):
    """Moeller-Trumbore intersection.

    Returns ``(t, u, v)`` with the hit at ``origin + t * direction`` and
    barycentric weights ``(1 - u - v, u, v)``.  Returns ``None`` for a miss
    or a parallel configuration.  Both sides of a triangle are hittable;
    callers decide whether a back-facing hit is acceptable.
    """
    origin = np.asarray(origin, dtype=np.float64)
    direction = np.asarray(direction, dtype=np.float64)
    edge1 = v1 - v0
    edge2 = v2 - v0
    pvec = np.cross(direction, edge2)
    det = float(edge1.dot(pvec))
    if abs(det) <= EPS:
        return None
    inv_det = 1.0 / det
    tvec = origin - v0
    u = float(tvec.dot(pvec)) * inv_det
    if u < 0.0 or u > 1.0:
        return None
    qvec = np.cross(tvec, edge1)
    v = float(direction.dot(qvec)) * inv_det
    if v < 0.0 or u + v > 1.0:
        return None
    t = float(edge2.dot(qvec)) * inv_det
    if t <= EPS:
        return None
    return t, u, v


def triangle_normal(v0, v1, v2):
    return normalize(np.cross(v1 - v0, v2 - v0))


def triangle_area(v0, v1, v2) -> float:
    return 0.5 * float(np.linalg.norm(np.cross(v1 - v0, v2 - v0)))


def angle_between(a, b) -> float:
    """Unsigned angle in radians between two unit vectors, range [0, pi]."""
    cos_a = float(np.clip(normalize(a).dot(normalize(b)), -1.0, 1.0))
    return float(np.arccos(cos_a))


def closest_point_on_triangle(point, v0, v1, v2):
    """Closest point on triangle ``(v0, v1, v2)`` to ``point``.

    Uses Ericson's real-time collision detection routine: project onto the
    triangle plane, then fall back to the closest edge when the projection
    lands outside the triangle.
    """
    point = np.asarray(point, dtype=np.float64)
    ab = v1 - v0
    ac = v2 - v0
    ap = point - v0
    d1 = ab.dot(ap)
    d2 = ac.dot(ap)
    if d1 <= 0.0 and d2 <= 0.0:
        return v0
    bp = point - v1
    d3 = ab.dot(bp)
    d4 = ac.dot(bp)
    if d3 >= 0.0 and d4 <= d3:
        return v1
    vc = d1 * d4 - d3 * d2
    if vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
        v = d1 / (d1 - d3)
        return v0 + v * ab
    cp = point - v2
    d5 = ab.dot(cp)
    d6 = ac.dot(cp)
    if d6 >= 0.0 and d5 <= d6:
        return v2
    vb = d5 * d2 - d1 * d6
    if vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
        w = d2 / (d2 - d6)
        return v0 + w * ac
    va = d3 * d6 - d5 * d4
    if va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        return v1 + w * (v2 - v1)
    denom = 1.0 / (va + vb + vc)
    v = vb * denom
    w = vc * denom
    return v0 + ab * v + ac * w
