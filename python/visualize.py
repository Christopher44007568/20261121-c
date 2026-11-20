"""Render the exported scan grids to PNG depth maps (pure stdlib).
Usage: python3 python/visualize.py [artifacts_dir]
Outputs next to the CSVs: depth_echo1.png, depth_echo2.png,
contrib_echo1.png, contrib_echo2.png, classes.png
"""

import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_grid, load_grid_int


def write_png(path, pixels):
    """pixels: rows of (r, g, b) tuples, top row first."""
    rows = len(pixels)
    cols = len(pixels[0])
    raw = b"".join(
        b"\x00" + b"".join(bytes(px) for px in row) for row in pixels
    )

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", cols, rows, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def depth_color(v, vmin, vmax):
    """Blue (near) -> cyan -> green -> yellow -> red (far)."""
    t = 0.0 if vmax <= vmin else (v - vmin) / (vmax - vmin)
    t = max(0.0, min(1.0, t))
    r = int(255 * max(0.0, min(1.0, 1.5 * t - 0.25)))
    g = int(255 * max(0.0, min(1.0, 1.5 - abs(2.0 * t - 1.0) * 1.5)))
    b = int(255 * max(0.0, min(1.0, 1.25 - 1.5 * t)))
    return (r, g, b)


def render_scalar(grid, path, clip=None):
    vals = [v for row in grid for v in row if not math.isnan(v)]
    if not vals:
        return
    lo, hi = min(vals), max(vals)
    if clip:
        lo, hi = clip
    pixels = []
    for row in reversed(grid):  # elevation row 0 at the bottom
        pixels.append([
            (16, 16, 16) if math.isnan(v) else depth_color(v, lo, hi)
            for v in row
        ])
    write_png(path, pixels)
    print(f"{path}  range [{lo:.4f}, {hi:.4f}]")


def render_classes(geom1, geom2, path):
    palette = {
        0: (10, 10, 10),      # no return
        1: (60, 200, 90),     # front plate only (single echo)
        2: (70, 110, 230),    # back plate only (front missed)
        3: (240, 160, 40),    # two echoes: front + back
    }
    pixels = []
    for r in reversed(range(len(geom1))):
        row = []
        for c in range(len(geom1[0])):
            g1, g2 = geom1[r][c], geom2[r][c]
            if g1 < 0:
                cls = 0
            elif g2 >= 0:
                cls = 3
            else:
                cls = 1 if g1 == 0 else 2
            row.append(palette[cls])
        pixels.append(row)
    write_png(path, pixels)
    print(f"{path}  classes: black=miss green=front-only blue=back-only orange=two-echo")


def main():
    artifacts = sys.argv[1] if len(sys.argv) > 1 else "artifacts"
    depth1 = load_grid(os.path.join(artifacts, "depth_echo1.csv"))
    depth2 = load_grid(os.path.join(artifacts, "depth_echo2.csv"))
    contrib1 = load_grid(os.path.join(artifacts, "contrib_echo1.csv"))
    contrib2 = load_grid(os.path.join(artifacts, "contrib_echo2.csv"))
    geom1 = load_grid_int(os.path.join(artifacts, "geom_echo1.csv"))
    geom2 = load_grid_int(os.path.join(artifacts, "geom_echo2.csv"))

    render_scalar(depth1, os.path.join(artifacts, "depth_echo1.png"))
    render_scalar(depth2, os.path.join(artifacts, "depth_echo2.png"))
    render_scalar(contrib1, os.path.join(artifacts, "contrib_echo1.png"))
    render_scalar(contrib2, os.path.join(artifacts, "contrib_echo2.png"))
    render_classes(geom1, geom2, os.path.join(artifacts, "classes.png"))


if __name__ == "__main__":
    main()
