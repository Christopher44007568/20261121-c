"""Bounding-volume hierarchy for nearest-hit ray casting on triangle meshes.

The tree is stored in flat arrays so that ray traversal allocates nothing.
Splits use the median centroid along the longest axis, which is cheap and
keeps the tree balanced for the meshes used with the brush.  Leaf nodes
reference a slice of a separate ``leaf_faces`` array, so internal child
indices and leaf payloads never share a slot.
"""

from __future__ import annotations

import numpy as np

from .geometry import ray_triangle


class _Node:
    __slots__ = ("bounds_min", "bounds_max", "left", "right",
                 "leaf_start", "leaf_count")

    def __init__(self):
        self.bounds_min = np.zeros(3)
        self.bounds_max = np.zeros(3)
        self.left = -1
        self.right = -1
        self.leaf_start = -1
        self.leaf_count = 0


class RayHit:
    """A successful ray/mesh intersection."""

    __slots__ = ("face_id", "t", "point", "bary", "front_facing", "normal")

    def __init__(self, face_id, t, point, bary, front_facing, normal):
        self.face_id = face_id
        self.t = t
        self.point = point
        self.bary = bary
        self.front_facing = front_facing
        self.normal = normal

    def __repr__(self):
        return (f"RayHit(face={self.face_id}, t={self.t:.4f}, "
                f"front={self.front_facing})")


class BVH:
    def __init__(self, mesh, leaf_size: int = 4):
        self.mesh = mesh
        self.leaf_size = max(1, int(leaf_size))
        nodes: list[_Node] = []
        leaf_lists: list[np.ndarray] = []
        face_ids = np.arange(mesh.num_faces, dtype=np.int64)
        self._build(mesh, face_ids, nodes, leaf_lists)
        count = len(nodes)
        self.bounds_min = np.zeros((count, 3))
        self.bounds_max = np.zeros((count, 3))
        self.left = np.full(count, -1, dtype=np.int64)
        self.right = np.full(count, -1, dtype=np.int64)
        self.leaf_start = np.full(count, -1, dtype=np.int64)
        self.leaf_count = np.zeros(count, dtype=np.int64)
        for i, node in enumerate(nodes):
            self.bounds_min[i] = node.bounds_min
            self.bounds_max[i] = node.bounds_max
            self.left[i] = node.left
            self.right[i] = node.right
            self.leaf_start[i] = node.leaf_start
            self.leaf_count[i] = node.leaf_count
        if leaf_lists:
            self.leaf_faces = np.concatenate(leaf_lists).astype(np.int64)
        else:
            self.leaf_faces = np.empty(0, dtype=np.int64)

    def _build(self, mesh, face_ids, nodes, leaf_lists):
        corners = mesh.vertices[mesh.faces[face_ids]]
        mins = corners.reshape(-1, 3).min(axis=0)
        maxs = corners.reshape(-1, 3).max(axis=0)
        node = _Node()
        node.bounds_min = mins
        node.bounds_max = maxs
        nodes.append(node)
        index = len(nodes) - 1
        if face_ids.shape[0] <= self.leaf_size:
            node.leaf_start = sum(a.shape[0] for a in leaf_lists)
            node.leaf_count = face_ids.shape[0]
            leaf_lists.append(face_ids.astype(np.int64).copy())
            return index
        centroids = corners.mean(axis=1)
        axis = int(np.argmax(maxs - mins))
        order = np.argsort(centroids[:, axis])
        sorted_ids = face_ids[order]
        mid = sorted_ids.shape[0] // 2
        node.left = self._build(mesh, sorted_ids[:mid], nodes, leaf_lists)
        node.right = self._build(mesh, sorted_ids[mid:], nodes, leaf_lists)
        return index

    def _intersect_bbox(self, node_id, origin, inv_dir, t_max):
        lo = self.bounds_min[node_id]
        hi = self.bounds_max[node_id]
        near = 0.0
        far = np.inf
        for axis in range(3):
            d = inv_dir[axis]
            if np.isinf(d):
                if origin[axis] < lo[axis] or origin[axis] > hi[axis]:
                    return False
                continue
            t0 = (lo[axis] - origin[axis]) * d
            t1 = (hi[axis] - origin[axis]) * d
            near = max(near, min(t0, t1))
            far = min(far, max(t0, t1))
        return far >= max(near, 0.0) and near < t_max

    def cast_ray(self, origin, direction, t_max: float = np.inf):
        """Return the nearest :class:`RayHit` or ``None``."""
        origin = np.asarray(origin, dtype=np.float64)
        direction = np.asarray(direction, dtype=np.float64)
        norm = np.linalg.norm(direction)
        if norm <= 1.0e-12:
            return None
        direction = direction / norm
        with np.errstate(divide="ignore"):
            inv_dir = np.where(np.abs(direction) > 1.0e-30,
                               1.0 / direction, np.inf)
        best = None
        stack = [0]
        mesh = self.mesh
        while stack:
            node_id = stack.pop()
            if not self._intersect_bbox(node_id, origin, inv_dir, t_max):
                continue
            if self.leaf_count[node_id] > 0:
                start = int(self.leaf_start[node_id])
                stop = start + int(self.leaf_count[node_id])
                for face_id in self.leaf_faces[start:stop]:
                    result = self._test_face(int(face_id), origin,
                                             direction, mesh)
                    if result is not None and result[0] < t_max:
                        t_max, best = result
                continue
            stack.append(int(self.right[node_id]))
            stack.append(int(self.left[node_id]))
        return best

    def _test_face(self, face_id, origin, direction, mesh):
        v0, v1, v2 = mesh.face_points(face_id)
        hit = ray_triangle(origin, direction, v0, v1, v2)
        if hit is None:
            return None
        t, u, v = hit
        point = origin + t * direction
        normal = mesh.face_normal(face_id)
        front = float(normal.dot(-direction)) > 0.0
        return t, RayHit(face_id, t, point,
                         np.array((1.0 - u - v, u, v)),
                         front, normal)
