#!/usr/bin/env python3
"""Generate offline lightmap-UV test scenes (no third-party dependencies)."""
import json
import math
import os


def num(v):
    return round(float(v), 9)


def grid_mesh(nx, ny, sx=1.0, sy=1.0):
    """Regular triangulated nx*ny grid on the XY plane, z = 0."""
    positions = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            positions.append([num(i * sx / nx), num(j * sy / ny), 0.0])
    tris = []
    row = nx + 1
    for j in range(ny):
        for i in range(nx):
            a = j * row + i
            tris.append([a, a + 1, a + row])
            tris.append([a + 1, a + row + 1, a + row])
    return positions, tris


def box_mesh():
    """Unit cube with welded vertices: 12 triangles, 8 vertices."""
    p = [
        [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
        [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ]
    tris = [
        [0, 3, 2], [0, 2, 1],  # bottom
        [4, 5, 6], [4, 6, 7],  # top
        [0, 1, 5], [0, 5, 4],  # front
        [2, 3, 7], [2, 7, 6],  # back
        [1, 2, 6], [1, 6, 5],  # right
        [3, 0, 4], [3, 4, 7],  # left
    ]
    return p, tris


def concave_l_mesh():
    """L-shaped planar polygon (concave corner), triangulated as a fan."""
    pts = [(0, 0), (2, 0), (2, 1), (1, 1), (1, 2), (0, 2)]
    positions = [[num(x), num(y), 0.0] for x, y in pts]
    tris = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]]
    return positions, tris


def scene(config, parts):
    return {"config": config, "parts": parts}


BASE = os.path.join(os.path.dirname(__file__), "..", "tests")


def write(name, data):
    os.makedirs(BASE, exist_ok=True)
    path = os.path.join(BASE, name)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def main():
    # 1. Adjacent small islands: two flat grids sharing no edge, placed next
    #    to each other. Plus a tiny third "island" to stress small content.
    cfg = {"lightmapSize": 512, "texelDensity": 100, "padding": 6,
           "hardAngleDeg": 60}
    p1, t1 = grid_mesh(4, 4, 1.0, 1.0)
    p2, t2 = grid_mesh(3, 3, 0.6, 0.6)
    p2 = [[x + 1.05, y, z] for x, y, z in p2]
    p3, t3 = grid_mesh(2, 2, 0.2, 0.2)
    p3 = [[x + 1.7, y + 0.3, z] for x, y, z in p3]
    write("adjacent_islands.json", scene(cfg, [
        {"name": "big", "positions": p1, "triangles": t1},
        {"name": "small", "positions": p2, "triangles": t2},
        {"name": "tiny", "positions": p3, "triangles": t3},
    ]))

    # 2. Non-uniform scale baked through part transform; a cube with hard
    #    90-degree edges must split into six face islands anyway.
    cfg2 = {"lightmapSize": 1024, "texelDensity": 80, "padding": 8,
            "hardAngleDeg": 60}
    bp, bt = box_mesh()
    gp, gt = grid_mesh(5, 5, 2.0, 1.0)
    write("nonuniform_scale.json", scene(cfg2, [
        {"name": "stretched_cube", "positions": bp, "triangles": bt,
         "transform": {"scale": [2.0, 0.5, 3.0]}},
        {"name": "flat_grid", "positions": gp, "triangles": gt,
         "transform": {"scale": [0.5, 2.0, 1.0],
                       "translation": [4.0, 0.0, 0.0]}},
    ]))

    # 3. Concave corner single island.
    cfg3 = {"lightmapSize": 512, "texelDensity": 120, "padding": 4,
            "hardAngleDeg": 60}
    cp, ct = concave_l_mesh()
    write("concave.json", scene(cfg3, [
        {"name": "l_shape", "positions": cp, "triangles": ct},
    ]))

    # 4. Explicit seams on a cylinder-like strip force cuts even though the
    #    dihedral is smooth. Two disjoint seam edges split the ring into two
    #    face components. Built as a folded strip of 8 quads.
    cfg4 = {"lightmapSize": 512, "texelDensity": 90, "padding": 4,
            "hardAngleDeg": 60}
    n = 8
    positions = []
    for j in range(2):
        for i in range(n):
            ang = 2 * math.pi * i / n
            positions.append([num(math.cos(ang)), num(math.sin(ang)),
                              num(float(j))])
    tris = []
    for i in range(n):
        a = i
        b = (i + 1) % n
        c = n + (i + 1) % n
        d = n + i
        tris.append([a, b, c])
        tris.append([a, c, d])
    # Column boundaries at angle 0 and at angle pi.
    seam_a = [0, n]
    seam_b = [n // 2, n + n // 2]
    write("explicit_seam.json", scene(cfg4, [
        {"name": "strip", "positions": positions, "triangles": tris,
         "seams": [seam_a, seam_b]},
    ]))

    # 5. Local edit scenario. The base scene carries an existing UV for every
    #    part; only "edit_me" is rebuilt, the neighbour must stay bit-identical.
    cfg5 = {"lightmapSize": 512, "texelDensity": 100, "padding": 6,
            "hardAngleDeg": 60}
    ep, et = grid_mesh(4, 4, 1.0, 1.0)
    np_, nt = grid_mesh(3, 3, 1.0, 1.0)
    neighbour_uv = [[0.02 + 0.3 * (i % 4) / 3,
                     0.02 + 0.3 * (i // 4) / 3] for i in range(len(np_))]
    write("local_edit.json", scene(cfg5, [
        {"name": "edit_me", "positions": ep, "triangles": et},
        {"name": "neighbour", "positions": np_, "triangles": nt,
         "uv": neighbour_uv},
    ]))

    # 6. Oversize content: density makes the island larger than the lightmap,
    #    so packing must fail cleanly instead of producing overlaps.
    cfg6 = {"lightmapSize": 128, "texelDensity": 500, "padding": 4,
            "hardAngleDeg": 60}
    op, ot = grid_mesh(2, 2, 2.0, 2.0)
    write("oversize.json", scene(cfg6, [
        {"name": "too_big", "positions": op, "triangles": ot},
    ]))


if __name__ == "__main__":
    main()
