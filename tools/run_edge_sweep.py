"""Hard-light-edge measurement sweep.

Reproduces the analytic half-plane response of the same three-lobe profile
used by the HDRP custom pass, across eight world scales and two profile modes:

  profile_scaled: geometry, camera distance and diffusion radii all scale by s
                  -> constant pixel footprint, linear world-space growth
  profile_fixed:  profile stays at 1x -> common failure mode, world radius fixed

Outputs artifacts/generated/measurements.{csv,json}.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sss import (  # noqa: E402
    CameraSpec,
    LOBE_RADIUS_M,
    LOBE_WEIGHT,
    MEAN_FREE_PATH_M,
    SCATTER_TINT,
    edge_radius_px,
    effective_radius_m,
    half_plane_response,
    pixels_per_metre,
)
from sss.diffusion import lobe_sigma_px  # noqa: E402
from sss.profile import SEPARABLE_KERNEL_SCALE  # noqa: E402

SCALES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0]
OUT_DIR = ROOT / "artifacts" / "generated"


def sweep() -> list[dict]:
    camera = CameraSpec()
    distance_px = np.linspace(-120.0, 120.0, 4801)
    effective = effective_radius_m()
    rows: list[dict] = []

    for mode, fixed in (("profile_scaled", False), ("profile_fixed", True)):
        for scale in SCALES:
            ppm = pixels_per_metre(camera, scale)
            radius_scale = 1.0 if fixed else scale
            metres_per_px = 1.0 / ppm

            # Per-lobe pixel sigmas at this scale and profile multiplier.
            sigma_px = lobe_sigma_px(metres_per_px, radius_scale)
            response = half_plane_response(distance_px, sigma_px)
            radius_px, x10_px, x90_px = edge_radius_px(response, distance_px, channel=0)

            rows.append(
                {
                    "scale": scale,
                    "mode": mode,
                    "radius_scale": radius_scale,
                    "pixels_per_m": ppm,
                    "x10_world_mm": abs(x10_px) / ppm * 1000.0,
                    "x90_world_mm": abs(x90_px) / ppm * 1000.0,
                    "width_10_90_px": abs(x10_px - x90_px),
                    "radius_px": radius_px,
                    "radius_world_mm": radius_px / ppm * 1000.0,
                    "predicted_effective_r_mm": float(
                        effective[0] / SEPARABLE_KERNEL_SCALE * radius_scale * 1000.0
                    ),
                }
            )
    return rows


def write_outputs(rows: list[dict]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = OUT_DIR / "measurements.csv"
    fieldnames = list(rows[0].keys())
    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    payload = {
        "definition": {
            "radius_px": "(x10 - x90) / 2 measured across the hard light edge",
            "pixels_per_m": "H / (2 * depth * tan(verticalFov / 2))",
            "resolution_height": CameraSpec().height_px,
            "fov_y_degrees": CameraSpec().fov_y_deg,
            "camera_depth_at_1x_m": CameraSpec().distance_at_1x_m,
            "profile_radii_m": LOBE_RADIUS_M.tolist(),
            "profile_weights": LOBE_WEIGHT.tolist(),
            "mean_free_path_m": MEAN_FREE_PATH_M.tolist(),
            "scatter_tint": SCATTER_TINT.tolist(),
            "effective_radius_m": effective_radius_m().tolist(),
        },
        "rows": rows,
    }
    (OUT_DIR / "measurements.json").write_text(json.dumps(payload, indent=2))


def main() -> None:
    rows = sweep()
    write_outputs(rows)
    scaled = [r for r in rows if r["mode"] == "profile_scaled"]
    fixed = [r for r in rows if r["mode"] == "profile_fixed"]
    print("scale  mode             r_px     r_world_mm  ppm")
    for row in scaled + fixed:
        print(
            f"{row['scale']:>4}  {row['mode']:<15} "
            f"{row['radius_px']:7.3f}  {row['radius_world_mm']:9.3f}  "
            f"{row['pixels_per_m']:9.1f}"
        )
    print(f"\nwrote {OUT_DIR / 'measurements.csv'}")


if __name__ == "__main__":
    main()
