"""End-to-end validation harness producing the convergence numbers.

Run:  PYTHONPATH=. python3 tests/run_validation.py
"""

import math
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shbake import bake, scenes, sh, validate
from shbake.geometry import normalize

EQUI_SIZES = [(32, 16), (64, 32), (128, 64), (256, 128), (512, 256), (1024, 512)]
CUBE_SIZES = [8, 16, 32, 64, 128, 256]


def fmt(x):
    return "%.3e" % x


def convergence_record(ref, energy, mode, resolution, coefs, weight):
    """One entry aligned with the reference artifacts/convergence.json schema."""
    max_coeff_err = max(
        abs(coefs[ch][i] - ref[ch][i]) for ch in range(3) for i in range(9)
    )
    got_energy = sh.total_energy(coefs)
    energy_abs = max(abs(got_energy[ch] - energy[ch]) for ch in range(3))
    higher = max(abs(coefs[ch][i]) for ch in range(3) for i in range(4, 9))
    return {
        "projection": mode,
        "resolution": list(resolution),
        "coeff_max_err": max_coeff_err,
        "energy_abs_err": energy_abs,
        "max_higher_band_coeff": higher,
        "solid_angle_err": abs(weight - 4 * math.pi),
    }


CASE_NAME = {
    "constant": "constant_sky",
    "spot": "directional_spot",
    "soft_spot": "smooth_directional_spot",
    "hemisphere": "hemisphere",
}


def convergence_table(scene, ref, mode):
    print(f"\n=== scene: {scene.name}  mode: {mode} ===")
    print("resolution        texels      weight-4pi rel.    coef RMSE vs analytic")
    rows = []
    if mode == "equirect":
        for width, height in EQUI_SIZES:
            img = scenes.rasterize_equirect(scene, width, height)
            coefs, weight = bake.bake_equirect(img, workers=bake.default_workers())
            werr = abs(weight - 4 * math.pi) / (4 * math.pi)
            rows.append(((width, height), width * height, werr,
                         validate.rmse(coefs, ref)))
    else:
        for size in CUBE_SIZES:
            faces = scenes.rasterize_cubemap(scene, size)
            coefs, weight = bake.bake_cubemap(faces, workers=bake.default_workers())
            werr = abs(weight - 4 * math.pi) / (4 * math.pi)
            rows.append(((size, size), 6 * size * size, werr,
                         validate.rmse(coefs, ref)))
    for res, texels, werr, err in rows:
        label = f"{res[0]}x{res[1]}" if mode == "equirect" else f"face {res[0]}"
        print(f"{label:<16}{texels:<12d}{fmt(werr):<20}{fmt(err)}")
    return rows


def main():
    out = {"four_pi": 4 * math.pi, "cases": {}}
    print("### 1. Quadrature weight partition (must sum to 4*pi) ###")
    for label, err in validate.check_quadrature_weights().items():
        print(f"  {label:<18} relative error {fmt(err)}")

    print("\n### 2. Energy conservation (baked total energy vs analytic) ###")
    all_scenes = [scenes.SCENES[k]()
                  for k in ("constant", "spot", "soft_spot", "hemisphere")]
    for scene in all_scenes:
        ref, energy = validate.reference_for(scene)
        img = scenes.rasterize_equirect(scene, 512, 256)
        coefs, _ = bake.bake_equirect(img, workers=bake.default_workers())
        print(f"  {scene.name:<11} energy rel. err {fmt(validate.relative_energy_error(coefs, energy))}")

    print("\n### 3. Rotation equivariance (baked-rotated vs SH-rotated) ###")
    spot = scenes.SCENES["soft_spot"]()
    axis = normalize((0.3, -0.8, 0.5))
    for mode, builder in (
        ("equirect",
         lambda fn: bake.bake_equirect(scenes.rasterize_equirect(fn, 256, 128),
                                       workers=bake.default_workers())[0]),
        ("cubemap",
         lambda fn: bake.bake_cubemap(scenes.rasterize_cubemap(fn, 64),
                                      workers=bake.default_workers())[0]),
    ):
        err = validate.check_rotation_equivalence(builder, spot, axis, 0.9)
        print(f"  {mode:<9} rotation RMSE {fmt(err)}")

    print("\n### 4. Axis / horizon structural rules ###")
    tilted = scenes.make_spot(normalize((0.5, 0.3, 0.8)), math.radians(10),
                              (1.0, 0.25, 0.1))
    faces = scenes.rasterize_cubemap(tilted, 128)
    spot_coefs, _ = bake.bake_cubemap(faces, workers=bake.default_workers())
    _, cosang = validate.axis_spot_check(spot_coefs, tilted.axis)
    print(f"  tilted-spot band1-axis cosine {cosang:.8f} (want 1.0)")
    pole = scenes.make_spot((0.0, 0.0, 1.0), math.radians(10), (1.0, 0.25, 0.1))
    pole_coefs, _ = bake.bake_cubemap(scenes.rasterize_cubemap(pole, 128),
                                      workers=bake.default_workers())
    pole_leak, _ = validate.axis_spot_check(pole_coefs, pole.axis)
    print(f"  pole-aligned spot m!=0 leakage {fmt(pole_leak)} (want 0)")
    hemi = scenes.SCENES["hemisphere"]()
    himg = scenes.rasterize_equirect(hemi, 256, 128)
    hcoefs, _ = bake.bake_equirect(himg, workers=bake.default_workers())
    print(f"  horizon m!=0 leakage {fmt(validate.hemisphere_rule_check(hcoefs))}")

    print("\n### 5. Convergence vs analytic reference ###")
    for scene in all_scenes:
        ref, energy = validate.reference_for(scene)
        case = []
        for width, height in EQUI_SIZES:
            img = scenes.rasterize_equirect(scene, width, height)
            coefs, weight = bake.bake_equirect(img, workers=bake.default_workers())
            case.append(convergence_record(ref, energy, "equirect",
                                           (height, width), coefs, weight))
        for size in CUBE_SIZES:
            faces = scenes.rasterize_cubemap(scene, size)
            coefs, weight = bake.bake_cubemap(faces, workers=bake.default_workers())
            case.append(convergence_record(ref, energy, "cubemap",
                                           (6, size, size), coefs, weight))
        out["cases"][CASE_NAME[scene.name]] = case
        convergence_table(scene, ref, "equirect")
        convergence_table(scene, ref, "cubemap")

    print("\n### 6. Reconstruction residual (Fibonacci probes) ###")
    for scene in all_scenes:
        img = scenes.rasterize_equirect(scene, 512, 256)
        coefs, _ = bake.bake_equirect(img, workers=bake.default_workers())
        print(f"  {scene.name:<11} mean |reconstruct - truth| {fmt(validate.reconstruction_error(coefs, scene))}")

    out_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "artifacts", "convergence_shbake.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
