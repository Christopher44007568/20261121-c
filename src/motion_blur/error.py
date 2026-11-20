"""Error measurement and visualization between the two renderers."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .blur import to_uint8
from .motion import MotionVectors

DISOCCLUSION_COLOR = np.array([1.0, 0.85, 0.0])   # amber
CROSS_SCREEN_COLOR = np.array([0.2, 0.7, 1.0])    # cyan
OVERLAP_COLOR = np.array([1.0, 0.3, 1.0])         # magenta


@dataclass
class ErrorStats:
    mean_abs: float
    max_abs: float
    rms: float
    disocclusion_mean: float
    cross_screen_mean: float
    ordinary_mean: float
    disocclusion_count: int
    cross_screen_count: int


def per_pixel_error(fast: np.ndarray, reference: np.ndarray) -> np.ndarray:
    """Euclidean RGB distance in linear color, shape (H, W)."""
    return np.linalg.norm(fast - reference, axis=2)


def compute_stats(error: np.ndarray, mv: MotionVectors) -> ErrorStats:
    dis = mv.disocclusion
    cross = mv.cross_screen
    ordinary = ~dis & ~cross
    def mean(mask: np.ndarray) -> float:
        return float(error[mask].mean()) if np.any(mask) else 0.0
    return ErrorStats(
        mean_abs=float(error.mean()),
        max_abs=float(error.max()),
        rms=float(np.sqrt((error ** 2).mean())),
        disocclusion_mean=mean(dis),
        cross_screen_mean=mean(cross),
        ordinary_mean=mean(ordinary),
        disocclusion_count=int(dis.sum()),
        cross_screen_count=int(cross.sum()),
    )


def error_heatmap(error: np.ndarray) -> np.ndarray:
    """Map scalar error to a black->red->yellow heatmap (float RGB)."""
    scale = error.max(initial=1e-9)
    normalized = np.clip(error / scale, 0.0, 1.0)
    heat = np.zeros((*error.shape, 3), dtype=np.float64)
    heat[..., 0] = np.clip(2.0 * normalized, 0.0, 1.0)
    heat[..., 1] = np.clip(2.0 * normalized - 1.0, 0.0, 1.0)
    return heat


def visualize_error(fast: np.ndarray, reference: np.ndarray,
                    mv: MotionVectors) -> np.ndarray:
    """Three-panel comparison as uint8 RGB: reference | fast | error map.

    The error panel tints disocclusion pixels amber and cross-screen pixels
    cyan (magenta where both apply), and draws the outlines of those masks on
    the fast-render panel as well.
    """
    error = per_pixel_error(fast, reference)
    heat = error_heatmap(error)
    overlap = mv.disocclusion & mv.cross_screen
    dis_only = mv.disocclusion & ~mv.cross_screen
    cross_only = mv.cross_screen & ~mv.disocclusion
    heat[dis_only] = DISOCCLUSION_COLOR
    heat[cross_only] = CROSS_SCREEN_COLOR
    heat[overlap] = OVERLAP_COLOR

    outlined = to_uint8(fast).astype(np.float64) / 255.0
    outline = _mask_outline(mv.disocclusion | mv.cross_screen)
    tint = np.where(mv.disocclusion[..., None], DISOCCLUSION_COLOR,
                    CROSS_SCREEN_COLOR)
    outlined[outline] = 0.6 * outlined[outline] + 0.4 * tint[outline]

    panels = [
        to_uint8(reference),
        to_uint8(outlined),
        to_uint8(heat),
    ]
    return np.concatenate(panels, axis=1)


def _mask_outline(mask: np.ndarray) -> np.ndarray:
    """Boundary pixels of a boolean mask."""
    padded = np.pad(mask, 1, constant_values=False)
    eroded = (
        padded[1:-1, 1:-1]
        & padded[:-2, 1:-1] & padded[2:, 1:-1]
        & padded[1:-1, :-2] & padded[1:-1, 2:]
    )
    return mask & ~eroded


def motion_vector_overlay(color: np.ndarray, mv: MotionVectors,
                          stride: int = 8) -> np.ndarray:
    """Draw sparse green arrows showing the start->end motion vectors."""
    image = to_uint8(color).astype(np.float64)
    height, width = mv.magnitude.shape
    for y in range(stride // 2, height, stride):
        for x in range(stride // 2, width, stride):
            if not mv.history_valid[y, x] or mv.magnitude[y, x] < 0.75:
                continue
            _draw_line(image, mv.start[y, x], mv.end[y, x],
                       np.array([0.2, 1.0, 0.2]))
    return np.clip(image, 0.0, 1.0)


def _draw_line(image: np.ndarray, a: np.ndarray, b: np.ndarray,
               color: np.ndarray) -> None:
    height, width = image.shape[:2]
    span = int(max(abs(b - a).max(), 1))
    for alpha in np.linspace(0.0, 1.0, span + 1):
        p = a + alpha * (b - a)
        x, y = int(round(p[0])), int(round(p[1]))
        if 0 <= x < width and 0 <= y < height:
            image[y, x] = color
