import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from blender_card_render.frame_math import (  # noqa: E402
    VIEW_LIBRARY,
    bbox_corners,
    bbox_of_points,
    camera_basis,
    cross,
    dot,
    fit_orthographic,
    normalize,
    shared_ortho_scale,
    sub,
)
from blender_card_render.coord_systems import (  # noqa: E402
    apply_axis_map,
    axis_map_rotation,
    measured_alpha_margins,
)


class CameraBasisTests(unittest.TestCase):
    def test_right_handed_camera_axes(self):
        for name, (view_dir, up_hint) in VIEW_LIBRARY.items():
            with self.subTest(view=name):
                d, right, up = camera_basis(view_dir, up_hint)
                handed = cross(right, up)
                for got, want in zip(handed, tuple(-v for v in d)):
                    self.assertAlmostEqual(got, want, places=9)
                self.assertAlmostEqual(dot(right, up), 0.0, places=9)

    def test_front_view_looks_along_negative_y(self):
        d, right, up = camera_basis(*VIEW_LIBRARY["front"])
        self.assertEqual(tuple(round(v, 6) for v in d), (0.0, -1.0, 0.0))
        self.assertEqual(tuple(round(v, 6) for v in right), (-1.0, 0.0, 0.0))
        self.assertEqual(tuple(round(v, 6) for v in up), (0.0, 0.0, 1.0))


class FramingTests(unittest.TestCase):
    def setUp(self):
        # Slender 10 x 0.4 x 0.4 bar centered on origin.
        self.bar = [(-5.0, -0.2, -0.2), (5.0, 0.2, 0.2)]
        self.lo, self.hi = bbox_of_points(self.bar)
        self.corners = bbox_corners(self.lo, self.hi)

    def test_front_view_preserves_aspect_and_margin(self):
        width = height = 1000
        margin = 0.1
        framing = fit_orthographic(
            "front", *VIEW_LIBRARY["front"], self.corners, width, height, margin
        )
        # Horizontal bar dominates: usable 80% holds 10 world units.
        self.assertAlmostEqual(framing.world_width, 12.5, places=6)
        self.assertAlmostEqual(framing.world_height, 12.5, places=6)
        self.assertAlmostEqual(framing.px_left, 100.0, places=4)
        self.assertAlmostEqual(framing.px_right, 100.0, places=4)
        self.assertGreater(framing.px_top, 400.0)
        self.assertGreater(framing.px_bottom, 400.0)

    def test_far_away_attachment_stays_inside_frame(self):
        # Tiny attachment flying 40 units off the part origin.
        points = self.corners + [
            (44.9, 9.9, -0.1),
            (45.1, 10.1, 0.1),
        ]
        framing = fit_orthographic(
            "front", *VIEW_LIBRARY["front"], points, 800, 600, 0.05
        )
        for side in ("px_left", "px_right", "px_top", "px_bottom"):
            self.assertGreaterEqual(getattr(framing, side), 0.0)
        # Frame must span at least the 50-unit X extent plus margin.
        self.assertGreaterEqual(framing.world_width, 50.0 / 0.9)

    def test_origin_offset_does_not_shift_framing(self):
        offset = [(x + 123.0, y - 77.0, z + 9.0) for (x, y, z) in self.corners]
        base = fit_orthographic(
            "front", *VIEW_LIBRARY["front"], self.corners, 512, 512, 0.08
        )
        shifted = fit_orthographic(
            "front", *VIEW_LIBRARY["front"], offset, 512, 512, 0.08
        )
        self.assertAlmostEqual(base.ortho_scale, shifted.ortho_scale, places=6)
        self.assertAlmostEqual(base.px_left, shifted.px_left, places=4)

    def test_shared_scale_keeps_equal_pixels_per_unit(self):
        specs = [
            ("front", *VIEW_LIBRARY["front"]),
            ("right", *VIEW_LIBRARY["right"]),
            ("top", *VIEW_LIBRARY["top"]),
        ]
        scale = shared_ortho_scale(specs, self.corners, 1024, 1024, 0.08)
        for name, view_dir, up_hint in specs:
            framing = fit_orthographic(
                name, view_dir, up_hint, self.corners,
                1024, 1024, 0.08, fixed_ortho_scale=scale,
            )
            self.assertAlmostEqual(
                framing.pixels_per_unit, 1024.0 / scale, places=6
            )

    def test_clip_range_contains_geometry(self):
        framing = fit_orthographic(
            "iso", *VIEW_LIBRARY["iso"], self.corners, 1024, 1024, 0.08
        )
        self.assertGreater(framing.far, framing.near)
        self.assertGreater(framing.near, 0.0)


class CoordinateSystemTests(unittest.TestCase):
    def test_y_up_conversion(self):
        matrix = axis_map_rotation("+X", "-Z", "+Y")
        # Source +Y (up in glTF style) lands on world +Z.
        self.assertEqual(
            apply_axis_map((0.0, 1.0, 0.0), matrix), (0.0, 0.0, 1.0)
        )
        # Source +Z (glTF forward) lands on world -Y.
        self.assertEqual(
            apply_axis_map((0.0, 0.0, 1.0), matrix), (0.0, -1.0, 0.0)
        )

    def test_measured_alpha_margins(self):
        w = h = 10
        alpha = [0.0] * (w * h)
        for y in range(2, 8):
            for x in range(3, 7):
                alpha[y * w + x] = 1.0
        margins = measured_alpha_margins(alpha, w, h)
        self.assertEqual(margins["left"], 3)
        self.assertEqual(margins["right"], 3)
        self.assertEqual(margins["bottom"], 2)
        self.assertEqual(margins["top"], 2)
        self.assertEqual(margins["silhouette_px"], [4, 6])


if __name__ == "__main__":
    unittest.main()
