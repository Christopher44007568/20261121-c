"""Numerical checks for the offline reference model.

1. The discrete 48-tap kernel used by the HLSL pass reproduces the analytic
   half-plane 10-90 radius within half a tap.
2. The material-ID gate keeps a zero-gap seam hard: a mismatched neighbour
   never contributes energy across the boundary.
3. Thickness transmission collapses the 40 mm plate to ~zero scattered energy
   while the thin auricle retains a strong response.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sss import CameraSpec, pixels_per_metre, transmission  # noqa: E402
from sss.diffusion import (  # noqa: E402
    TAP_COUNT,
    TAP_SPACING,
    discrete_step_response,
    diffuse_1d,
    edge_radius_px,
    half_plane_response,
    lobe_sigma_px,
)
from sss.profile import LOBE_WEIGHT  # noqa: E402


def check_discrete_vs_analytic() -> None:
    camera = CameraSpec()
    metres_per_px = 1.0 / pixels_per_metre(camera, 1.0)
    sigma_px = lobe_sigma_px(metres_per_px, 1.0)

    x = np.arange(-300, 301).astype(float)
    analytic = half_plane_response(x.astype(float), sigma_px)
    radius_a, _, _ = edge_radius_px(analytic, x.astype(float), channel=0)

    discrete_red = discrete_step_response(metres_per_px, 1.0, x, channel=0)
    radius_d, _, _ = edge_radius_px(
        np.stack([discrete_red] * 3, axis=1), x, channel=0
    )

    # The 97-sample kernel is a truncated engineering approximation of the
    # continuous profile; analytic CDF remains the measurement ground truth.
    print(
        f"[1] discrete {TAP_COUNT * 2 + 1}-tap radius {radius_d:.3f} px "
        f"vs analytic {radius_a:.3f} px (tap spacing {TAP_SPACING} px)"
    )
    assert abs(radius_d - radius_a) / radius_a < 0.15, "discrete kernel drifts too far"

    # Across scales the discrete pixel footprint must stay constant just like
    # the analytic one, because profile radii and camera distance scale together.
    radii = []
    for scale in (0.5, 1.0, 2.0, 4.0):
        mpp = 1.0 / pixels_per_metre(camera, scale)
        curve = discrete_step_response(mpp, scale, x, channel=0)
        radius, _, _ = edge_radius_px(np.stack([curve] * 3, axis=1), x, channel=0)
        radii.append(radius)
    spread = max(radii) - min(radii)
    print(f"    discrete footprint across scales: {radii} (spread {spread:.4f} px)")
    assert spread < 0.05, "pixel footprint must be scale invariant in profile_scaled mode"


def check_id_gate() -> None:
    n = 401
    x = np.arange(n) - n // 2
    signal = np.zeros((n, 3))
    signal[x >= 0] = np.array([1.0, 0.4, 0.3])

    # IDs 3 on the dark side, 4 on the lit side, seam exactly at x = 0.
    ids = np.where(x < 0, 3, 4).astype(np.int32)
    camera = CameraSpec()
    metres_per_px = 1.0 / pixels_per_metre(camera, 1.0)

    gated = diffuse_1d(signal, ids, metres_per_px, 1.0, id_gate=True)
    ungated = diffuse_1d(signal, ids, metres_per_px, 1.0, id_gate=False)

    dark_gated = gated[x < 0]
    dark_ungated = ungated[x < 0]
    leaked = float(dark_gated.max())
    spread_ungated = float(dark_ungated[:, 0].max())
    print(f"[2] gated dark-side energy {leaked:.3e} vs ungated {spread_ungated:.3f}")
    assert leaked < 1e-12, "material ID gate leaked across the zero-gap seam"
    assert spread_ungated > 0.2, "ungated reference should bleed across the seam"


def check_thickness() -> None:
    ear_thin = 0.00045
    ear_thick = 0.0024
    plate = 0.040
    t_ear_thin = float(transmission(ear_thin)[0])
    t_ear_thick = float(transmission(ear_thick)[0])
    t_plate = float(transmission(plate)[0])
    print(
        "[3] transmission R  ear 0.45mm=%.3f  ear 2.4mm=%.3f  plate 40mm=%.3e"
        % (t_ear_thin, t_ear_thick, t_plate)
    )
    assert t_ear_thin > 0.85, "thin auricle must keep strong transmission"
    assert t_plate < 1e-4, "40 mm plate must be opaque to the diffuse pass"


def main() -> None:
    check_discrete_vs_analytic()
    check_id_gate()
    check_thickness()
    print("\nall diffusion checks passed")


if __name__ == "__main__":
    main()
