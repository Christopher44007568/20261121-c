"""Porcelain stamp baker for Blender 5."""

import bpy

from .properties import PorcelainBakeSettings
from . import operators, ui

bl_info = {
    "name": "Porcelain Stamp Baker",
    "author": "Codex",
    "version": (1, 0, 0),
    "blender": (4, 3, 0),
    "location": "View3D > Sidebar > Porcelain",
    "description": "Place tangent-aligned prints and bake seam-safe porcelain textures",
    "category": "Paint",
}

CLASSES = (PorcelainBakeSettings,)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.porcelain_bake = bpy.props.PointerProperty(
        type=PorcelainBakeSettings
    )
    operators.register()
    ui.register()


def unregister():
    ui.unregister()
    operators.unregister()
    del bpy.types.Scene.porcelain_bake
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
