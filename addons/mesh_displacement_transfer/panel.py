"""Sidebar panel for the displacement transfer addon."""

import bpy


class MDT_PT_panel(bpy.types.Panel):
    bl_label = "Displacement Transfer"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "DispTransfer"

    def draw(self, context):
        layout = self.layout
        scene = context.scene

        col = layout.column(align=True)
        col.prop(scene, "mdt_source", text="Low (driver)")
        col.prop(scene, "mdt_target", text="High (target)")
        col.prop(scene, "mdt_lock_group", text="Lock Group")
        col.prop(scene, "mdt_group_attribute", text="Region Attr")

        layout.operator("mdt.bind", icon="SNAP_SURFACE")
        layout.operator("mdt.lock_seam", icon="LOCKED")
        layout.operator("mdt.transfer", icon="MOD_MESHDEFORM")
        layout.operator("mdt.measure_thickness", icon="RULER")
        layout.operator("mdt.clear", icon="TRASH")


CLASSES = (MDT_PT_panel,)
