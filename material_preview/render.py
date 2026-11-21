"""Path-local shading integrator (one bounce, vectorised over pixels).

Direct light and environment light are integrated in separate functions so
the caller can visualise them independently.  Every sampling strategy
(cosine for Lambert, GGX half-vector for each specular lobe and for the
clearcoat) is combined with the balance-heuristic MIS, which keeps the
estimator unbiased when weights are changed while preserving energy.
"""

from __future__ import annotations

import numpy as np

from . import brdf
from .lighting import DirectionalLight, EnvironmentLight
from .materials import Material


def _sun_sample(light: DirectionalLight, n_points, rng):
    """Uniform draw on the sun's solid-angle disc; returns (wi, pdf)."""
    sun = np.asarray(light.direction)
    u1 = rng.random(n_points)
    u2 = rng.random(n_points)
    cos_max = np.cos(light.angular_radius)
    z = 1.0 - u1 * (1.0 - cos_max)
    r_xy = np.sqrt(np.clip(1.0 - z * z, 0.0, 1.0))
    local = np.stack([r_xy * np.cos(2 * np.pi * u2),
                      r_xy * np.sin(2 * np.pi * u2), z], axis=-1)
    ref = np.array([0.0, 0.0, 1.0]) if abs(sun[2]) < 0.99 \
        else np.array([1.0, 0.0, 0.0])
    t = ref - sun * np.dot(ref, sun)
    t /= np.linalg.norm(t)
    b = np.cross(sun, t)
    wi = local[..., 0:1] * t + local[..., 1:2] * b + local[..., 2:3] * sun
    pdf = np.full(n_points, 1.0 / light.solid_angle)
    return wi, pdf


def _sun_pdf(light: DirectionalLight, wi_world):
    sun = np.asarray(light.direction)
    cos_radius = np.cos(light.angular_radius)
    inside = brdf.dot(wi_world, np.broadcast_to(sun, wi_world.shape)) >= cos_radius
    return np.where(inside, 1.0 / light.solid_angle, 0.0)


def local_frame(normal):
    z = normal / (np.linalg.norm(normal, axis=-1, keepdims=True) + brdf.EPS)
    ref = np.where(np.abs(z[..., 2:3]) < 0.99,
                   np.array([0.0, 0.0, 1.0]), np.array([1.0, 0.0, 0.0]))
    t = ref - z * np.sum(ref * z, axis=-1, keepdims=True)
    t = t / (np.linalg.norm(t, axis=-1, keepdims=True) + brdf.EPS)
    b = np.cross(z, t)
    return t, b, z


def to_local(frame, v):
    t, b, z = frame
    return np.stack([np.sum(v * t, -1), np.sum(v * b, -1), np.sum(v * z, -1)], -1)


def to_world(frame, v):
    t, b, z = frame
    return v[..., 0:1] * t + v[..., 1:2] * b + v[..., 2:3] * z


def _strategies(mat: Material):
    """Return (kind, alpha) for each equally-weighted MIS strategy."""
    specs = [("diffuse", 0.0)]
    specs += [("ggx", lobe.alpha) for lobe in mat.lobes]
    if mat.clearcoat is not None:
        specs.append(("ggx", mat.clearcoat.alpha))
    return specs


def _strategy_pdf(mat: Material, wi_local, wo_local):
    """PDF of the full mixture for directions drawn by any strategy."""
    n_strategies = 1 + len(mat.lobes) + (1 if mat.clearcoat else 0)
    diffuse_pdf = np.clip(wi_local[..., 2], 0.0, 1.0) / np.pi
    total = diffuse_pdf
    for lobe in mat.lobes:
        h = wi_local + wo_local
        h = h / (np.linalg.norm(h, axis=-1, keepdims=True) + brdf.EPS)
        total += brdf.ggx_pdf(np.clip(h[..., 2], 0, 1),
                              np.clip(brdf.dot(h, wo_local), brdf.EPS, 1),
                              lobe.alpha)
    if mat.clearcoat is not None:
        h = wi_local + wo_local
        h = h / (np.linalg.norm(h, axis=-1, keepdims=True) + brdf.EPS)
        total += brdf.ggx_pdf(np.clip(h[..., 2], 0, 1),
                              np.clip(brdf.dot(h, wo_local), brdf.EPS, 1),
                              mat.clearcoat.alpha)
    return total / n_strategies


