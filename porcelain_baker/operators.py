"""Blender operators for surface stamp placement and texture baking."""

import math

import bpy
from bpy_extras.io_utils import ImportHelper
from bpy_extras.view3d_utils import (
    region_2d_to_origin_3d,
    region_2d_to_vector_3d,
)
from mathutils import Vector

from . import stamping
from .mesh import create_stamp_empty, create_vase


def _bake_and_update(context):
    settings = context.scene.porcelain_bake
    target = settings.target_object
    if target is None or target.type != "MESH":
        raise ValueError("Choose a vase mesh first")
    if not target.data.uv_layers.active:
        raise ValueError("The vase needs an active UV map")
    result = stamping.bake_to_files(
        target,
        settings.resolution,
        settings.padding,
        settings.output_dir,
        tuple(settings.porcelain_color),
    )
    stamping.apply_baked_material(target, result["padded_image"])
    settings.last_texture = result["padded_path"]
    settings.last_padding_texture = result["raw_path"]
    target["porcelain_raw_texture"] = result["raw_path"]
    target["porcelain_padded_texture"] = result["padded_path"]
    target["porcelain_bake_stamps"] = result["stamps"]
    target["porcelain_bake_seconds"] = result["seconds"]
    return result


def _raycast_target(context, event, target):
    region = context.region
    rv3d = context.region_data
    origin = region_2d_to_origin_3d(region, rv3d, (event.mouse_region_x,
                                                    event.mouse_region_y))
    direction = region_2d_to_vector_3d(
        region, rv3d, (event.mouse_region_x, event.mouse_region_y)
    )
    inverse = target.matrix_world.inverted()
    local_origin = inverse @ origin
    local_direction = (inverse.to_3x3() @ direction).normalized()
    hit, location, normal, _face = target.ray_cast(local_origin, local_direction)
    if not hit:
        return False, None, None
    return True, location.copy(), normal.normalized()


def _view_tangent(context, normal):
    rv3d = context.region_data
    right = rv3d.view_rotation @ Vector((1.0, 0.0, 0.0))
    tangent = right - normal * right.dot(normal)
    if tangent.length < 1.0e-5:
        tangent = Vector((0.0, 1.0, 0.0))
    return tangent.normalized()


class PORCELAIN_OT_place_stamp(bpy.types.Operator):
    """Click the vase, drag a surface tangent, and release to stamp"""

    bl_idname = "porcelain.place_stamp"
    bl_label = "Place Directional Stamp"
    bl_options = {"REGISTER", "UNDO"}

    def invoke(self, context, event):
        settings = context.scene.porcelain_bake
        target = settings.target_object
        if target is None or target.type != "MESH":
            self.report({"ERROR"}, "Choose the vase mesh first")
            return {"CANCELLED"}
        if settings.stamp_image is None:
            self.report({"ERROR"}, "Load a transparent stamp image first")
            return {"CANCELLED"}
        self._target = target
        self._center = None
        self._normal = None
        self._tangent = None
        self._press = None
        self._draw_handle = None
        self._batch = None
        context.window.cursor_set("CROSSHAIR")
        context.workspace.status_text_set(
            "Porcelain: click on the vase, drag along the print direction, "
            "release to bake. Esc cancels."
        )
        self._add_preview(context)
        context.window_manager.modal_handler_add(self)
        return {"RUNNING_MODAL"}

    def _add_preview(self, context):
        try:
            import gpu
            from gpu_extras.batch import batch_for_shader
        except ImportError:
            return

        def draw():
            if not self._batch:
                return
            gpu.state.line_width_set(3.0)
            gpu.state.blend_set("ALPHA")
            shader = gpu.shader.from_builtin("UNIFORM_COLOR")
            shader.bind()
            shader.uniform_float("color", (1.0, 0.38, 0.08, 0.95))
            self._batch.draw(shader)
            gpu.state.blend_set("NONE")

        self._draw_handle = bpy.types.SpaceView3D.draw_handler_add(
            draw, (), "WINDOW", "POST_VIEW"
        )

    def _update_preview(self, context):
        if self._center is None or self._tangent is None:
            return
        try:
            import gpu
            from gpu_extras.batch import batch_for_shader
        except ImportError:
            return
        center = self._target.matrix_world @ self._center
        normal = (self._target.matrix_world.to_3x3() @ self._normal).normalized()
        tangent = (self._target.matrix_world.to_3x3() @ self._tangent).normalized()
        offset = normal * 0.012
        end = center + tangent * 0.36 + offset
        shader = gpu.shader.from_builtin("UNIFORM_COLOR")
        self._batch = batch_for_shader(
            shader, "LINES", {"pos": [center + offset, end]}
        )
        context.area.tag_redraw()

    def _finish(self, context):
        self._remove_preview()
        context.window.cursor_set("DEFAULT")
        context.workspace.status_text_set(None)

    def _remove_preview(self):
        if self._draw_handle is not None:
            bpy.types.SpaceView3D.draw_handler_remove(
                self._draw_handle, "WINDOW"
            )
            self._draw_handle = None

    def modal(self, context, event):
        if event.type in {"ESC", "RIGHTMOUSE"}:
            self._finish(context)
            return {"CANCELLED"}
        if event.type == "LEFTMOUSE" and event.value == "PRESS":
            hit, center, normal = _raycast_target(context, event, self._target)
            if not hit:
                self.report({"WARNING"}, "Ray missed the vase")
                return {"RUNNING_MODAL"}
            self._center = center
            self._normal = normal
            self._tangent = _view_tangent(context, normal)
            self._press = (event.mouse_region_x, event.mouse_region_y)
            self._update_preview(context)
            return {"RUNNING_MODAL"}
        if event.type == "MOUSEMOVE" and self._center is not None:
            hit, location, _normal = _raycast_target(context, event, self._target)
            if hit:
                candidate = location - self._center
                candidate -= self._normal * candidate.dot(self._normal)
                if candidate.length > 0.003:
                    self._tangent = candidate.normalized()
                    self._update_preview(context)
            return {"RUNNING_MODAL"}
        if event.type == "LEFTMOUSE" and event.value == "RELEASE":
            if self._center is None or self._tangent is None:
                self._finish(context)
                return {"CANCELLED"}
            settings = context.scene.porcelain_bake
            name = "Porcelain_Stamp_%02d" % (len(
                [o for o in bpy.data.objects if o.get("porcelain_stamp")]
            ) + 1)
            empty = create_stamp_empty(
                self._center,
                self._normal,
                self._tangent,
                settings.stamp_image,
                settings.stamp_width,
                settings.stamp_height,
                settings.stamp_opacity,
                settings.stamp_rotation,
                name,
                target=self._target,
            )
            empty.parent = self._target
            bpy.context.view_layer.objects.active = empty
            empty.select_set(True)
            self._finish(context)
            if settings.auto_bake:
                context.window.cursor_set("WAIT")
                try:
                    result = _bake_and_update(context)
                    self.report(
                        {"INFO"},
                        "Stamped and baked %d print(s) in %.1f s"
                        % (result["stamps"], result["seconds"]),
                    )
                except Exception as exc:
                    self.report({"ERROR"}, "Bake failed: %s" % exc)
                finally:
                    context.window.cursor_set("DEFAULT")
            return {"FINISHED"}
        return {"RUNNING_MODAL"}


