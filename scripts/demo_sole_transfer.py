"""Headless demo: low-poly sole sculpt drives a high-poly sole.

Run with:
    blender --background --factory-startup --python scripts/demo_sole_transfer.py

Builds both soles, locks the seam rings between sole regions, binds the high
mesh to the low sculpt, bends the forefoot and twists the heel over 49
frames, bakes the transfer to shape keys, exports GLB animation, measures
local thickness before/after, and verifies UV / face-group reuse.
"""

import json
import os
import sys
import time

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "addons"))
sys.path.insert(0, os.path.join(REPO, "scripts"))

import bpy  # noqa: E402

import mesh_displacement_transfer as mdt  # noqa: E402
from mesh_displacement_transfer import analysis, core  # noqa: E402
from sole_builder import build_sole  # noqa: E402
from sole_deform import deform_positions, pose_at_frame  # noqa: E402

ART = os.path.join(REPO, "artifacts")
FRAME_START, FRAME_END = 1, 49
LENGTH = 0.28


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras,
                  bpy.data.lights, bpy.data.materials):
        for item in list(block):
            block.remove(item)


def add_sculpt_noise(obj, amplitude=0.0004, seed=7):
    """Deterministic per-vertex normal jitter: fake sculpt detail."""
    rng = np.random.default_rng(seed)
    mesh = obj.data
    noise = (rng.random(len(mesh.vertices)) - 0.5) * 2.0 * amplitude
    for v in mesh.vertices:
        n = v.normal
        v.co.x += n.x * noise[v.index]
        v.co.y += n.y * noise[v.index]
        v.co.z += n.z * noise[v.index]
    mesh.update()


def bake_transfer(low, high, binding, low_rest):
    """Bake transferred poses to one shape key per frame; animate weights."""
    t0 = time.perf_counter()
    keys = []
    for frame in range(FRAME_START, FRAME_END + 1):
        bend, twist = pose_at_frame(frame, FRAME_START, FRAME_END)
        low_pos = deform_positions(low_rest, LENGTH, bend, twist)
        core.apply_positions(low, low_pos)
        pos = core.transfer(binding, low_pos)
        key = high.shape_key_add(name="pose_%03d" % frame, from_mix=False)
        flat = np.ascontiguousarray(pos, dtype=np.float32).reshape(-1)
        key.data.foreach_set("co", flat)
        keys.append((frame, key))
    for frame, key in keys:
        if frame > FRAME_START:
            key.value = 0.0
            key.keyframe_insert("value", frame=frame - 1)
        key.value = 1.0
        key.keyframe_insert("value", frame=frame)
        if frame < FRAME_END:
            key.value = 0.0
            key.keyframe_insert("value", frame=frame + 1)
    key_blocks = high.data.shape_keys
    ad = key_blocks.animation_data
    action = ad.action if ad else None
    if action is not None:
        if hasattr(action, "fcurves"):  # Blender < 4.4 legacy actions
            fcurves = list(action.fcurves)
        else:  # slotted actions (Blender 4.4+)
            fcurves = [
                fc
                for layer in action.layers
                for strip in layer.strips
                for bag in strip.channelbags
                for fc in bag.fcurves
            ]
        for fc in fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    return len(keys), time.perf_counter() - t0


def export_glb(high, path):
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    bpy.context.view_layer.objects.active = high
    valid = {p.identifier
             for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    kwargs = {"filepath": path, "export_format": "GLB"}
    for name, value in (
        ("use_selection", True),
        ("export_animations", True),
        ("export_animation", True),
        ("export_morph", True),
        ("export_morph_animation", True),
    ):
        if name in valid:
            kwargs[name] = value
    bpy.ops.export_scene.gltf(**kwargs)


def setup_render_scene(high):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False

    mat = bpy.data.materials.new("SoleRubber")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.75, 0.28, 0.12, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.6
    high.data.materials.append(mat)

    bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0.0, 0.14, -0.018))
    ground = bpy.context.active_object
    gmat = bpy.data.materials.new("Ground")
    gmat.use_nodes = True
    gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        0.16, 0.16, 0.18, 1.0)
    ground.data.materials.append(gmat)

    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0.34, -0.16, 0.30)
    target = np.array([0.0, 0.15, 0.0])
    direction = target - np.array(cam.location)
    from mathutils import Vector
    cam.rotation_euler = Vector(direction).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 4.0
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (0.7, 0.2, 0.6)
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.05, 0.05, 0.07, 1.0)
    scene.world = world


