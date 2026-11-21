"""Generate the transparent cobalt-scroll stamp used by the acceptance scene."""

import math
import os
import sys

import bpy
import numpy as np


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "artifacts", "textures", "cobalt_diagonal_scroll.png")


def blend(canvas, alpha, color):
    alpha = np.clip(alpha, 0.0, 1.0)[:, :, None]
    old = canvas[:, :, 3:4]
    out_alpha = alpha + old * (1.0 - alpha)
    rgb = (np.asarray(color)[None, None, :] * alpha
           + canvas[:, :, :3] * old * (1.0 - alpha))
    canvas[:, :, :3] = np.divide(rgb, np.maximum(out_alpha, 1.0e-8))
    canvas[:, :, 3:4] = out_alpha


def ellipse_alpha(x, y, cx, cy, rx, ry, angle):
    ca, sa = math.cos(angle), math.sin(angle)
    dx, dy = x - cx, y - cy
    u = ca * dx + sa * dy
    v = -sa * dx + ca * dy
    q = np.sqrt((u / rx) ** 2 + (v / ry) ** 2)
    aa = 1.3 / min(x.shape[1], x.shape[0])
    return np.clip((1.0 - q) / aa + 0.5, 0.0, 1.0)


def thick_curve_alpha(x, y, points, widths):
    distance = np.full(x.shape, 1.0e9, dtype=np.float64)
    for index in range(len(points) - 1):
        ax, ay = points[index]
        bx, by = points[index + 1]
        dx, dy = bx - ax, by - ay
        denom = dx * dx + dy * dy
        t = np.clip(((x - ax) * dx + (y - ay) * dy) / denom, 0.0, 1.0)
        d = np.hypot(x - (ax + t * dx), y - (ay + t * dy))
        width = widths[index] * (1.0 - t) + widths[index + 1] * t
        distance = np.minimum(distance, d - width)
    aa = 1.2 / min(x.shape[1], x.shape[0])
    return np.clip(-distance / aa + 0.5, 0.0, 1.0)


def flower(canvas, x, y, cx, cy, scale, rotation):
    dark = (0.004, 0.025, 0.17)
    blue = (0.008, 0.075, 0.48)
    light = (0.05, 0.24, 0.72)
    center = (0.82, 0.68, 0.30)
    for petal in range(5):
        angle = rotation + petal * math.tau / 5.0
        px = cx + math.cos(angle) * scale * 0.052
        py = cy + math.sin(angle) * scale * 0.052
        alpha = ellipse_alpha(x, y, px, py, scale * 0.057, scale * 0.030,
                              angle + math.pi * 0.12)
        blend(canvas, alpha * 0.58, blue)
        inner = ellipse_alpha(x, y, px, py, scale * 0.046, scale * 0.022,
                              angle + math.pi * 0.12)
        blend(canvas, inner * 0.95, light)
    blend(canvas, ellipse_alpha(x, y, cx, cy, scale * 0.024, scale * 0.024, 0.0),
          dark)
    blend(canvas, ellipse_alpha(x, y, cx, cy, scale * 0.014, scale * 0.014, 0.0),
          center)


def make_stamp(size_x=640, size_y=960):
    yy, xx = np.mgrid[0:size_y, 0:size_x]
    x = xx / (size_x - 1)
    y = yy / (size_y - 1)
    canvas = np.zeros((size_y, size_x, 4), dtype=np.float64)

    t = np.linspace(0.0, 1.0, 72)
    vine_x = 0.17 + 0.64 * t + 0.075 * np.sin(math.tau * t + 0.5)
    vine_y = 0.04 + 0.92 * t
    points = list(zip(vine_x, vine_y))
    widths = 0.008 + 0.008 * np.sin(np.pi * t) ** 2

    outer = thick_curve_alpha(x, y, points, widths * 1.9)
    inner = thick_curve_alpha(x, y, points, widths)
    blend(canvas, outer, (0.003, 0.018, 0.13))
    blend(canvas, inner, (0.008, 0.072, 0.45))
    highlight = thick_curve_alpha(
        x, y,
        [(px - 0.002, py + 0.003) for px, py in points],
        widths * 0.22,
    )
    blend(canvas, highlight * 0.55, (0.18, 0.40, 0.83))

    leaf_specs = [
        (0.16, 0.16, math.radians(-118), 1.0),
        (0.25, 0.25, math.radians(58), 1.15),
        (0.35, 0.36, math.radians(-125), 0.9),
        (0.47, 0.45, math.radians(62), 1.25),
        (0.59, 0.55, math.radians(-118), 1.05),
        (0.69, 0.66, math.radians(55), 0.9),
        (0.78, 0.76, math.radians(-121), 1.15),
        (0.87, 0.87, math.radians(58), 0.95),
    ]
    for tx, ty, angle, scale in leaf_specs:
        center_x = tx + math.cos(angle) * 0.045
        center_y = ty + math.sin(angle) * 0.045
        leaf = ellipse_alpha(x, y, center_x, center_y,
                             scale * 0.060, scale * 0.022, angle)
        blend(canvas, leaf, (0.006, 0.055, 0.38))
        vein = ellipse_alpha(x, y, center_x, center_y,
                             scale * 0.044, scale * 0.004, angle)
        blend(canvas, vein * 0.7, (0.16, 0.38, 0.76))

    flower(canvas, x, y, 0.31, 0.31, 1.15, 0.2)
    flower(canvas, x, y, 0.58, 0.53, 1.05, 0.9)
    flower(canvas, x, y, 0.82, 0.80, 0.88, 0.4)
    return canvas


def save_rgba(path, rgba):
    image = bpy.data.images.get("CobaltDiagonalScroll")
    if image is not None:
        bpy.data.images.remove(image)
    image = bpy.data.images.new(
        "CobaltDiagonalScroll",
        width=rgba.shape[1],
        height=rgba.shape[0],
        alpha=True,
    )
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(rgba.astype(np.float32).ravel())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.file_format = "PNG"
    image.filepath_raw = path
    image.save()
    return image


if __name__ == "__main__":
    stamp = make_stamp()
    save_rgba(OUT, stamp)
    print("STAMP", OUT, stamp.shape, float(stamp[:, :, 3].mean()))
