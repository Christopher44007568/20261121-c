"""Blender operators for the displacement transfer addon."""

import bpy
from bpy.props import IntProperty

from . import analysis, core


def _targets(context):
    scene = context.scene
    low = scene.mdt_source
    high = scene.mdt_target
    if low is None or high is None:
        return None, None
    return low, high


class MDT_OT_bind(bpy.types.Operator):
    bl_idname = "mdt.bind"
    bl_label = "Bind High to Low"
    bl_description = "Capture rest-pose local coordinates of the high mesh on the low surface"

    def execute(self, context):
        low, high = _targets(context)
        if low is None:
            self.report({"ERROR"}, "Set source and target objects first")
            return {"CANCELLED"}
        binding = core.bind(low, high, context.scene.mdt_lock_group)
        dist = binding["distance"]
        self.report(
            {"INFO"},
            "Bound %d vertices (mean dist %.5f, max %.5f)"
            % (len(dist), dist.mean(), dist.max()),
        )
        return {"FINISHED"}


class MDT_OT_transfer(bpy.types.Operator):
    bl_idname = "mdt.transfer"
    bl_label = "Transfer Displacement"
    bl_description = "Rebuild high-mesh positions from the current low-mesh pose"

    def execute(self, context):
        low, high = _targets(context)
        if low is None:
            self.report({"ERROR"}, "Set source and target objects first")
            return {"CANCELLED"}
        binding = core.get_binding(low, high)
        low_verts, _ = core._triangulated(low.evaluated_get(context.evaluated_depsgraph_get()).to_mesh())
        positions = core.transfer(binding, low_verts)
        core.apply_positions(high, positions)
        locked = int((binding["lock"] > 0.0).sum())
        self.report({"INFO"}, "Transferred (%d locked vertices held)" % locked)
        return {"FINISHED"}


class MDT_OT_lock_seam(bpy.types.Operator):
    bl_idname = "mdt.lock_seam"
    bl_label = "Lock Seam Rings"
    bl_description = "Find region-boundary rings on the high mesh and lock them"

    falloff: IntProperty(name="Falloff Rings", default=1, min=0, max=8)

    def execute(self, context):
        _low, high = _targets(context)
        if high is None:
            self.report({"ERROR"}, "Set a target object first")
            return {"CANCELLED"}
        scene = context.scene
        seam = analysis.find_seam_vertices(high, scene.mdt_group_attribute)
        if not seam:
            self.report({"WARNING"}, "No seam rings found for attribute")
            return {"CANCELLED"}
        _vg, count = analysis.assign_lock_group(
            high, seam, scene.mdt_lock_group, falloff=self.falloff
        )
        core.BINDING_CACHE.clear()  # lock weights changed: force rebind
        self.report({"INFO"}, "Locked %d seam vertices" % count)
        return {"FINISHED"}


class MDT_OT_measure_thickness(bpy.types.Operator):
    bl_idname = "mdt.measure_thickness"
    bl_label = "Measure Local Thickness"
    bl_description = "Ray-cast inward along normals and report local thickness"

    def execute(self, context):
        _low, high = _targets(context)
        if high is None:
            self.report({"ERROR"}, "Set a target object first")
            return {"CANCELLED"}
        thickness, mask = analysis.measure_thickness(high)
        stats = analysis.thickness_stats(thickness, mask)
        if stats.get("samples"):
            self.report(
                {"INFO"},
                "Thickness mean %.5f (min %.5f, max %.5f, %d samples)"
                % (stats["mean"], stats["min"], stats["max"], stats["samples"]),
            )
        else:
            self.report({"WARNING"}, "No thickness samples")
        return {"FINISHED"}


class MDT_OT_clear(bpy.types.Operator):
    bl_idname = "mdt.clear"
    bl_label = "Clear Binding"
    bl_description = "Drop cached bindings"

    def execute(self, context):
        core.BINDING_CACHE.clear()
        self.report({"INFO"}, "Binding cache cleared")
        return {"FINISHED"}


CLASSES = (
    MDT_OT_bind,
    MDT_OT_transfer,
    MDT_OT_lock_seam,
    MDT_OT_measure_thickness,
    MDT_OT_clear,
)
