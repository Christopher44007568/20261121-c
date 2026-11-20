#!/usr/bin/env python3
"""CPU reference for the Metal star previewer's photometric kernel.

Mirrors Sources/StarCore/Photometry.swift formula-for-formula and runs the
same checks the Metal Verifier performs on macOS:
  A. total flux conservation under camera translation (sub-pixel jitter)
  B. top-3 anchor brightness hierarchy and Pogson ratios under zoom
  C. density-budget culling keeps the brightest stars
Run: python3 tools/photometry_check.py
"""
import math
import sys

PSF_SIGMA = 0.75
QUAD_HALF = 4.0 * PSF_SIGMA
ANCHOR_MAGS = [8.0, 9.0, 10.5]
ANCHOR_POS = [(0.80, 0.55), (-0.75, 0.62), (0.10, -0.85)]
CLUSTER_N = 4000
SEED = 0x9E3779B97F4A7C15


def flux_for_mag(m):
    return 10.0 ** (-0.4 * m)


def erf_approx(x):
    t = 1.0 / (1.0 + 0.3275911 * abs(x))
    poly = ((((1.061405429 * t - 1.453152027) * t)
             + 1.421413741) * t - 0.284496736) * t + 0.254829592
    y = 1.0 - poly * t * math.exp(-x * x)
    return y if x >= 0 else -y


def gauss_int_1d(x0, x1, mean, sigma):
    k = 0.7071067811865476 / sigma
    return 0.5 * (erf_approx((x1 - mean) * k) - erf_approx((x0 - mean) * k))


def pixel_flux(cx, cy, px, py, flux, sigma=PSF_SIGMA):
    return flux * gauss_int_1d(px - 0.5, px + 0.5, cx, sigma) \
        * gauss_int_1d(py - 0.5, py + 0.5, cy, sigma)


class XorShift64:
    def __init__(self, state):
        self.s = state or 0x123456789ABCDEF

    def next(self):
        self.s ^= (self.s << 13) & 0xFFFFFFFFFFFFFFFF
        self.s ^= self.s >> 7
        self.s ^= (self.s << 17) & 0xFFFFFFFFFFFFFFFF
        return self.s

    def uniform(self):
        return (self.next() >> 40) / float(1 << 24)


def make_catalog():
    rng = XorShift64(SEED)
    stars = [(x, y, m) for m, (x, y) in zip(ANCHOR_MAGS, ANCHOR_POS)]
    core = 0.05
    for _ in range(CLUSTER_N):
        r = min(core * math.tan(rng.uniform() * 1.48), 0.6)
        th = rng.uniform() * 2 * math.pi
        m = 12.0 + 6.0 * rng.uniform()
        if rng.uniform() < 0.05:
            m = 10.8 + 1.2 * rng.uniform()
        stars.append((r * math.cos(th), r * math.sin(th), m))
    stars.sort(key=lambda s: s[2])
    return stars


def render(catalog, size, scale, center=(0.0, 0.0)):
    """Rasterize with the same area-integral kernel as the Metal shader."""
    img = [0.0] * (size * size)
    for wx, wy, m in catalog:
        sx = (wx - center[0]) * scale + size * 0.5
        sy = (center[1] - wy) * scale + size * 0.5
        f = flux_for_mag(m)
        x0, x1 = int(sx - QUAD_HALF) - 1, int(sx + QUAD_HALF) + 1
        y0, y1 = int(sy - QUAD_HALF) - 1, int(sy + QUAD_HALF) + 1
        for py in range(max(0, y0), min(size, y1 + 1)):
            for px in range(max(0, x0), min(size, x1 + 1)):
                img[py * size + px] += pixel_flux(sx, sy, px + 0.5, py + 0.5, f)
    return img


def test_flux_conservation(catalog):
    size, scale = 512, 512 / 2.4
    ref = sum(render(catalog, size, scale))
    print(f"Test A: total flux vs. translation (reference = {ref:.6f})")
    worst = 0.0
    for dx, dy in [(0.13, 0.29), (0.5, 0.5), (0.71, -0.33), (3.4, -2.1), (-6.0, 4.7)]:
        center = (dx / scale, -dy / scale)
        total = sum(render(catalog, size, scale, center))
        dev = abs(total - ref) / ref
        worst = max(worst, dev)
        print(f"  pan ({dx:+6.2f}, {dy:+6.2f}) px -> flux {total:.6f}  dev {dev*100:.5f}%")
    ok = worst < 0.005
    print(f"  max deviation {worst*100:.5f}%  {'PASS (< 0.5%)' if ok else 'FAIL'}")
    return ok


def aperture(img, size, cx, cy, r=8):
    return sum(img[y * size + x]
               for y in range(int(cy) - r, int(cy) + r + 1)
               for x in range(int(cx) - r, int(cx) + r + 1))


def test_zoom_hierarchy(catalog):
    size, base = 512, 512 / 2.4
    anchors = sorted((s for s in catalog if s[2] in ANCHOR_MAGS),
                     key=lambda s: s[2])
    print(f"Test B: anchor hierarchy under zoom (mags {[a[2] for a in anchors]})")
    ok = True
    for zoom in (1.0, 4.0):
        sums = []
        for ax, ay, _ in anchors:
            img = render(catalog, size, base * zoom, center=(ax, ay))
            sums.append(aperture(img, size, size / 2, size / 2))
        r21, r31 = sums[1] / sums[0], sums[2] / sums[0]
        e21 = 10 ** (-0.4 * (anchors[1][2] - anchors[0][2]))
        e31 = 10 ** (-0.4 * (anchors[2][2] - anchors[0][2]))
        good = sums[0] > sums[1] > sums[2] and abs(r21 - e21) / e21 < 0.02 \
            and abs(r31 - e31) / e31 < 0.02
        print(f"  zoom {zoom:.0f}x: ratios {r21:.4f}, {r31:.4f} "
              f"(expect {e21:.4f}, {e31:.4f}) {'PASS' if good else 'FAIL'}")
        ok = ok and good
    return ok


def test_density_culling(catalog):
    # Field 0.4 x 0.3 deg, cap 1000 stars/deg^2 -> budget 120, brightest kept.
    half_w, half_h, cap = 0.2, 0.15, 1000
    budget = int(cap * (2 * half_w) * (2 * half_h))
    in_field = [s for s in catalog if abs(s[0]) <= half_w and abs(s[1]) <= half_h]
    kept = in_field[:budget]
    ok = len(kept) == budget and kept[-1][2] <= in_field[budget][2]
    print(f"Test C: density culling keeps brightest {len(kept)} of "
          f"{len(in_field)} in-field stars  {'PASS' if ok else 'FAIL'}")
    return ok


def main():
    catalog = make_catalog()
    print(f"catalog: {len(catalog)} stars, brightest mag {catalog[0][2]:.2f}, "
          f"faintest mag {catalog[-1][2]:.2f}")
    ok = test_flux_conservation(catalog)
    ok = test_zoom_hierarchy(catalog) and ok
    ok = test_density_culling(catalog) and ok
    print("ALL PASS" if ok else "FAILURES")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
