"""Quadric error metrics (Garland & Heckbert 1997).

A plane p = (a, b, c, d) with unit normal contributes the outer product
K_p = p p^T (4x4).  A vertex quadric is the sum of its incident plane
quadrics; the contraction error at homogeneous point h = [x, y, z, 1] is
h^T (Q_u + Q_v) h.
"""

from __future__ import annotations

import numpy as np


def face_plane_quadric(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray):
    normal = np.cross(p1 - p0, p2 - p0)
    length = np.linalg.norm(normal)
    if length < 1e-18:
        return np.zeros((4, 4)), np.zeros(4)
    normal = normal / length
    d = -float(normal @ p0)
    plane = np.array([normal[0], normal[1], normal[2], d])
    return np.outer(plane, plane), plane


def boundary_plane_quadric(v0: np.ndarray, v1: np.ndarray,
                           face_normal: np.ndarray):
    """Perpendicular preservation plane through a boundary/seam edge."""
    edge = v1 - v0
    elen = np.linalg.norm(edge)
    if elen < 1e-12:
        return np.zeros((4, 4))
    edge = edge / elen
    n = face_normal - edge * float(face_normal @ edge)
    nlen = np.linalg.norm(n)
    if nlen < 1e-12:
        return np.zeros((4, 4))
    n = n / nlen
    d = -float(n @ v0)
    plane = np.array([n[0], n[1], n[2], d])
    return np.outer(plane, plane)


def initial_quadrics(mesh, boundary_weight: float, seam_weight: float,
                     seam_keys):
    n = mesh.num_vertices
    quadrics = np.zeros((n, 4, 4))
    for fid in range(mesh.num_faces):
        if not mesh.face_alive[fid]:
            continue
        i, j, k = mesh.faces[fid]
        q, _ = face_plane_quadric(mesh.positions[i], mesh.positions[j],
                                  mesh.positions[k])
        quadrics[i] += q
        quadrics[j] += q
        quadrics[k] += q
    seam_set = set(seam_keys)
    for key in mesh.edge_faces:
        is_boundary = mesh.edge_is_boundary(key)
        if not (is_boundary or key in seam_set):
            continue
        weight = boundary_weight if is_boundary else seam_weight
        if weight <= 0.0:
            continue
        a, b = mesh.key_verts(key)
        nrm = np.zeros(3)
        for fid in mesh.alive_incident_faces(key):
            nrm += mesh.face_normal(fid)
        ln = np.linalg.norm(nrm)
        if ln < 1e-12:
            continue
        qb = boundary_plane_quadric(mesh.positions[a], mesh.positions[b],
                                    nrm / ln) * weight
        quadrics[a] += qb
        quadrics[b] += qb
    return quadrics


def contraction_error(q: np.ndarray, point: np.ndarray) -> float:
    h = np.array([point[0], point[1], point[2], 1.0])
    return float(h @ q @ h)


def optimal_point(q: np.ndarray, v0: np.ndarray, v1: np.ndarray):
    """Solve argmin x^T Q x; fall back to endpoint/midpoint candidates."""
    a = q[:3, :3]
    b = q[:3, 3]
    if abs(np.linalg.det(a)) > 1e-12:
        try:
            x = np.linalg.solve(a, -b)
            if np.all(np.isfinite(x)):
                return x, contraction_error(q, x)
        except np.linalg.LinAlgError:
            pass
    candidates = [v0, v1, 0.5 * (v0 + v1)]
    errs = [contraction_error(q, c) for c in candidates]
    idx = int(np.argmin(errs))
    return candidates[idx], errs[idx]
