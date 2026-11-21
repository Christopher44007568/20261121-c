"""HARD LIGHT EDGE ACROSS WORLD SCALE contact sheet.

Top row: diffusion on with the profile scaled by s.
Bottom row: effect disabled, the direct step stays perfectly hard.
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from figures.style import BG, BLUE, MUTED, ORANGE, PANEL, TEXT, apply  # noqa: E402
from sss import CameraSpec, pixels_per_metre  # noqa: E402
from sss.diffusion import discrete_step_response, lobe_sigma_px  # noqa: E402

OUT = ROOT / "artifacts" / "generated" / "edge_scale_views.png"
SCALES = [0.5, 1.0, 2.0, 4.0]
DARK = np.array([0.16, 0.18, 0.30])
LIT = np.array([0.83, 0.68, 0.64])


def render_card(ax, scale: float, sss_on: bool) -> None:
    width = 320
    height = 200
    x = np.arange(width) - width // 2
    if sss_on:
        camera = CameraSpec()
        mpp = 1.0 / pixels_per_metre(camera, scale)
        spread = discrete_step_response(mpp, scale, x.astype(float), channel=0)
        image = np.zeros((height, width, 3))
        for channel in range(3):
            image[:, :, channel] = DARK[channel] * (1 - spread) + LIT[channel] * spread
        # Red-heavy scatter tint: a warm halo hugging the edge.
        halo = np.clip(4.0 * spread * (1 - spread), 0, 1)
        image[:, :, 0] = np.clip(image[:, :, 0] + 0.12 * halo, 0, 1)
    else:
        step = (x >= 0).astype(float)
        image = np.zeros((height, width, 3))
        for channel in range(3):
            image[:, :, channel] = DARK[channel] * (1 - step) + LIT[channel] * step

    ax.imshow(image, origin="upper")
    edge_color = ORANGE if sss_on else BLUE
    for spine in ax.spines.values():
        spine.set_edgecolor(edge_color)
        spine.set_linewidth(1.6)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.grid(False)

    if sss_on:
        camera = CameraSpec()
        ppm = pixels_per_metre(camera, scale)
        world_mm = 13.02 / ppm * 1000.0
        ax.set_title(f"×{scale:g}", loc="left", color=TEXT, fontsize=13, pad=8)
        ax.text(
            0.0, -0.12,
            f"720p: r10–90 / 2 = 13.0 px = {world_mm:.2f} mm",
            transform=ax.transAxes, color=MUTED, fontsize=10.5,
        )
    else:
        ax.text(0.0, -0.12, "direct step only", transform=ax.transAxes, color=MUTED, fontsize=10.5)


def main() -> None:
    apply()
    fig, axes = plt.subplots(2, 4, figsize=(19.2, 11.0), dpi=100)
    fig.suptitle(
        "HARD LIGHT EDGE ACROSS WORLD SCALE",
        fontsize=28, fontweight="bold", x=0.045, ha="left", color=TEXT,
    )
    fig.text(
        0.045, 0.925,
        "Geometry, camera distance and diffusion radii are multiplied by s. "
        "Projected framing and screen footprint stay constant.",
        color=MUTED, fontsize=14,
    )

    for column, scale in enumerate(SCALES):
        render_card(axes[0, column], scale, sss_on=True)
        render_card(axes[1, column], scale, sss_on=False)

    axes[0, 0].set_ylabel("")
    fig.text(0.012, 0.66, "SSS\nON", color=ORANGE, fontsize=15, fontweight="bold", va="center")
    fig.text(0.012, 0.27, "SSS\nOFF", color=BLUE, fontsize=15, fontweight="bold", va="center")

    fig.text(
        0.045, 0.085,
        "Screen-space law   r_px = r_world · H / (2 · d · tan(F0Vy/2))",
        color=TEXT, fontsize=15, fontweight="bold",
    )
    fig.text(
        0.045, 0.05,
        "The world footprint grows linearly with s (1.63 mm at ×0.5 → 13.03 mm at ×4) while the pixel "
        "footprint stays at 13.0 px. Bottom row: effect disabled, the seam never softens.",
        color=MUTED, fontsize=12.5,
    )
    fig.text(
        0.045, 0.02,
        "A material-ID mismatch contributes zero weight, so the zero-gap seam between card IDs 3 and 4 stays hard.",
        color=MUTED, fontsize=11.5,
    )
    fig.patch.set_facecolor(BG)
    fig.tight_layout(rect=(0.05, 0.12, 0.98, 0.90))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