def render_previews(frames):
    scene = bpy.context.scene
    out_dir = os.path.join(ART, "preview_frames")
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for frame in frames:
        scene.frame_set(frame)
        path = os.path.join(out_dir, "frame_%04d.png" % frame)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.frame_set(FRAME_END)
    poster = os.path.join(ART, "sole_transfer_poster.png")
    scene.render.filepath = poster
    bpy.ops.render.render(write_still=True)
    return paths, poster


def main():
    os.makedirs(ART, exist_ok=True)
    reset_scene()
    mdt.register()
    scene = bpy.context.scene
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END

    low = build_sole("Sole_Low_Sculpt", rings=8, segments=16)
    high = build_sole("Sole_High", rings=40, segments=64)
    add_sculpt_noise(high)
    for poly in high.data.polygons:
        poly.use_smooth = True
    low.hide_render = True  # driver only: keep it out of the beauty pass
    low.display_type = "WIRE"

    scene.mdt_source = low
    scene.mdt_target = high

    seam = analysis.find_seam_vertices(high, scene.mdt_group_attribute)
    _vg, locked = analysis.assign_lock_group(
        high, seam, scene.mdt_lock_group, falloff=1)
    snap_before = analysis.snapshot_reusable_data(high)

    binding = core.bind(low, high, scene.mdt_lock_group)
    low_rest, _ = core._triangulated(low.data)

    thickness_before, mask_before = analysis.measure_thickness(high)

    key_count, bake_seconds = bake_transfer(low, high, binding, low_rest)

    snap_after = analysis.snapshot_reusable_data(high)
    reuse = analysis.compare_snapshots(snap_before, snap_after)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    scene.frame_set(FRAME_END)
    high_eval = high.evaluated_get(depsgraph)
    thickness_after, mask_after = analysis.measure_thickness(high_eval)

    _write_thickness_csv(thickness_before, mask_before, thickness_after, mask_after)
    glb_path = os.path.join(ART, "sole_high_animation.glb")
    export_glb(high, glb_path)

    setup_render_scene(high)
    preview_frames = [1, 13, 25, 37, 49]
    _previews, poster = render_previews(preview_frames)
    bpy.ops.wm.save_as_mainfile(
        filepath=os.path.join(ART, "sole_transfer_demo.blend"))

    report = {
        "demo": "local-frame sole displacement transfer",
        "low_mesh": {"name": low.name,
                     "vertices": len(low.data.vertices),
                     "polygons": len(low.data.polygons)},
        "high_mesh": {"name": high.name,
                      "vertices": len(high.data.vertices),
                      "polygons": len(high.data.polygons),
                      "seam_locked_vertices": locked},
        "poses": {
            "frames": preview_frames,
            "forefoot_bend_degrees": [
                round(pose_at_frame(f, FRAME_START, FRAME_END)[0], 2)
                for f in preview_frames],
            "heel_twist_degrees": [
                round(pose_at_frame(f, FRAME_START, FRAME_END)[1], 2)
                for f in preview_frames],
        },
        "correspondence": {
            "valid_count": int(len(binding["tri_index"])),
            "distance": {
                "mean": float(binding["distance"].mean()),
                "max": float(binding["distance"].max()),
            },
            "signature": binding["high_signature"],
        },
        "bake": {"frame_start": FRAME_START, "frame_end": FRAME_END,
                 "shape_key_count": key_count,
                 "elapsed_seconds": bake_seconds},
        "thickness": {
            "method": "inward ray cast along evaluated vertex normal",
            "before": analysis.thickness_stats(thickness_before, mask_before),
            "after": analysis.thickness_stats(thickness_after, mask_after),
        },
        "reuse_checks": reuse,
        "outputs": {
            "glb": os.path.relpath(glb_path, REPO),
            "poster": os.path.relpath(poster, REPO),
        },
    }
    with open(os.path.join(ART, "sole_transfer_report.json"), "w") as fh:
        json.dump(report, fh, indent=2)
    print("DEMO_DONE", json.dumps(reuse))


def _write_thickness_csv(before, mask_b, after, mask_a):
    path = os.path.join(ART, "sole_transfer_thickness.csv")
    with open(path, "w") as fh:
        fh.write("vertex,thickness_before,thickness_after\n")
        for i in range(len(before)):
            b = before[i] if mask_b[i] else ""
            a = after[i] if i < len(after) and mask_a[i] else ""
            fh.write("%d,%s,%s\n" % (i, b, a))


if __name__ == "__main__":
    main()
