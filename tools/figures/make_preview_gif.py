"""Toggle GIF alternating SSS enabled / disabled on the auricle scene."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from sss import (  # noqa: E402
    apply_screen_space_sss,
    build_auricle_scene,
)
from sss.camera import CameraSpec, metres_per_pixel  # noqa: E402

OUT = ROOT / "artifacts" / "generated" / "preview_toggle.gif"


def to_pil(image: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(image, 0, 1) * 255).astype(np.uint8), mode="RGB")


def main() -> None:
    camera = CameraSpec()
    buffers = build_auricle_scene(height=480, width=480)
    mpp = metres_per_pixel(camera, 1.0)
    frames = [
        to_pil(apply_screen_space_sss(buffers, mpp, sss_enabled=True)),
        to_pil(apply_screen_space_sss(buffers, mpp, sss_enabled=False)),
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=900,
        loop=0,
        optimize=True,
    )
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
