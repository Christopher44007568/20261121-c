"""BRDF primitives: GGX microfacet, Schlick Fresnel, Lambert diffuse.

Conventions
-----------
* All vectors are unit length, points on the upper hemisphere.
* ``wi`` points *toward* the light, ``wo`` points *toward* the viewer.
* A flat layer reflectance is stored as linear sRGB triplets in [0, 1].
* BRDF values are spectral (per-channel) radiance / irradiance, sr^-1.
"""

from __future__ import annotations

import numpy as np

EPS = 1.0e-4


def clamp01(x):
    return np.clip(x, 0.0, 1.0)


def dot(a, b):
    return np.sum(a * b, axis=-1)


def reflect(i, n):
    """Reflect incident direction ``i`` (pointing toward surface) about ``n``."""
    d = dot(n, i)[..., None]
    return i - 2.0 * n * d


def fresnel_schlick(cos_theta, f0):
    """Schlick Fresnel; ``f0`` broadcasts over the last channel axis."""
    t = np.clip(1.0 - cos_theta, 0.0, 1.0)[..., None]
    return f0 + (1.0 - f0) * t**5


def ggx_d(n_dot_h, alpha):
    """GGX (Trowbridge-Reitz) normal distribution function."""
    a2 = alpha * alpha
    denom = n_dot_h**2 * (a2 - 1.0) + 1.0
    return a2 / (np.pi * denom * denom + EPS)


def ggx_g1(n_dot_v, alpha):
    """Smith GGX geometry term (single direction)."""
    a2 = alpha * alpha
    return 2.0 * n_dot_v / (n_dot_v + np.sqrt(a2 + (1.0 - a2) * n_dot_v**2) + EPS)


def ggx_g(n_dot_l, n_dot_v, alpha):
    """Smith combined shadowing-masking term."""
    return ggx_g1(n_dot_l, alpha) * ggx_g1(n_dot_v, alpha)


def ggx_pdf(n_dot_h, h_dot_v, alpha):
    """Solid-angle PDF of GGX half-vector importance sampling (in ``wi`` space)."""
    d = ggx_d(n_dot_h, alpha)
    jacobian = 4.0 * np.maximum(h_dot_v, EPS)
    return d * np.maximum(n_dot_h, 0.0) / jacobian


def sample_ggx(wo, alpha, rng):
    """Importance-sample GGX around the shading normal (z), not the viewer.

    The half vector is drawn in the normal-aligned local frame, then the
    incident direction is the reflection of ``-wo`` about that half vector.
    Keeping every direction in the normal frame makes the returned pdf
    (defined over incident solid angle) consistent with ``ggx_pdf``.
    """
    shape = wo.shape[:-1]
    u1 = rng.random(shape)
    u2 = rng.random(shape)
    a2 = alpha * alpha
    phi = 2.0 * np.pi * u2
    # GGX/Beckmann-style inversion: cos(theta_h) = sqrt((1-u)/(1+(a^2-1)u))
    # is the correct half-vector CDF for the GGX distribution.
    cos_h = np.sqrt(np.clip((1.0 - u1) / (1.0 + (a2 - 1.0) * u1), 0.0, 1.0))
    sin_h = np.sqrt(np.clip(1.0 - cos_h**2, 0.0, 1.0))
    h = np.stack(
        [sin_h * np.cos(phi), sin_h * np.sin(phi), cos_h], axis=-1
    )
    wi = reflect(-wo, h)
    n_dot_h = cos_h
    h_dot_v = np.clip(dot(h, wo), EPS, 1.0)
    pdf = ggx_pdf(n_dot_h, h_dot_v, alpha)
    below = wi[..., 2] <= 0.0
    pdf = np.where(below, 0.0, pdf)
    return wi, pdf


def sample_cosine(wo, rng):
    """Cosine-weighted hemisphere sample; ``wo`` only fixes the shading frame."""
    shape = wo.shape[:-1]
    u1 = rng.random(shape)
    u2 = rng.random(shape)
    r = np.sqrt(u1)
    z = np.sqrt(np.clip(1.0 - u1, 0.0, 1.0))
    local = np.stack(
        [r * np.cos(2.0 * np.pi * u2), r * np.sin(2.0 * np.pi * u2), z],
        axis=-1,
    )
    frame = _frame_from_z(np.broadcast_to(np.array([0.0, 0.0, 1.0]), wo.shape))
    wi = _from_local(frame, local)
    pdf = z / np.pi
    return wi, pdf


def _frame_from_z(z):
    """Build an orthonormal frame (tangent, bitangent, normal) from normal ``z``."""
    z = z / (np.linalg.norm(z, axis=-1, keepdims=True) + EPS)
    up = np.where(np.abs(z[..., 2:3]) < 0.99, np.array([0.0, 0.0, 1.0]),
                  np.array([1.0, 0.0, 0.0]))
    t = up - z * np.sum(up * z, axis=-1, keepdims=True)
    t = t / (np.linalg.norm(t, axis=-1, keepdims=True) + EPS)
    b = np.cross(z, t)
    return np.stack([t, b, z], axis=-2)


def _from_local(frame, local):
    t, b, n = frame[..., 0, :], frame[..., 1, :], frame[..., 2, :]
    return (
        local[..., 0:1] * t
        + local[..., 1:2] * b
        + local[..., 2:3] * n
    )
