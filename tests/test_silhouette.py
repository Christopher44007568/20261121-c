"""Tests for the software silhouette renderer and deviation metrics."""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from qem_simplify.io import build_mesh
from qem_simplify.silhouette import (camera_frame, compare_masks,
                                     render_silhouette)


def square_plate(size=2.0, z=0.0):
    h = size / 2
    verts = [[-h, -h, z], [h, -h, z], [h, h, z], [-h, h, z]]
    faces = [[0, 1, 2], [0, 2, 3]]
    uv = [[0, 0]] * 4
    return build_mesh(verts, uv, faces, [0, 0], [0, 0], ["m"], ["p"])


class TestSilhouette(unittest.TestCase):
    def test_camera_frames_orthonormal(self):
        for name in ("+z", "-z", "+x", "+y", "iso"):
            f, r, u = camera_frame(name)
            self.assertAlmostEqual(np.linalg.norm(f), 1.0)
            self.assertAlmostEqual(np.linalg.norm(r), 1.0)
            self.assertAlmostEqual(abs(np.dot(r, u)), 0.0)

    def test_self_comparison_is_perfect(self):
        mesh = square_plate()
        mask, ps = render_silhouette(mesh, "+z", 128)
        stats = compare_masks(mask, mask, ps)
        self.assertAlmostEqual(stats["iou"], 1.0)
        self.assertEqual(stats["symmetric_diff_pixels"], 0)
        self.assertEqual(stats["mean_contour_distance"], 0.0)

    def test_smaller_plate_lowers_iou(self):
        big = square_plate(2.0)
        small = square_plate(1.0)
        from qem_simplify.silhouette import camera_frame, shared_frame
        f, r, u = camera_frame("+z")
        frame = shared_frame(big, f, r, u)
        mb, ps = render_silhouette(big, "+z", 128, frame)
        ms, _ = render_silhouette(small, "+z", 128, frame)
        stats = compare_masks(mb, ms, ps)
        self.assertLess(stats["iou"], 0.95)
        self.assertGreater(stats["symmetric_diff_pixels"], 0)

    def test_holes_produce_interior_background(self):
        # the two thin holes appear as background connected components that
        # do not touch the image border (i.e. they are fully enclosed)
        from collections import deque
        from qem_simplify.generate import build_test_mesh
        mesh = build_test_mesh()
        mask, _ = render_silhouette(mesh, "+z", 300)
        bg = ~mask
        h, w = bg.shape
        seen = np.zeros_like(bg)
        enclosed = 0
        for y in range(h):
            for x in range(w):
                if not bg[y, x] or seen[y, x]:
                    continue
                q = deque([(y, x)])
                seen[y, x] = True
                touches_border, size = False, 0
                while q:
                    cy, cx = q.popleft()
                    size += 1
                    if cy in (0, h - 1) or cx in (0, w - 1):
                        touches_border = True
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] \
                                and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
                if not touches_border:
                    enclosed += size
        self.assertGreater(enclosed, 50)


if __name__ == "__main__":
    unittest.main(verbosity=2)
