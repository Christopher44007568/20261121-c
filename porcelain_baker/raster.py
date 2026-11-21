"""UV triangle rasterization and seam-safe texture padding."""

import numpy as np


def rasterize_uv(mesh, size):
    """Rasterize mesh surface attributes into a square UV atlas.

    Returns coverage, object-space positions and smooth normals. The baker
    evaluates stamps from these surface samples, so mirrored islands receive
    the exact same decoration values at the same 3D location.
    """
    coverage = np.zeros((size, size), dtype=bool)
    position = np.zeros((size, size, 3), dtype=np.float32)
    normal = np.zeros((size, size, 3), dtype=np.float32)
    uv_data = mesh.uv_layers.active.data
    mesh.calc_loop_triangles()

    for tri in mesh.loop_triangles:
        loops = list(tri.loops)
        uv = np.asarray([uv_data[i].uv[:] for i in loops], dtype=np.float64)
        pix = uv * size
        x_min = max(0, int(np.floor(pix[:, 0].min())) - 1)
        x_max = min(size, int(np.ceil(pix[:, 0].max())) + 1)
        y_min = max(0, int(np.floor(pix[:, 1].min())) - 1)
        y_max = min(size, int(np.ceil(pix[:, 1].max())) + 1)
        if x_max <= x_min or y_max <= y_min:
            continue

        ax, ay = pix[0]
        bx, by = pix[1]
        cx, cy = pix[2]
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1.0e-12:
            continue

        xs = np.arange(x_min, x_max, dtype=np.float64) + 0.5
        ys = np.arange(y_min, y_max, dtype=np.float64) + 0.5
        gx, gy = np.meshgrid(xs, ys)
        w0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / det
        w1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / det
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -1.0e-7) & (w1 >= -1.0e-7) & (w2 >= -1.0e-7)
        if not inside.any():
            continue

        verts = [mesh.vertices[i].co[:] for i in tri.vertices]
        norms = [mesh.vertices[i].normal[:] for i in tri.vertices]
        pos = (
            w0[inside, None] * np.asarray(verts[0], dtype=np.float64)
            + w1[inside, None] * np.asarray(verts[1], dtype=np.float64)
            + w2[inside, None] * np.asarray(verts[2], dtype=np.float64)
        )
        nrm = (
            w0[inside, None] * np.asarray(norms[0], dtype=np.float64)
            + w1[inside, None] * np.asarray(norms[1], dtype=np.float64)
            + w2[inside, None] * np.asarray(norms[2], dtype=np.float64)
        )
        lengths = np.linalg.norm(nrm, axis=1, keepdims=True)
        nrm /= np.maximum(lengths, 1.0e-12)

        iy, ix = np.nonzero(inside)
        ix += x_min
        iy += y_min
        coverage[iy, ix] = True
        position[iy, ix] = pos
        normal[iy, ix] = nrm
    return coverage, position, normal


def pad_texture(color, coverage, pixels):
    """Dilate island colors outward by `pixels` texels.

    This is the texture-space half of seam handling. Together with 3D surface
    sampling it keeps both the visible border and lower mip levels continuous.
    """
    if pixels <= 0:
        return color.copy()
    out = color.copy()
    filled = coverage.copy()
    size_y, size_x = coverage.shape
    for _ in range(int(pixels)):
        up = np.zeros_like(out)
        down = np.zeros_like(out)
        left = np.zeros_like(out)
        right = np.zeros_like(out)
        up[1:] = out[:-1]
        down[:-1] = out[1:]
        left[:, 1:] = out[:, :-1]
        right[:, :-1] = out[:, 1:]
        count = np.zeros((size_y, size_x, 1), dtype=np.int8)
        count[1:] += filled[:-1, :, None]
        count[:-1] += filled[1:, :, None]
        count[:, 1:] += filled[:, :-1, None]
        count[:, :-1] += filled[:, 1:, None]
        neigh_sum = up + down + left + right
        grow = (~filled) & (count[:, :, 0] > 0)
        out[grow] = neigh_sum[grow] / count[grow]
        filled |= grow
        if not grow.any():
            break
    out[~filled] = 0.0
    return out
