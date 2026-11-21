"""Batch-render multi-view part cards from heterogeneous CAD parts.

Run inside Blender::

    blender --background --python render_cards.py -- --config parts.json

Each part can have its own coordinate system, scale, origin and file format.
Camera framing is derived from the actual geometry bounding volume, the
aspect ratio of every part is preserved, and one shared lighting environment
is used for every view and every part. A manifest records the predicted and
measured pixel margins plus the list of rendered views.
"""

from __future__ import annotations

import argparse
import json
import mathutils
import sys
import time
import warnings
from pathlib import Path

import bpy

# use_nodes remains the supported API on Blender 4.x/5.x; silence only the
# forward-looking removal notice scheduled for Blender 6.0.
warnings.filterwarnings(
    "ignore", message=r".*use_nodes.*expected to be removed.*"
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from blender_card_render.frame_math import (  # noqa: E402
    DEFAULT_VIEWS,
    VIEW_LIBRARY,
    bbox_of_points,
    fit_orthographic,
    shared_ortho_scale,
)
from blender_card_render.coord_systems import (  # noqa: E402
    UP_AXIS_ROTATION,
    apply_axis_map,
    axis_map_rotation,
    measured_alpha_margins,
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser(description="Batch part-card renderer")
    parser.add_argument("--config", required=True, help="JSON job configuration")
    return parser.parse_args(argv)


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        cfg = json.load(handle)
    base = Path(path).resolve().parent
    cfg["_base_dir"] = str(base)
    return cfg


def resolve_path(base_dir: str, value: str) -> str:
    path = Path(value)
    if not path.is_absolute():
        path = Path(base_dir) / path
    return str(path.resolve())


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def import_part(file_path: str, up_axis: str, axis_map: list | None) -> list:
    """Import a geometry file and return the newly created objects."""
    before = set(bpy.data.objects)
    suffix = Path(file_path).suffix.lower()
    if suffix == ".blend":
        with bpy.data.libraries.load(file_path) as (src, dst):
            dst.objects = list(src.objects)
    elif suffix == ".stl":
        bpy.ops.wm.stl_import(filepath=file_path)
    elif suffix == ".ply":
        bpy.ops.wm.ply_import(filepath=file_path)
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=file_path, up_axis=up_axis)
    elif suffix in (".gltf", ".glb"):
        # The glTF importer always applies its spec-mandated Y-up -> Z-up
        # conversion and exposes no toggle, so an explicit axis_map is not
        # allowed here (it would double-convert).
        if axis_map:
            raise ValueError(
                "axis_map is not supported for glTF/GLB; the importer already "
                "converts Y-up. Use up_axis metadata only."
            )
        bpy.ops.import_scene.gltf(filepath=file_path)
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=file_path)
    else:
        raise ValueError(f"unsupported geometry format: {suffix}")

    new_objects = [obj for obj in bpy.data.objects if obj not in before]
    if axis_map:
        matrix = axis_map_rotation(*axis_map)
        _apply_matrix_to_objects(new_objects, matrix)
    elif up_axis and up_axis != "Z_UP":
        rx, ry, rz = UP_AXIS_ROTATION[up_axis]
        euler = mathutils.Euler(
            (math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ"
        )
        for obj in new_objects:
            obj.rotation_euler = euler
    return new_objects


def _apply_matrix_to_objects(objects, matrix) -> None:
    rot = mathutils.Matrix(
        [
            list(matrix[0]) + [0.0],
            list(matrix[1]) + [0.0],
            list(matrix[2]) + [0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    )
    for obj in objects:
        obj.matrix_world = rot @ obj.matrix_world


def configure_render_engine(cfg: dict) -> None:
    scene = bpy.context.scene
    requested = cfg.get("engine", "BLENDER_EEVEE")
    available = {
        item.identifier for item in bpy.types.RenderSettings.bl_rna.properties[
            "engine"
        ].enum_items
    }
    engine = requested if requested in available else next(
        iter(name for name in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES")
             if name in available)
    )
    scene.render.engine = engine
    cfg["_resolved_engine"] = engine
    scene.render.resolution_x = int(cfg.get("resolution", [1024, 1024])[0])
    scene.render.resolution_y = int(cfg.get("resolution", [1024, 1024])[1])
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = bool(cfg.get("transparent_film", True))
    scene.view_settings.view_transform = "AgX" if _has_view_transform(
        "AgX"
    ) else "Filmic"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = int(cfg.get("samples", 64))
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = int(cfg.get("samples", 64))
        scene.cycles.use_denoising = True


def _has_view_transform(name: str) -> bool:
    return name in {
        item.identifier
        for item in bpy.types.ColorManagedViewSettings.bl_rna.properties[
            "view_transform"
        ].enum_items
    }


def build_lighting_environment(cfg: dict) -> None:
    """One fixed, camera-independent environment used for every view/part."""
    world = bpy.data.worlds.new("card_world")
    bpy.context.scene.world = world
    world.use_nodes = True  # noqa: B018 (still required through Blender 5.x)
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputWorld")
    background = nodes.new("ShaderNodeBackground")
    gradient = nodes.new("ShaderNodeTexGradient")
    gradient.gradient_type = "SPHERICAL"
    mapping = nodes.new("ShaderNodeMapping")
    texcoord = nodes.new("ShaderNodeTexCoord")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (0.025, 0.028, 0.035, 1.0)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (0.55, 0.58, 0.65, 1.0)
    background.inputs["Strength"].default_value = float(
        cfg.get("world_strength", 0.55)
    )
    links.new(texcoord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], gradient.inputs["Vector"])
    links.new(gradient.outputs["Color"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], output.inputs["Surface"])

    hdri = cfg.get("hdri")
    if hdri:
        env = nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(resolve_path(cfg["_base_dir"], hdri))
        links.new(env.outputs["Color"], background.inputs["Color"])

    # Fixed world-space three-point lights so lighting never changes per view.
    _add_area_light("key", (-4.0, -5.0, 7.0), 900.0, 4.0)
    _add_area_light("fill", (5.0, -2.0, 3.0), 350.0, 5.0)
    _add_area_light("rim", (1.0, 6.0, 4.0), 650.0, 3.5)


def _add_area_light(name: str, location, energy: float, size: float) -> None:
    data = bpy.data.lights.new(name=f"light_{name}", type="AREA")
    data.energy = energy
    data.size = size
    obj = bpy.data.objects.new(f"light_{name}", data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    direction = mathutils.Vector((0.0, 0.0, 0.0)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def apply_uniform_material(objects, cfg: dict) -> None:
    if not cfg.get("uniform_material", True):
        return
    color = tuple(cfg.get("material_color", [0.58, 0.62, 0.68, 1.0]))
    mat = bpy.data.materials.new("uniform_card_material")
    mat.use_nodes = True  # noqa: B018
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = float(
        cfg.get("material_roughness", 0.45)
    )
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = float(
            cfg.get("material_metallic", 0.15)
        )
    for obj in objects:
        if obj.type == "MESH":
            obj.data.materials.clear()
            obj.data.materials.append(mat)


def mesh_world_points(objects) -> list:
    """World-space mesh vertices across all objects, after every transform."""
    points = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        for vertex in mesh.vertices:
            points.append(tuple(evaluated.matrix_world @ vertex.co))
        evaluated.to_mesh_clear()
    if not points:
        raise RuntimeError("no mesh geometry found for part")
    return points


def build_camera() -> object:
    data = bpy.data.cameras.new("card_camera")
    data.type = "ORTHO"
    data.sensor_fit = "HORIZONTAL"
    camera = bpy.data.objects.new("card_camera", data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    return camera


def place_camera(camera, framing) -> None:
    data = camera.data
    data.ortho_scale = framing.ortho_scale
    data.clip_start = framing.near
    data.clip_end = framing.far
    camera.location = framing.camera_location
    direction = mathutils.Vector(framing.view_dir)
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_view(camera, framing, output_path: str, measure: bool) -> dict:
    place_camera(camera, framing)
    scene = bpy.context.scene
    scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)
    record = framing.as_dict()
    record["file"] = output_path
    if measure:
        record["pixel_margin_measured"] = _measure_png_margins(output_path)
    return record


def _measure_png_margins(output_path: str) -> dict | None:
    """Reload the written PNG; background mode exposes no Render Result pixels."""
    image = bpy.data.images.load(output_path)
    width, height = image.size
    pixels = list(image.pixels)
    bpy.data.images.remove(image)
    if len(pixels) < width * height * 4:
        return None
    return measured_alpha_margins(pixels[3::4], width, height)


def resolve_views(cfg: dict) -> list[tuple[str, tuple, tuple]]:
    names = cfg.get("views", list(DEFAULT_VIEWS))
    specs = []
    for name in names:
        if name in VIEW_LIBRARY:
            view_dir, up_hint = VIEW_LIBRARY[name]
        else:
            custom = cfg["custom_views"][name]
            view_dir = tuple(custom["direction"])
            up_hint = tuple(custom["up"])
        specs.append((name, view_dir, up_hint))
    return specs


def process_part(part: dict, cfg: dict, camera, view_specs) -> dict:
    file_path = resolve_path(cfg["_base_dir"], part["file"])
    objects = import_part(
        file_path,
        part.get("up_axis", "Z_UP"),
        part.get("axis_map"),
    )

    unit_scale = float(part.get("unit_scale", 1.0))
    origin_offset = part.get("origin_offset", [0.0, 0.0, 0.0])
    for obj in objects:
        if unit_scale != 1.0:
            obj.scale = tuple(v * unit_scale for v in obj.scale)
        if any(origin_offset):
            obj.location = tuple(
                obj.location[i] + origin_offset[i] for i in range(3)
            )

    apply_uniform_material(objects, cfg)
    points = mesh_world_points(objects)
    lo, hi = bbox_of_points(points)

    margin = float(cfg.get("margin_fraction", 0.08))
    width, height = cfg["resolution"]
    common_scale = shared_ortho_scale(view_specs, points, width, height, margin)

    out_dir = Path(resolve_path(cfg["_base_dir"], cfg["output_dir"]))
    part_id = part["id"]
    part_dir = out_dir / part_id
    part_dir.mkdir(parents=True, exist_ok=True)

    views_record = []
    for name, view_dir, up_hint in view_specs:
        framing = fit_orthographic(
            name,
            view_dir,
            up_hint,
            points,
            width,
            height,
            margin,
            fixed_ortho_scale=common_scale,
        )
        output_file = str(part_dir / f"{part_id}_{name}.png")
        views_record.append(
            render_view(
                camera,
                framing,
                output_file,
                bool(cfg.get("measure_alpha_margins", True)),
            )
        )

    record = {
        "id": part_id,
        "source_file": file_path,
        "coordinate_system": {
            "up_axis": part.get("up_axis", "Z_UP"),
            "axis_map": part.get("axis_map"),
            "unit_scale": unit_scale,
            "origin_offset": list(origin_offset),
        },
        "world_bbox": {
            "min": [round(v, 6) for v in lo],
            "max": [round(v, 6) for v in hi],
            "size": [round(hi[i] - lo[i], 6) for i in range(3)],
            "center": [round((lo[i] + hi[i]) / 2, 6) for i in range(3)],
            "origin_inside_bbox": all(
                lo[i] <= 0.0 <= hi[i] for i in range(3)
            ),
        },
        "shared_ortho_scale": common_scale,
        "shared_pixels_per_unit": width / common_scale,
        "views": views_record,
    }

    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    return record


def main() -> None:
    args = parse_args()
    cfg = load_config(args.config)
    cfg.setdefault("resolution", [1024, 1024])
    cfg.setdefault("output_dir", "output")
    cfg.setdefault("margin_fraction", 0.08)

    reset_scene()
    configure_render_engine(cfg)
    build_lighting_environment(cfg)
    camera = build_camera()
    view_specs = resolve_views(cfg)

    manifest = {
        "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "engine": cfg.get("_resolved_engine", bpy.context.scene.render.engine),
        "resolution": list(cfg["resolution"]),
        "margin_fraction": cfg["margin_fraction"],
        "views": [name for name, _, _ in view_specs],
        "uniform_lighting": True,
        "uniform_material": bool(cfg.get("uniform_material", True)),
        "parts": [],
    }
    for part in cfg["parts"]:
        print(f"[card-render] processing {part['id']}")
        manifest["parts"].append(process_part(part, cfg, camera, view_specs))

    out_dir = Path(resolve_path(cfg["_base_dir"], cfg["output_dir"]))
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "render_manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    print(f"[card-render] manifest -> {manifest_path}")


if __name__ == "__main__":
    main()
