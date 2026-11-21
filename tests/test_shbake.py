"""Unit tests for the SH math, geometry, and analytic references.

Run:  PYTHONPATH=. python3 -m unittest tests.test_shbake -v
"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shbake import bake, scenes, sh, validate
from shbake.geometry import (
    cubemap_grid,
    equirect_grid,
    normalize,
    total_solid_angle,
)

FOUR_PI = 4.0 * math.pi


class TestQuadrature(unittest.TestCase):
    def test_equirect_partitions_sphere(self):
        for w, h in ((32, 16), (256, 128)):
            got = total_solid_angle(equirect_grid(w, h))
            self.assertAlmostEqual(got, FOUR_PI, delta=1e-12)

    def test_cubemap_partitions_sphere(self):
        for size in (4, 16, 64):
            got = total_solid_angle(list(cubemap_grid(size)))
            self.assertAlmostEqual(got, FOUR_PI, delta=1e-12)

    def test_basis_orthonormal_fibonacci(self):
        golden = math.pi * (3 - math.sqrt(5))
        n = 60000
        acc = [[0.0] * 9 for _ in range(9)]
        for i in range(n):
            z = 1 - (2 * i + 1) / n
            r = math.sqrt(max(0.0, 1 - z * z))
            phi = golden * i
            d = (r * math.cos(phi), r * math.sin(phi), z)
            b = sh.basis(d)
            for a in range(9):
                for c in range(9):
                    acc[a][c] += b[a] * b[c]
        w = FOUR_PI / n
        for a in range(9):
            for c in range(9):
                self.assertAlmostEqual(acc[a][c] * w, 1.0 if a == c else 0.0,
                                       delta=2e-6)


class TestRotation(unittest.TestCase):
    def test_identity(self):
        M = sh.rotation_matrix(sh.rotation_axis_angle((0, 0, 1), 0.0))
        for i in range(9):
            for j in range(9):
                self.assertAlmostEqual(M[i][j], 1.0 if i == j else 0.0)

    def test_orthogonal_random_axes(self):
        for seed in range(5):
            axis = normalize((math.sin(seed + 1), math.cos(2 * seed), 0.5 + 0.1 * seed))
            M = sh.rotation_matrix(sh.rotation_axis_angle(axis, 0.3 + seed))
            for i in range(9):
                for j in range(9):
                    dot = sum(M[i][k] * M[j][k] for k in range(9))
                    self.assertAlmostEqual(dot, 1.0 if i == j else 0.0,
                                           delta=1e-12)

    def test_band1_pole_rotation(self):
        # +90 deg about y maps the +z lobe onto +x; band1 cartesian x is idx 3.
        spot = sh.analytic_soft_spot((0, 0, 1), 8.0, (1, 1, 1))
        R = sh.rotation_axis_angle((0, 1, 0), math.pi / 2)
        rot = sh.rotate(spot, sh.rotation_matrix(R))
        self.assertAlmostEqual(rot[0][3], spot[0][2], delta=1e-12)
        self.assertAlmostEqual(rot[0][2], 0.0, delta=1e-12)


class TestAnalyticReferences(unittest.TestCase):
    def test_constant_energy(self):
        color = (0.6, 0.6, 0.6)
        c = sh.analytic_constant(color)
        energy = sh.total_energy(c)
        for v in energy:
            self.assertAlmostEqual(v, color[0] * FOUR_PI, delta=1e-12)

    def test_hemisphere_matches_high_res(self):
        hemi = scenes.make_hemisphere((0.8, 0.2, 0.15), (0.1, 0.25, 0.7))
        baked, _ = bake.bake_function(equirect_grid(1024, 512), hemi, workers=4)
        ref = sh.analytic_hemisphere(hemi.top, hemi.bottom)
        self.assertLess(validate.rmse(baked, ref), 1e-5)

    def test_soft_spot_pole_matches_polar_integral(self):
        half_n = 16.0
        s = scenes.make_soft_spot((0, 0, 1), half_n, (1.0, 1.0, 1.0))
        baked, _ = bake.bake_function(equirect_grid(1024, 512), s, workers=4)
        ref = sh.analytic_soft_spot((0, 0, 1), half_n, (1, 1, 1))
        self.assertLess(validate.rmse(baked, ref), 5e-6)

    def test_hard_spot_tilted_matches_high_res(self):
        axis = normalize((0.5, 0.3, 0.8))
        s = scenes.make_spot(axis, math.radians(10), (1, 0.25, 0.1))
        baked, _ = bake.bake_function(equirect_grid(1024, 512), s, workers=4)
        ref = sh.analytic_zonal_spot(axis, s.half_angle, s.color)
        self.assertLess(validate.rmse(baked, ref), 5e-5)


class TestStructuralRules(unittest.TestCase):
    def test_pole_spot_has_no_offaxis_terms(self):
        pole = scenes.make_spot((0, 0, 1), math.radians(10), (1, 1, 1))
        coefs, _ = bake.bake_cubemap(scenes.rasterize_cubemap(pole, 64), workers=4)
        leak, _ = validate.axis_spot_check(coefs, pole.axis)
        self.assertLess(leak, 1e-12)

    def test_hemisphere_azimuthal_terms_zero(self):
        hemi = scenes.make_hemisphere((0.7, 0.2, 0.3), (0.1, 0.4, 0.6))
        coefs, _ = bake.bake_equirect(
            scenes.rasterize_equirect(hemi, 256, 128), workers=4)
        self.assertLess(validate.hemisphere_rule_check(coefs), 1e-12)


if __name__ == "__main__":
    unittest.main()
