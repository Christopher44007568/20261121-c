"""Procedural validation scenes and their rasterization to env maps."""

import math

from .geometry import CUBE_FACES, normalize
from .imageio import Image


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def make_constant(color):
    """Everywhere-constant sky; exact zonal energy reference."""
    def fn(d):
        return tuple(color)
    fn.name = "constant"
    return fn


def make_spot(axis, half_angle, color):
    """Hard-edged uniform cone (directional spot) around `axis`."""
    axis = normalize(axis)
    threshold = math.cos(half_angle)

    def fn(d):
        return tuple(color) if dot(d, axis) >= threshold else (0.0, 0.0, 0.0)
    fn.name = "spot"
    fn.axis = axis
    fn.half_angle = half_angle
    fn.color = tuple(color)
    return fn


def make_hemisphere(top, bottom):
    """Different constant colors above and below the z=0 horizon."""
    def fn(d):
        return tuple(top) if d[2] >= 0.0 else tuple(bottom)
    fn.name = "hemisphere"
    fn.top = tuple(top)
    fn.bottom = tuple(bottom)
    return fn


def make_soft_spot(axis, exponent, color):
    """Smooth directional spot: radiance = color * max(dot,0)^exponent.

    Smooth (no hard edge), so quadrature converges cleanly and an analytic
    zonal-harmonic reference is available in closed form.
    """
    axis = normalize(axis)

    def fn(d):
        mu = max(0.0, dot(d, axis))
        v = mu ** exponent
        return (color[0] * v, color[1] * v, color[2] * v)
    fn.name = "soft_spot"
    fn.axis = axis
    fn.exponent = exponent
    fn.color = tuple(color)
    return fn


SCENES = {
    "constant": lambda: make_constant((0.6, 0.6, 0.6)),
    "spot": lambda: make_spot(normalize((0.5, 0.3, 0.8)), math.radians(10.0),
                              (1.0, 0.25, 0.1)),
    "soft_spot": lambda: make_soft_spot(normalize((0.5, 0.3, 0.8)), 16.0,
                                        (0.9, 0.4, 0.2)),
    "hemisphere": lambda: make_hemisphere((0.8, 0.2, 0.15), (0.1, 0.25, 0.7)),
}


def rasterize_equirect(fn, width, height):
    from .geometry import equirect_grid
    pixels = [0.0] * (width * height * 3)
    for idx, (d, _w) in enumerate(equirect_grid(width, height)):
        r, g, b = fn(d)
        pixels[idx * 3:idx * 3 + 3] = [r, g, b]
    return Image(width, height, pixels, 3)


def rasterize_cubemap(fn, size):
    """Return six square face Images in PX,NX,PY,NY,PZ,NZ order."""
    faces = []
    for _name, origin, right, up in CUBE_FACES:
        pixels = [0.0] * (size * size * 3)
        i = 0
        for row in range(size):
            v = 1.0 - (2.0 * row + 1.0) / size
            for col in range(size):
                u = (2.0 * col + 1.0) / size - 1.0
                d = normalize((
                    origin[0] + u * right[0] + v * up[0],
                    origin[1] + u * right[1] + v * up[1],
                    origin[2] + u * right[2] + v * up[2],
                ))
                r, g, b = fn(d)
                pixels[i:i + 3] = [r, g, b]
                i += 3
        faces.append(Image(size, size, pixels, 3))
    return faces


def cubemap_strip(faces):
    """Pack six faces into a horizontal 6x1 RGB strip image."""
    size = faces[0].width
    out = Image(size * 6, size, [0.0] * (size * 6 * size * 3), 3)
    for face, img in enumerate(faces):
        for row in range(size):
            src = row * size * 3
            dst = (row * size * 6 + face * size) * 3
            out.pixels[dst:dst + size * 3] = img.pixels[src:src + size * 3]
    return out
