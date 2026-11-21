"""Light sources: a directional key light and a procedural environment.

The two sources are sampled independently so the renderer can emit
separate "direct" and "ambient" passes instead of a merged image.

Direction convention: ``wi`` points toward the light; all directions live
in the same local frame as the shading normal (z up).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import brdf


@dataclass(frozen=True)
class DirectionalLight:
    direction: tuple[float, float, float]
    color: tuple[float, float, float] = (1.0, 0.96, 0.88)
    # Radiance is shared across the disc; irradiance is intensity * solid
    # angle, so widening the disc brightens the surface without violating
    # energy conservation.  0.042 rad ~= 2.4 deg, a soft studio key light.
    intensity: float = 25.0
    angular_radius: float = 0.042

    def __post_init__(self):
        d = np.asarray(self.direction, dtype=float)
        object.__setattr__(self, "direction", tuple(d / np.linalg.norm(d)))

    def radiance(self, wi):
        """Finite-disc sun: constant radiance inside its angular radius."""
        sun = np.asarray(self.direction)
        cos_radius = np.cos(self.angular_radius)
        inside = brdf.dot(wi, np.broadcast_to(sun, wi.shape)) >= cos_radius
        value = np.asarray(self.color) * self.intensity
        out = np.zeros((*wi.shape[:-1], 3))
        out[inside] = value
        return out

    @property
    def solid_angle(self):
        return 2.0 * np.pi * (1.0 - np.cos(self.angular_radius))


@dataclass(frozen=True)
class EnvironmentLight:
    """Procedural sky: vertical gradient plus a bright soft sun blob.

    The gradient gives low-frequency ambient fill; the sun blob adds a
    localised highlight visible even on surfaces away from the key light.
    """

    sun_direction: tuple[float, float, float] = (0.45, -0.35, 0.82)
    sun_color: tuple[float, float, float] = (1.0, 0.92, 0.78)
    sun_intensity: float = 2.2
    sun_sigma: float = 0.12
    horizon: tuple[float, float, float] = (0.32, 0.36, 0.42)
    zenith: tuple[float, float, float] = (0.08, 0.11, 0.18)
    ground: tuple[float, float, float] = (0.10, 0.09, 0.08)

    def radiance(self, wi):
        sun = np.asarray(self.sun_direction)
        sun = sun / np.linalg.norm(sun)
        cos_ang = np.clip(brdf.dot(wi, np.broadcast_to(sun, wi.shape)), -1, 1)
        ang = np.arccos(cos_ang)
        blob = np.exp(-0.5 * (ang / self.sun_sigma) ** 2)
        z = wi[..., 2]
        t = np.clip(z, 0.0, 1.0)[..., None]
        sky = (1.0 - t) * np.asarray(self.horizon) + t * np.asarray(self.zenith)
        below = np.clip(-z, 0.0, 1.0)[..., None]
        sky = sky + below * (np.asarray(self.ground) - np.asarray(self.horizon))
        return sky + blob[..., None] * (
            np.asarray(self.sun_color) * self.sun_intensity
        )
