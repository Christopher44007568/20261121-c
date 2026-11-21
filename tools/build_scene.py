"""Build the porcelain baking demo scene and render acceptance images."""

import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import porcelain_baker
from porcelain_baker import stamping
from porcelain_baker.mesh import (
    create_stamp_empty,
    create_vase,
    profile_radius,
)


ARTIFACTS = os.path.join(ROOT, "artifacts")
VALIDATION = os.path.join(ARTIFACTS, "validation")
TEXTURES = os.path.join(ARTIFACTS, "textures")
BLEND_PATH = os.path.join(ARTIFACTS, "porcelain_stamp_baker.blend")


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def make_material(name, color, roughness=0.4, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def setup_studio():
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Porcelain_Studio")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.012, 0.018, 0.024, 1.0)
    background.inputs["Strength"].default_value = 0.28

    floor_mat = make_material("Studio_Floor", (0.075, 0.09, 0.105), 0.33)
    wall_mat = make_material("Studio_Wall", (0.035, 0.047, 0.058), 0.55)
    bpy.ops.mesh.primitive_plane_add(size=24, location=(0.0, 0.0, 0.0))
    floor = bpy.context.object
    floor.name = "Studio_Floor"
    floor.data.materials.append(floor_mat)
    bpy.ops.mesh.primitive_plane_add(
        size=24, location=(0.0, 5.0, 5.0), rotation=(math.pi / 2, 0.0, 0.0)
    )
    wall = bpy.context.object
    wall.name = "Studio_Backdrop"
    wall.data.materials.append(wall_mat)

    lights = (
        ("Key_Softbox", (-3.7, -4.4, 4.8), 850.0, 4.0, (1.0, 0.91, 0.82)),
        ("Fill_Softbox", (4.4, -2.8, 2.7), 430.0, 3.2, (0.70, 0.82, 1.0)),
        ("Rim_Strip", (1.3, 3.8, 4.1), 650.0, 2.0, (1.0, 0.89, 0.72)),
        ("Top_Softbox", (0.0, 0.2, 6.2), 330.0, 2.5, (0.88, 0.94, 1.0)),
    )
    for name, location, energy, size, color in lights:
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        light.data.color = color
        look_at(light, (0.0, 0.0, 1.2))


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    looks = [item.identifier for item in
             scene.view_settings.bl_rna.properties["look"].enum_items]
    for candidate in ("AgX - Medium High Contrast", "Medium High Contrast", "None"):
        if candidate in looks:
            scene.view_settings.look = candidate
            break
    scene.render.use_file_extension = True


def add_camera(name, location, target, lens):
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.object
    camera.name = name
    camera.data.lens = lens
    camera.data.sensor_width = 36.0
    look_at(camera, target)
    return camera


def emission_material(name, color, strength=2.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (*color, 1.0)
    emission.inputs["Strength"].default_value = strength
    mat.node_tree.links.new(emission.outputs["Emission"],
                            output.inputs["Surface"])
    return mat


def polyline_curve(name, points, radius, material, cyclic=False):
    curve = bpy.data.curves.new(name + "_Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def add_seam_guides(z_split):
    coral = emission_material("Seam_Vertical_Guide", (1.0, 0.16, 0.05), 2.2)
    cyan = emission_material("Seam_Horizontal_Guide", (0.04, 0.62, 1.0), 2.2)
    zs = np.linspace(0.03, 2.38, 150)
    vertical_points = [
        (0.0, -(profile_radius(float(z)) + 0.009), float(z)) for z in zs
    ]
    horizontal_points = []
    for i in range(192):
        theta = -math.pi + math.tau * i / 192
        radius = profile_radius(z_split) + 0.009
        horizontal_points.append((
            radius * math.cos(theta),
            radius * math.sin(theta),
            z_split,
        ))
    vertical = polyline_curve(
        "UV_Seam_Vertical", vertical_points, 0.0028, coral
    )
    horizontal = polyline_curve(
        "UV_Seam_Horizontal", horizontal_points, 0.0028, cyan, cyclic=True
    )
    vertical.hide_render = True
    horizontal.hide_render = True
    return vertical, horizontal


def place_acceptance_stamp(vase, settings, image):
    z = 1.2
    radius = profile_radius(z)
    dz = 0.001
    slope = (profile_radius(z + dz) - profile_radius(z - dz)) / (2.0 * dz)
    normal = Vector((0.0, -1.0, -slope)).normalized()
    center = Vector((0.0, -radius, z))
    e_theta = Vector((1.0, 0.0, 0.0))
    tangent = (e_theta * 0.76 + Vector((0.0, 0.0, 1.0)) * 0.65)
    tangent -= normal * tangent.dot(normal)
    tangent.normalize()
    stamp = create_stamp_empty(
        center,
        normal,
        tangent,
        image,
        1.28,
        2.72,
        1.0,
        rotation=-0.035,
        name="Diagonal_Scroll_SeamTest",
        target=vase,
    )
    return stamp


def save_atlas_diagnostic(result, path):
    raw = result["raw"].copy()
    coverage = result["coverage"]
    edge_x = np.zeros_like(coverage)
    edge_y = np.zeros_like(coverage)
    edge_x[:, 1:] = coverage[:, 1:] != coverage[:, :-1]
    edge_y[1:, :] = coverage[1:, :] != coverage[:-1, :]
    for _ in range(3):
        grown_x = edge_x.copy()
        grown_y = edge_y.copy()
        grown_x[:, 1:] |= edge_x[:, :-1]
        grown_x[:, :-1] |= edge_x[:, 1:]
        grown_y[1:, :] |= edge_y[:-1, :]
        grown_y[:-1, :] |= edge_y[1:, :]
        edge_x, edge_y = grown_x, grown_y
    raw[edge_x] = (1.0, 0.14, 0.035)
    raw[edge_y] = (0.02, 0.62, 1.0)
    stamping._save_image("UV_Island_Diagnostic", raw, path)
    return path


def render_still(camera, path, width, height):
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    return path


def add_label(text, location, size=0.16, color=(0.92, 0.95, 1.0)):
    bpy.ops.object.text_add(location=location, rotation=(math.pi / 2, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = "Label_" + text.replace(" ", "_").replace("/", "_")
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = 0.0
    mat = emission_material("LabelMat_" + obj.name, color, 2.5)
    obj.data.materials.append(mat)
    return obj


def duplicate_group(vase, suffix):
    group = [vase]
    for obj in bpy.data.objects:
        if obj.name.startswith("Porcelain_Vase_") and obj != vase:
            group.append(obj)
    copies = []
    for obj in group:
        copy = obj.copy()
        copy.data = obj.data.copy()
        copy.name = obj.name + suffix
        bpy.context.scene.collection.objects.link(copy)
        copies.append(copy)
    return copies


def vase_group(vase):
    return [
        obj for obj in bpy.data.objects
        if obj == vase
        or (obj.name.startswith("Porcelain_Vase_")
            and not obj.name.endswith("_MipRaw"))
    ]


def build_mip_comparison(result, render_path):
    vase = bpy.data.objects["Porcelain_Vase"]
    padded_group = vase_group(vase)
    raw_group = duplicate_group(vase, "_MipRaw")
    raw_vase = raw_group[0]
    stamping.apply_baked_material(
        raw_vase, result["raw_image"], "Porcelain_MipRaw"
    )
    for obj in padded_group:
        obj.location.x = -1.22
    for obj in raw_group:
        obj.location.x += 1.22

    add_label("PADDED / SEAM-SAFE", (-1.0, -2.5, 0.23), 0.09)
    add_label("RAW / MIP BLEED", (1.0, -2.5, 0.23), 0.09,
              color=(1.0, 0.48, 0.32))
    camera = add_camera(
        "Camera_MipCompare", (0.0, -9.0, 1.28), (0.0, 0.0, 1.06), 64.0
    )
    return render_still(camera, render_path, 1600, 980)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    porcelain_baker.register()
    from porcelain_baker import operators

    setup_studio()
    setup_render()
    scene = bpy.context.scene
    settings = scene.porcelain_bake
    settings.resolution = 2048
    settings.padding = 128
    settings.output_dir = TEXTURES
    settings.porcelain_color = (0.82, 0.77, 0.67)

    vase = create_vase()
    settings.target_object = vase
    image_path = os.path.join(TEXTURES, "cobalt_diagonal_scroll.png")
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import generate_assets
    generate_assets.save_rgba(image_path, generate_assets.make_stamp())
    image = bpy.data.images.load(image_path, check_existing=True)
    image.colorspace_settings.name = "sRGB"
    settings.stamp_image = image
    stamp = place_acceptance_stamp(vase, settings, image)
    vertical_guide, horizontal_guide = add_seam_guides(1.2)

    hero_camera = add_camera(
        "Camera_Hero", (2.35, -7.35, 2.38), (0.0, 0.0, 1.22), 82.0
    )
    close_camera = add_camera(
        "Camera_SeamCloseup", (0.0, -3.5, 1.22), (0.0, -0.64, 1.20), 80.0
    )

    bake_result = operators._bake_and_update(bpy.context)
    atlas_path = save_atlas_diagnostic(
        bake_result, os.path.join(VALIDATION, "uv_atlas_islands.png")
    )

    hero_path = render_still(
        hero_camera, os.path.join(ARTIFACTS, "hero_porcelain.png"), 1000, 1200
    )
    close_path = render_still(
        close_camera, os.path.join(VALIDATION, "seam_closeup.png"), 1000, 1000
    )
    vertical_guide.hide_render = False
    horizontal_guide.hide_render = False
    probe_path = render_still(
        close_camera, os.path.join(VALIDATION, "seam_diagnostic.png"), 1000, 1000
    )
    vertical_guide.hide_render = True
    horizontal_guide.hide_render = True

    scene.camera = hero_camera
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    mip_path = build_mip_comparison(
        bake_result, os.path.join(VALIDATION, "mip_compare.png")
    )

    report = {
        "blender": bpy.app.version_string,
        "object": vase.name,
        "uv_layout": vase.get("uv_layout"),
        "stamp": stamp.name,
        "stamp_source": image_path,
        "bake_resolution": settings.resolution,
        "padding_pixels": settings.padding,
        "stamp_count": bake_result["stamps"],
        "bake_seconds": round(bake_result["seconds"], 3),
        "seam_crossing": [
            "vertical UV seam at theta=-pi/2 (front)",
            "horizontal mirrored UV seam at z=1.2",
        ],
        "artifacts": {
            "blend": BLEND_PATH,
            "hero": hero_path,
            "seam_closeup": close_path,
            "seam_diagnostic": probe_path,
            "uv_atlas": atlas_path,
            "mip_compare": mip_path,
            "padded_texture": bake_result["padded_path"],
            "raw_texture": bake_result["raw_path"],
        },
    }
    with open(os.path.join(VALIDATION, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print("BUILD_COMPLETE", json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
