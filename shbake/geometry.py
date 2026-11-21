"""Direction grids and per-texel solid angles for equirect and cubemap.

Coordinate convention: right-handed, +z is up, +x is forward/right reference,
y completes the frame.  Equirectangular maps longitude phi (around z) and
latitude theta (from +z).  Cubemap faces use the standard GL cross ordering
PX, NX, PY, NY, PZ, NZ with a right-handed per-face basis.
"""

import math

from .sh import PI


def normalize(v):
    n = math.sqrt(sum(c * c for c in v))
    return (v[0] / n, v[1] / n, v[2] / n)


def _quad_solid_angle(corners):
    """Solid angle of a spherical quad given 4 unit corner vectors.

    Van Oosterom / St-Pierre formula: split the quad into two triangles and
    sum |atan2(dot(a, cross(b,c)), 1 + a.b + b.c + c.a)| for each triangle.
    Exact (not the planar/1-cos approximation) for a texel on the cube.
    """
    def tri(a, b, c):
        bc = (
            b[1] * c[2] - b[2] * c[1],
            b[2] * c[0] - b[0] * c[2],
            b[0] * c[1] - b[1] * c[0],
        )
        num = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2]
        den = (
            1.0
            + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
            + b[0] * c[0] + b[1] * c[1] + b[2] * c[2]
            + c[0] * a[0] + c[1] * a[1] + c[2] * a[2]
        )
        return abs(2.0 * math.atan2(num, den))

    # Corners arrive in screen order (top-left, top-right, bottom-right,
    # bottom-left).  Split on the a-c diagonal.  The two triangles sit on
    # opposite sides of the diagonal, so their raw windings differ and the
    # absolute value of each signed angle is summed.
    a, b, c, d = corners
    return tri(a, b, c) + tri(a, d, c)


# Each face: (origin direction, right axis, up axis).
# Rows of the image run top->bottom, so the texture `up` basis points toward
# the top edge of the face.  Frame (right, up, origin) is right-handed.
CUBE_FACES = (
    ("+x", (1, 0, 0), (0, 0, 1), (0, -1, 0)),
    ("-x", (-1, 0, 0), (0, 0, -1), (0, -1, 0)),
    ("+y", (0, 1, 0), (1, 0, 0), (0, 0, 1)),
    ("-y", (0, -1, 0), (1, 0, 0), (0, 0, -1)),
    ("+z", (0, 0, 1), (1, 0, 0), (0, -1, 0)),
    ("-z", (0, 0, -1), (-1, 0, 0), (0, -1, 0)),
)


def _cube_corner(origin, right, up, su, sv):
    return normalize((
        origin[0] + su * right[0] + sv * up[0],
        origin[1] + su * right[1] + sv * up[1],
        origin[2] + su * right[2] + sv * up[2],
    ))


def cubemap_grid(face_size):
    """Yield (direction, solid_angle) for every texel of a 6-face cubemap."""
    scale = 1.0 / face_size
    for _name, origin, right, up in CUBE_FACES:
        for row in range(face_size):
            v = 1.0 - (2.0 * row + 1.0) * scale  # +1 at top row ... -1 bottom
            v_top = 1.0 - (2.0 * row) * scale
            v_bottom = 1.0 - (2.0 * (row + 1)) * scale
            for col in range(face_size):
                u = (2.0 * col + 1.0) * scale - 1.0
                u_left = (2.0 * col) * scale - 1.0
                u_right = (2.0 * (col + 1)) * scale - 1.0
                d = normalize((
                    origin[0] + u * right[0] + v * up[0],
                    origin[1] + u * right[1] + v * up[1],
                    origin[2] + u * right[2] + v * up[2],
                ))
                corners = (
                    _cube_corner(origin, right, up, u_left, v_top),
                    _cube_corner(origin, right, up, u_right, v_top),
                    _cube_corner(origin, right, up, u_right, v_bottom),
                    _cube_corner(origin, right, up, u_left, v_bottom),
                )
                yield d, _quad_solid_angle(corners)


def equirect_grid(width, height):
    """Yield (direction, solid_angle) for every texel of an equirect map.

    Exact spherical-rectangle area sin(theta_north)-sin(theta_south) times
    the longitude span; texel centers sit at cell centers.
    """
    dphi = 2.0 * PI / width
    dtheta = PI / height
    for row in range(height):
        theta = (row + 0.5) * dtheta  # 0 at north pole (+z) ... pi at south
        sin_theta = math.sin(theta)
        cos_theta = math.cos(theta)
        solid = dphi * (
            math.cos(theta - 0.5 * dtheta) - math.cos(theta + 0.5 * dtheta)
        )
        for col in range(width):
            phi = (col + 0.5) * dphi
            d = (
                sin_theta * math.cos(phi),
                sin_theta * math.sin(phi),
                cos_theta,
            )
            yield d, solid


def total_solid_angle(grid):
    return sum(item[1] for item in grid)
