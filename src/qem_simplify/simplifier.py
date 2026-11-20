"""Constrained QEM edge-collapse simplifier.

Constraint policies, per edge class:
  * boundary / uv-seam: "penalize" (weighted preservation planes) or
    "lock" (never collapse)
  * hard (material/part change): always locked, so material regions and
    parts never merge
  * user locked edges (per part): always locked

Every candidate collapse is rejected when it would (a) violate the link
condition (keeps the mesh manifold), (b) flip a face normal, or
(c) produce a degenerate triangle.  Edge identity is the stable undirected
vertex-pair key, so lazy heap entries stay valid across collapses.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass

import numpy as np

from .quadric import initial_quadrics, optimal_point
from .mesh import Mesh

FLIP_DOT = 1e-4


@dataclass
class SimplifyOptions:
    boundary_policy: str = "penalize"   # or "lock"
    seam_policy: str = "penalize"       # or "lock"
    boundary_weight: float = 10.0
    seam_weight: float = 5.0
    max_error: float = 1e30
    lock_parts: tuple = ()              # part names whose edges are frozen


@dataclass
class CollapseRecord:
    u: int
    v: int
    target: np.ndarray
    error: float
    key: int
    edge_kind: str


class Simplifier:
    def __init__(self, mesh: Mesh, options: SimplifyOptions | None = None):
        self.mesh = mesh
        self.opt = options or SimplifyOptions()
        m = mesh
        self.heap = []
        self.counter = 0
        self.edge_version: dict[int, int] = {k: 0 for k in m.edge_faces}
        self.locked: set[int] = set()
        self.history: list[CollapseRecord] = []
        self.reject_reasons: dict[str, int] = {}
        seam_keys = [k for k in m.edge_faces if m.edge_is_uv_seam(k)]
        self.quadrics = initial_quadrics(
            m, self.opt.boundary_weight, self.opt.seam_weight, seam_keys)
        self._build_vertex_faces()
        self._classify_edges()
        self._push_all_edges()

    # ------------------------------------------------------------- setup
    def _edge_kind(self, key: int) -> str:
        m = self.mesh
        if m.edge_is_hard(key):
            return "hard"
        if m.edge_is_boundary(key):
            return "boundary"
        if m.edge_is_uv_seam(key):
            return "seam"
        return "interior"

    def _classify_edges(self) -> None:
        m = self.mesh
        lock_part_ids = {i for i, p in enumerate(m.parts)
                         if p in set(self.opt.lock_parts)}
        primary = set()
        for key in list(m.edge_faces):
            kind = self._edge_kind(key)
            if kind == "hard":
                primary.add(key)
            elif kind == "boundary" and self.opt.boundary_policy == "lock":
                primary.add(key)
            elif kind == "seam" and self.opt.seam_policy == "lock":
                primary.add(key)
            if lock_part_ids:
                faces = m.alive_incident_faces(key)
                if faces and all(int(m.face_part[f]) in lock_part_ids
                                 for f in faces):
                    primary.add(key)
        # An edge survives intact only if neither endpoint is contracted
        # away.  Mark primary-constraint endpoints as protected vertices and
        # lock just the edges touching them; the link condition still allows
        # ordinary collapses elsewhere in the mesh.
        frozen_verts = set()
        for key in primary:
            a, b = m.key_verts(key)
            frozen_verts.add(a)
            frozen_verts.add(b)
        self.protected_verts = frozen_verts
        for key in list(m.edge_faces):
            a, b = m.key_verts(key)
            if a in frozen_verts or b in frozen_verts:
                self.locked.add(key)
        self.primary_locked = primary

    def _build_vertex_faces(self) -> None:
        m = self.mesh
        self.vfaces = [set() for _ in range(m.num_vertices)]
        for fid in range(m.num_faces):
            if m.face_alive[fid]:
                for vi in m.faces[fid]:
                    self.vfaces[int(vi)].add(fid)

    # ------------------------------------------------------------- heap
    def _push_edge(self, key: int) -> None:
        m = self.mesh
        a, b = m.key_verts(key)
        if not (m.vertex_alive[a] and m.vertex_alive[b]):
            return
        if key in self.locked or a in self.protected_verts \
                or b in self.protected_verts:
            return
        q = self.quadrics[a] + self.quadrics[b]
        point, error = optimal_point(q, m.positions[a], m.positions[b])
        self.counter += 1
        heapq.heappush(self.heap,
                       (error, self.counter, key,
                        self.edge_version.get(key, 0), a, b, point))

    def _push_all_edges(self) -> None:
        for key in list(self.mesh.edge_faces):
            self._push_edge(key)

    def _bump(self, key: int) -> None:
        self.edge_version[key] = self.edge_version.get(key, 0) + 1
        self._push_edge(key)

    # --------------------------------------------------------- validation
    def _neighbors(self, vi: int) -> set:
        out = set()
        for fid in self.vfaces[vi]:
            for other in self.mesh.faces[fid]:
                if int(other) != vi:
                    out.add(int(other))
        return out

    def link_condition_ok(self, u: int, v: int) -> bool:
        """Lk(u) n Lk(v) == Lk(u,v); keeps the mesh manifold after collapse."""
        m = self.mesh
        key = m.edge_key(u, v)
        opposite = set()
        for fid in m.alive_incident_faces(key):
            for vert in m.faces[fid]:
                vert = int(vert)
                if vert not in (u, v):
                    opposite.add(vert)
        return (self._neighbors(u) & self._neighbors(v)) == opposite

    def _would_flip(self, u: int, v: int, point: np.ndarray) -> bool:
        m = self.mesh
        edge_faces = set(m.alive_incident_faces(m.edge_key(u, v)))
        # the merged point must not coincide with any surviving neighbor
        for nb in self._neighbors(u) | self._neighbors(v):
            if nb in (u, v) or not m.vertex_alive[nb]:
                continue
            if np.linalg.norm(m.positions[nb] - point) < 1e-10:
                self._reject("coincident_point")
                return True
        checked = set()
        # only faces containing u are rewritten to v; v's other faces keep
        # their vertex set, so the duplicate-index risk is on u's side only
        for fid in list(self.vfaces[u]):
            if fid in edge_faces:
                continue
            if fid in checked:
                continue
            checked.add(fid)
            if v in {int(x) for x in m.faces[fid]}:
                self._reject("duplicate_index")
                return True  # would create a duplicated-index degenerate face
            i, j, k = m.faces[fid]
            old = m.face_normal(fid)
            pts = m.positions[np.array([i, j, k])].copy()
            for s in range(3):
                if int(m.faces[fid][s]) == u:
                    pts[s] = point
            n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
            ln = np.linalg.norm(n)
            if ln < 1e-14:
                self._reject("degenerate_target")
                return True  # rewritten face becomes collinear/zero-area
            if float(old @ (n / ln)) < FLIP_DOT:
                return True
        # v keeps the merged point too: its own neighbors can become
        # degenerate or flip even though their vertex ids do not change
        for fid in list(self.vfaces[v]):
            if fid in edge_faces:
                continue
            i, j, k = m.faces[fid]
            old = m.face_normal(fid)
            pts = m.positions[np.array([i, j, k])].copy()
            for s in range(3):
                if int(m.faces[fid][s]) == v:
                    pts[s] = point
            n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
            ln = np.linalg.norm(n)
            if ln < 1e-14:
                self._reject("degenerate_target")
                return True
            if float(old @ (n / ln)) < FLIP_DOT:
                return True
        return False

    def _reject(self, reason: str) -> None:
        self.reject_reasons[reason] = self.reject_reasons.get(reason, 0) + 1

    def _pop_valid(self):
        m = self.mesh
        while self.heap:
            error, _, key, ver, a, b, point = heapq.heappop(self.heap)
            if ver != self.edge_version.get(key, -1):
                continue
            if key in self.locked or a in self.protected_verts \
                    or b in self.protected_verts:
                continue
            if not (m.vertex_alive[a] and m.vertex_alive[b]):
                continue
            if m.edge_key(a, b) != key:
                continue
            return error, key, a, b, point
        return None

    # ------------------------------------------------------------- collapse
    def _collapse(self, key: int, u: int, v: int, point: np.ndarray,
                  error: float) -> None:
        """Contract u -> v; v keeps merged position and quadric."""
        m = self.mesh
        kind = self._edge_kind(key)
        edge_faces = set(m.alive_incident_faces(key))
        rewritten = [fid for fid in list(self.vfaces[u])
                     if fid not in edge_faces]
        affected = edge_faces | set(rewritten)
        # 1. detach every affected face from the edge incidence map
        for fid in affected:
            face = m.faces[fid]
            for s in range(3):
                k2 = m.edge_key(face[s], face[(s + 1) % 3])
                bucket = m.edge_faces[k2]
                if fid in bucket:
                    bucket.remove(fid)
        for fid in list(affected):
            face = m.faces[fid]
            for s in range(3):
                k2 = m.edge_key(face[s], face[(s + 1) % 3])
                if not m.edge_faces.get(k2):
                    m.edge_faces.pop(k2, None)
        # 2. kill edge triangles; rewrite u -> v in the rest
        for fid in edge_faces:
            m.face_alive[fid] = False
            for vert in m.faces[fid]:
                self.vfaces[int(vert)].discard(fid)
        touched = set()
        for fid in rewritten:
            face = m.faces[fid]
            for s in range(3):
                if int(face[s]) == u:
                    face[s] = v
            for s in range(3):
                nk = m.edge_key(face[s], face[(s + 1) % 3])
                m.edge_faces[nk].append(fid)
                touched.add(nk)
            self.vfaces[v].add(fid)
        self.vfaces[u].clear()
        m.vertex_alive[u] = False
        m.positions[v] = point
        self.quadrics[v] = self.quadrics[u] + self.quadrics[v]
        self.quadrics[u] = 0.0
        # 3. re-push neighbor edges; the contracted edge itself is gone
        for tkey in touched:
            if tkey == key:
                continue
            a2, b2 = m.key_verts(tkey)
            if m.vertex_alive[a2] and m.vertex_alive[b2]:
                self._bump(tkey)
        # incrementally reclassify only edges touched by this collapse so
        # newly hard/protected edges become locked without an O(E) sweep
        self._reclassify_touched(touched | {key})
        # self.locked only ever grows, so structural constraints stay locked
        # without an O(E) reclassification after every collapse
        self.history.append(CollapseRecord(u, v, point.copy(), error,
                                           key, kind))

    def _reclassify_touched(self, keys) -> None:
        m = self.mesh
        lock_part_ids = {i for i, p in enumerate(m.parts)
                         if p in set(self.opt.lock_parts)}
        for tkey in keys:
            if tkey not in m.edge_faces:
                continue
            a, b = m.key_verts(tkey)
            if not (m.vertex_alive[a] and m.vertex_alive[b]):
                continue
            kind = self._edge_kind(tkey)
            if kind == "hard":
                self.locked.add(tkey)
                self.primary_locked.add(tkey)
                self.protected_verts.update((a, b))
            elif kind == "boundary" and self.opt.boundary_policy == "lock":
                self.locked.add(tkey)
                self.primary_locked.add(tkey)
                self.protected_verts.update((a, b))
            elif kind == "seam" and self.opt.seam_policy == "lock":
                self.locked.add(tkey)
                self.primary_locked.add(tkey)
                self.protected_verts.update((a, b))
            if lock_part_ids:
                faces = m.alive_incident_faces(tkey)
                if faces and all(int(m.face_part[f]) in lock_part_ids
                                 for f in faces):
                    self.locked.add(tkey)
                    self.primary_locked.add(tkey)
                    self.protected_verts.update((a, b))
        # any edge touching a protected vertex is locked, but this is a
        # membership test done lazily in _push_edge rather than a growing set

    # ------------------------------------------------------------- driver
    def run_to(self, target_faces: int) -> int:
        m = self.mesh
        target_faces = max(1, int(target_faces))
        while int(m.face_alive.sum()) > target_faces:
            popped = self._pop_valid()
            if popped is None:
                break
            error, key, u, v, point = popped
            if error > self.opt.max_error:
                self._reject("max_error")
                break
            if not self.link_condition_ok(u, v):
                self._reject("link_condition")
                self.edge_version[key] += 1
                self.locked.add(key)
                continue
            if self._would_flip(u, v, point):
                self._reject("normal_flip")
                self.edge_version[key] += 1
                self.locked.add(key)
                continue
            self._collapse(key, u, v, point, error)
        return int(m.face_alive.sum())

    def run_ratio(self, ratio: float) -> int:
        return self.run_to(int(round(self.mesh.num_faces * ratio)))
