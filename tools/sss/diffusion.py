"""Separable Gaussian diffusion, ID gating and edge measurement.

The discrete kernel mirrors SSSDiffusion.hlsl: 48 taps per axis, tap spacing
1/15 px, three lobes evaluated in the same loop. Analytic half-plane CDFs are
provided so the discrete Unity output can be validated against ground truth.
"""

import math
import numpy as np

from .profile import LOBE_RADIUS_M, LOBE_WEIGHT, SEPARABLE_KERNEL_SCALE

TAP_COUNT = 48
TAP_SPACING = 0.5  # matches SSS_TAP_SPACING in the HLSL pass


def lobe_sigma_px(metres_per_px: float, radius_scale: float) -> np.ndarray:
    """Per-lobe, per-channel pixel standard deviation."""
    return LOBE_RADIUS_M * SEPARABLE_KERNEL_SCALE * radius_scale / max(metres_per_px, 1e-7)


def _normal_cdf(x: np.ndarray) -> np.ndarray:
    return 0.5 * (1.0 + np.vectorize(math.erf)(x / math.sqrt(2.0)))


def half_plane_response(distance_px: np.ndarray, sigma_px: np.ndarray) -> np.ndarray:
    """Analytic response of a Gaussian to a hard step at x = 0.

    distance_px shape (N,) and sigma_px shape (3 lobes, 3 channels); output
    shape is (N, 3) after mixing lobes with LOBE_WEIGHT.
    """
    distance_px = np.asarray(distance_px, dtype=np.float64)
    responses = np.zeros((distance_px.size, sigma_px.shape[1]))
    for k in range(sigma_px.shape[0]):
        for channel in range(sigma_px.shape[1]):
            cdf = _normal_cdf(distance_px / sigma_px[k, channel])
            responses[:, channel] += LOBE_WEIGHT[k, channel] * cdf
    return responses


def diffuse_1d(
    signal: np.ndarray,
    material_id: np.ndarray,
    metres_per_px: float,
    radius_scale: float,
    id_gate: bool = True,
) -> np.ndarray:
    """Discrete 96-tap-equivalent 1D diffusion with a hard material-ID gate.

    signal: (N, 3) linear radiance. material_id: (N,) integer IDs.
    Taps with a mismatched ID get zero weight and the remaining weights are
    renormalised, exactly as the HLSL pass does.
    """
    signal = np.asarray(signal, dtype=np.float64)
    n = signal.shape[0]
    sigma_px = lobe_sigma_px(metres_per_px, radius_scale)
    offsets = np.arange(-TAP_COUNT, TAP_COUNT + 1) * TAP_SPACING

    # Mix the three lobes into one per-channel kernel, then normalise once:
    # this matches the HLSL footprint where every tap carries all lobes.
    kernel = np.zeros((offsets.size, 3))
    for k in range(3):
        x = offsets[:, None] / np.maximum(sigma_px[k], 1e-4)
        kernel += LOBE_WEIGHT[k] * np.exp(-0.5 * x * x)

    centres = np.arange(n)
    # sources[i, j] is the signal index sampled by tap j at centre pixel i.
    sources = np.rint(centres[:, None] + offsets[None, :]).astype(int)
    valid = (sources >= 0) & (sources < n)
    safe_sources = np.clip(sources, 0, n - 1)

    if id_gate:
        centre_ids = material_id[:, None]
        source_ids = material_id[safe_sources]
        gates = np.where(valid & (source_ids == centre_ids), 1.0, 0.0)
    else:
        gates = valid.astype(np.float64)

    weights = kernel[None, :, :] * gates[:, :, None]
    sampled = signal[safe_sources]
    weight_total = weights.sum(axis=1)
    output = (sampled * weights).sum(axis=1) / np.maximum(weight_total, 1e-5)
    return output


def edge_radius_px(
    response: np.ndarray,
    distance_px: np.ndarray,
    channel: int = 0,
) -> tuple[float, float, float]:
    """10-90 half-width on the dark side of the hard edge.

    Returns (radius_px, x10_px, x90_px). The dark side is distance < 0; the
    response rises from 0 toward 1 as distance approaches 0.
    """
    curve = response[:, channel]
    dark = float(np.interp(-120.0, distance_px, curve))
    lit = float(np.interp(120.0, distance_px, curve))
    level10 = dark + (lit - dark) * 0.10
    level90 = dark + (lit - dark) * 0.90

    def crossing(level: float) -> float:
        idx = np.where(np.diff(np.sign(curve - level)))[0]
        if len(idx) == 0:
            return float("nan")
        i = idx[0]
        x0, x1 = distance_px[i], distance_px[i + 1]
        y0, y1 = curve[i], curve[i + 1]
        return float(x0 + (level - y0) * (x1 - x0) / max(y1 - y0, 1e-12))

    x10 = crossing(level10)
    x90 = crossing(level90)
    radius = abs(x10 - x90) * 0.5
    return radius, x10, x90


def discrete_step_response(
    metres_per_px: float,
    radius_scale: float,
    distance_px: np.ndarray,
    channel: int = 0,
) -> np.ndarray:
    """Response of the actual 96-tap discrete kernel to a hard step.

    The response at position x is the normalised kernel mass with source on
    the lit side, i.e. sum of weights whose tap offset satisfies o >= -x.
    This is exactly what the HLSL pass computes on an infinite half-plane.
    """
    sigma_px = lobe_sigma_px(metres_per_px, radius_scale)
    offsets = np.arange(-TAP_COUNT, TAP_COUNT + 1) * TAP_SPACING
    kernel = np.zeros(offsets.size)
    for k in range(3):
        x = offsets / max(sigma_px[k, channel], 1e-4)
        kernel += LOBE_WEIGHT[k, channel] * np.exp(-0.5 * x * x)
    kernel /= kernel.sum()

    response = np.zeros(distance_px.size)
    for index, distance in enumerate(distance_px):
        response[index] = kernel[offsets >= -distance].sum()
    return response
