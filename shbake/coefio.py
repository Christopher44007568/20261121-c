"""SH coefficient container and JSON serialization."""

import json

from .sh import N_COEF


def normalize_coefs(coefs):
    """Accept either flat-9 or RGB(3x9); always return 3x9 floats."""
    if coefs and isinstance(coefs[0], (list, tuple)):
        out = [[float(v) for v in ch[:N_COEF]] for ch in coefs[:3]]
        while len(out) < 3:
            out.append([0.0] * N_COEF)
        return out
    flat = [float(v) for v in coefs[:N_COEF]]
    return [flat[:], flat[:], flat[:]]


def save_coefs(path, coefs, meta=None):
    payload = {
        "format": "shbake-sh3-v1",
        "bands": 3,
        "convention": "real SH, Condon-Shortley, z-up",
        "basis_order": [
            "Y00", "Y1-1", "Y10", "Y11",
            "Y2-2", "Y2-1", "Y20", "Y21", "Y22",
        ],
        "coefficients_rgb": normalize_coefs(coefs),
    }
    if meta:
        payload["meta"] = meta
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


def save_shbake_v1(path, coefs, projection, resolution, total_solid_angle):
    """Write the reference-compatible `shbake-v1` record.

    Coefficients are stored per-basis as 9 rows of RGB (9x3), alongside the
    reconstructed total energy and quadrature solid-angle sum.
    """
    from .sh import total_energy
    rgb = normalize_coefs(coefs)
    coeffs_9x3 = [[rgb[ch][i] for ch in range(3)] for i in range(N_COEF)]
    payload = {
        "schema": "shbake-v1",
        "convention": "real-sh-sloan; z-up; x=sin(theta)cos(phi) "
                      "y=sin(theta)sin(phi) z=cos(theta)",
        "projection": projection,
        "resolution": list(resolution),
        "channels": 3,
        "total_solid_angle": total_solid_angle,
        "energy": total_energy(rgb),
        "coeffs": coeffs_9x3,
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


def load_coefs(path):
    with open(path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if payload.get("schema") == "shbake-v1":
        rows = payload["coeffs"]  # 9 x 3
        rgb = [[rows[i][ch] for i in range(N_COEF)] for ch in range(3)]
        wrapped = {
            "format": "shbake-sh3-v1",
            "bands": 3,
            "convention": payload.get("convention", ""),
            "coefficients_rgb": rgb,
            "meta": {"source_schema": "shbake-v1"},
        }
        return normalize_coefs(rgb), wrapped
    return normalize_coefs(payload["coefficients_rgb"]), payload
