"""View-ray circular brush with connectivity-aware flood painting.

The brush works entirely in world space.  A dab is a ray cast from the
camera through the cursor.  The nearest front-facing triangle seeds a
breadth-first flood over edge-adjacent triangles that stay inside the
brush sphere.  Crossing onto a disconnected back layer is prevented by
four geometric guards evaluated for every flood edge:

* **component guard** -- only faces of the hit's connected component are
  ever reached, so separate sheets of geometry cannot be painted at all;
* **depth guard** -- a neighbour is rejected when its surface lies behind
  the seed sheet by more than ``depth_tolerance * radius``;
* **bifurcation guard** -- non-manifold edges (more than two incident
  faces) are fork points; faces on the other sheet are rejected, and the
  event is recorded for diagnostics;
* **tangent guard** -- near-grazing triangles (view angle beyond
  ``tangent_angle``) are rejected so the brush does not smear along
  silhouettes onto a hidden layer.

Sliver triangles are never used as a seed and are reported when the flood
touches them, keeping the painted-area statistics trustworthy.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .bvh import BVH
from .geometry import closest_point_on_triangle, normalize


@dataclass
class BrushSettings:
    """Tunable brush parameters.  Radius is measured in world units."""

    radius: float = 0.5
    color: tuple[float, float, float] = (0.9, 0.2, 0.15)
    strength: float = 1.0
    tangent_angle_deg: float = 75.0
    depth_tolerance_ratio: float = 0.35
    sliver_aspect_threshold: float = 12.0
    paint_back_faces: bool = False
    falloff: str = "smooth"

    @property
    def tangent_cos(self) -> float:
        return float(np.cos(np.radians(self.tangent_angle_deg)))


@dataclass
class DabReport:
    """Diagnostics returned by a single brush dab."""
    hit_face: int = -1
    hit_point: np.ndarray | None = None
    painted_faces: list[int] = field(default_factory=list)
    painted_area: float = 0.0
    rejected_tangent: list[int] = field(default_factory=list)
    rejected_bifurcation: list[int] = field(default_factory=list)
    rejected_depth: list[int] = field(default_factory=list)
    rejected_component: list[int] = field(default_factory=list)
    sliver_faces: list[int] = field(default_factory=list)
    reason: str = "ok"

    @property
    def painted(self) -> bool:
        return bool(self.painted_faces)


class GeometryGuards:
    """Stateless geometric predicates shared by seed and flood steps."""

    def __init__(self, mesh, settings: BrushSettings):
        self.mesh = mesh
        self.settings = settings
        self.quality = mesh.quality(settings.sliver_aspect_threshold)
        self.edge_faces = mesh.edge_faces()
        self.adjacency = mesh.face_adjacency()
        self.components = mesh.connected_components()
        self.normals = mesh.face_normals()

    def is_tangent(self, face_id: int, view_dir: np.ndarray) -> bool:
        """Grazing view: the ray meets the face almost edge-on."""
        facing = float(self.normals[face_id].dot(-view_dir))
        return facing < self.settings.tangent_cos

    def is_sliver(self, face_id: int) -> bool:
        return bool(self.quality.is_sliver[face_id])

    def crosses_bifurcation(self, current: int, neighbour: int) -> bool:
        """True when the shared edge is a non-manifold fork.

        An edge with more than two incident faces is a surface fork.  The
        flood may continue onto faces already reached through a regular
        manifold path, but stepping *through* the fork onto a third sheet
        is blocked and reported.
        """
        for edge in self._shared_edges(current, neighbour):
            if len(self.edge_faces[edge]) > 2:
                return True
        return False

    def _shared_edges(self, face_a: int, face_b: int):
        def edges_of(face_id):
            verts = self.mesh.faces[face_id]
            return {tuple(sorted((int(verts[i]), int(verts[j]))))
                    for i, j in ((0, 1), (1, 2), (2, 0))}
        return edges_of(face_a) & edges_of(face_b)

    def depth_offset(self, face_id: int, seed_point: np.ndarray,
                     view_dir: np.ndarray) -> float:
        """Signed distance behind the seed along the view direction.

        Positive means the candidate centroid is further from the camera
        than the seed, i.e. it belongs to a layer hidden behind it.
        """
        centroid = self.mesh.face_centroids()[face_id]
        return float((centroid - seed_point).dot(view_dir))

    def seed_is_valid(self, hit, view_dir):
        if hit is None:
            return False, "no_hit"
        if not self.settings.paint_back_faces and not hit.front_facing:
            return False, "back_face"
        if self.is_sliver(hit.face_id):
            return False, "sliver_seed"
        if self.is_tangent(hit.face_id, view_dir):
            return False, "tangent_seed"
        return True, "ok"


class PaintLayer:
    """Per-vertex RGB colors plus a cumulative per-face paint weight."""

    def __init__(self, mesh, base_color=(0.75, 0.75, 0.78)):
        self.mesh = mesh
        base = np.asarray(base_color, dtype=np.float64)
        self.vertex_colors = np.tile(base, (mesh.num_vertices, 1)).copy()
        self.face_paint = np.zeros(mesh.num_faces, dtype=np.float64)

    def snapshot(self):
        return (self.vertex_colors.copy(), self.face_paint.copy())

    def restore(self, snap):
        colors, face_paint = snap
        self.vertex_colors = colors.copy()
        self.face_paint = face_paint.copy()

    def apply_face(self, face_id, color, alpha):
        color = np.asarray(color, dtype=np.float64)
        for vertex_id in self.mesh.faces[face_id]:
            old = self.vertex_colors[vertex_id]
            self.vertex_colors[vertex_id] = old * (1.0 - alpha) + color * alpha
        self.face_paint[face_id] = min(1.0,
                                       self.face_paint[face_id] + alpha)


class Stroke:
    """An in-progress stroke with rollback support."""

    def __init__(self, layer: PaintLayer):
        self.layer = layer
        self.snapshot = layer.snapshot()
        self.reports: list[DabReport] = []
        self.active = True

    def cancel(self):
        self.layer.restore(self.snapshot)
        self.active = False

    def finish(self):
        self.active = False
        painted = sorted({f for report in self.reports
                          for f in report.painted_faces})
        return StrokeResult(painted, list(self.reports))


@dataclass
class StrokeResult:
    painted_faces: list[int]
    reports: list[DabReport]

    @property
    def painted_area(self) -> float:
        return sum(report.painted_area for report in self.reports)


class BrushEngine:
    """Owns the BVH, geometric guards and the active :class:`Stroke`."""

    def __init__(self, mesh, settings: BrushSettings | None = None,
                 layer: PaintLayer | None = None):
        self.mesh = mesh
        self.settings = settings or BrushSettings()
        self.bvh = BVH(mesh)
        self.guards = GeometryGuards(mesh, self.settings)
        self.layer = layer or PaintLayer(mesh)
        self._stroke: Stroke | None = None

    def begin_stroke(self) -> Stroke:
        if self._stroke is not None and self._stroke.active:
            raise RuntimeError("a stroke is already active")
        self._stroke = Stroke(self.layer)
        return self._stroke

    def cancel_stroke(self):
        """Discard every dab of the current stroke and roll colors back."""
        if self._stroke is None or not self._stroke.active:
            raise RuntimeError("no active stroke to cancel")
        self._stroke.cancel()
        reports = list(self._stroke.reports)
        self._stroke = None
        return reports

    def end_stroke(self) -> StrokeResult:
        if self._stroke is None or not self._stroke.active:
            raise RuntimeError("no active stroke to finish")
        result = self._stroke.finish()
        self._stroke = None
        return result

    @property
    def stroke_active(self) -> bool:
        return self._stroke is not None and self._stroke.active

    def dab_from_ray(self, origin, direction,
                     settings: BrushSettings | None = None) -> DabReport:
        """Cast one view ray and paint the connected region inside the
        brush sphere.  A stroke must have been started first."""
        if not self.stroke_active:
            raise RuntimeError("call begin_stroke() before dabbing")
        settings = settings or self.settings
        origin = np.asarray(origin, dtype=np.float64)
        view_dir = normalize(np.asarray(direction, dtype=np.float64))
        hit = self.bvh.cast_ray(origin, view_dir)
        report = DabReport()
        if hit is None:
            report.reason = "no_hit"
            self._stroke.reports.append(report)
            return report
        report.hit_face = int(hit.face_id)
        report.hit_point = hit.point.copy()
        valid, reason = self.guards.seed_is_valid(hit, view_dir)
        if not valid:
            report.reason = reason
            self._stroke.reports.append(report)
            return report
        self._flood(hit, view_dir, settings, report)
        self._stroke.reports.append(report)
        return report

    def _flood(self, hit, view_dir, settings: BrushSettings,
               report: DabReport):
        radius = float(settings.radius)
        seed_label = self.guards.components[hit.face_id]
        depth_limit = settings.depth_tolerance_ratio * radius
        queued = {hit.face_id}
        queue = [hit.face_id]
        mesh = self.mesh
        while queue:
            current = queue.pop()
            v0, v1, v2 = mesh.face_points(current)
            nearest = closest_point_on_triangle(hit.point, v0, v1, v2)
            distance = float(np.linalg.norm(nearest - hit.point))
            weight = self._falloff(distance, radius, settings.falloff)
            alpha = weight * settings.strength
            self.layer.apply_face(current, settings.color, alpha)
            report.painted_faces.append(int(current))
            report.painted_area += float(
                self.guards.quality.area[current])
            if self.guards.is_sliver(current):
                report.sliver_faces.append(int(current))
            for neighbour in self.guards.adjacency[current]:
                if neighbour in queued:
                    continue
                if self.guards.components[neighbour] != seed_label:
                    report.rejected_component.append(int(neighbour))
                    continue
                if self.guards.crosses_bifurcation(current, neighbour):
                    report.rejected_bifurcation.append(int(neighbour))
                    continue
                if self.guards.is_tangent(neighbour, view_dir):
                    report.rejected_tangent.append(int(neighbour))
                    continue
                depth = self.guards.depth_offset(
                    neighbour, hit.point, view_dir)
                if depth > depth_limit:
                    report.rejected_depth.append(int(neighbour))
                    continue
                nv0, nv1, nv2 = mesh.face_points(neighbour)
                near = closest_point_on_triangle(
                    hit.point, nv0, nv1, nv2)
                if float(np.linalg.norm(near - hit.point)) > radius:
                    continue
                queued.add(neighbour)
                queue.append(neighbour)

    @staticmethod
    def _falloff(distance: float, radius: float, mode: str) -> float:
        ratio = min(1.0, distance / max(radius, 1.0e-12))
        if mode == "flat":
            return 1.0
        if mode == "linear":
            return 1.0 - ratio
        return 0.5 * (1.0 + np.cos(np.pi * ratio))
