"""Directional surface stamping, tangent-aware baking and material setup."""

import math
import os
import time

import bpy
import numpy as np
from mathutils import Vector

from .raster import pad_texture, rasterize_uv


_RASTER_CACHE = {}
_IMAGE_CACHE = {}


def clear_caches():
    _RASTER_CACHE.clear()
    _IMAGE_CACHE.clear()


def _cached_raster(mesh, size):
    key = (mesh.name, len(mesh.vertices), len(mesh.polygons), int(size))
    if key not in _RASTER_CACHE:
        _RASTER_CACHE[key] = rasterize_uv(mesh, size)
    return _RASTER_CACHE[key]


def _image_pixels(image):
    key = (image.name, image.size[0], image.size[1], image.filepath)
    if key not in _IMAGE_CACHE:
        width, height = image.size
        data = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(data)
        _IMAGE_CACHE[key] = data.reshape((height, width, 4))
    return _IMAGE_CACHE[key]


def _sample_bilinear(rgba, u, v):
    height, width = rgba.shape[:2]
    inside = (u >= 0.0) & (u <= 1.0) & (v >= 0.0) & (v <= 1.0)
    x = np.clip(u, 0.0, 1.0) * (width - 1)
    y = np.clip(v, 0.0, 1.0) * (height - 1)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = np.minimum(x0 + 1, width - 1)
    y1 = np.minimum(y0 + 1, height - 1)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    top = rgba[y0, x0] * (1.0 - fx) + rgba[y0, x1] * fx
    bottom = rgba[y1, x0] * (1.0 - fx) + rgba[y1, x1] * fx
    result = top * (1.0 - fy) + bottom * fy
    result[~inside] = 0.0
    return result


def _collect_stamps(target):
    stamps = []
    for obj in bpy.data.objects:
        if not obj.get("porcelain_stamp") or obj.get("disabled", False):
            continue
        owner = obj.get("target", "")
        if owner and owner != target.name:
            continue
        stamps.append(obj)
    return sorted(stamps, key=lambda item: item.name)


def _stamp_uv_coordinates(position, stamp):
    points = np.asarray(position, dtype=np.float64)
    center = Vector(stamp["center"])
    tangent = Vector(stamp["tangent"]).normalized()
    theta0 = math.atan2(center.y, center.x)
    radius0 = max(math.hypot(center.x, center.y), 1.0e-4)
    e_theta = Vector((-math.sin(theta0), math.cos(theta0), 0.0))
    tangent_theta = tangent.dot(e_theta) / radius0
    tangent_z = tangent.z
    scale = math.hypot(tangent_theta, tangent_z)
    if scale < 1.0e-5:
        tangent_theta, tangent_z = 0.0, 1.0
        scale = 1.0
    along_axis = np.array(
        [tangent_theta / scale, tangent_z / scale], dtype=np.float64
    )
    rotation = float(stamp.get("rotation", 0.0))
    cos_r, sin_r = math.cos(rotation), math.sin(rotation)
    along_axis = np.array(
        [
            along_axis[0] * cos_r - along_axis[1] * sin_r,
            along_axis[0] * sin_r + along_axis[1] * cos_r,
        ]
    )
    across_axis = np.array([-along_axis[1], along_axis[0]])

    theta = np.arctan2(points[:, 1], points[:, 0])
    delta_theta = (theta - theta0 + math.pi) % (2.0 * math.pi) - math.pi
    arc = delta_theta * radius0
    dz = points[:, 2] - center.z
    along = arc * along_axis[0] + dz * along_axis[1]
    across = arc * across_axis[0] + dz * across_axis[1]
    width = max(float(stamp.get("width", 1.0)), 1.0e-5)
    height = max(float(stamp.get("height", 1.0)), 1.0e-5)
    return across / width + 0.5, along / height + 0.5