class PORCELAIN_OT_bake(bpy.types.Operator):
    """Bake every surface stamp into the porcelain UV atlas"""

    bl_idname = "porcelain.bake"
    bl_label = "Bake Porcelain Texture"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        context.window.cursor_set("WAIT")
        try:
            result = _bake_and_update(context)
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        finally:
            context.window.cursor_set("DEFAULT")
        self.report(
            {"INFO"},
            "Baked %d stamps at %d px in %.1f s"
            % (result["stamps"], context.scene.porcelain_bake.resolution,
               result["seconds"]),
        )
        return {"FINISHED"}


class PORCELAIN_OT_clear_stamps(bpy.types.Operator):
    """Remove all placed surface stamps"""

    bl_idname = "porcelain.clear_stamps"
    bl_label = "Clear All Stamps"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = context.scene.porcelain_bake
        for obj in list(bpy.data.objects):
            if not obj.get("porcelain_stamp"):
                continue
            owner = obj.get("target", "")
            if owner and settings.target_object and owner != settings.target_object.name:
                continue
            bpy.data.objects.remove(obj, do_unlink=True)
        return {"FINISHED"}


class PORCELAIN_OT_remove_stamp(bpy.types.Operator):
    """Remove the active surface stamp"""

    bl_idname = "porcelain.remove_stamp"
    bl_label = "Remove Active Stamp"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        obj = context.active_object
        if obj is None or not obj.get("porcelain_stamp"):
            self.report({"WARNING"}, "Select a porcelain stamp empty")
            return {"CANCELLED"}
        bpy.data.objects.remove(obj, do_unlink=True)
        return {"FINISHED"}


class PORCELAIN_OT_select_stamp(bpy.types.Operator):
    """Select a surface stamp empty"""

    bl_idname = "porcelain.select_stamp"
    bl_label = "Select Stamp"

    stamp_name: bpy.props.StringProperty()

    def execute(self, context):
        obj = bpy.data.objects.get(self.stamp_name)
        if obj is None or not obj.get("porcelain_stamp"):
            return {"CANCELLED"}
        for selected in context.selected_objects:
            selected.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        return {"FINISHED"}


class PORCELAIN_OT_import_stamp(bpy.types.Operator, ImportHelper):
    """Load a transparent PNG stamp"""

    bl_idname = "porcelain.import_stamp"
    bl_label = "Load Stamp Image"
    filename_ext = ".png"
    filter_glob: bpy.props.StringProperty(default="*.png;*.tif;*.tiff;*.exr")

    def execute(self, context):
        image = bpy.data.images.load(self.filepath, check_existing=True)
        image.colorspace_settings.name = "sRGB"
        context.scene.porcelain_bake.stamp_image = image
        return {"FINISHED"}


class PORCELAIN_OT_create_demo_vase(bpy.types.Operator):
    """Create the mirrored-UV demo vase"""

    bl_idname = "porcelain.create_demo_vase"
    bl_label = "Create Demo Vase"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        vase = create_vase()
        context.scene.porcelain_bake.target_object = vase
        bpy.context.view_layer.objects.active = vase
        vase.select_set(True)
        return {"FINISHED"}


CLASSES = (
    PORCELAIN_OT_place_stamp,
    PORCELAIN_OT_bake,
    PORCELAIN_OT_clear_stamps,
    PORCELAIN_OT_remove_stamp,
    PORCELAIN_OT_select_stamp,
    PORCELAIN_OT_import_stamp,
    PORCELAIN_OT_create_demo_vase,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
