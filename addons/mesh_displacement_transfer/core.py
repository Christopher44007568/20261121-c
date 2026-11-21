"""Core math for local-frame displacement transfer.

The transfer binds every vertex of a high-resolution mesh to the surface of a
low-resolution "sculpt" mesh in rest pose. Each binding stores barycentric
coordinates inside a source triangle plus an offset expressed in a local
orthonormal frame derived from that triangle. When the low mesh is later
deformed (bent, twisted, rotated), the high vertex is rebuilt from the same
local coordinates, so the displacement follows the rotation of the low
surface instead of being copied in world space.
"""

import hashlib

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BINDING_CACHE = {}
LOCK_GROUP_DEFAULT = "MDT_SeamLock"


def _triangulated(mesh):
    """Return (verts (n,3) float64, tris (m,3) int32) from a mesh."""
    mesh.calc_loop_triangles()
    verts = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", verts)
    verts = verts.reshape(-1, 3)
    tris = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("vertices", tris)
    return verts, tris.reshape(-1, 3)


def _frames(tri_pts):
    """Orthonormal local frames for triangles.

    tri_pts: (m, 3, 3) triangle corner positions.
    Returns (t1, t2, n) each (m, 3); rows are unit vectors.
    """
    e1 = tri_pts[:, 1] - tri_pts[:, 0]
    e2 = tri_pts[:, 2] - tri_pts[:, 0]
    n = np.cross(e1, e2)
    n_len = np.linalg.norm(n, axis=1)
    n_len[n_len == 0.0] = 1.0
    n = n / n_len[:, None]
    e1_len = np.linalg.norm(e1, axis=1)
    e1_len[e1_len == 0.0] = 1.0
    t1 = e1 / e1_len[:, None]
    t2 = np.cross(n, t1)
    return t1, t2, n


def _barycentric(point, tri_pts):
    """Barycentric weights of points projected onto triangles.

    point: (k, 3) closest points on the triangles (already projected).
    Returns (k, 3) weights for corners 0..2.
    """
    p0 = tri_pts[:, 0]
    v0 = tri_pts[:, 1] - p0
    v1 = tri_pts[:, 2] - p0
    v2 = point - p0
    d00 = np.einsum("ij,ij->i", v0, v0)
    d01 = np.einsum("ij,ij->i", v0, v1)
    d11 = np.einsum("ij,ij->i", v1, v1)
    d20 = np.einsum("ij,ij->i", v2, v0)
    d21 = np.einsum("ij,ij->i", v2, v1)
    denom = d00 * d11 - d01 * d01
    denom[np.abs(denom) < 1e-30] = 1e-30
    v = (d11 * d20 - d01 * d21) / denom
    w = (d00 * d21 - d01 * d20) / denom
    u = 1.0 - v - w
    return np.stack([u, v, w], axis=1)


def mesh_signature(mesh):
    """Stable hash of topology + rest positions, used to validate bindings."""
    verts, tris = _triangulated(mesh)
    h = hashlib.sha1()
    h.update(np.ascontiguousarray(verts).tobytes())
    h.update(np.ascontiguousarray(tris).tobytes())
    return h.hexdigest()


def bind(low_obj, high_obj, lock_group=LOCK_GROUP_DEFAULT):
    """Bind high vertices to the low rest surface.

    Returns a binding dict of numpy arrays and caches it for the session.
    """
    low_verts, low_tris = _triangulated(low_obj.data)
    high_rest, _ = _triangulated(high_obj.data)

    bvh = BVHTree.FromPolygons(low_verts.tolist(), low_tris.tolist())

    count = len(high_rest)
    tri_index = np.empty(count, dtype=np.int32)
    anchor = np.empty((count, 3), dtype=np.float64)
    distance = np.empty(count, dtype=np.float64)
    for i, co in enumerate(high_rest):
        loc, _norm, idx, dist = bvh.find_nearest(Vector(co))
        if idx is None:  # degenerate source mesh: fall back to first triangle
            idx, dist, loc = 0, 0.0, Vector(low_verts[low_tris[0, 0]])
        tri_index[i] = idx
        anchor[i] = loc
        distance[i] = dist

    tri_pts = low_verts[low_tris[tri_index]]
    bary = _barycentric(anchor, tri_pts)
    t1, t2, n = _frames(tri_pts)
    delta = high_rest - anchor
    offset_local = np.stack(
        [
            np.einsum("ij,ij->i", delta, t1),
            np.einsum("ij,ij->i", delta, t2),
            np.einsum("ij,ij->i", delta, n),
        ],
        axis=1,
    )

    lock = np.zeros(count, dtype=np.float64)
    vg = high_obj.vertex_groups.get(lock_group)
    if vg is not None:
        for i in range(count):
            try:
                lock[i] = vg.weight(i)
            except RuntimeError:
                pass

    binding = {
        "low_tri_verts": low_tris,
        "tri_index": tri_index,
        "bary": bary,
        "offset_local": offset_local,
        "high_rest": high_rest,
        "lock": lock,
        "low_signature": mesh_signature(low_obj.data),
        "high_signature": mesh_signature(high_obj.data),
        "distance": distance,
    }
    BINDING_CACHE[(low_obj.name, high_obj.name)] = binding
    return binding


def get_binding(low_obj, high_obj):
    binding = BINDING_CACHE.get((low_obj.name, high_obj.name))
    if binding is None:
        binding = bind(low_obj, high_obj)
    return binding


def transfer(binding, low_verts_deformed, lock_weight_scale=1.0):
    """Rebuild high positions from deformed low vertex positions.

    low_verts_deformed: (v, 3) array of the low mesh in its current pose.
    Locked vertices (lock weight 1) keep their rest position; partial weights
    blend between the transferred and the rest position.
    """
    tris = binding["low_tri_verts"][binding["tri_index"]]
    tri_pts = low_verts_deformed[tris]
    bary = binding["bary"]
    anchor = (
        tri_pts[:, 0] * bary[:, 0:1]
        + tri_pts[:, 1] * bary[:, 1:2]
        + tri_pts[:, 2] * bary[:, 2:3]
    )
    t1, t2, n = _frames(tri_pts)
    off = binding["offset_local"]
    pos = anchor + off[:, 0:1] * t1 + off[:, 1:2] * t2 + off[:, 2:3] * n

    lock = np.clip(binding["lock"] * lock_weight_scale, 0.0, 1.0)
    if lock.any():
        pos = pos * (1.0 - lock[:, None]) + binding["high_rest"] * lock[:, None]
    return pos


def apply_positions(obj, positions):
    """Write (n, 3) positions back into a mesh's vertices."""
    flat = np.ascontiguousarray(positions, dtype=np.float64).reshape(-1)
    obj.data.vertices.foreach_set("co", flat)
    obj.data.update()
