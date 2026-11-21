"""Three-lobe separated diffusion profile, kept in sync with SSSProfile.hlsl."""

import numpy as np

# Standard deviation per lobe, per RGB channel, in world metres.
LOBE_RADIUS_M = np.array(
    [
        [0.0065, 0.0048, 0.0035],
        [0.0024, 0.0015, 0.0010],
        [0.00055, 0.0004, 0.00028],
    ],
    dtype=np.float64,
)

LOBE_WEIGHT = np.array(
    [
        [0.32, 0.15, 0.10],
        [0.38, 0.40, 0.35],
        [0.30, 0.45, 0.55],
    ],
    dtype=np.float64,
)

# Mean free path per RGB channel in metres (Beer-Lambert thickness term).
MEAN_FREE_PATH_M = np.array([0.0035, 0.0017, 0.0009], dtype=np.float64)

SCATTER_TINT = np.array([1.0, 0.36, 0.22], dtype=np.float64)

# Separable-kernel calibration, matching SSSProfile.hlsl.
SEPARABLE_KERNEL_SCALE = 0.7869


def effective_radius_m() -> np.ndarray:
    """Weighted first-moment radius per channel: sum_k w_k * sigma_k."""
    return np.sum(LOBE_WEIGHT * LOBE_RADIUS_M, axis=0) * SEPARABLE_KERNEL_SCALE


def transmission(thickness_m: np.ndarray | float) -> np.ndarray:
    """Beer-Lambert transmittance exp(-thickness / mfp), shape (..., 3)."""
    thickness_nd = np.ndim(thickness_m)
    thickness_m = np.asarray(thickness_m, dtype=np.float64)
    if thickness_nd == 0:
        return np.exp(-thickness_m / MEAN_FREE_PATH_M)
    return np.exp(-thickness_m[..., None] / MEAN_FREE_PATH_M[None, :])


def thickness_transmission_row(thickness_m: float) -> np.ndarray:
    """Convenience helper for scalar thickness values."""
    return transmission(np.float64(thickness_m))
