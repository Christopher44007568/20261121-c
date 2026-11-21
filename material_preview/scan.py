"""Grazing-angle scans and directional-hemispherical reflectance.

Two quantities are produced for a flat surface and a sphere:

* ``rho_dh(theta_v)``: directional-hemispherical reflectance, i.e. the
  fraction of incoming energy reflected back over the whole hemisphere,
  evaluated for a range of view zenith angles (0 = normal, ~90 = grazing).
  Energy-conserving materials keep every channel below 1.
* ``specular_profile(theta_v)``: reflected radiance for a fixed collimated
  beam at 45 deg incidence, scanned across view angles; used to locate the
  specular peak and to measure the integrated reflection.
"""

from __future__ import annotations

import numpy as np

from . import brdf
from .materials import Material


def view_directions(theta_deg, phi_deg=0.0):
    return _view_dir_rad(np.radians(theta_deg), np.radians(phi_deg))


def _view_dir_rad(theta, phi):
    return np.stack(
        [np.sin(theta) * np.cos(phi),
         np.sin(theta) * np.sin(phi),
         np.cos(theta)], axis=-1,
    )


def hemisphere_rays(n, rng):
    """Cosine-weighted hemisphere directions plus their PDF (z / pi)."""
    u1 = rng.random(n)
    u2 = rng.random(n)
    r = np.sqrt(u1)
    z = np.sqrt(np.clip(1.0 - u1, 0.0, 1.0))
    wi = np.stack([r * np.cos(2 * np.pi * u2),
                   r * np.sin(2 * np.pi * u2), z], axis=-1)
    return wi, z / np.pi


