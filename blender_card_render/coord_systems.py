"""Coordinate-system normalization for imported CAD parts.

Parts may arrive in Z-up (Blender, STEP-ish), Y-up (glTF/3ds), or with a fully
custom axis map. Everything is converted into Blender's world frame:
X right, Y forward, Z up.
"""

from __future__ import annotations

from .frame_math import Vec3


UP_AXIS_ROTATION = {
    # (target up axis, target forward axis) -> Euler degrees applied on import
    "Z_UP": (0.0, 0.0, 0.0),
    "Y_UP": (90.0, 0.0, 0.0),
    "X_UP": (0.0, -90.0, 0.0),
}


def axis_map_rotation(src_right: str, src_forward: str, src_up: str) -> Vec3:
    """Build a 3x3 rotation matrix (row-major) from named source axes.

    Axis names are ``+X``/``-X`` etc. Row i of the matrix is the source axis
    that maps onto world axis i. Only axis-permuting (right-handed) maps are
    expected; the sign is encoded in the axis name.
    """
    vectors = {
        "+X": (1.0, 0.0, 0.0),
        "-X": (-1.0, 0.0, 0.0),
        "+Y": (0.0, 1.0, 0.0),
        "-Y": (0.0, -1.0, 0.0),
        "+Z": (0.0, 0.0, 1.0),
        "-Z": (0.0, 0.0, -1.0),
    }
    for name in (src_right, src_forward, src_up):
        if name not in vectors:
            raise ValueError(f"unknown axis {name!r}; use +X/-X/+Y/-Y/+Z/-Z")
    # World basis expressed in source coordinates.
    return (vectors[src_right], vectors[src_forward], vectors[src_up])


def apply_axis_map(point: Vec3, matrix: tuple[Vec3, Vec3, Vec3]) -> Vec3:
    return (
        sum(matrix[0][j] * point[j] for j in range(3)),
        sum(matrix[1][j] * point[j] for j in range(3)),
        sum(matrix[2][j] * point[j] for j in range(3)),
    )


def measured_alpha_margins(
    alpha: list[float], width: int, height: int, threshold: float = 0.5
) -> dict | None:
    """Scan a linear alpha buffer (bottom-up, one channel) for silhouette bbox.

    Returns pixel whitespace on every edge plus the silhouette size in pixels,
    or None when nothing passes the threshold.
    """
    min_x, max_x, min_y, max_y = width, -1, height, -1
    for y in range(height):
        row = y * width
        for x in range(width):
            if alpha[row + x] > threshold:
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
    if max_x < 0:
        return None
    return {
        "left": min_x,
        "right": width - 1 - max_x,
        "bottom": min_y,
        "top": height - 1 - max_y,
        "silhouette_px": [max_x - min_x + 1, max_y - min_y + 1],
    }
