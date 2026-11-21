"""Triangle mesh with adjacency, quality metrics and connectivity labels."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .geometry import normalize


@dataclass
class FaceQuality:
    """Per-face quality flags used by the brush for safety checks."""

    area: np.ndarray
    aspect_ratio: np.ndarray
    min_angle_rad: np.ndarray
    is_sliver: np.ndarray


class TriangleMesh:
    """A minimal indexed triangle mesh.

    Vertices are ``(V, 3)`` float64 points and faces are ``(F, 3)`` int64
    vertex indices.  The mesh may be non-manifold: adjacency is built from
    undirected edges, and an edge shared by more than two faces simply keeps
    every incident face, which is exactly the information needed to detect
    bifurcating ("forking") surfaces.
    """

    def __init__(self, vertices, faces):
        self.vertices = np.asarray(vertices, dtype=np.float64)
        self.faces = np.asarray(faces, dtype=np.int64)
        if self.vertices.ndim != 2 or self.vertices.shape[1] != 3:
            raise ValueError("vertices must have shape (V, 3)")
        if self.faces.ndim != 2 or self.faces.shape[1] != 3:
            raise ValueError("faces must have shape (F, 3)")
        self._edge_faces = None
        self._adjacency = None
        self._quality = None
        self._components = None

    @property
    def num_vertices(self) -> int:
        return self.vertices.shape[0]

    @property
    def num_faces(self) -> int:
        return self.faces.shape[0]

    def face_points(self, face_index: int):
        i0, i1, i2 = self.faces[face_index]
        return self.vertices[i0], self.vertices[i1], self.vertices[i2]

    def face_normal(self, face_index: int) -> np.ndarray:
        v0, v1, v2 = self.face_points(face_index)
        return normalize(np.cross(v1 - v0, v2 - v0))

    def face_normals(self) -> np.ndarray:
        v0 = self.vertices[self.faces[:, 0]]
        v1 = self.vertices[self.faces[:, 1]]
        v2 = self.vertices[self.faces[:, 2]]
        cross = np.cross(v1 - v0, v2 - v0)
        norms = np.linalg.norm(cross, axis=1, keepdims=True)
        norms[norms <= 0.0] = 1.0
        return cross / norms

    def face_centroids(self) -> np.ndarray:
        idx = self.faces
        return (self.vertices[idx[:, 0]]
                + self.vertices[idx[:, 1]]
                + self.vertices[idx[:, 2]]) / 3.0

    def edge_faces(self) -> dict:
        """Mapping ``(min_v, max_v) -> sorted list of incident face ids``."""
        if self._edge_faces is not None:
            return self._edge_faces
        table: dict[tuple[int, int], list[int]] = {}
        for face_id, (a, b, c) in enumerate(self.faces):
            for u, w in ((a, b), (b, c), (c, a)):
                key = (int(min(u, w)), int(max(u, w)))
                table.setdefault(key, []).append(face_id)
        for key in table:
            table[key].sort()
        self._edge_faces = table
        return table

    def face_adjacency(self) -> list[list[int]]:
        """Neighbouring faces sharing at least one edge with each face."""
        if self._adjacency is not None:
            return self._adjacency
        table = self.edge_faces()
        adj: list[set[int]] = [set() for _ in range(self.num_faces)]
        for face_ids in table.values():
            for face_id in face_ids:
                adj[face_id].update(f for f in face_ids if f != face_id)
        self._adjacency = [sorted(nb) for nb in adj]
        return self._adjacency

    def quality(self, sliver_threshold: float = 8.0,
                min_angle_deg: float = 10.0) -> FaceQuality:
        """Compute area, aspect-ratio and minimum-angle sliver flags.

        ``aspect_ratio`` is the longest edge divided by the in-circle
        diameter (``longest * perimeter / (4 * area)``), a scale-independent
        measure: equilateral triangles score 3 while degenerate slivers
        tend to infinity.  A face is also a sliver when its smallest inner
        angle drops below ``min_angle_deg``, which catches long thin
        triangles whose aspect ratio alone looks moderate.
        """
        if (self._quality is not None
                and getattr(self, "_quality_threshold", None)
                == (sliver_threshold, min_angle_deg)):
            return self._quality
        v0 = self.vertices[self.faces[:, 0]]
        v1 = self.vertices[self.faces[:, 1]]
        v2 = self.vertices[self.faces[:, 2]]
        cross = np.cross(v1 - v0, v2 - v0)
        area = 0.5 * np.linalg.norm(cross, axis=1)
        e0 = np.linalg.norm(v1 - v0, axis=1)
        e1 = np.linalg.norm(v2 - v1, axis=1)
        e2 = np.linalg.norm(v0 - v2, axis=1)
        longest = np.maximum(np.maximum(e0, e1), e2)
        perimeter = e0 + e1 + e2
        safe_area = np.maximum(area, 1.0e-300)
        aspect = longest * perimeter / (4.0 * safe_area)
        min_angle = self._minimum_angles(e0, e1, e2)
        is_sliver = ((aspect > sliver_threshold)
                     | (min_angle < np.radians(min_angle_deg))
                     | (area <= 1.0e-12))
        self._quality = FaceQuality(area, aspect, min_angle, is_sliver)
        self._quality_threshold = (sliver_threshold, min_angle_deg)
        return self._quality

    @staticmethod
    def _minimum_angles(e0, e1, e2):
        def angle_opposite(edge, adj_a, adj_b):
            cos_a = ((adj_a * adj_a + adj_b * adj_b - edge * edge)
                     / np.maximum(2.0 * adj_a * adj_b, 1.0e-300))
            return np.arccos(np.clip(cos_a, -1.0, 1.0))
        a0 = angle_opposite(e2, e0, e1)
        a1 = angle_opposite(e1, e0, e2)
        a2 = angle_opposite(e0, e1, e2)
        return np.minimum(np.minimum(a0, a1), a2)

    def connected_components(self) -> np.ndarray:
        """Label connected face components via shared-edge adjacency."""
        if self._components is not None:
            return self._components
        adj = self.face_adjacency()
        labels = np.full(self.num_faces, -1, dtype=np.int64)
        label = 0
        for seed in range(self.num_faces):
            if labels[seed] != -1:
                continue
            labels[seed] = label
            stack = [seed]
            while stack:
                face_id = stack.pop()
                for nb in adj[face_id]:
                    if labels[nb] == -1:
                        labels[nb] = label
                        stack.append(nb)
            label += 1
        self._components = labels
        return labels

    def edge_is_manifold(self, edge: tuple[int, int]) -> bool:
        """True when the undirected edge has exactly two incident faces."""
        return len(self.edge_faces()[edge]) == 2
