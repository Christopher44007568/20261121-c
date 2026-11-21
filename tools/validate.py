"""Headless checks for the saved acceptance scene and baked mip behaviour."""

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from porcelain_baker import stamping


OUT = os.path.join(ROOT, "artifacts", "validation", "checks.json")


def image_array(name):
    image = bpy.data.images[name]
    width, height = image.size
    data = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    return data.reshape((height, width, 4))[:, :, :3]


def box_downsample(array, factor):
    height = array.shape[0] // factor
    width = array.shape[1] // factor
    cropped = array[:height * factor, :width * factor]
    return cropped.reshape(height, factor, width, factor, 3).mean(axis=(1, 3))


def uv_quadrant_report(mesh):
    uv = mesh.uv_layers.active
    counts = [0, 0, 0, 0]
    signs = [0, 0]
    for poly in mesh.polygons:
        coords = [uv.data[i].uv for i in poly.loop_indices]
        if len(coords) < 3:
            continue
        center = sum(coords, Vector((0.0, 0.0))) / len(coords)
        col = 1 if center.x > 0.5 else 0
        row = 1 if center.y > 0.5 else 0
        counts[row * 2 + col] += 1
        area = 0.0
        for i in range(len(coords)):
            a, b = coords[i], coords[(i + 1) % len(coords)]
            area += a.x * b.y - b.x * a.y
        signs[0 if area >= 0.0 else 1] += 1
    return counts, signs


def stamp_alpha_at(stamp, image, point):
    u, v = stamping._stamp_uv_coordinates(np.asarray([point]), stamp)
    sample = stamping._sample_bilinear(stamping._image_pixels(image), u, v)
    return float(sample[0, 3])


def main():
    vase = bpy.data.objects["Porcelain_Vase"]
    stamp = bpy.data.objects["Diagonal_Scroll_SeamTest"]
    source = bpy.data.images["CobaltDiagonalScroll"]
    counts, signs = uv_quadrant_report(vase.data)

    radius = 0.6
    for vertex in vase.data.vertices:
        if abs(vertex.co.z - 1.2) < 1.0e-4 and abs(vertex.co.x) < 1.0e-4:
            radius = abs(vertex.co.y)
            break
    intersection = (0.0, -radius, 1.2)
    vertical_probe = [
        (0.0, -radius, 1.2 + dz) for dz in (-0.18, -0.08, 0.0, 0.08, 0.18)
    ]
    horizontal_probe = [
        (dx, -radius, 1.2) for dx in (-0.2, -0.08, 0.0, 0.08, 0.2)
    ]
    vertical_alphas = [stamp_alpha_at(stamp, source, p) for p in vertical_probe]
    horizontal_alphas = [stamp_alpha_at(stamp, source, p) for p in horizontal_probe]

    padded = image_array("PorcelainBake_Padded")
    raw = image_array("PorcelainBake_Raw")
    padded_mip = box_downsample(padded, 16)
    raw_mip = box_downsample(raw, 16)
    padded_black = float(np.mean(np.max(padded_mip, axis=2) < 0.02))
    raw_black = float(np.mean(np.max(raw_mip, axis=2) < 0.02))

    rendered = {
        name: os.path.exists(os.path.join(ROOT, "artifacts", name))
        for name in (
            "hero_porcelain.png",
            "validation/seam_closeup.png",
            "validation/seam_diagnostic.png",
            "validation/uv_atlas_islands.png",
            "validation/mip_compare.png",
        )
    }
    checks = {
        "uv_map_exists": vase.data.uv_layers.active is not None,
        "uv_four_islands": all(count > 1000 for count in counts),
        "uv_has_mirrored_orientation": all(count > 1000 for count in signs),
        "uv_counts_by_quadrant": counts,
        "uv_winding_signs": signs,
        "stamp_intersects_vertical_seam": max(vertical_alphas) > 0.08,
        "stamp_intersects_horizontal_seam": max(horizontal_alphas) > 0.08,
        "seam_intersection_alpha": stamp_alpha_at(stamp, source, intersection),
        "vertical_seam_alphas": vertical_alphas,
        "horizontal_seam_alphas": horizontal_alphas,
        "padded_mip_near_black_fraction": padded_black,
        "raw_mip_near_black_fraction": raw_black,
        "padding_removes_mip_gutters": raw_black > padded_black + 0.03,
        "rendered_images": rendered,
        "renders_exist": all(rendered.values()),
    }
    checks["all_passed"] = all([
        checks["uv_map_exists"],
        checks["uv_four_islands"],
        checks["uv_has_mirrored_orientation"],
        checks["stamp_intersects_vertical_seam"],
        checks["stamp_intersects_horizontal_seam"],
        checks["padding_removes_mip_gutters"],
        checks["renders_exist"],
    ])
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(checks, fh, indent=2)
    print("CHECKS", json.dumps(checks, indent=2))


if __name__ == "__main__":
    main()