def _mis_estimate(mat, frame, wo_world, light_fn, rng, samples):
    """Shared MIS loop; one draw per strategy per sample (balance heuristic)."""
    t, b, z = frame
    wo_local = to_local(frame, wo_world)
    flat_wo = wo_local.reshape(-1, 3)
    flat_n = z.reshape(-1, 3)
    flat_t, flat_b = t.reshape(-1, 3), b.reshape(-1, 3)
    specs = _strategies(mat)
    n_strategy = len(specs)
    acc = np.zeros((flat_wo.shape[0], 3))
    total_draws = n_strategy * samples
    for _ in range(samples):
        for kind, alpha in specs:
            if kind == "diffuse":
                wi_local, pdf_local = brdf.sample_cosine(flat_wo, rng)
            else:
                wi_local, pdf_local = brdf.sample_ggx(flat_wo, alpha, rng)
            upper = wi_local[..., 2] > 0.0
            wi_world = to_world((flat_t, flat_b, flat_n), wi_local)
            f = mat.eval(wi_local, flat_wo)
            li = light_fn(wi_world)
            mix_pdf = _strategy_pdf(mat, wi_local, flat_wo)
            draw_pdf = pdf_local / n_strategy
            weight = np.where(upper & (pdf_local > 0.0) & (mix_pdf > 0.0),
                              draw_pdf / np.where(mix_pdf > 0, mix_pdf, 1.0),
                              0.0)
            acc += weight[..., None] * f * li
    return acc / total_draws


def render_direct(mat, hit, normals, view_dirs, light: DirectionalLight,
                  rng, samples=4):
    """Direct key light: explicit sun sampling combined with BRDF MIS."""
    shape = hit.shape
    frame = local_frame(normals)
    wo = -view_dirs
    out = np.zeros((*shape, 3))
    t, b, z = (frame[0][hit], frame[1][hit], frame[2][hit])
    wo_local = to_local((t, b, z), wo[hit])
    n_pts = wo_local.shape[0]
    acc = np.zeros((n_pts, 3))
    for _ in range(samples):
        # Strategy 1: sample the sun disc in world space.
        wi_world, pdf_light = _sun_sample(light, n_pts, rng)
        wi_local = to_local((t, b, z), wi_world)
        upper = wi_local[..., 2] > 0.0
        f = mat.eval(wi_local, wo_local)
        li = light.radiance(wi_world)
        pdf_brdf = _strategy_pdf(mat, wi_local, wo_local)
        w_light = np.where(upper & (pdf_light > 0),
                           pdf_light / (pdf_light + pdf_brdf + brdf.EPS), 0.0)
        acc += w_light[..., None] * f * li / pdf_light[..., None]
        # Strategy 2: sample the BRDF, weight against the sun pdf.
        for kind, alpha in _strategies(mat):
            if kind == "diffuse":
                wi_l, _pdf_b = brdf.sample_cosine(wo_local, rng)
            else:
                wi_l, _pdf_b = brdf.sample_ggx(wo_local, alpha, rng)
            wi_w = to_world((t, b, z), wi_l)
            upper = wi_l[..., 2] > 0.0
            f = mat.eval(wi_l, wo_local)
            li = light.radiance(wi_w)
            p_l = _sun_pdf(light, wi_w)
            p_b = _strategy_pdf(mat, wi_l, wo_local)
            w_brdf = np.where(upper & (p_b > 0),
                              p_b / (p_b + p_l + brdf.EPS), 0.0)
            acc += w_brdf[..., None] * f * li
    out[hit] = acc / samples
    return out


def render_ambient(mat, hit, normals, view_dirs, env: EnvironmentLight,
                   rng, samples=4):
    shape = hit.shape
    frame = local_frame(normals)
    wo = -view_dirs
    out = np.zeros((*shape, 3))
    out[hit] = _mis_estimate(
        mat, (frame[0][hit], frame[1][hit], frame[2][hit]),
        wo[hit], lambda wi: env.radiance(wi), rng, samples,
    )
    return out
