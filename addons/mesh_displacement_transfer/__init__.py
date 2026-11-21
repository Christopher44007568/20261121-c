"""Transfer low-poly sculpt displacement to a high-poly mesh via local frames."""

bl_info = {
    "name": "Local Displacement Transfer",
    "author": "Codex",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > DispTransfer",
    "description": (
        "Bind a high-poly mesh to a low-poly sculpt in rest pose, then replay "
        "the low-poly deformation through per-triangle local frames so "
        "displacement propagates with rotation. Supports seam-ring locking."
    ),
    "category": "Mesh",
}

import bpy
from bpy.props import PointerProperty, StringProperty

from . import operators, panel


def register():
    for cls in operators.CLASSES + panel.CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.mdt_source = PointerProperty(
        name="Low Source", type=bpy.types.Object
    )
    bpy.types.Scene.mdt_target = PointerProperty(
        name="High Target", type=bpy.types.Object
    )
    bpy.types.Scene.mdt_lock_group = StringProperty(
        name="Lock Vertex Group", default="MDT_SeamLock"
    )
    bpy.types.Scene.mdt_group_attribute = StringProperty(
        name="Face Region Attribute", default="part_group"
    )


def unregister():
    for cls in reversed(operators.CLASSES + panel.CLASSES):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.mdt_source
    del bpy.types.Scene.mdt_target
    del bpy.types.Scene.mdt_lock_group
    del bpy.types.Scene.mdt_group_attribute


if __name__ == "__main__":
    register()
