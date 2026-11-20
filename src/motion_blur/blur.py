"""Motion-blur renderers: fast motion-vector path vs. time multisampling."""

from __future__ import annotations

import numpy as np

from .motion import MotionVectors
from .rasterizer import GBuffer, render_gbuffer
from .scene import SceneObject
from .transform import Camera


def _tonemap(color: np.ndarray) -> np.ndarray:
    # Simple Reinhard + gamma for displayable 8-bit output.
    mapped = color / (1.0 + color)
    return np.clip(mapped, 0.0, 1.0) ** (1.0 / 2.2)


def to_uint8(color: np.ndarray) -> np.ndarray:
    return (_tonemap(color) * 255.0).round().astype(np.uint8)


def reference_multisample(objects: list[SceneObject], camera: Camera,
                          t_open: float, t_close: float, sample_count: int,
                          background: np.ndarray | None = None,
                          camera_factory=None) -> np.ndarray:
    """Ground truth: average sharp G-buffers sampled across the exposure.

    Samples are stratified at the midpoint of each equal time bin, which
    avoids aliasing toward either shutter edge. When ``camera_factory`` is
    given it is evaluated at each sample time, so camera motion *during* the
    exposure is integrated exactly like object motion.
    """
    if sample_count < 1:
        raise ValueError("sample_count must be >= 1")
    accum = None
    weights = 0.0
    for k in range(sample_count):
        t = t_open + (k + 0.5) * (t_close - t_open) / sample_count
        sample_camera = camera if camera_factory is None else camera_factory(t)
        gb = render_gbuffer(objects, sample_camera, t, background)
        accum = gb.color.copy() if accum is None else accum + gb.color
        weights += 1.0
    return accum / weights


def fast_motion_vector(gb: GBuffer, mv: MotionVectors,
                       steps_per_pixel: float = 1.0,
                       min_steps: int = 1,
                       max_steps: int = 64) -> np.ndarray:
    """Approximate the exposure by sweeping pixels along their vectors.

    The shutter interval is split into global time steps. At each step every
    valid pixel is evaluated along its own start->end segment and splatted
    with its current G-buffer depth, so nearer surfaces occlude farther
    ones (this is what keeps disoccluded pixels from leaking hidden color).
    Averaging the per-step images mirrors the stratified reference and gives
    proper coverage accumulation for the rotating blades. Pixels without
    history (first/reset frame) keep their sharp G-buffer color.
    """
    height, width = gb.height, gb.width
    bg_color = gb.color[gb.background_mask]
    default_bg = np.full(3, 0.08) if bg_color.size == 0 else bg_color[0]
    lengths = mv.magnitude
    global_steps = int(np.clip(np.ceil(lengths.max(initial=0.0) * steps_per_pixel),
                               min_steps, max_steps))
    valid = mv.history_valid
    sharp = np.tile(default_bg, (height, width, 1))
    sharp[~gb.background_mask] = gb.color[~gb.background_mask]
    if not np.any(valid):
        return sharp.copy()

    src_rows, src_cols = np.nonzero(valid)
    starts = mv.start[src_rows, src_cols]
    ends = mv.end[src_rows, src_cols]
    src_depth = gb.depth[src_rows, src_cols]
    src_color = gb.color[src_rows, src_cols]

    accumulated = np.zeros_like(sharp)
    for step in range(global_steps):
        alpha = (step + 0.5) / global_steps
        points = starts + alpha * (ends - starts)
        ix = np.rint(points[:, 0] - 0.5).astype(np.int64)
        iy = np.rint(points[:, 1] - 0.5).astype(np.int64)
        keep = (ix >= 0) & (ix < width) & (iy >= 0) & (iy < height)
        ix, iy = ix[keep], iy[keep]
        d = src_depth[keep]
        col = src_color[keep]
        nearest = np.full((height, width), np.inf, dtype=np.float64)
        # Resolve multiple splats landing on one pixel: nearest wins.
        np.minimum.at(nearest, (iy, ix), d)
        winners = d == nearest[iy, ix]
        # Start from the sharp frame so gaps between splats retain the
        # currently visible surface instead of snapping to background.
        frame = sharp.copy()
        frame[iy[winners], ix[winners]] = col[winners]
        accumulated += frame
    return accumulated / global_steps
