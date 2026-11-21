"""Deterministic triangle-mesh builders used by the test-suite."""

from __future__ import annotations

import numpy as np

from meshbrush.mesh import TriangleMesh


def grid_mesh(nx: int, ny: int, spacing: float = 1.0,
              origin=(0.0, 0.0, 0.0)):
    """A regular ``nx`` by ``ny`` quad grid split into triangles."""
    ox, oy, oz = origin
    vertices = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            vertices.append((ox + i * spacing,
                             oy + j * spacing, oz))
    faces = []
    row = nx + 1
    for j in range(ny):
        for i in range(nx):
            a = j * row + i
            faces.append((a, a + 1, a + row))
            faces.append((a + 1, a + row + 1, a + row))
    return TriangleMesh(np.array(vertices), np.array(faces))


def two_parallel_sheets(gap: float = 0.02, size: int = 6,
                        spacing: float = 0.2):
    """Two disconnected, co-facing sheets separated by a tiny gap."""
    front = grid_mesh(size, size, spacing, origin=(0.0, 0.0, 0.0))
    back = grid_mesh(size, size, spacing, origin=(0.0, 0.0, -gap))
    verts = np.vstack([front.vertices, back.vertices])
    faces = np.vstack([front.faces,
                       back.faces + front.vertices.shape[0]])
    return TriangleMesh(verts, faces), front.num_faces


def forked_sheet():
    """Three sheets sharing one common edge (a true non-manifold fork).

    The shared edge joins vertices 0 and 1 and three faces fan out from
    it.  A brush seeded on the horizontal sheet must not cross the fork
    onto either angled branch, even though all branches sit inside the
    brush sphere.
    """
    vertices = np.array([
        (0.0, 0.0, 0.0),
        (0.0, 2.0, 0.0),
        (2.0, 0.0, 0.0),
        (2.0, 2.0, 0.0),
        (1.2, 0.0, -1.0),
        (1.2, 2.0, -1.0),
        (1.2, 0.0, 0.0),
        (1.2, 2.0, 0.0),
    ], dtype=np.float64)
    faces = np.array([
        (0, 2, 1),
        (1, 2, 3),
        (0, 1, 4),
        (1, 5, 4),
        (0, 6, 1),
        (1, 6, 7),
    ], dtype=np.int64)
    return TriangleMesh(vertices, faces)


def sliver_mesh():
    """One healthy triangle next to an extremely thin sliver."""
    vertices = np.array([
        (0.0, 0.0, 0.0),
        (1.0, 0.0, 0.0),
        (0.0, 1.0, 0.0),
        (6.0, 0.0002, 0.0),
    ], dtype=np.float64)
    faces = np.array([(0, 1, 2), (1, 3, 2)], dtype=np.int64)
    return TriangleMesh(vertices, faces)


def folded_sheet():
    """Two planar strips meeting at a sharp crease along an edge."""
    vertices = np.array([
        (0.0, 0.0, 0.0),
        (0.0, 2.0, 0.0),
        (2.0, 0.0, 0.0),
        (2.0, 2.0, 0.0),
        (2.0, 0.0, 1.5),
        (2.0, 2.0, 1.5),
    ], dtype=np.float64)
    faces = np.array([
        (0, 1, 2),
        (1, 3, 2),
        (2, 3, 4),
        (3, 5, 4),
    ], dtype=np.int64)
    return TriangleMesh(vertices, faces)


def recessed_pocket():
    """A connected L-shaped sheet whose back wall hides behind the front.

    The front strip connects through shallow ramps to a recessed wall.
    Every face still points roughly toward the overhead camera, so the
    depth guard (not the tangent guard) is what has to stop the flood
    from reaching the wall hidden further along the view ray.
    """
    vertices = np.array([
        (0.0, 0.0, 0.0),
        (0.0, 2.0, 0.0),
        (1.0, 0.0, 0.0),
        (1.0, 2.0, 0.0),
        (1.4, 0.0, -0.4),
        (1.4, 2.0, -0.4),
        (2.4, 0.0, -0.4),
        (2.4, 2.0, -0.4),
    ], dtype=np.float64)
    faces = np.array([
        (0, 2, 1),
        (1, 2, 3),
        (2, 4, 3),
        (3, 4, 5),
        (4, 6, 5),
        (5, 6, 7),
    ], dtype=np.int64)
    return TriangleMesh(vertices, faces)
