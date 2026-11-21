"""Generate heterogeneous sample parts for end-to-end card rendering.

Run inside Blender::

    blender --background --python make_examples.py

The parts deliberately cover the tricky cases:
* a very slender bar (high aspect ratio);
* a hub whose origin sits far outside its geometry, with a thin antenna that
  flies away from the origin and the body;
* a bracket authored in Y-up and exported as glTF so the pipeline must
  normalize a different coordinate system.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def reset() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def export_glb(obj_name: str, path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    bpy.data.objects[obj_name].select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
    )


def make_slender_bar(path: Path) -> None:
    reset()
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
    bar = bpy.context.object
    bar.name = "slender_bar"
    bar.dimensions = (12.0, 0.35, 0.35)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.wm.stl_export(filepath=str(path), export_selected_objects=False)


def make_flying_antenna(path: Path) -> None:
    reset()
    # Body placed 8 units from the world origin; origin stays at (0,0,0).
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.8, depth=1.6, location=(8.0, 0.0, 0.0)
    )
    body = bpy.context.object
    body.name = "hub_body"

    # Thin antenna stretching 14 units away from the body, ending in a knob.
    start = Vector((8.6, 0.0, 0.0))
    end = Vector((22.0, 3.0, 1.0))
    midpoint = (start + end) / 2.0
    length = (end - start).length
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.06, depth=length, location=midpoint
    )
    antenna = bpy.context.object
    antenna.name = "flying_antenna"
    antenna.rotation_euler = (end - start).to_track_quat("Z", "Y").to_euler()

    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=0.22, location=end
    )
    knob = bpy.context.object
    knob.name = "antenna_knob"

    bpy.ops.object.select_all(action="DESELECT")
    for obj in (body, antenna, knob):
        obj.select_set(True)
    bpy.ops.wm.stl_export(filepath=str(path), export_selected_objects=True)


def make_yup_bracket(path: Path) -> None:
    reset()
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
    plate = bpy.context.object
    plate.name = "yup_bracket"
    plate.dimensions = (3.0, 2.0, 0.4)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.8, 1.2))
    fin = bpy.context.object
    fin.name = "yup_fin"
    fin.dimensions = (0.5, 0.4, 2.4)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bpy.ops.object.select_all(action="DESELECT")
    plate.select_set(True)
    fin.select_set(True)
    export_glb("yup_bracket", path)


def main() -> None:
    out = Path(sys.argv[-1] if len(sys.argv) > 1 and Path(sys.argv[-1]).is_dir()
               else Path(__file__).resolve().parent / "examples" / "geometry")
    out.mkdir(parents=True, exist_ok=True)
    make_slender_bar(out / "slender_bar.stl")
    make_flying_antenna(out / "flying_antenna.stl")
    make_yup_bracket(out / "yup_bracket.glb")
    make_yup_pin(out / "yup_pin.stl")
    print(f"[make-examples] wrote sample parts to {out}")


def make_yup_pin(path: Path) -> None:
    """Raw STL authored in Y-up: its long axis is stored along source Y."""
    reset()
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.3, depth=6.0, location=(0.0, 3.0, 0.0),
        rotation=(math.radians(90.0), 0.0, 0.0),
    )
    pin = bpy.context.object
    pin.name = "yup_pin"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.wm.stl_export(filepath=str(path), export_selected_objects=True)


if __name__ == "__main__":
    main()
