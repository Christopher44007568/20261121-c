"""Scene properties shared by the porcelain baker UI and operators."""

import bpy
from bpy.props import (
    BoolProperty,
    FloatProperty,
    FloatVectorProperty,
    IntProperty,
    PointerProperty,
    StringProperty,
)


def _mesh_poll(_self, obj):
    return obj is not None and obj.type == "MESH"


class PorcelainBakeSettings(bpy.types.PropertyGroup):
    target_object: PointerProperty(
        name="Vase",
        description="Mesh with mirrored UV islands to receive porcelain stamps",
        type=bpy.types.Object,
        poll=_mesh_poll,
    )
    stamp_image: PointerProperty(
        name="Stamp",
        description="Transparent directional print used by the surface tool",
        type=bpy.types.Image,
    )
    stamp_width: FloatProperty(
        name="Width",
        description="Stamp width in object units (across the drag direction)",
        default=1.2,
        min=0.02,
        soft_max=4.0,
    )
    stamp_height: FloatProperty(
        name="Length",
        description="Stamp length in object units (along the drag direction)",
        default=2.2,
        min=0.02,
        soft_max=6.0,
    )
    stamp_rotation: FloatProperty(
        name="Print Rotation",
        description="Extra rotation in the surface tangent plane",
        default=0.0,
        subtype="ANGLE",
    )
    stamp_opacity: FloatProperty(
        name="Opacity",
        default=1.0,
        min=0.0,
        max=1.0,
    )
    resolution: IntProperty(
        name="Bake Size",
        description="Square baked texture resolution",
        default=1024,
        min=256,
        max=4096,
    )
    padding: IntProperty(
        name="Seam Padding",
        description="Pixels of UV-boundary dilation used by the mip chain",
        default=64,
        min=0,
        max=256,
    )
    auto_bake: BoolProperty(
        name="Bake After Placement",
        default=True,
    )
    output_dir: StringProperty(
        name="Output Folder",
        default="//porcelain_bake",
        subtype="DIR_PATH",
    )
    porcelain_color: FloatVectorProperty(
        name="Porcelain",
        description="Linear RGB glaze color written into the baked atlas",
        subtype="COLOR",
        size=3,
        default=(0.82, 0.77, 0.67),
        min=0.0,
        max=1.0,
    )
    last_texture: StringProperty(name="Last Texture", default="")
    last_padding_texture: StringProperty(name="Padded Copy", default="")