def directional_hemispherical(mat: Material, theta_v_deg, rng, samples=20000):
    """Monte-Carlo rho_dh for one view direction (per channel).

    A cosine-only estimator misses the narrow clearcoat / metal-flake lobes
    at grazing angles, so this combines cosine samples with GGX half-vector
    samples from every specular lobe using a uniform mixture + balance
    heuristic, matching the renderer's MIS strategy.
    """
    wo = view_directions(theta_v_deg)
    specs = [("cos", 0.0)] + [("ggx", lb.alpha) for lb in mat.lobes]
    if mat.clearcoat is not None:
        specs.append(("ggx", mat.clearcoat.alpha))
    n_strategy = len(specs)
    per_strategy = max(1, samples // n_strategy)
    acc = np.zeros(3)
    for kind, alpha in specs:
        if kind == "cos":
            wi, pdf_local = hemisphere_rays(per_strategy, rng)
        else:
            wi, pdf_local = brdf.sample_ggx(
                np.broadcast_to(wo, (per_strategy, 3)).copy(), alpha, rng)
        upper = wi[..., 2] > 0.0
        wo_s = np.broadcast_to(wo, wi.shape)
        f = mat.eval(wi, wo_s)
        mix_pdf = _mixture_pdf(mat, wi, wo_s)
        # Balance heuristic for an equal-count mixture of pdfs p_k:
        # w_s = p_s / (sum_k p_k).  The integrand's own 1/p_s cancels the
        # numerator, leaving f * cos / (n * mixture_pdf).
        weight = np.where(upper & (pdf_local > 0.0) & (mix_pdf > 0.0),
                          1.0, 0.0)
        estimate = weight[..., None] * f * wi[..., 2:3] \
            / (n_strategy * mix_pdf[..., None] + brdf.EPS)
        acc += estimate.mean(axis=0)
    return acc


def _mixture_pdf(mat, wi, wo):
    n_strategy = 1 + len(mat.lobes) + (1 if mat.clearcoat else 0)
    h = wi + wo
    h = h / (np.linalg.norm(h, axis=-1, keepdims=True) + brdf.EPS)
    n_dot_h = np.clip(h[..., 2], 0.0, 1.0)
    h_dot_v = np.clip(brdf.dot(h, wo), brdf.EPS, 1.0)
    pdf = np.clip(wi[..., 2], 0.0, 1.0) / np.pi
    for lobe in mat.lobes:
        pdf += brdf.ggx_pdf(n_dot_h, h_dot_v, lobe.alpha)
    if mat.clearcoat is not None:
        pdf += brdf.ggx_pdf(n_dot_h, h_dot_v, mat.clearcoat.alpha)
    return pdf / n_strategy


def grazing_scan(mat: Material, rng, angles=None, samples=12000):
    """rho_dh over view zenith angles; returns structured dict."""
    if angles is None:
        angles = np.linspace(0.0, 88.0, 23)
    rho = np.stack([
        directional_hemispherical(mat, float(a), rng, samples) for a in angles
    ])
    return {
        "material": mat.name,
        "view_theta_deg": np.asarray(angles),
        "rho_dh": rho,
        "rho_dh_mean": rho.mean(axis=1),
        "rho_max": float(rho.max()),
        "energy_ok": bool(rho.max() <= 1.02),
    }


def specular_profile(mat: Material, incidence_deg=45.0,
                     view_angles=None, beam_samples=40000, rng=None):
    """Lobe-resolved reflected radiance for a fixed-incidence collimated beam.

    Returns the total luminance profile plus one profile per physical lobe
    (diffuse, each GGX specular lobe, clearcoat).  Peak positions are found
    per specular lobe near its mirror angle, so broad dielectric lobes and
    narrow metal-flake / clearcoat lobes are measured independently instead
    of being masked by the Lambert 1/cos rise toward grazing.
    """
    if rng is None:
        rng = np.random.default_rng(0)
    if view_angles is None:
        view_angles = np.linspace(0.0, 89.0, 357)
    # Beam and viewer sit on opposite sides of the surface normal: when the
    # view zenith equals the incidence angle the half vector is the normal,
    # which is exactly where the mirror peak must land.
    wi = _view_dir_rad(np.radians(incidence_deg), 0.0)
    cone = _cone_samples(wi, beam_samples, np.radians(0.6), rng)
    wo = _view_dir_rad(np.radians(view_angles), np.pi)
    components = _lobe_components(mat, cone, wo)
    lum_w = np.array([0.2126, 0.7152, 0.0722])
    total_radiance = sum(components.values())
    luminance = total_radiance @ lum_w
    peaks = {}
    for label, radiance in components.items():
        if label == "diffuse":
            continue
        lum = radiance @ lum_w
        # Peak localisation uses the analytic, single-direction BRDF instead
        # of the cone average: a finite beam broadens a sharp lobe and its
        # cosine weighting biases the maximum.  The Smith geometry term shifts
        # the peak away from the mirror angle by an amount that grows with
        # roughness, so the scan spans a generous window around it.
        # Full-angle scan: for very rough dielectric lobes the Smith geometry
        # term pushes the radiance maximum all the way to grazing, while the
        # mirror angle still marks where the microfacet NDF itself peaks.
        fine_angles = np.linspace(0.0, 89.5, 1791)
        fine_lum = _analytic_lobe_luminance(
            mat, label, incidence_deg, fine_angles, lum_w)
        fine_idx = int(np.argmax(fine_lum))
        peaks[label] = {
            "peak_theta_deg": float(fine_angles[fine_idx]),
            "peak_luminance": float(fine_lum[fine_idx]),
            "mirror_theta_deg": float(incidence_deg),
            "peak_offset_deg": float(
                fine_angles[fine_idx] - incidence_deg),
            "integrated_reflection": float(
                np.trapezoid(lum, np.radians(view_angles))),
        }
    return {
        "material": mat.name,
        "incidence_deg": float(incidence_deg),
        "view_theta_deg": np.asarray(view_angles),
        "radiance": total_radiance,
        "luminance": luminance,
        "components": {k: v @ lum_w for k, v in components.items()},
        "peaks": peaks,
        "integrated_reflection": float(
            np.trapezoid(luminance, np.radians(view_angles))),
    }


def _lobe_components(mat, cone, wo):
    """Evaluate each physical lobe separately along the view-angle scan."""
    n_dot_l = np.clip(cone[..., 2], brdf.EPS, 1.0)
    out = {"diffuse": np.empty((wo.shape[0], 3))}
    for lobe in mat.lobes:
        out[lobe.label] = np.empty((wo.shape[0], 3))
    if mat.clearcoat is not None:
        out["clearcoat"] = np.empty((wo.shape[0], 3))
    albedo = np.asarray(mat.albedo) / np.pi
    coat = mat.clearcoat
    for i, w in enumerate(wo):
        wo_b = np.broadcast_to(w, cone.shape)
        n_dot_v = np.clip(wo_b[..., 2], brdf.EPS, 1.0)
        h = cone + wo_b
        h = h / (np.linalg.norm(h, axis=-1, keepdims=True) + brdf.EPS)
        n_dot_h = np.clip(h[..., 2], 0.0, 1.0)
        h_dot_v = np.clip(brdf.dot(h, wo_b), brdf.EPS, 1.0)
        diffuse = np.broadcast_to(albedo, cone.shape)
        if coat is not None:
            f_in = brdf.fresnel_schlick(n_dot_l, coat.f0)[..., 0]
            f_out = brdf.fresnel_schlick(n_dot_v, coat.f0)[..., 0]
            transmit = (np.clip(1 - f_in, 0, 1)
                        * np.clip(1 - f_out, 0, 1))[..., None]
            diffuse = diffuse * transmit
        out["diffuse"][i] = diffuse.mean(axis=0)
        for j, lobe in enumerate(mat.lobes):
            spec = _spec_lobe_values(
                cone, wo_b, n_dot_l, n_dot_v, n_dot_h, h_dot_v,
                np.asarray(lobe.f0), lobe.alpha, lobe.weight)
            if coat is not None:
                spec = spec * transmit
            out[lobe.label][i] = spec.mean(axis=0)
        if coat is not None:
            d = brdf.ggx_d(n_dot_h, coat.alpha)
            g = brdf.ggx_g(n_dot_l, n_dot_v, coat.alpha)
            f = brdf.fresnel_schlick(n_dot_l, coat.f0)
            coat_val = (d * g / (4 * n_dot_l * n_dot_v + brdf.EPS))[..., None] * f
            out["clearcoat"][i] = coat_val.mean(axis=0)
    return out


def _spec_lobe_values(wi, wo, n_dot_l, n_dot_v, n_dot_h, h_dot_v,
                      f0, alpha, weight):
    d = brdf.ggx_d(n_dot_h, alpha)
    g = brdf.ggx_g(n_dot_l, n_dot_v, alpha)
    f = brdf.fresnel_schlick(h_dot_v, f0)
    return weight * (d * g / (4 * n_dot_l * n_dot_v + brdf.EPS))[..., None] * f


def _single_lobe_luminance(mat, label, cone, wo, lum_w):
    """Luminance of one named lobe (including coat transmission) on a grid."""
    coat = mat.clearcoat
    out = np.empty(wo.shape[0])
    n_dot_l = np.clip(cone[..., 2], brdf.EPS, 1.0)
    for i, w in enumerate(wo):
        wo_b = np.broadcast_to(w, cone.shape)
        n_dot_v = np.clip(wo_b[..., 2], brdf.EPS, 1.0)
        h = cone + wo_b
        h = h / (np.linalg.norm(h, axis=-1, keepdims=True) + brdf.EPS)
        n_dot_h = np.clip(h[..., 2], 0.0, 1.0)
        h_dot_v = np.clip(brdf.dot(h, wo_b), brdf.EPS, 1.0)
        if label == "clearcoat":
            d = brdf.ggx_d(n_dot_h, coat.alpha)
            g = brdf.ggx_g(n_dot_l, n_dot_v, coat.alpha)
            f = brdf.fresnel_schlick(n_dot_l, coat.f0)
            val = (d * g / (4 * n_dot_l * n_dot_v + brdf.EPS))[..., None] * f
        else:
            lobe = next(lb for lb in mat.lobes if lb.label == label)
            val = _spec_lobe_values(
                cone, wo_b, n_dot_l, n_dot_v, n_dot_h, h_dot_v,
                np.asarray(lobe.f0), lobe.alpha, lobe.weight)
            if coat is not None:
                f_in = brdf.fresnel_schlick(n_dot_l, coat.f0)[..., 0]
                f_out = brdf.fresnel_schlick(n_dot_v, coat.f0)[..., 0]
                transmit = (np.clip(1 - f_in, 0, 1)
                            * np.clip(1 - f_out, 0, 1))[..., None]
                val = val * transmit
        out[i] = (val.mean(axis=0) @ lum_w)
    return out


def _analytic_lobe_luminance(mat, label, incidence_deg, view_angles, lum_w):
    """Single-direction (no beam cone) lobe luminance on a fine angle grid."""
    wi = _view_dir_rad(np.radians(incidence_deg), 0.0)
    out = np.empty(len(view_angles))
    coat = mat.clearcoat
    n_dot_l = max(wi[2], brdf.EPS)
    for i, angle in enumerate(view_angles):
        wo = _view_dir_rad(np.radians(angle), np.pi)
        n_dot_v = max(wo[2], brdf.EPS)
        h = wi + wo
        h = h / (np.linalg.norm(h) + brdf.EPS)
        n_dot_h = max(h[2], 0.0)
        h_dot_v = max(float(np.dot(h, wo)), brdf.EPS)
        if label == "clearcoat":
            d = brdf.ggx_d(n_dot_h, coat.alpha)
            g = brdf.ggx_g(n_dot_l, n_dot_v, coat.alpha)
            f = brdf.fresnel_schlick(np.array(n_dot_l), coat.f0)
            val = d * g / (4 * n_dot_l * n_dot_v + brdf.EPS) * f
        else:
            lobe = next(lb for lb in mat.lobes if lb.label == label)
            d = brdf.ggx_d(n_dot_h, lobe.alpha)
            g = brdf.ggx_g(n_dot_l, n_dot_v, lobe.alpha)
            f = brdf.fresnel_schlick(np.array(h_dot_v), np.asarray(lobe.f0))
            val = (lobe.weight * d * g
                   / (4 * n_dot_l * n_dot_v + brdf.EPS) * f)
            if coat is not None:
                f_in = float(brdf.fresnel_schlick(
                    np.array(n_dot_l), coat.f0)[0])
                f_out = float(brdf.fresnel_schlick(
                    np.array(n_dot_v), coat.f0)[0])
                val = val * (1 - f_in) * (1 - f_out)
        out[i] = float(val @ lum_w)
    return out


def _cone_samples(axis, n, half_angle, rng):
    u1 = rng.random(n)
    u2 = rng.random(n)
    cos_max = np.cos(half_angle)
    z = 1.0 - u1 * (1.0 - cos_max)
    r_xy = np.sqrt(np.clip(1.0 - z * z, 0.0, 1.0))
    local = np.stack([r_xy * np.cos(2 * np.pi * u2),
                      r_xy * np.sin(2 * np.pi * u2), z], axis=-1)
    axis = axis / np.linalg.norm(axis)
    ref = np.array([0.0, 0.0, 1.0]) if abs(axis[2]) < 0.99 else np.array([1.0, 0.0, 0.0])
    t = ref - axis * np.dot(ref, axis)
    t /= np.linalg.norm(t)
    b = np.cross(axis, t)
    return local[..., 0:1] * t + local[..., 1:2] * b + local[..., 2:3] * axis
