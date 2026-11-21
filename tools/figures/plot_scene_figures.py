"""Hero comparison and material-ID / thickness buffer visualisations."""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from figures.style import BG, BLUE, GREEN, MUTED, ORANGE, TEXT, apply  # noqa: E402
from sss import (  # noqa: E402
    apply_screen_space_sss,
    build_auricle_scene,
    encode_id_buffer,
    encode_thickness_buffer,
)
from sss.camera import CameraSpec, metres_per_pixel  # noqa: E402

OUT_DIR = ROOT / "artifacts" / "generated"


def main() -> None:
    apply()
    camera = CameraSpec()
    mpp = metres_per_pixel(camera, 1.0)
    buffers = build_auricle_scene(height=720, width=720)
    sss_on = apply_screen_space_sss(buffers, mpp, sss_enabled=True, id_gate=True)
    sss_off = apply_screen_space_sss(buffers, mpp, sss_enabled=False)

    write_hero_pair(sss_on, sss_off)
    write_on_off_comparison(sss_on, sss_off)
    write_buffer_dashboard(buffers, sss_on)


def write_hero_pair(sss_on: np.ndarray, sss_off: np.ndarray) -> None:
    for name, image, label in (
        ("hero_sss_enabled.png", sss_on, "SSS ENABLED"),
        ("hero_sss_disabled.png", sss_off, "SSS DISABLED"),
    ):
        fig, ax = plt.subplots(figsize=(8.2, 8.2), dpi=100)
        ax.imshow(image, origin="upper")
        ax.set_xticks([])
        ax.set_yticks([])
        ax.grid(False)
        ax.set_title(label, color=ORANGE if "ENABLED" in label else BLUE, loc="left", pad=10)
        fig.tight_layout(pad=0.4)
        fig.savefig(OUT_DIR / name)
        plt.close(fig)
        print(f"wrote {OUT_DIR / name}")


def write_on_off_comparison(sss_on: np.ndarray, sss_off: np.ndarray) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(19.2, 10.8), dpi=100)
    fig.suptitle(
        "SCREEN-SPACE SUBSURFACE SCATTERING",
        fontsize=28, fontweight="bold", x=0.045, ha="left", color=TEXT,
    )
    fig.text(
        0.045, 0.925,
        "HDRP 14 custom pass  /  three-lobe diffusion profile  /  strict material-ID isolation",
        color=MUTED, fontsize=14,
    )
    for ax, image, title, color in (
        (axes[0], sss_on, "SSS ENABLED\ndiffusion + thickness attenuation", ORANGE),
        (axes[1], sss_off, "SSS DISABLED\ndirect lighting only", BLUE),
    ):
        ax.imshow(image, origin="upper")
        ax.set_xticks([])
        ax.set_yticks([])
        ax.grid(False)
        ax.set_title(title, loc="left", color=color, fontsize=15, pad=12)
        for spine in ax.spines.values():
            spine.set_edgecolor(color)
            spine.set_linewidth(1.8)

    fig.text(
        0.045, 0.085,
        "Auricle: 0.45–2.4 mm  •  backing plate: 40 mm  •  camera-to-ear distance 336 mm  •  30° vertical FOV",
        color=TEXT, fontsize=14.5,
    )
    fig.text(
        0.045, 0.05,
        "The red-heavy halo is strongest on the thin helix and lobe. The 40 mm plate has "
        "exp(−40/mfp) ≈ 0 transmission, so its boundary stays crisp even though the two surfaces "
        "occupy adjacent screen pixels.",
        color=MUTED, fontsize=12.5,
    )
    fig.text(
        0.045, 0.02,
        "measured red 10–90 radius = 3.26 mm = 13.0 px at 720p / 336 mm  •  "
        "profile first moment 3.16 / 1.50 / 0.85 mm",
        color=ORANGE, fontsize=12,
    )
    fig.patch.set_facecolor(BG)
    fig.tight_layout(rect=(0.03, 0.12, 0.98, 0.90))
    fig.savefig(OUT_DIR / "sss_on_off_comparison.png")
    plt.close(fig)
    print(f"wrote {OUT_DIR / 'sss_on_off_comparison.png'}")


def write_buffer_dashboard(buffers, beauty) -> None:
    id_image = encode_id_buffer(buffers.material_id)
    thickness_image = encode_thickness_buffer(buffers.thickness_m)

    fig, axes = plt.subplots(1, 3, figsize=(19.2, 10.8), dpi=100)
    fig.suptitle(
        "MATERIAL FIREWALL AND THICKNESS BUFFER",
        fontsize=26, fontweight="bold", x=0.045, ha="left", color=TEXT,
    )
    fig.text(
        0.045, 0.925,
        "Every diffuse tap is accepted only when sampleID == centreID; the opaque plate never "
        "receives the auricle's red bleed.",
        color=MUTED, fontsize=13.5,
    )
    panels = (
        (beauty, "BEAUTY", "direct + screen-space diffusion", TEXT),
        (id_image, "MATERIAL ID", "R = round(ID) / 255", GREEN),
        (thickness_image, "THICKNESS", "G = thickness / 80 mm", BLUE),
    )
    for ax, (image, title, subtitle, color) in zip(axes, panels):
        ax.imshow(image, origin="upper")
        ax.set_xticks([])
        ax.set_yticks([])
        ax.grid(False)
        ax.set_title(f"{title}      {subtitle}", loc="left", color=color, fontsize=14.5, pad=10)

    notes = (
        "ID GATE — adjacent, zero-gap seam, no colour crosses\n\n"
        "1  auricle: thin shell, vertex thickness 0.45–2.4 mm, ID 1\n"
        "2  backing plate: 40 mm, opaque, ID 2\n"
        "3 / 4  hard-edge cards: adjacent 0.55 mm shells with IDs 3 and 4\n\n"
        "Transmission  T = exp(-thickness / meanFreePath)\n"
        "mfp R/G/B = 3.5 / 1.7 / 0.9 mm   →  ear keeps 0.88/0.77/0.61 at 0.45 mm\n"
        "plate at 40 mm → 1.1e-5 / 6.2e-11 / 5.6e-20  (fully opaque to the diffuse pass)\n\n"
        "The ID buffer is not a beauty texture: it is a hard gate on each 96-tap diffusion footprint."
    )
    fig.text(0.045, 0.06, notes, color=MUTED, fontsize=12.5, family="monospace", va="top")
    fig.patch.set_facecolor(BG)
    fig.tight_layout(rect=(0.03, 0.34, 0.98, 0.90))
    fig.savefig(OUT_DIR / "material_id_and_thickness.png")
    plt.close(fig)
    print(f"wrote {OUT_DIR / 'material_id_and_thickness.png'}")


if __name__ == "__main__":
    main()
