"""Procedural test model: perforated thin plate + bracket part.

The plate is a flat triangulated solid (top/bottom caps + side walls) with:
  * one narrow stadium slot ("thin hole") and one small round hole
  * two materials split by a hard edge down the middle
  * explicit UV seams around every hole and along the material split
A separate small bracket part provides user-locked edges.
"""

from __future__ import annotations

import numpy as np
from scipy.spatial import Delaunay

from .io import build_mesh

W, H = 6.0, 4.0          # plate extents
THICK = 0.35             # plate thickness
SLOT_W, SLOT_L = 0.32, 2.2
HOLE_R = 0.28


def _sample_ring(cx, cy, r, n, jitter=0.0):
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    pts = np.c_[cx + r * np.cos(ang), cy + r * np.sin(ang)]
    if jitter:
        pts += np.random.default_rng(7).normal(0, jitter, pts.shape)
    return pts


def _stadium_points(cx, cy, length, width, n_arc=14):
    r = width / 2
    straight = (length - width) / 2
    pts = []
    for sign in (1, -1):
        arc_c = (cx, cy + sign * straight)
        ang = np.linspace(0, np.pi, n_arc) if sign > 0 else \
            np.linspace(np.pi, 2 * np.pi, n_arc)
        for a in ang:
            pts.append([arc_c[0] + r * np.cos(a), arc_c[1] + r * np.sin(a)])
    return np.array(pts)


def _inside_hole(x, y):
    # round hole at (+1.6, 0)
    if (x - 1.6) ** 2 + y ** 2 <= (HOLE_R * 1.02) ** 2:
        return True
    # vertical stadium slot centered at (-1.4, 0)
    dx = abs(x + 1.4)
    half_straight = (SLOT_L - SLOT_W) / 2
    if dx <= SLOT_W / 2 and abs(y) <= SLOT_L / 2:
        return True
    if dx <= SLOT_W / 2 and abs(y) > half_straight:
        cy = np.sign(y) * half_straight
        if dx ** 2 + (abs(y) - half_straight) ** 2 <= (SLOT_W / 2) ** 2:
            return True
    return False


def make_plate_triangles():
    rng = np.random.default_rng(42)
    # interior jittered grid
    gx = np.linspace(-W / 2, W / 2, 30)
    gy = np.linspace(-H / 2, H / 2, 21)
    interior = []
    for x in gx[1:-1]:
        for y in gy[1:-1]:
            interior.append([x + rng.normal(0, 0.03),
                             y + rng.normal(0, 0.03)])
    # boundaries: outer rectangle loop and hole loops
    outer = []
    nb = 40
    for t in np.linspace(-W / 2, W / 2, nb):
        outer.append([t, -H / 2])
    for t in np.linspace(-H / 2, H / 2, nb):
        outer.append([W / 2, t])
    for t in np.linspace(W / 2, -W / 2, nb):
        outer.append([t, H / 2])
    for t in np.linspace(H / 2, -H / 2, nb):
        outer.append([-W / 2, t])
    slot = _stadium_points(-1.4, 0, SLOT_L, SLOT_W)
    hole = _sample_ring(1.6, 0, HOLE_R, 26)
    pts2d_raw = np.vstack([np.array(outer), slot, hole, np.array(interior)])
    # weld coincident 2D points so Delaunay output is a clean triangulation
    weld = {}
    pts2d = []
    for p in pts2d_raw:
        key = tuple(np.round(p / 1e-7).astype(np.int64))
        if key not in weld:
            weld[key] = len(pts2d)
            pts2d.append(p)
    pts2d = np.array(pts2d)
    tri = Delaunay(pts2d)
    keep = []
    for t in tri.simplices:
        cx, cy = pts2d[t].mean(axis=0)
        if abs(cx) > W / 2 or abs(cy) > H / 2:
            continue
        if _inside_hole(cx, cy):
            continue
        # reject triangles crossing outside the outer rectangle corners
        if np.any(np.abs(pts2d[t])[:, 0] > W / 2 + 1e-9) or \
           np.any(np.abs(pts2d[t])[:, 1] > H / 2 + 1e-9):
            continue
        keep.append(t)
    return pts2d, np.array(keep)


def _boundary_loops(pts2d, tris):
    from collections import defaultdict
    edge_count = defaultdict(list)
    for fi, t in enumerate(tris):
        for s in range(3):
            a, b = int(t[s]), int(t[(s + 1) % 3])
            key = (min(a, b), max(a, b))
            edge_count[key].append((fi, a, b))
    adj = {}
    for (a, b), entries in edge_count.items():
        if len(entries) == 1:
            # keep the triangle's own directed half-edge (interior on left)
            _, ea, eb = entries[0]
            adj[ea] = eb
    loops, visited = [], set()
    for start in adj:
        if start in visited:
            continue
        loop, cur = [], start
        while cur not in visited:
            visited.add(cur)
            loop.append(cur)
            cur = adj[cur]
        loops.append(loop)
    # orient: outer loop CCW (positive shoelace), hole loops CW
    fixed = []
    for loop in loops:
        area2 = sum(pts2d[loop[i], 0] * pts2d[loop[(i + 1) % len(loop)], 1]
                    - pts2d[loop[(i + 1) % len(loop)], 0]
                    * pts2d[loop[i], 1] for i in range(len(loop)))
        is_outer = len(loop) == max(len(l) for l in loops)
        if (area2 > 0) != is_outer:
            loop = list(reversed(loop))
        fixed.append(loop)
    return loops


