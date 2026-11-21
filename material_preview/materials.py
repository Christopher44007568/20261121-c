"""Material model: diffuse Lambert base + GGX specular lobes + clearcoat.

Energy bookkeeping
------------------
A base material is the sum of a Lambert lobe and weighted GGX specular
lobes (a broad dielectric lobe for the binder and a tight chromatic lobe
for embedded metal flakes).  A clearcoat is a separate dielectric layer:

* reflected light: a GGX lobe whose Fresnel term is the coat reflectance;
* transmitted light: enters and exits the coat with factors
  ``(1 - F(wi)) * (1 - F(wo))`` before reaching the base BRDF.

The two paths are mutually exclusive for a given photon, so the model does
not create energy, and every albedo / lobe weight stays inside [0, 1].
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import brdf


@dataclass(frozen=True)
class SpecLobe:
    """One weighted GGX specular lobe."""

    f0: tuple[float, float, float]
    alpha: float
    weight: float = 1.0
    label: str = "spec"


@dataclass(frozen=True)
class ClearCoat:
    """Transparent dielectric clearcoat (no absorption, unit thickness)."""

    ior: float = 1.5
    alpha: float = 0.02

    @property
    def f0(self):
        r = (self.ior - 1.0) / (self.ior + 1.0)
        v = r * r
        return np.array([v, v, v])


@dataclass(frozen=True)
class Material:
    name: str
    albedo: tuple[float, float, float]
    lobes: tuple[SpecLobe, ...] = field(default_factory=tuple)
    clearcoat: ClearCoat | None = None

    def eval(self, wi, wo):
        """Evaluate the full layered BRDF for direction arrays."""
        n_dot_l = np.clip(wi[..., 2], brdf.EPS, 1.0)
        n_dot_v = np.clip(wo[..., 2], brdf.EPS, 1.0)
        f_base = self._eval_base(wi, wo, n_dot_l, n_dot_v)
        if self.clearcoat is None:
            return f_base
        coat = self.clearcoat
        # Coat specular lobe: mirror reflection of the dielectric interface,
        # weighted by the Fresnel reflectance (its own energy budget).
        h = wi + wo
        h = h / (np.linalg.norm(h, axis=-1, keepdims=True) + brdf.EPS)
        n_dot_h = np.clip(h[..., 2], 0.0, 1.0)
        d = brdf.ggx_d(n_dot_h, coat.alpha)
        g = brdf.ggx_g(n_dot_l, n_dot_v, coat.alpha)
        # Interface Fresnel depends on the incidence angle to the macro
        # surface, not on the (rough) microfacet half vector.
        f_coat_fresnel = brdf.fresnel_schlick(n_dot_l, coat.f0)
        f_coat = (d * g / (4.0 * n_dot_l * n_dot_v + brdf.EPS))[..., None] \
            * f_coat_fresnel
        f_in = brdf.fresnel_schlick(n_dot_l, coat.f0)[..., 0]
        f_out = brdf.fresnel_schlick(n_dot_v, coat.f0)[..., 0]
        transmit = np.clip(1.0 - f_in, 0.0, 1.0) * np.clip(1.0 - f_out, 0.0, 1.0)
        return f_coat + transmit[..., None] * f_base

    def _eval_base(self, wi, wo, n_dot_l, n_dot_v):
        h = wi + wo
        h = h / (np.linalg.norm(h, axis=-1, keepdims=True) + brdf.EPS)
        n_dot_h = np.clip(h[..., 2], 0.0, 1.0)
        f = np.broadcast_to(np.asarray(self.albedo, dtype=float) / np.pi,
                            (*n_dot_l.shape, 3)).copy()
        for lobe in self.lobes:
            f += _ggx_lobe(wi, wo, n_dot_l, n_dot_v,
                           np.asarray(lobe.f0), lobe.alpha, lobe.weight,
                           n_dot_h=n_dot_h)
        return f


def _ggx_lobe(wi, wo, n_dot_l, n_dot_v, f0, alpha, weight, n_dot_h=None):
    h = wi + wo
    h = h / (np.linalg.norm(h, axis=-1, keepdims=True) + brdf.EPS)
    if n_dot_h is None:
        n_dot_h = np.clip(h[..., 2], 0.0, 1.0)
    h_dot_v = np.clip(brdf.dot(h, wo), brdf.EPS, 1.0)
    d = brdf.ggx_d(n_dot_h, alpha)
    g = brdf.ggx_g(n_dot_l, n_dot_v, alpha)
    f = brdf.fresnel_schlick(h_dot_v, np.asarray(f0))
    denom = 4.0 * n_dot_l * n_dot_v + brdf.EPS
    return weight * (d * g / denom)[..., None] * f