def _base_porcelain(position, normal, porcelain_color):
    points = np.asarray(position, dtype=np.float64)
    # Very low-contrast kiln variation. It is evaluated in object space so the
    # same value is produced on every mirrored UV island.
    waves = (
        np.sin(points[:, 0] * 9.7 + points[:, 2] * 15.3)
        + 0.6 * np.sin(points[:, 1] * 18.1 - points[:, 2] * 8.3)
        + 0.3 * np.cos((points[:, 0] + points[:, 1]) * 31.0)
    )
    variation = (waves / 1.9 * 0.006)[:, None]
    color = np.asarray(porcelain_color, dtype=np.float64)[None, :] + variation
    return np.clip(color, 0.0, 1.0)


def evaluate_bake(target, resolution, padding, porcelain_color, include_padding=True):
    """Evaluate all directional stamps into RGBA arrays and a coverage mask."""
    start = time.time()
    coverage, position, _normal = _cached_raster(target.data, resolution)
    color = np.zeros((resolution, resolution, 3), dtype=np.float64)
    color[coverage] = _base_porcelain(
        position[coverage], _normal[coverage], porcelain_color
    )

    for stamp in _collect_stamps(target):
        image = bpy.data.images.get(stamp.get("image", ""))
        if image is None or image.size[0] == 0:
            continue
        rgba = _image_pixels(image)
        u, v = _stamp_uv_coordinates(position[coverage], stamp)
        sample = _sample_bilinear(rgba, u, v)
        alpha = np.clip(sample[:, 3] * float(stamp.get("opacity", 1.0)), 0.0, 1.0)
        if not np.any(alpha > 0.0):
            continue
        dst = color[coverage]
        color[coverage] = dst * (1.0 - alpha[:, None]) + sample[:, :3] * alpha[:, None]

    raw = color.copy()
    padded = pad_texture(color, coverage, padding) if include_padding else raw.copy()
    return {
        "raw": np.clip(raw, 0.0, 1.0),
        "padded": np.clip(padded, 0.0, 1.0),
        "coverage": coverage,
        "stamps": len(_collect_stamps(target)),
        "seconds": time.time() - start,
    }


def _save_image(name, rgba, filepath):
    image = bpy.data.images.get(name)
    if image is not None:
        bpy.data.images.remove(image)
    image = bpy.data.images.new(name, width=rgba.shape[1], height=rgba.shape[0],
                                alpha=True, float_buffer=False)
    image.colorspace_settings.name = "sRGB"
    pixels = np.ones((rgba.shape[0], rgba.shape[1], 4), dtype=np.float32)
    pixels[:, :, :3] = rgba
    image.pixels.foreach_set(pixels.ravel())
    image.file_format = "PNG"
    image.filepath_raw = filepath
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    image.save()
    image.source = "FILE"
    image.filepath = filepath
    image.reload()
    image.use_fake_user = True
    return image


def apply_baked_material(target, image, material_name="Porcelain_Baked"):
    mat = bpy.data.materials.get(material_name)
    if mat is None:
        mat = bpy.data.materials.new(material_name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Linear"
    coord = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 28.0
    noise.inputs["Detail"].default_value = 2.0
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.025
    bump.inputs["Distance"].default_value = 0.02
    bsdf.inputs["Roughness"].default_value = 0.2
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.35
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = 0.08
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(coord.outputs["Generated"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    target.data.materials.clear()
    target.data.materials.append(mat)
    return mat


def bake_to_files(target, resolution, padding, output_dir, porcelain_color,
                  padded_name="PorcelainBake_Padded",
                  raw_name="PorcelainBake_Raw"):
    result = evaluate_bake(target, resolution, padding, porcelain_color)
    folder = bpy.path.abspath(output_dir)
    padded_path = os.path.join(folder, "porcelain_bake_padded.png")
    raw_path = os.path.join(folder, "porcelain_bake_raw.png")
    padded_image = _save_image(padded_name, result["padded"], padded_path)
    raw_image = _save_image(raw_name, result["raw"], raw_path)
    result.update({
        "padded_image": padded_image,
        "raw_image": raw_image,
        "padded_path": padded_path,
        "raw_path": raw_path,
    })
    return result
