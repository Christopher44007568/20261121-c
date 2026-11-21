"""N-panel interface for the porcelain stamp baker."""

import bpy


def _stamp_count(settings):
    target = settings.target_object
    return len([
        obj for obj in bpy.data.objects
        if obj.get("porcelain_stamp")
        and (not obj.get("target") or not target or obj.get("target") == target.name)
    ])


class PORCELAIN_PT_baker(bpy.types.Panel):
    bl_label = "Porcelain Stamp Baker"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Porcelain"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.porcelain_bake

        box = layout.box()
        box.label(text="Target", icon="MESH_DATA")
        box.prop(settings, "target_object")
        if settings.target_object is None:
            box.operator("porcelain.create_demo_vase", icon="ADD")

        box = layout.box()
        box.label(text="Directional print", icon="IMAGE_DATA")
        box.prop(settings, "stamp_image")
        row = box.row(align=True)
        row.operator("porcelain.import_stamp", icon="FILEBROWSER")
        row.prop(settings, "stamp_opacity")
        row = box.row(align=True)
        row.prop(settings, "stamp_width")
        row.prop(settings, "stamp_height")
        box.prop(settings, "stamp_rotation")
        box.prop(settings, "auto_bake")
        box.operator("porcelain.place_stamp", icon="CURSOR")
        box.label(text="Click surface, drag tangent, release.", icon="INFO")

        box = layout.box()
        box.label(text="Placed prints (%d)" % _stamp_count(settings))
        for obj in bpy.data.objects:
            if not obj.get("porcelain_stamp"):
                continue
            owner = obj.get("target", "")
            if owner and settings.target_object and owner != settings.target_object.name:
                continue
            row = box.row(align=True)
            active = context.active_object == obj
            op = row.operator(
                "porcelain.select_stamp",
                text=obj.name,
                emboss=False,
                icon="RADIOBUT_ON" if active else "RADIOBUT_OFF",
            )
            op.stamp_name = obj.name
        row = box.row(align=True)
        row.operator("porcelain.remove_stamp", icon="REMOVE")
        row.operator("porcelain.clear_stamps", icon="TRASH")

        box = layout.box()
        box.label(text="Bake", icon="RENDER_STILL")
        row = box.row(align=True)
        row.prop(settings, "resolution")
        row.prop(settings, "padding")
        box.prop(settings, "output_dir")
        box.prop(settings, "porcelain_color")
        box.operator("porcelain.bake", icon="SHADING_TEXTURE")
        if settings.last_texture:
            box.label(text="Padded: " + settings.last_texture, icon="CHECKMARK")
        if settings.last_padding_texture:
            box.label(text="Raw: " + settings.last_padding_texture, icon="IMAGE_DATA")
        box.label(text="Raw copy is for mip-bleed comparison.", icon="INFO")


CLASSES = (PORCELAIN_PT_baker,)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
