"""Energy-conservation and sampling self-consistency checks.

Run with:  .venv/bin/python -m pytest tests/ -q
(or directly: .venv/bin/python tests/test_energy.py)
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from material_preview import brdf
from material_preview.materials import ClearCoat, Material
from material_preview.presets import preset_stack
from material_preview.scan import directional_hemispherical


def test_ggx_pdf_self_consistent():
    rng = np.random.default_rng(0)
    for alpha in (0.02, 0.35):
        wo = np.zeros((200_000, 3))
        wo[:, 2] = 1.0
        wi, pdf = brdf.sample_ggx(wo, alpha, rng)
        h = wi + wo
        h /= np.linalg.norm(h, axis=-1, keepdims=True)
        h_dot_v = np.clip((h * wo).sum(axis=1), brdf.EPS, 1.0)
        rebuilt = brdf.ggx_pdf(h[:, 2], h_dot_v, alpha)
        ok = np.allclose(pdf[pdf > 0], rebuilt[pdf > 0], rtol=0.02)
        assert ok, f"GGX pdf mismatch for alpha={alpha}"


def test_lambert_reflectance_equals_albedo():
    rng = np.random.default_rng(1)
    mat = Material("lambert", (0.5, 0.5, 0.5), ())
    rho = directional_hemispherical(mat, 0.0, rng, samples=40_000)
    assert np.allclose(rho, 0.5, atol=0.02), rho


def test_all_presets_conserve_energy():
    rng = np.random.default_rng(2)
    for mat in preset_stack():
        for theta in (0.0, 45.0, 80.0, 87.0):
            rho = directional_hemispherical(mat, theta, rng, samples=25_000)
            assert rho.max() <= 1.03, (mat.name, theta, rho)


def test_clearcoat_fresnel_rises_at_grazing():
    rng = np.random.default_rng(3)
    coat_only = Material("coat", (0.0, 0.0, 0.0), (), ClearCoat(alpha=0.02))
    normal = directional_hemispherical(coat_only, 0.0, rng, 40_000)[0]
    grazing = directional_hemispherical(coat_only, 85.0, rng, 40_000)[0]
    assert grazing > normal
    assert normal < 0.06  # close to the dielectric F0 ~= 0.04


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