def build_test_mesh():
    pts2d, tris = make_plate_triangles()
    loops = _boundary_loops(pts2d, tris)
    n2d = len(pts2d)
    zt, zb = THICK / 2, -THICK / 2
    verts3 = np.vstack([np.c_[pts2d, np.full(n2d, zt)],
                        np.c_[pts2d, np.full(n2d, zb)]])
    uv_planar = np.vstack([pts2d / np.array([W, H]) + 0.5,
                           pts2d / np.array([W, H]) + 0.5])
    faces, uvs_per_vertex, fmats, fparts = [], {}, [], []

    def add_tri(ids, mat, part=0):
        faces.append(list(ids))
        fmats.append(mat)
        fparts.append(part)

    # caps: Delaunay simplices are CCW in xy -> top keeps the order and
    # points along +z; the bottom cap reverses it to point along -z
    for t in tris:
        cx = pts2d[t, 0].mean()
        mat = 0 if cx < 0.0 else 1
        add_tri([int(t[0]), int(t[1]), int(t[2])], mat)
        add_tri([int(t[2]) + n2d, int(t[1]) + n2d,
                 int(t[0]) + n2d], mat)
    # walls along every boundary loop.  Winding is chosen per edge by
    # matching the adjacent top-cap triangle orientation, which is robust
    # for concave hole loops where a centroid heuristic fails.
    top_owner = {}
    for fi, t in enumerate(tris):
        for s in range(3):
            top_owner[(min(int(t[s]), int(t[(s + 1) % 3])),
                       max(int(t[s]), int(t[(s + 1) % 3])))] = fi
    for loop in loops:
        m = len(loop)
        for s in range(m):
            a, b = loop[s], loop[(s + 1) % m]
            mat = 0 if (pts2d[a, 0] + pts2d[b, 0]) / 2 < 0 else 1
            cap = tris[top_owner[(min(a, b), max(a, b))]]
            cap_has_ab = (int(cap[0]) == a and int(cap[1]) == b) or \
                         (int(cap[1]) == a and int(cap[2]) == b) or \
                         (int(cap[2]) == a and int(cap[0]) == b)
            if not cap_has_ab:
                add_tri([a, b, b + n2d], mat)
                add_tri([a, b + n2d, a + n2d], mat)
            else:
                add_tri([a, b + n2d, b], mat)
                add_tri([a, a + n2d, b + n2d], mat)
    # bracket: small L-shaped block on the left end, its own part + material
    bx0, bx1 = -W / 2 - 0.55, -W / 2 - 0.05
    bz0, bz1 = zt, zt + 0.9
    verts3, _, _, _ = _add_bracket(
        verts3, uv_planar, faces, fmats, fparts,
        (bx0, -0.5, bz0), (bx1, 0.5, bz1))
    raw_uv = np.zeros((len(verts3), 2))
    raw_uv[: len(uv_planar)] = uv_planar
    mesh = build_mesh(verts3, raw_uv, faces, fmats, fparts,
                      ["paint_red", "paint_blue", "bracket_green"],
                      ["plate", "bracket"], name="perforated_plate")
    _split_seam_uvs(mesh, pts2d, tris, loops)
    return mesh


def _add_bracket(verts3, raw_uv, faces, fmats, fparts, lo, hi):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    base = len(verts3)
    box = np.array([
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ])
    verts3 = np.vstack([verts3, box])
    raw_uv = np.vstack([raw_uv, np.zeros((8, 2))])
    quads = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    start = len(faces)
    for q in quads:
        faces.append([base + q[0], base + q[1], base + q[2]])
        faces.append([base + q[0], base + q[2], base + q[3]])
        fmats.extend([2, 2])
        fparts.extend([1, 1])
    return verts3, raw_uv, len(faces) - start, start


def _split_seam_uvs(mesh, pts2d, tris, loops):
    """Make hole boundaries and the material split explicit UV seams.

    Corner UVs on one side of a seam are offset in v so the position-welded
    mesh carries distinct UVs while sharing vertices.
    """
    # collect seam 2D vertex ids: every hole-loop vertex and the split line
    seam_verts = set()
    for loop in loops:
        # outer loop is the longest; only inner loops are hole seams
        if len(loop) < len(pts2d) // 2:
            seam_verts.update(loop)
    n2d = len(pts2d)
    for fid in range(mesh.num_faces):
        face = mesh.faces[fid]
        for s in range(3):
            vi = int(face[s])
            base2d = vi if vi < n2d else vi - n2d
            uv = mesh.corner_uv[fid, s].copy()
            if base2d in seam_verts:
                # offset wall-side corners (detected by part geometry) so
                # neighboring cap and wall corners no longer share UVs
                if not (np.allclose(mesh.positions[vi][:2],
                                    pts2d[base2d])):
                    continue
                z = mesh.positions[vi][2]
                if z < 0:  # bottom cap corner: second chart
                    uv = uv + np.array([0.0, 2.0])
                mesh.corner_uv[fid, s] = uv
            # material split seam: offset blue-side UVs in u
            if mesh.face_mat[fid] == 1:
                mesh.corner_uv[fid, s] = mesh.corner_uv[fid, s] \
                    + np.array([3.0, 0.0])
    return mesh
