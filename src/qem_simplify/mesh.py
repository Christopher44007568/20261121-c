"""Triangle mesh with position-welded vertices and per-corner attributes.

Vertices are welded by spatial position so that boundary loops, UV seams and
material hard edges all share vertex indices.  UV coordinates / material ids /
part ids live on corners, which lets the simplifier reason about seams while
keeping the topology a plain indexed triangle list.

Edge identity is the *stable* undirected vertex pair (lo, hi), encoded as an
integer key.  Half-edge incidence is rebuilt incrementally during collapses,
so edge keys never get reindexed.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np


def edge_key_of(a: int, b: int, num_vertices: int) -> int:
    lo, hi = (a, b) if a < b else (b, a)
    return lo * (num_vertices + 1) + hi


@dataclass
class Mesh:
    positions: np.ndarray   # (V, 3) float64
    faces: np.ndarray       # (F, 3) int32 vertex indices
    corner_uv: np.ndarray   # (F, 3, 2) float64
    face_mat: np.ndarray    # (F,) int32 material id
    face_part: np.ndarray   # (F,) int32 part id
    materials: list = field(default_factory=list)
    parts: list = field(default_factory=list)
    name: str = "mesh"

    def __post_init__(self) -> None:
        self.face_alive = np.ones(self.num_faces, dtype=bool)
        self.vertex_alive = np.ones(self.num_vertices, dtype=bool)
        self.rebuild_incidence()

    @property
    def num_vertices(self) -> int:
        return int(self.positions.shape[0])

    @property
    def num_faces(self) -> int:
        return int(self.faces.shape[0])

    def edge_key(self, a: int, b: int) -> int:
        return edge_key_of(int(a), int(b), self.num_vertices)

    def key_verts(self, key: int) -> tuple:
        v = self.num_vertices + 1
        return divmod(key, v)

    def rebuild_incidence(self) -> None:
        """Map undirected edge key -> list of incident face ids."""
        self.edge_faces: dict[int, list[int]] = defaultdict(list)
        for fid in range(self.num_faces):
            if not self.face_alive[fid]:
                continue
            face = self.faces[fid]
            for s in range(3):
                key = self.edge_key(face[s], face[(s + 1) % 3])
                self.edge_faces[key].append(fid)

    def alive_incident_faces(self, key: int) -> list:
        return [fid for fid in self.edge_faces.get(key, ())
                if self.face_alive[fid]]

    def edge_is_boundary(self, key: int) -> bool:
        return len(self.alive_incident_faces(key)) == 1

    def edge_is_uv_seam(self, key: int) -> bool:
        faces = self.alive_incident_faces(key)
        if len(faces) != 2:
            return False
        a, b = self.key_verts(key)
        uv_sets = []
        for fid in faces:
            verts = self.faces[fid]
            slots = {int(verts[s]): s for s in range(3)}
            uv_sets.append(frozenset((
                self.corner_uv[fid][slots[a]].tobytes(),
                self.corner_uv[fid][slots[b]].tobytes(),
            )))
        return uv_sets[0] != uv_sets[1]

    def edge_is_hard(self, key: int) -> bool:
        """Hard edge = material or part id changes across the edge."""
        faces = self.alive_incident_faces(key)
        if len(faces) != 2:
            return False
        f0, f1 = faces
        return (int(self.face_mat[f0]) != int(self.face_mat[f1])
                or int(self.face_part[f0]) != int(self.face_part[f1]))

    def face_normal(self, face_id: int) -> np.ndarray:
        i, j, k = self.faces[face_id]
        n = np.cross(self.positions[j] - self.positions[i],
                     self.positions[k] - self.positions[i])
        ln = np.linalg.norm(n)
        return n / ln if ln > 1e-18 else np.zeros(3)

    def bbox(self) -> tuple:
        alive = np.unique(self.faces[self.face_alive])
        pts = self.positions[alive]
        return pts.min(axis=0), pts.max(axis=0)
