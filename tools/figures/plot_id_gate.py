"""ID gate proof: zero-gap seam between material IDs 3 and 4."""

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
from sss import CameraSpec, pixels_per_metre  # noqa: E402
from sss.diffusion import diffuse_1d  # noqa: E402

OUT = ROOT / "artifacts" / "generated" / "id_gate_seam.png"


def main() -> None:
    apply()
    n = 320
    x = np.arange(n) - n // 2
    signal = np.zeros((n, 3))
    signal[x >= 0] = np.array([0.95, 0.55, 0.45])
    signal[x < 0] = np.array([0.10, 0.12, 0.25])
    ids = np.where(x < 0, 3, 4).astype(np.int32)

    camera = CameraSpec()
    mpp = 1.0 / pixels_per_metre(camera, 1.0)
    gated = diffuse_1d(signal, ids, mpp, 1.0, id_gate=True)
    ungated = diffuse_1d(signal, ids, mpp, 1.0, id_gate=False)

    fig, axes = plt.subplots(1, 3, figsize=(19.2, 6.4), dpi=100)
    fig.suptitle(
        "MATERIAL-ID FIREWALL AT A ZERO-GAP SEAM",
        fontsize=26, fontweight="bold", x=0.045, ha="left", color=TEXT,
    )
    panels = (
        (gated, "ID GATE ON", "sampleID == centreID on every tap", GREEN),
        (ungated, "ID GATE OFF", "reference: unconstrained diffusion", ORANGE),
    )
    for ax, (image_curve, title, subtitle, color) in zip(axes[:2], panels):
        stripe = np.repeat(image_curve[None, :, :], 120, axis=0)
        ax.imshow(np.clip(stripe, 0, 1), extent=[x.min(), x.max(), 0, 1], aspect="auto")
        ax.axvline(0, color=color, linestyle="--", linewidth=2)
        ax.set_title(f"{title}   {subtitle}", loc="left", color=color, fontsize=14.5)
        ax.set_yticks([])
        ax.set_xlabel("pixels from seam")
        ax.grid(False)

    ax = axes[2]
    ax.plot(x, gated[:, 0], color=GREEN, label="gated R")
    ax.plot(x, ungated[:, 0], color=ORANGE, label="ungated R")
    ax.plot(x, signal[:, 0], color=BLUE, linestyle="--", label="direct step")
    ax.axvline(0, color=MUTED, linestyle=":")
    ax.set_title("Red channel section", loc="left")
    ax.set_xlabel("pixels from seam")
    ax.set_ylabel("radiance")
    ax.legend(frameon=False)

    dark_leak = float(np.abs(gated[x < 0, 0] - signal[x < 0, 0]).max())
    fig.text(
        0.045, 0.04,
        f"Max dark-side change with the gate on: {dark_leak:.2e} — the seam stays a hard step. "
        "Without the gate, lit-side energy bleeds ~20 px across the boundary.",
        color=MUTED, fontsize=13,
    )
    fig.patch.set_facecolor(BG)
    fig.tight_layout(rect=(0.03, 0.10, 0.98, 0.90))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
