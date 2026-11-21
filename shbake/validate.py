"""Numeric validation: energy, rotation, axis/horizon rules, convergence."""

import math

from .geometry import equirect_grid, cubemap_grid, total_solid_angle
from .sh import (
    N_COEF,
    analytic_constant,
    analytic_hemisphere,
    analytic_soft_spot,
    analytic_zonal_spot,
    basis,
    reconstruct,
    rotate,
    rotation_axis_angle,
    rotation_matrix,
    total_energy,
)

FOUR_PI = 4.0 * math.pi


def rmse(a, b):
    """Per-coefficient RMS difference over the 3x9 RGB coefficient block."""
    total = 0.0
    for ch in range(3):
        for k in range(N_COEF):
            d = a[ch][k] - b[ch][k]
            total += d * d
    return math.sqrt(total / (3 * N_COEF))


def relative_energy_error(coefs, expected_energy):
    got = total_energy(coefs)
    errs = []
    for ch, ref in enumerate(expected_energy):
        if abs(ref) > 1e-12:
            errs.append(abs(got[ch] - ref) / abs(ref))
    return max(errs) if errs else abs(got[0])


def reconstruction_error(coefs, color_fn, probes=2048):
    """Mean absolute reconstruction residual over a Fibonacci sphere."""
    golden = math.pi * (3.0 - math.sqrt(5.0))
    err = 0.0
    for i in range(probes):
        z = 1.0 - (2.0 * i + 1.0) / probes
        r = math.sqrt(max(0.0, 1.0 - z * z))
        phi = golden * i
        d = (r * math.cos(phi), r * math.sin(phi), z)
        got = reconstruct(coefs, d)
        ref = color_fn(d)
        err += sum(abs(got[ch] - ref[ch]) for ch in range(3)) / 3.0
    return err / probes


def check_quadrature_weights():
    """Both grids must partition the sphere into exactly 4 pi steradians."""
    out = {}
    for width, height in ((64, 32), (256, 128)):
        got = total_solid_angle(equirect_grid(width, height))
        out[f"equirect {width}x{height}"] = abs(got - FOUR_PI) / FOUR_PI
    for size in (16, 64):
        got = total_solid_angle(list(cubemap_grid(size)))
        out[f"cubemap {size}"] = abs(got - FOUR_PI) / FOUR_PI
    return out


def check_rotation_equivalence(build_fn, scene_fn, axis, angle):
    """Bake a rotated scene vs. rotate the baked SH: they must agree.

    build_fn(color_fn) -> coefs.  A direction d in the rotated scene carries
    radiance L(R d).  Under the change of variable d' = R d this rotates the
    coefficient vector by the inverse R, i.e. by M^T, which is what the baked
    result is compared against.
    """
    R = rotation_axis_angle(axis, angle)
    M = rotation_matrix(R)

    def rotated(d):
        rd = (
            R[0][0] * d[0] + R[0][1] * d[1] + R[0][2] * d[2],
            R[1][0] * d[0] + R[1][1] * d[1] + R[1][2] * d[2],
            R[2][0] * d[0] + R[2][1] * d[1] + R[2][2] * d[2],
        )
        return scene_fn(rd)

    baked_rotated = build_fn(rotated)
    mt = [[M[j][i] for j in range(N_COEF)] for i in range(N_COEF)]
    rotated_coefs = rotate(build_fn(scene_fn), mt)
    return rmse(baked_rotated, rotated_coefs)


def axis_spot_check(coefs, axis):
    """Check the band-1 directional vector of a zonal spot.

    A cone around an arbitrary tilted axis legitimately has nonzero m!=0 SH
    terms, so leakage is only zero for a pole-aligned spot.  The robust
    axis test is that the band-1 vector points exactly along the cone axis;
    the returned leakage value is intended for pole-aligned inputs only.
    """
    r, g, b = coefs
    # In the pole frame only indices 0 (Y00), 2 (Y10), 6 (Y20) survive.
    pole_frame = (1, 3, 4, 5, 7, 8)
    leak = max(abs(c[k]) for c in coefs for k in pole_frame)
    # band-1 directional vector in cartesian (x=idx3, y=idx1, z=idx2)
    vec = (r[3], r[1], r[2])
    n = math.sqrt(sum(v * v for v in vec))
    an = math.sqrt(sum(v * v for v in axis))
    cosang = sum(vec[i] * axis[i] for i in range(3)) / (n * an)
    return leak, cosang


def hemisphere_rule_check(coefs):
    """Two-color horizon: every azimuthal (m!=0) coefficient must be zero."""
    return max(
        abs(coefs[ch][k])
        for ch in range(3)
        for k in (1, 3, 4, 5, 7, 8)
    )


def reference_for(scene):
    name = scene.name
    if name == "constant":
        color = scene((0, 0, 1))
        return analytic_constant(color), [v * FOUR_PI for v in color]
    if name == "spot":
        return (
            analytic_zonal_spot(scene.axis, scene.half_angle, scene.color),
            [v * 2.0 * math.pi * (1.0 - math.cos(scene.half_angle))
             for v in scene.color],
        )
    if name == "hemisphere":
        return (
            analytic_hemisphere(scene.top, scene.bottom),
            [2.0 * math.pi * (scene.top[ch] + scene.bottom[ch]) for ch in range(3)],
        )
    if name == "soft_spot":
        n = scene.exponent
        return (
            analytic_soft_spot(scene.axis, n, scene.color),
            # int color mu^n dOmega = 2 pi color / (n+1)
            [2.0 * math.pi * v / (n + 1.0) for v in scene.color],
        )
    raise KeyError(name)
