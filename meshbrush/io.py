"""Minimal Wavefront OBJ import/export for painted triangle meshes."""

from __future__ import annotations

import numpy as np

from .mesh import TriangleMesh


def load_obj(path: str) -> TriangleMesh:
    """Read ``v``/``f`` records.  Polygon faces are fan-triangulated."""
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            parts = line.split()
            if not parts:
                continue
            tag = parts[0]
            if tag == "v":
                vertices.append(tuple(float(x) for x in parts[1:4]))
            elif tag == "f":
                indices = [_face_index(token) for token in parts[1:]]
                for i in range(1, len(indices) - 1):
                    faces.append((indices[0], indices[i],
                                  indices[i + 1]))
    return TriangleMesh(np.array(vertices, dtype=np.float64),
                        np.array(faces, dtype=np.int64))


def _face_index(token: str) -> int:
    index = token.split("/", 1)[0]
    value = int(index)
    return value - 1 if value > 0 else value


def save_obj(path: str, mesh: TriangleMesh,
             vertex_colors: np.ndarray | None = None) -> None:
    """Write geometry, optionally embedding colors as ``v x y z r g b``."""
    with open(path, "w", encoding="utf-8") as handle:
        for i, vertex in enumerate(mesh.vertices):
            line = "v " + " ".join(f"{c:.6f}" for c in vertex)
            if vertex_colors is not None:
                color = np.clip(vertex_colors[i], 0.0, 1.0)
                line += " " + " ".join(f"{c:.6f}" for c in color)
            handle.write(line + "\n")
        for face in mesh.faces:
            handle.write("f " + " ".join(str(int(i) + 1)
                                         for i in face) + "\n")
