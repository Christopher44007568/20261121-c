"""EDGE-SPREAD MEASUREMENT dashboard: sections A/B and radius laws C/D."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from figures.style import (  # noqa: E402
    AMBER,
    BLUE,
    GREEN,
    MUTED,
    ORANGE,
    PINK,
    TEXT,
    apply,
)
from sss import CameraSpec, half_plane_response, pixels_per_metre  # noqa: E402
from sss.diffusion import lobe_sigma_px  # noqa: E402

OUT = ROOT / "artifacts" / "generated" / "edge_cross_sections.png"
SCALE_COLORS = {0.5: GREEN, 1.0: BLUE, 2.0: AMBER, 4.0: PINK}


def load_rows() -> dict:
    data = json.loads((ROOT / "artifacts" / "generated" / "measurements.json").read_text())
    return data


def main() -> None:
    apply()
    data = load_rows()
    rows = data["rows"]
    camera = CameraSpec()
    distance_px = np.linspace(-45.0, 45.0, 901)

    fig, axes = plt.subplots(2, 2, figsize=(19.2, 10.8), dpi=100)
    fig.suptitle("EDGE-SPREAD MEASUREMENT", fontsize=30, fontweight="bold", x=0.06, ha="left", color=TEXT)
    fig.text(
        0.06, 0.925,
        "half-plane response of the same three-lobe profile used by the HDRP custom pass  •  720p  •  30° vertical FOV",
        color=MUTED, fontsize=14,
    )

    plot_sections(axes[0, 0], axes[0, 1], distance_px, camera)
    plot_radius_laws(axes[1, 0], axes[1, 1], rows)

    fig.tight_layout(rect=(0.04, 0.05, 0.98, 0.90))
    fig.text(
        0.06, 0.02,
        "r_px = (x10 − x90) / 2 on the dark side of a hard edge. The profile-fixed control is the common "
        "failure mode: world-unit radii are not converted back to pixels.",
        color=MUTED, fontsize=12.5,
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT)
    print(f"wrote {OUT}")


def plot_sections(ax_scaled, ax_fixed, distance_px, camera) -> None:
    for ax, fixed, title in (
        (ax_scaled, False, "A  Screen-space section — profile follows scale"),
        (ax_fixed, True, "B  Control — profile fixed at 1×"),
    ):
        for scale, color in SCALE_COLORS.items():
            mpp = 1.0 / pixels_per_metre(camera, scale)
            radius_scale = 1.0 if fixed else scale
            sigma = lobe_sigma_px(mpp, radius_scale)
            response = half_plane_response(distance_px, sigma)
            ax.plot(distance_px, response[:, 0], color=color, label=f"×{scale:g}")
        ax.axvline(0, color=MUTED, linestyle="--", alpha=0.7)
        ax.set_title(title, loc="left")
        ax.set_xlabel("distance from hard edge (px)")
        ax.set_ylabel("normalised radiance")
        ax.set_xlim(-45, 45)
        ax.set_ylim(0, 1.05)
        ax.legend(frameon=False, ncol=2)
    ax_scaled.text(8, 0.62, "all four scales collapse", color=AMBER, fontsize=13)


def plot_radius_laws(ax_px, ax_world, rows) -> None:
    scaled = [r for r in rows if r["mode"] == "profile_scaled"]
    fixed = [r for r in rows if r["mode"] == "profile_fixed"]
    scales = [r["scale"] for r in scaled]

    ax_px.plot(scales, [r["radius_px"] for r in scaled], "o-", color=ORANGE, label="profile × s")
    ax_px.plot(scales, [r["radius_px"] for r in fixed], "o-", color=BLUE, label="profile fixed")
    ax_px.axhline(13.02, color=MUTED, linestyle=":", alpha=0.8)
    ax_px.text(1.25, 13.6, "13.02 px", color=ORANGE, fontsize=12)
    ax_px.set_title("C  Measured pixel radius", loc="left")
    ax_px.set_xlabel("world scale")
    ax_px.set_ylabel("radius (px)")
    ax_px.legend(frameon=False)

    ax_world.plot(scales, [r["radius_world_mm"] for r in scaled], "o-", color=ORANGE, label="profile × s")
    ax_world.plot(scales, [r["radius_world_mm"] for r in fixed], "o-", color=BLUE, label="profile fixed")
    ax_world.plot(
        scales, [3.257 * s for s in scales], color=MUTED, linestyle=":",
        label="r_world = 3.257 × s mm",
    )
    ax_world.set_title("D  Measured world-space radius", loc="left")
    ax_world.set_xlabel("world scale")
    ax_world.set_ylabel("radius (mm)")
    ax_world.legend(frameon=False)


if __name__ == "__main__":
    main()
