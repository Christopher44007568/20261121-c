"""Silhouette deviation measured from specified camera directions.

Each mesh is rendered from a camera with an orthographic projection using a
pure-numpy triangle rasterizer (no GPU/display required).  The filled
silhouette masks are compared with:
  * symmetric difference area (pixels) and IoU
  * mean symmetric contour distance, in model-space units
Cameras are given as view directions in model space, e.g. ["+z", "+x",
"iso"]; the orthographic frame is built from the direction and an up hint.
"""

from __future__ import annotations

import numpy as np


def camera_frame(direction: str):
    d = direction.lower().strip()
    presets = {
        "+z": (0, 0, 1), "-z": (0, 0, -1),
        "+x": (1, 0, 0), "-x": (-1, 0, 0),
        "+y": (0, 1, 0), "-y": (0, -1, 0),
        "iso": (1, 1, 1),
    }
    if d not in presets:
        raise ValueError(f"unknown camera {direction}")
    forward = np.array(presets[d], dtype=float)
    forward /= np.linalg.norm(forward)
    up_hint = np.array([0, 0, 1.0])
    if abs(forward @ up_hint) > 0.95:
        up_hint = np.array([0, 1.0, 0])
    right = np.cross(up_hint, forward)
    right /= np.linalg.norm(right)
    up = np.cross(forward, right)
    return forward, right, up


def render_silhouette(mesh, direction: str, resolution: int = 256,
                      frame=None):
    forward, right, up = camera_frame(direction)
    if frame is None:
        frame = shared_frame(mesh, forward, right, up)
    center, half = frame
    pts = mesh.positions - center
    sx, sy, depth = pts @ right, pts @ up, pts @ forward
    extent = 2 * half / 0.55
    scale = (resolution - 1) / (2 * half)
    px = (sx + half) * scale
    py = (sy + half) * scale
    zbuf = np.full((resolution, resolution), np.inf)
    mask = np.zeros((resolution, resolution), dtype=bool)
    alive = np.where(mesh.face_alive)[0]
    for fid in alive:
        i, j, k = mesh.faces[fid]
        tri = np.array([[px[i], py[i], depth[i]],
                        [px[j], py[j], depth[j]],
                        [px[k], py[k], depth[k]]])
        _raster_triangle(tri, mask, zbuf)
    return mask, extent / resolution


def shared_frame(mesh, forward, right, up):
    """Common center/half-extent so different LODs use one projection."""
    lo, hi = mesh.bbox()
    center = 0.5 * (lo + hi)
    extent = float(np.max(hi - lo))
    return center, extent * 0.55


def _raster_triangle(tri, mask, zbuf):
    res = mask.shape[0]
    xmin = max(0, int(np.floor(tri[:, 0].min())))
    xmax = min(res - 1, int(np.ceil(tri[:, 0].max())))
    ymin = max(0, int(np.floor(tri[:, 1].min())))
    ymax = min(res - 1, int(np.ceil(tri[:, 1].max())))
    (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = tri
    denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if abs(denom) < 1e-12:
        return
    for y in range(ymin, ymax + 1):
        for x in range(xmin, xmax + 1):
            w0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / denom
            w1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / denom
            w2 = 1 - w0 - w1
            if w0 >= 0 and w1 >= 0 and w2 >= 0:
                z = w0 * z0 + w1 * z1 + w2 * z2
                if z < zbuf[y, x]:
                    zbuf[y, x] = z
                    mask[y, x] = True


def _edge_pixels(mask):
    """Contour pixels of a filled binary mask via 4-neighborhood erosion."""
    padded = np.pad(mask, 1, constant_values=False)
    eroded = (padded[1:-1, 1:-1] & padded[:-2, 1:-1] & padded[2:, 1:-1]
              & padded[1:-1, :-2] & padded[1:-1, 2:])
    return mask & ~eroded


def compare_masks(ref_mask, lod_mask, pixel_size):
    diff = np.logical_xor(ref_mask, lod_mask)
    union = np.logical_or(ref_mask, lod_mask)
    iou = (np.logical_and(ref_mask, lod_mask).sum()
           / max(1, union.sum()))
    ref_edge = _edge_pixels(ref_mask)
    lod_edge = _edge_pixels(lod_mask)
    # symmetric mean contour distance via brute-force nearest pixel
    def mean_dist(src, dst):
        if not src.any() or not dst.any():
            return float("inf")
        sy, sx = np.nonzero(src)
        dy, dx = np.nonzero(dst)
        # chunk to keep memory bounded
        best = np.full(sx.size, np.inf)
        for start in range(0, sx.size, 256):
            chunk_x = sx[start:start + 256, None]
            chunk_y = sy[start:start + 256, None]
            d2 = (chunk_x - dx[None, :]) ** 2 + (chunk_y - dy[None, :]) ** 2
            best[start:start + 256] = d2.min(axis=1)
        return float(np.sqrt(best).mean()) * pixel_size
    d_ref = mean_dist(ref_edge, lod_edge)
    d_lod = mean_dist(lod_edge, ref_edge)
    return {
        "iou": float(iou),
        "symmetric_diff_pixels": int(diff.sum()),
        "symmetric_diff_area": float(diff.sum() * pixel_size ** 2),
        "mean_contour_distance": float(0.5 * (d_ref + d_lod)),
        "ref_contour_pixels": int(ref_edge.sum()),
        "lod_contour_pixels": int(lod_edge.sum()),
    }


def measure_lod(reference_mesh, lod_mesh, directions, resolution=256):
    rows = []
    ref_cache = {}
    for direction in directions:
        forward, right, up = camera_frame(direction)
        # both meshes must share one orthographic frame and pixel scale,
        # otherwise a smaller mesh would be normalized to the same size
        frame = shared_frame(reference_mesh, forward, right, up)
        ref_mask, ps = render_silhouette(
            reference_mesh, direction, resolution, frame)
        ref_cache[direction] = (ref_mask, ps)
        lod_mask, _ = render_silhouette(
            lod_mesh, direction, resolution, frame)
        stats = compare_masks(ref_mask, lod_mask, ps)
        stats["camera"] = direction
        stats["pixel_size"] = float(ps)
        rows.append(stats)
    return rows
