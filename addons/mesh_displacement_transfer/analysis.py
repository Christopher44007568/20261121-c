"""Thickness measurement, seam-ring detection and reuse checks."""

import hashlib

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .core import _triangulated


def measure_thickness(obj, max_distance=1.0, top_only=False, up_min=0.3):
    """Local thickness per vertex via inward ray cast along the vertex normal.

    Returns (thickness (n,) array, mask (n,) bool of sampled vertices).
    Vertices whose inward ray misses get thickness 0 and mask False.
    """
    mesh = obj.data
    verts, tris = _triangulated(mesh)
    bvh = BVHTree.FromPolygons(verts.tolist(), tris.tolist())

    normals = np.empty(len(verts) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("normal", normals)
    normals = normals.reshape(-1, 3)
    n_len = np.linalg.norm(normals, axis=1)
    n_len[n_len == 0.0] = 1.0
    normals = normals / n_len[:, None]

    thickness = np.zeros(len(verts), dtype=np.float64)
    mask = np.zeros(len(verts), dtype=bool)
    eps = 1e-5
    for i in range(len(verts)):
        n = normals[i]
        if top_only and n[2] < up_min:
            continue
        # start just *inside* the surface so the nearest inward hit is the
        # opposite wall, not the surface the vertex belongs to
        origin = Vector(verts[i] - n * eps)
        hit = bvh.ray_cast(origin, Vector(-n), max_distance)
        loc = hit[0]
        if loc is None:
            continue
        dist = (Vector(loc) - origin).length
        if dist > eps:
            thickness[i] = dist
            mask[i] = True
    return thickness, mask


def thickness_stats(thickness, mask):
    values = thickness[mask]
    if values.size == 0:
        return {"samples": 0}
    return {
        "samples": int(values.size),
        "mean": float(values.mean()),
        "median": float(np.median(values)),
        "min": float(values.min()),
        "max": float(values.max()),
        "std": float(values.std()),
    }


def find_seam_vertices(obj, attribute="part_group"):
    """Vertex indices on boundaries between face-attribute regions.

    A vertex is a seam vertex when the faces around it carry more than one
    value of the given FACE-domain integer attribute.
    """
    mesh = obj.data
    attr = mesh.attributes.get(attribute)
    if attr is None or attr.domain != "FACE":
        return []
    face_group = np.empty(len(mesh.polygons), dtype=np.int32)
    attr.data.foreach_get("value", face_group)

    vert_groups = {}
    for poly in mesh.polygons:
        g = int(face_group[poly.index])
        for vi in poly.vertices:
            vert_groups.setdefault(vi, set()).add(g)
    return sorted(vi for vi, groups in vert_groups.items() if len(groups) > 1)


def assign_lock_group(obj, vertex_indices, group_name, falloff=0):
    """Create/refresh the lock vertex group from seam vertex indices.

    falloff > 0 spreads decaying weights to edge-neighbours so the lock
    blends smoothly into the moving interior.
    """
    mesh = obj.data
    vg = obj.vertex_groups.get(group_name)
    if vg is None:
        vg = obj.vertex_groups.new(name=group_name)

    weights = {int(vi): 1.0 for vi in vertex_indices}
    if falloff > 0:
        neighbours = {i: set() for i in weights}
        all_neighbours = {}
        for edge in mesh.edges:
            a, b = edge.vertices
            all_neighbours.setdefault(a, set()).add(b)
            all_neighbours.setdefault(b, set()).add(a)
        frontier = dict(weights)
        for step in range(1, falloff + 1):
            w = 1.0 - step / (falloff + 1.0)
            nxt = {}
            for vi in frontier:
                for nb in all_neighbours.get(vi, ()):  # spread one ring
                    if nb not in weights and nb not in nxt:
                        nxt[nb] = w
            weights.update(nxt)
            frontier = nxt

    for vi, w in weights.items():
        vg.add([vi], float(w), "REPLACE")
    return vg, len(weights)


def _hash_array(arr):
    return hashlib.sha1(np.ascontiguousarray(arr).tobytes()).hexdigest()


def snapshot_reusable_data(obj, attribute="part_group"):
    """Hash UVs, face-group attribute and vertex-group membership."""
    mesh = obj.data
    snap = {}
    uv = mesh.uv_layers.active
    if uv is not None:
        data = np.empty(len(uv.data) * 2, dtype=np.float64)
        uv.data.foreach_get("uv", data)
        snap["uv"] = _hash_array(data)
    attr = mesh.attributes.get(attribute)
    if attr is not None:
        data = np.empty(len(attr.data), dtype=np.int32)
        attr.data.foreach_get("value", data)
        snap["face_group"] = _hash_array(data)
    groups = {}
    for vg in obj.vertex_groups:
        w = np.zeros(len(mesh.vertices), dtype=np.float64)
        for i in range(len(mesh.vertices)):
            try:
                w[i] = vg.weight(i)
            except RuntimeError:
                pass
        groups[vg.name] = _hash_array(w)
    snap["vertex_groups"] = groups
    return snap


def compare_snapshots(before, after):
    """Return dict of checks: True when the data survived recomputation."""
    checks = {}
    for key in ("uv", "face_group"):
        if key in before:
            checks[key] = before[key] == after.get(key)
    bg = before.get("vertex_groups", {})
    ag = after.get("vertex_groups", {})
    checks["vertex_groups"] = bg == ag
    checks["all"] = all(checks.values())
    return checks
