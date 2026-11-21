"""Parametric vase and the mirrored four-island UV layout used by the demo."""

import math

import bpy
from mathutils import Vector


PROFILE = (
    (0.00, 0.62),
    (0.08, 0.70),
    (0.24, 0.90),
    (0.48, 1.00),
    (0.72, 0.96),
    (0.94, 0.82),
    (1.13, 0.68),
    (1.30, 0.60),
    (1.48, 0.61),
    (1.68, 0.68),
    (1.88, 0.72),
    (2.04, 0.61),
    (2.18, 0.50),
    (2.31, 0.54),
    (2.40, 0.61),
)


def _catmull_rom(points, t):
    """Evaluate a uniform Catmull-Rom spline over a list of (z, radius)."""
    t = max(0.0, min(1.0, t))
    scaled = t * (len(points) - 1)
    i = min(int(scaled), len(points) - 2)
    local = scaled - i
    p0 = points[max(i - 1, 0)]
    p1 = points[i]
    p2 = points[i + 1]
    p3 = points[min(i + 2, len(points) - 1)]
    result = []
    for k in (0, 1):
        a = 2.0 * p1[k]
        b = p2[k] - p0[k]
        c = 2.0 * p0[k] - 5.0 * p1[k] + 4.0 * p2[k] - p3[k]
        d = -p0[k] + 3.0 * p1[k] - 3.0 * p2[k] + p3[k]
        result.append(0.5 * (a + b * local + c * local**2 + d * local**3))
    return tuple(result)


def profile_radius(z):
    """Radius at height z, sampled from the same matrix used for the mesh."""
    low, high = PROFILE[0][0], PROFILE[-1][0]
    return _catmull_rom(PROFILE, (z - low) / (high - low))[1]


def _plain_porcelain_material(name="Porcelain_Rim"):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.80, 0.75, 0.65, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.22
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.28
    return mat


def _build_inner_liner(top_z, outer_zs, name):
    rings = [z for z in outer_zs if z >= 1.47]
    ntheta = 128
    verts = []
    for z in rings:
        radius = max(0.08, profile_radius(z) - 0.055)
        for i in range(ntheta):
            theta = -math.pi + 2.0 * math.pi * i / ntheta
            verts.append((radius * math.cos(theta), radius * math.sin(theta), z))
    faces = []
    for j in range(len(rings) - 1):
        for i in range(ntheta):
            ni = (i + 1) % ntheta
            a = j * ntheta + i
            b = j * ntheta + ni
            c = (j + 1) * ntheta + ni
            d = (j + 1) * ntheta + i
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(_plain_porcelain_material())
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def mirror_uv_islands(mesh, ntheta, nz, theta_split, z_split):
    """Map four quadrants into four padded cells, alternating U/V mirrors."""
    uv_layer = mesh.uv_layers.new(name="PorcelainUV")
    cell = 0.5
    gutter = 0.022
    for poly in mesh.polygons:
        i0 = poly.index % ntheta
        j0 = poly.index // ntheta
        theta_mid = -math.pi + 2.0 * math.pi * (i0 + 0.5) / ntheta
        column = 0 if -math.pi * 0.5 < theta_mid < math.pi * 0.5 else 1
        row = 0 if (j0 + 0.5) < z_split else 1
        for loop_index, vertex_index in zip(poly.loop_indices, poly.vertices):
            i = vertex_index % (ntheta + 1)
            j = vertex_index // (ntheta + 1)
            theta = -math.pi + 2.0 * math.pi * i / ntheta
            if column == 0:
                local_u = (theta + math.pi * 0.5) / math.pi
            else:
                wrapped = theta if theta >= math.pi * 0.5 else theta + 2.0 * math.pi
                local_u = (wrapped - math.pi * 0.5) / math.pi
            half_z = nz // 2
            local_v = (
                j / half_z if row == 0 else 1.0 - (j - half_z) / half_z
            )
            if column == 1:
                local_u = 1.0 - local_u
            x0 = column * cell + gutter
            x1 = (column + 1) * cell - gutter
            y0 = row * cell + gutter
            y1 = (row + 1) * cell - gutter
            uv_layer.data[loop_index].uv = (
                x0 + local_u * (x1 - x0),
                y0 + local_v * (y1 - y0),
            )
    mesh.uv_layers.active = uv_layer


def create_vase(name="Porcelain_Vase", ntheta=192, nz=160):
    """Create the demo vase with two orthogonal, mirrored UV seams."""
    zmin, zmax = PROFILE[0][0], PROFILE[-1][0]
    z_split = nz // 2
    theta_split = ntheta // 2
    zs = [zmin + (zmax - zmin) * j / nz for j in range(nz + 1)]
    verts = []
    for z in zs:
        radius = profile_radius(z)
        for i in range(ntheta + 1):
            theta = -math.pi + 2.0 * math.pi * i / ntheta
            verts.append((radius * math.cos(theta),
                          radius * math.sin(theta),
                          z))
    faces = []
    for j in range(nz):
        for i in range(ntheta):
            a = j * (ntheta + 1) + i
            b = a + 1
            c = a + ntheta + 2
            d = a + ntheta + 1
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    mirror_uv_islands(mesh, ntheta, nz, theta_split, z_split)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj["uv_layout"] = (
        "4 mirrored quadrants; front/back vertical seam and z=mid horizontal seam"
    )
    obj["mirror_u"] = True
    obj["mirror_v"] = True
    for poly in mesh.polygons:
        poly.use_smooth = True
    _build_inner_liner(zmax, zs, name + "_Inner")
    rim_mat = _plain_porcelain_material("Porcelain_Rim")
    bpy.ops.mesh.primitive_torus_add(
        major_segments=192,
        minor_segments=16,
        location=(0.0, 0.0, zmax),
        major_radius=profile_radius(zmax),
        minor_radius=0.028,
    )
    rim = bpy.context.object
    rim.name = name + "_Rim"
    rim.data.materials.append(rim_mat)
    for poly in rim.data.polygons:
        poly.use_smooth = True
    return obj


def create_stamp_empty(center, normal, tangent, image, width, height, opacity,
                       rotation=0.0, name="Porcelain_Stamp", target=None):
    """Store a directional stamp as a lightweight empty in object space."""
    empty = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(empty)
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 0.25
    empty.location = center
    empty.rotation_mode = "QUATERNION"
    n = Vector(normal).normalized()
    t = Vector(tangent).normalized()
    b = n.cross(t).normalized()
    t = b.cross(n).normalized()
    empty.rotation_quaternion = Vector((0.0, 1.0, 0.0)).rotation_difference(t)
    empty["porcelain_stamp"] = True
    empty["center"] = list(center)
    empty["normal"] = list(n)
    empty["tangent"] = list(t)
    empty["image"] = image.name if image else ""
    empty["width"] = float(width)
    empty["height"] = float(height)
    empty["opacity"] = float(opacity)
    empty["rotation"] = float(rotation)
    empty["target"] = target.name if target else ""
    empty.hide_render = True
    return empty
