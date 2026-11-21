"""Command-line entry point for the offline material previewer.

Outputs (written to an output directory, default ``artifacts``):

* ``direct_vs_ambient.png``   - direct key light and ambient environment
  rendered as separate passes for every material;
* ``clearcoat_compare.png``   - side-by-side with/without clearcoat, plus a
  per-pixel difference map;
* ``grazing_scan.png``         - directional-hemispherical reflectance and
  lobe-resolved specular profiles over view zenith angle, for a flat surface;
* ``sphere_scan.png``          - the same grazing behaviour visualised on a
  sphere (normal at centre, grazing at the silhouette);
* ``metrics.json`` / ``metrics.csv`` - peak positions, peak offsets,
  integrated reflection and energy-conservation checks.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .geometry import Plane, Sphere, camera_rays, intersect, make_camera
from .lighting import DirectionalLight, EnvironmentLight
from .presets import flake_base, preset_stack, primer, with_clearcoat
from .render import render_ambient, render_direct
from .scan import grazing_scan, specular_profile

LUMA = np.array([0.2126, 0.7152, 0.0722])


def aces_tonemap(x):
    """ACES filmic curve, applied per channel; keeps HDR highlights bounded."""
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)


def to_srgb(linear):
    return np.where(linear <= 0.0031308, 12.92 * linear,
                    1.055 * np.power(np.clip(linear, 0, 1), 1 / 2.4) - 0.055)


def display(hdr, exposure=1.0):
    return to_srgb(aces_tonemap(hdr * exposure))


def luma(x):
    return x @ LUMA


def _median3(a):
    """3x3 median filter on a 2D field (NumPy-only, keeps edges bounded)."""
    out = a.copy()
    pad = np.pad(a, 1, mode="edge")
    windows = np.stack([
        pad[dy:dy + a.shape[0], dx:dx + a.shape[1]]
        for dy in range(3) for dx in range(3)
    ], axis=-1)
    out = np.median(windows, axis=-1)
    return out


def build_scene(width=220, height=168):
    camera = make_camera((2.3, -3.1, 1.7), (0.0, 0.0, -0.15))
    origins, dirs = camera_rays(camera, width, height)
    sphere = Sphere(np.array([0.0, 0.0, 0.12]), 0.82)
    plane = Plane()
    hit, _t, _points, normals = intersect(origins, dirs, sphere, plane)
    # Independent sphere-only intersection gives an unambiguous object mask
    # (the shared nearest-hit routine otherwise labels every floor pixel too).
    oc = origins - sphere.center
    b = np.sum(oc * dirs, axis=-1)
    c = np.sum(oc * oc, axis=-1) - sphere.radius**2
    disc = b * b - c
    t_sphere = -b - np.sqrt(np.maximum(disc, 0.0))
    sphere_mask = disc > 0.0
    sphere_t = np.where(sphere_mask, t_sphere, np.inf)
    plane_t = (plane.offset - origins[..., 2]) / dirs[..., 2]
    sphere_mask = sphere_mask & (sphere_t < plane_t)
    return origins, dirs, hit, normals, sphere_mask


def render_material(material, hit, normals, dirs, seed, samples):
    rng = np.random.default_rng(seed)
    light = DirectionalLight((0.42, -0.30, 0.86))
    env = EnvironmentLight()
    direct = render_direct(material, hit, normals, dirs, light, rng, samples)
    ambient = render_ambient(material, hit, normals, dirs, env, rng, samples)
    return direct, ambient


def _imshow(ax, img, hit, title, exposure):
    frame = np.zeros((*img.shape[:-1], 3))
    frame[hit] = display(img[hit], exposure)
    ax.imshow(frame, origin="upper")
    ax.set_title(title, fontsize=9)
    ax.set_xticks([])
    ax.set_yticks([])


def plot_direct_ambient(materials, renders, hit, out_path, exposure):
    n = len(materials)
    fig, axes = plt.subplots(2, n, figsize=(3.4 * n, 6.4))
    if n == 1:
        axes = axes.reshape(2, 1)
    for j, mat in enumerate(materials):
        direct, ambient = renders[mat.name]
        _imshow(axes[0, j], direct, hit, f"{mat.name}\ndirect key light", exposure)
        _imshow(axes[1, j], ambient, hit, f"{mat.name}\nambient environment",
                exposure)
    fig.suptitle("Direct light vs ambient light (separate passes, ACES)")
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)


def plot_clearcoat_compare(pairs, renders, hit, sphere_mask, out_path,
                           exposure):
    rows = len(pairs)
    fig, axes = plt.subplots(rows, 3, figsize=(10.5, 3.3 * rows),
                             squeeze=False)
    for r, (base, coated) in enumerate(pairs):
        d0, a0 = renders[base.name]
        d1, a1 = renders[coated.name]
        before = display(d0 + a0, exposure)
        after = display(d1 + a1, exposure)
        diff = np.zeros_like(before)
        # Absolute linear-HDR luminance difference with a fixed global scale:
        # a relative metric would divide by the near-zero background and let
        # Monte-Carlo grain dominate instead of the actual coat response.
        delta = luma(d1 + a1) - luma(d0 + a0)
        delta = _median3(delta)
        scale = np.percentile(np.abs(delta[sphere_mask]), 99.0) + 1e-6
        diff[sphere_mask, 0] = np.clip(delta[sphere_mask] / scale, 0, 1)
        diff[sphere_mask, 1] = np.clip(-delta[sphere_mask] / scale, 0, 1)
        diff[~sphere_mask] = 0.18  # neutral grey for plane / background
        for c, (img, title) in enumerate([
            (before, f"{base.name}\n(no clearcoat)"),
            (after, f"{coated.name}\n(with clearcoat)"),
            (diff, "linear luminance change\nred=added, green=removed"),
        ]):
            axes[r, c].imshow(img, origin="upper")
            axes[r, c].set_title(title, fontsize=9)
            axes[r, c].set_xticks([])
            axes[r, c].set_yticks([])
    fig.suptitle("Clearcoat on/off comparison")
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)

def plot_grazing_scan(materials, rng, out_path, scan_samples):
    fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.6))
    profiles = {}
    for mat in materials:
        graze = grazing_scan(mat, rng, samples=scan_samples)
        prof = specular_profile(mat, rng=np.random.default_rng(11))
        profiles[mat.name] = (graze, prof)
        axes[0].plot(graze["view_theta_deg"], graze["rho_dh_mean"],
                     marker="o", ms=3, label=mat.name)
        axes[1].plot(prof["view_theta_deg"], prof["luminance"],
                     label=mat.name)
        for label, comp in prof["components"].items():
            if label == "diffuse":
                continue
            axes[1].plot(prof["view_theta_deg"], comp, "--", lw=1,
                         alpha=0.6)
    axes[0].axhline(1.0, color="k", ls=":", lw=1, label="energy ceiling")
    axes[0].set_xlabel("view zenith angle (deg)")
    axes[0].set_ylabel("directional-hemispherical reflectance")
    axes[0].set_title("Flat surface: integrated reflection vs view angle")
    axes[0].legend(fontsize=7)
    axes[0].grid(alpha=0.3)
    axes[1].set_xlabel("view zenith angle (deg)")
    axes[1].set_ylabel("reflected luminance (collimated 45 deg beam)")
    axes[1].set_title("Specular profile (dashed = individual lobes)")
    axes[1].set_yscale("log")
    axes[1].legend(fontsize=7)
    axes[1].grid(alpha=0.3, which="both")
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
    return profiles


def plot_sphere_scan(materials, renders, hit, sphere_mask, normals, dirs,
                     out_path, exposure):
    """Map the sphere's surface normal to view zenith for a grazing read."""
    n = len(materials)
    fig, axes = plt.subplots(1, n, figsize=(3.4 * n, 3.6), squeeze=False)
    for j, mat in enumerate(materials):
        direct, ambient = renders[mat.name]
        img = np.zeros((*hit.shape, 3))
        img[sphere_mask] = display(
            direct[sphere_mask] + ambient[sphere_mask], exposure)
        img[~sphere_mask] = 0.18
        axes[0, j].imshow(img, origin="upper")
        view_zenith = np.degrees(np.arccos(
            np.clip(-np.sum(normals * dirs, axis=-1), 0, 1)))
        axes[0, j].set_title(
            f"{mat.name}\nzenith {view_zenith[sphere_mask].min():.0f} deg "
            f"(center) -> {view_zenith[sphere_mask].max():.0f} deg (rim)",
            fontsize=8)
        axes[0, j].set_xticks([])
        axes[0, j].set_yticks([])
    fig.suptitle("Grazing-angle scan visualised on a sphere")
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)


