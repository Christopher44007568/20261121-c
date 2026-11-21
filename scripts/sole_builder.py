"""Procedural shoe-sole meshes (low-poly sculpt + high-poly target).

The sole is a tube along +Y (heel at y=0, toe at y=length) with an elliptic
cross-section per ring, closed by two pole vertices. Both meshes get:
  * a UV layer (cylindrical: u around the section, v along the length)
  * an integer FACE attribute ``part_group`` (0 heel, 1 midfoot, 2 forefoot)
  * vertex groups Heel / Midfoot / Forefoot with smooth weights
"""

import math

import bpy


def _smoothstep(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


def half_width(y, length, width):
    """Sole outline: slim heel, wide ball, tapered toe."""
    s = y / length
    heel = 0.78 + 0.10 * _smoothstep(s / 0.30)
    ball = 1.0 + 0.22 * math.exp(-((s - 0.68) ** 2) / 0.012)
    toe = 1.0 - 0.55 * _smoothstep((s - 0.86) / 0.14)
    return 0.5 * width * heel * ball * toe


def center_z(y, length, arch=0.012):
    """Gentle arch rise in the midfoot."""
    s = y / length
    return arch * math.sin(math.pi * min(1.0, s * 1.15)) ** 2


def half_thickness(y, length, thickness):
    s = y / length
    return 0.5 * thickness * (0.85 + 0.3 * math.sin(math.pi * s) ** 2)


def build_sole(name, length=0.28, width=0.10, thickness=0.024, rings=8,
               segments=16, collection=None):
    """Create a sole mesh object and return it."""
    verts = []
    ring_index = []
    for j in range(rings):
        y = length * j / (rings - 1)
        w = half_width(y, length, width)
        h = half_thickness(y, length, thickness)
        zc = center_z(y, length)
        ring = []
        for i in range(segments):
            t = 2.0 * math.pi * i / segments
            cx, cz = math.sin(t), math.cos(t)
            x = w * math.copysign(abs(cx) ** 0.8, cx)
            z = zc + h * math.copysign(abs(cz) ** 0.8, cz)
            ring.append(len(verts))
            verts.append((x, y, z))
        ring_index.append(ring)
    pole_heel = len(verts)
    verts.append((0.0, 0.0, center_z(0.0, length)))
    pole_toe = len(verts)
    verts.append((0.0, length, center_z(length, length)))

    faces = []
    face_ring = []
    for j in range(rings - 1):
        for i in range(segments):
            a = ring_index[j][i]
            b = ring_index[j][(i + 1) % segments]
            c = ring_index[j + 1][(i + 1) % segments]
            d = ring_index[j + 1][i]
            faces.append((a, b, c, d))
            face_ring.append(j)
    for i in range(segments):
        faces.append((pole_heel, ring_index[0][(i + 1) % segments], ring_index[0][i]))
        face_ring.append(0)
        faces.append((pole_toe, ring_index[-1][i], ring_index[-1][(i + 1) % segments]))
        face_ring.append(rings - 2)

    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    _add_uvs(obj, rings, segments)
    _add_face_groups(obj, face_ring, rings)
    _add_vertex_groups(obj, length)
    return obj


def _add_uvs(obj, rings, segments):
    mesh = obj.data
    uv = mesh.uv_layers.new(name="UVMap")
    ring_pos = {}
    idx = 0
    for j in range(rings):
        for i in range(segments):
            ring_pos[idx] = (i / segments, j / (rings - 1))
            idx += 1
    ring_pos[idx] = (0.5, 0.0)
    ring_pos[idx + 1] = (0.5, 1.0)
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            u, v = ring_pos[vi]
            uv.data[li].uv = (u, v)


def _add_face_groups(obj, face_ring, rings):
    mesh = obj.data
    attr = mesh.attributes.new(name="part_group", type="INT", domain="FACE")
    for poly in mesh.polygons:
        j = face_ring[poly.index]
        s = j / max(1, rings - 2)
        attr.data[poly.index].value = 0 if s < 0.34 else (1 if s < 0.67 else 2)


def _add_vertex_groups(obj, length):
    groups = {n: obj.vertex_groups.new(name=n)
              for n in ("Heel", "Midfoot", "Forefoot")}
    for v in obj.data.vertices:
        s = v.co.y / length
        heel = 1.0 - _smoothstep((s - 0.22) / 0.16)
        fore = _smoothstep((s - 0.60) / 0.16)
        mid = max(0.0, 1.0 - heel - fore)
        groups["Heel"].add([v.index], heel, "REPLACE")
        groups["Midfoot"].add([v.index], mid, "REPLACE")
        groups["Forefoot"].add([v.index], fore, "REPLACE")
