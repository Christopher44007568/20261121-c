"""Offline environment-map -> 3-band spherical-harmonic baker.

For every texel we integrate radiance L(d) against the SH basis using the
texel's exact solid angle dOmega as the quadrature weight:

    c_lm = sum_texels L(d_texel) * Y_lm(d_texel) * dOmega_texel

Equirect and cubemap inputs share the same core loop; only the direction
grid and the image lookup differ.
"""

import os
import multiprocessing as mp
from concurrent.futures import ProcessPoolExecutor

from .geometry import cubemap_grid, equirect_grid
from .imageio import load
from .sh import N_COEF, basis


def _accumulate(chunk):
    """Worker: integrate a chunk of (direction, solid_angle, rgb) records."""
    acc = [0.0] * (3 * N_COEF)
    weight = 0.0
    for x, y, z, w, r, g, blue in chunk:
        sh_basis = basis((x, y, z))
        weight += w
        for k in range(N_COEF):
            bk = sh_basis[k] * w
            acc[k] += r * bk
            acc[N_COEF + k] += g * bk
            acc[2 * N_COEF + k] += blue * bk
    return acc, weight


def _run(records, workers):
    records = list(records)
    if workers and workers > 1 and len(records) > 4096:
        nchunks = workers * 4
        size = max(1, (len(records) + nchunks - 1) // nchunks)
        chunks = [records[i:i + size] for i in range(0, len(records), size)]
        ctx = mp.get_context("fork")
        with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as pool:
            results = list(pool.map(_accumulate, chunks))
    else:
        results = [_accumulate(records)]
    acc = [0.0] * (3 * N_COEF)
    weight = 0.0
    for a, w in results:
        for i in range(3 * N_COEF):
            acc[i] += a[i]
        weight += w
    coefs = [
        acc[0:N_COEF],
        acc[N_COEF:2 * N_COEF],
        acc[2 * N_COEF:3 * N_COEF],
    ]
    return coefs, weight


def bake_equirect(image, workers=None):
    """Bake an equirectangular Image (2:1) into SH coefficients."""
    if image.width != 2 * image.height:
        raise ValueError(
            f"equirect width must be 2x height, got {image.width}x{image.height}"
        )
    grid = equirect_grid(image.width, image.height)
    width = image.width

    def records():
        for idx, ((x, y, z), w) in enumerate(grid):
            row, col = divmod(idx, width)
            r, g, b = image.rgb(col, row)
            yield (x, y, z, w, r, g, b)

    return _run(records(), workers)


def bake_cubemap(face_images, workers=None):
    """Bake six equal-size square face Images ordered PX,NX,PY,NY,PZ,NZ."""
    size = face_images[0].width
    if any(img.width != size or img.height != size for img in face_images):
        raise ValueError("all cubemap faces must be identical squares")
    grid = list(cubemap_grid(size))
    if len(grid) != 6 * size * size:
        raise AssertionError("cubemap grid size mismatch")

    def records():
        for face in range(6):
            img = face_images[face]
            base = face * size * size
            for tex in range(size * size):
                (x, y, z), w = grid[base + tex]
                row, col = divmod(tex, size)
                r, g, b = img.rgb(col, row)
                yield (x, y, z, w, r, g, b)

    return _run(records(), workers)


def bake_function(grid, color_fn, workers=None):
    """Bake an analytic color function color_fn(d)->(r,g,b) over a grid."""
    def records():
        for d, w in grid:
            r, g, b = color_fn(d)
            yield (d[0], d[1], d[2], w, r, g, b)

    return _run(records(), workers)


def load_cubemap(path, workers=None):
    """Load a horizontal 6-face strip (1x6) or vertical strip (6x1).

    Face order follows the GL cross convention PX, NX, PY, NY, PZ, NZ.
    """
    img = load(path)
    if img.width == 6 * img.height:
        size = img.height
        faces = []
        for face in range(6):
            x0 = face * size
            faces.append(_crop(img, x0, 0, size, size))
    elif img.height == 6 * img.width:
        size = img.width
        faces = [_crop(img, 0, face * size, size, size) for face in range(6)]
    else:
        raise ValueError("cubemap image must be a 6x1 or 1x6 face strip")
    return bake_cubemap(faces, workers)


def load_equirect(path, workers=None):
    return bake_equirect(load(path), workers)


def _crop(img, x0, y0, size, size2):
    from .imageio import Image
    pixels = []
    for row in range(y0, y0 + size2):
        start = (row * img.width + x0) * img.channels
        pixels.extend(img.pixels[start:start + size * img.channels])
    return Image(size, size2, pixels, img.channels)


def default_workers():
    return max(1, (os.cpu_count() or 1))