def export_metrics(materials, profiles, graze_data, out_dir):
    rows = []
    for mat in materials:
        graze, prof = profiles[mat.name]
        for lobe, peak in prof["peaks"].items():
            rows.append({
                "material": mat.name,
                "lobe": lobe,
                "peak_theta_deg": round(peak["peak_theta_deg"], 3),
                "mirror_theta_deg": peak["mirror_theta_deg"],
                "peak_offset_deg": round(peak["peak_offset_deg"], 3),
                "peak_luminance": round(peak["peak_luminance"], 5),
                "lobe_integrated_reflection": round(
                    peak["integrated_reflection"], 5),
            })
        total = next(r for r in rows if r["material"] == mat.name)
        total["total_integrated_reflection"] = round(
            prof["integrated_reflection"], 5)
        total["rho_dh_max"] = round(graze["rho_max"], 5)
        total["energy_conservation_ok"] = graze["energy_ok"]
    csv_path = out_dir / "metrics.csv"
    with csv_path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    payload = {
        "materials": [m.name for m in materials],
        "energy_audit": {
            name: {
                "rho_dh_max": round(graze_data[name]["rho_max"], 5),
                "energy_conservation_ok": graze_data[name]["energy_ok"],
                "rho_dh_at_normal": graze_data[name]["rho_dh"][0].tolist(),
                "rho_dh_at_grazing": graze_data[name]["rho_dh"][-1].tolist(),
            }
            for name in graze_data
        },
        "specular_peaks": rows,
    }
    (out_dir / "metrics.json").write_text(json.dumps(payload, indent=2))
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="artifacts", help="output directory")
    parser.add_argument("--width", type=int, default=220)
    parser.add_argument("--height", type=int, default=168)
    parser.add_argument("--samples", type=int, default=4,
                        help="MIS samples per shading strategy")
    parser.add_argument("--scan-samples", type=int, default=9000,
                        help="hemisphere MC samples for rho_dh")
    parser.add_argument("--exposure", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=20261121)
    args = parser.parse_args(argv)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    materials = preset_stack()
    _origins, dirs, hit, normals, sphere_mask = build_scene(
        args.width, args.height)

    renders = {}
    for mat in materials:
        # Shared seed across materials: the on/off clearcoat comparison then
        # differs only because of the BRDF, not the Monte-Carlo sample paths.
        renders[mat.name] = render_material(
            mat, hit, normals, dirs, args.seed, args.samples)

    plot_direct_ambient(materials, renders, hit,
                        out_dir / "direct_vs_ambient.png", args.exposure)
    pairs = [(primer(), with_clearcoat(primer())),
             (flake_base(), with_clearcoat(flake_base()))]
    plot_clearcoat_compare(pairs, renders, hit, sphere_mask,
                           out_dir / "clearcoat_compare.png", args.exposure)
    rng = np.random.default_rng(args.seed)
    profiles = plot_grazing_scan(
        materials, rng, out_dir / "grazing_scan.png", args.scan_samples)
    plot_sphere_scan(materials, renders, hit, sphere_mask, normals, dirs,
                     out_dir / "sphere_scan.png", args.exposure)
    graze_data = {name: prof[0] for name, prof in profiles.items()}
    export_metrics(materials, profiles, graze_data, out_dir)
    print(f"Wrote previews, scans and metrics to {out_dir.resolve()}")


if __name__ == "__main__":
    main()
