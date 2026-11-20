"""Automated verification of the Embree scan against analytic ground truth.

Checks, per scan angle (azimuth column) and elevation row:
  1. echo ordering      - echo1 distance < echo2 distance
  2. missing values     - NaN exactly where the analytic model expects none
  3. depth + surface id - match analytic ray/plate intersections
  4. contribution       - throughput * reflectance * cos(incidence)
  5. lateral projection - reconstructed points lie on the plate rectangle,
                          lateral sweep is monotonic, occlusion edge azimuth
                          matches the analytic edge

Usage: python3 python/verify.py [artifacts_dir]
Exit code 0 = all checks passed.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (Plate, expected_echoes, load_grid, load_grid_int,
                    load_scene, ray_dir, scan_angles)

REL_TOL = 2e-4
ABS_TOL = 1e-4

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def close(a, b):
    return abs(a - b) <= ABS_TOL + REL_TOL * abs(b)


def main():
    artifacts = sys.argv[1] if len(sys.argv) > 1 else "artifacts"
    scene = load_scene(artifacts)
    plates = [Plate(p) for p in scene["plates"]]
    els, azs = scan_angles(scene)
    rows, cols = len(els), len(azs)

    depth = [load_grid(os.path.join(artifacts, f"depth_echo{k}.csv")) for k in (1, 2)]
    contrib = [load_grid(os.path.join(artifacts, f"contrib_echo{k}.csv")) for k in (1, 2)]
    geom = [load_grid_int(os.path.join(artifacts, f"geom_echo{k}.csv")) for k in (1, 2)]

    n_both = n_single = n_miss = 0
    edge_measured = {}   # row -> last azimuth column with two echoes
    edge_analytic = {}

    for r in range(rows):
        for c in range(cols):
            d = ray_dir(els[r], azs[c])
            exp = expected_echoes(plates, d)

            d1, d2 = depth[0][r][c], depth[1][r][c]
            g1, g2 = geom[0][r][c], geom[1][r][c]

            if not math.isnan(d2):
                edge_measured[r] = c  # measured from the Embree output

            # missing values: NaN exactly where the analytic model has no echo
            check(math.isnan(d1) == (len(exp) < 1),
                  f"echo1 presence mismatch at row {r} col {c}")
            check(math.isnan(d2) == (len(exp) < 2),
                  f"echo2 presence mismatch at row {r} col {c}")
            if len(exp) < 1:
                n_miss += 1
                continue

            # surface id + depth
            i1, t1 = exp[0]
            check(g1 == i1, f"echo1 geom {g1} != expected {i1} at {r},{c}")
            check(close(d1, t1), f"echo1 depth {d1} != analytic {t1} at {r},{c}")

            # surface contribution
            c1 = contrib[0][r][c]
            exp_c1 = plates[i1].reflectance * plates[i1].cos_incidence(d)
            check(close(c1, exp_c1), f"echo1 contrib {c1} != {exp_c1} at {r},{c}")

            # lateral projection: reconstructed point must lie on the plate
            p1 = tuple(d1 * v for v in d)
            pl1 = plates[i1]
            rel = tuple(p1[k] - pl1.center[k] for k in range(3))
            lu = sum(rel[k] * pl1.u[k] for k in range(3))
            lv = sum(rel[k] * pl1.v[k] for k in range(3))
            off = abs(sum(rel[k] * pl1.n[k] for k in range(3)))
            check(off < ABS_TOL, f"echo1 point off plane by {off} at {r},{c}")
            check(abs(lu) <= pl1.hw + ABS_TOL and abs(lv) <= pl1.hh + ABS_TOL,
                  f"echo1 lateral proj ({lu:.3f},{lv:.3f}) outside plate at {r},{c}")

            if len(exp) == 2:
                n_both += 1
                i2, t2 = exp[1]
                # echo ordering
                check(d1 < d2, f"echo order violated: {d1} !< {d2} at {r},{c}")
                check(g2 == i2, f"echo2 geom {g2} != expected {i2} at {r},{c}")
                check(close(d2, t2), f"echo2 depth {d2} != analytic {t2} at {r},{c}")
                tau = plates[i1].transmittance
                exp_c2 = tau * plates[i2].reflectance * plates[i2].cos_incidence(d)
                check(close(contrib[1][r][c], exp_c2),
                      f"echo2 contrib {contrib[1][r][c]} != {exp_c2} at {r},{c}")
            else:
                n_single += 1

            if len(exp) == 2:
                edge_analytic[r] = c

    # monotonic lateral sweep across the front plate (middle row)
    mid = rows // 2
    xs = []
    for c in range(cols):
        if geom[0][mid][c] == 0:  # front semi-transparent plate
            xs.append(depth[0][mid][c] * math.sin(azs[c]))
    check(all(a < b for a, b in zip(xs, xs[1:])),
          "lateral projection not monotonic across azimuth sweep")

    # occlusion edge azimuth agreement (measured vs analytic)
    edge_errs = []
    for r, c_exp in edge_analytic.items():
        c_meas = edge_measured.get(r)
        if c_meas is not None:
            edge_errs.append(abs(c_meas - c_exp))
    check(edge_errs and max(edge_errs) <= 1,
          f"occlusion edge off by {max(edge_errs) if edge_errs else 'n/a'} columns")

    print(f"rays: {rows * cols}  two-echo: {n_both}  single-echo: {n_single}  miss: {n_miss}")
    print(f"occlusion edge: max deviation {max(edge_errs)} column(s) over "
          f"{len(edge_errs)} rows (allowed <= 1)")
    print(f"lateral sweep: {len(xs)} front-plate columns, monotonic")

    if failures:
        shown = failures[:10]
        print(f"\nFAIL ({len(failures)} problems, first {len(shown)}):")
        for f in shown:
            print("  -", f)
        return 1
    print("PASS: echo order, missing values, depths, contributions, "
          "lateral projection all verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
