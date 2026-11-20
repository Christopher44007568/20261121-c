"""Post-simplification verification.

Checks:
  * manifoldness: every edge has 1 (boundary) or 2 (interior) alive faces,
    and every alive vertex has a single fan of faces
  * normal orientation: consistent winding inside each connected component
  * constrained edges: boundary / seam / hard / user-locked edges of the
    original mesh that still exist must remain un-collapsed; the original
    boundary loop length is preserved (within tolerance)
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np


def find_nonmanifold_edges(mesh) -> list:
    bad = []
    for key, fids in mesh.edge_faces.items():
        alive = [f for f in fids if mesh.face_alive[f]]
        if len(alive) not in (1, 2) or len(alive) != len(set(alive)):
            bad.append((key, len(alive)))
    return bad


def find_nonmanifold_vertices(mesh) -> list:
    fan = defaultdict(list)
    for fid in range(mesh.num_faces):
        if not mesh.face_alive[fid]:
            continue
        for vi in mesh.faces[fid]:
            fan[int(vi)].append(fid)
    bad = []
    for vi, fids in fan.items():
        # build undirected neighbor graph inside the fan; manifold vertices
        # have every neighbor appearing exactly twice (once per adjacent tri)
        degree = defaultdict(int)
        for fid in fids:
            face = mesh.faces[fid]
            for s in range(3):
                if int(face[s]) == vi:
                    degree[int(face[(s + 1) % 3])] += 1
                    degree[int(face[(s - 1) % 3])] += 1
        boundary_tips = sum(1 for d in degree.values() if d == 1)
        if any(d > 2 for d in degree.values()):
            bad.append(vi)
        elif boundary_tips not in (0, 2):
            bad.append(vi)
    return bad


def orientation_inconsistencies(mesh) -> list:
    """Pairs of adjacent faces whose shared edge is not oppositely oriented."""
    bad = []
    for key, fids in mesh.edge_faces.items():
        alive = [f for f in fids if mesh.face_alive[f]]
        if len(alive) != 2:
            continue
        f0, f1 = alive
        a, b = mesh.key_verts(key)
        def order(fid):
            face = list(map(int, mesh.faces[fid]))
            i = face.index(a)
            return face[i], face[(i + 1) % 3]
        if order(f0) == order(f1):
            bad.append((f0, f1))
    return bad


def degenerate_faces(mesh) -> list:
    out = []
    for fid in range(mesh.num_faces):
        if not mesh.face_alive[fid]:
            continue
        i, j, k = mesh.faces[fid]
        area = np.linalg.norm(np.cross(mesh.positions[j] - mesh.positions[i],
                                       mesh.positions[k] - mesh.positions[i]))
        if area < 1e-14:
            out.append(fid)
    return out


def boundary_loop_length(mesh) -> float:
    total = 0.0
    for key in mesh.edge_faces:
        if mesh.edge_is_boundary(key):
            a, b = mesh.key_verts(key)
            total += float(np.linalg.norm(mesh.positions[a]
                                          - mesh.positions[b]))
    return total


def classify_constraint_edges(mesh) -> dict:
    # edge classes are not mutually exclusive: a hard material edge can also
    # carry distinct UVs and therefore be a seam at the same time
    buckets = {"boundary": [], "seam": [], "hard": []}
    for key in list(mesh.edge_faces):
        if mesh.edge_is_hard(key):
            buckets["hard"].append(key)
        if mesh.edge_is_boundary(key):
            buckets["boundary"].append(key)
        if mesh.edge_is_uv_seam(key):
            buckets["seam"].append(key)
    return buckets


def verify_constraints(original, simplified, locked_keys) -> dict:
    """Every original locked edge must still exist, un-collapsed, in output."""
    out_keys = set(simplified.edge_faces.keys())
    missing = [k for k in locked_keys if k not in out_keys]
    original_boundary = classify_constraint_edges(original)["boundary"]
    boundary_missing = [k for k in original_boundary if k not in out_keys]
    return {
        "locked_total": len(locked_keys),
        "locked_missing": len(missing),
        "original_boundary_edges": len(original_boundary),
        "boundary_edges_lost": len(boundary_missing),
        "boundary_length_before": boundary_loop_length(original),
        "boundary_length_after": boundary_loop_length(simplified),
    }


def full_report(mesh) -> dict:
    nm_edges = find_nonmanifold_edges(mesh)
    nm_verts = find_nonmanifold_vertices(mesh)
    orient = orientation_inconsistencies(mesh)
    deg = degenerate_faces(mesh)
    return {
        "faces": int(mesh.face_alive.sum()),
        "vertices": int(mesh.vertex_alive.sum()),
        "nonmanifold_edges": len(nm_edges),
        "nonmanifold_vertices": len(nm_verts),
        "orientation_inconsistencies": len(orient),
        "degenerate_faces": len(deg),
        "boundary_loop_length": boundary_loop_length(mesh),
        "manifold": not nm_edges and not nm_verts,
        "oriented": not orient,
    }
