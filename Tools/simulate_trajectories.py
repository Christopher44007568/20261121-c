#!/usr/bin/env python3
"""Offline validation of the parallax-correction demo math (no Unity needed).

For each frame we locate where a room feature APPEARS on the mirror sphere
(the surface normal whose reflection samples the feature):
  ideal: reflection ray physically hits the feature (ground truth)
  corr:  box-projected cubemap lookup hits the feature's cubemap direction
  raw:   uncorrected lookup (feature treated as infinitely far)

Generates per-scenario SVG plots (apparent-position trajectory on the sphere
in azimuth/elevation + position error vs time) and CSV files in artifacts/.
"""
import csv
import math
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "artifacts")

ROOM_MIN = (-5.0, 0.0, -5.0)
ROOM_MAX = (5.0, 3.0, 5.0)
# Proxy boxes coincide with the room walls and overlap in [-1, 1] on x.
PROBE_A = {"center": (-2.0, 1.5, 0.0), "min": (-5.0, 0.0, -5.0), "max": (1.0, 3.0, 5.0)}
PROBE_B = {"center": (2.0, 1.5, 0.0), "min": (-1.0, 0.0, -5.0), "max": (5.0, 3.0, 5.0)}
FEATURE_INSIDE = (4.7, 1.6, 0.0)    # on the east wall: correctable
FEATURE_BEYOND = (0.0, 8.0, 20.0)   # outside the proxy box: uncorrectable


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vnorm(a):
    l = math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2) or 1e-9
    return (a[0] / l, a[1] / l, a[2] / l)


def vdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def reflect(d, n):
    k = 2.0 * vdot(d, n)
    return vnorm((d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]))


def box_project(direction, pos, probe):
    """Mirror of Unity's BoxProjectedCubemapDirection."""
    mags = []
    for i in range(3):
        bound = probe["max"][i] if direction[i] > 0 else probe["min"][i]
        d = direction[i] if abs(direction[i]) > 1e-9 else 1e-9
        mags.append((bound - pos[i]) / d)
    t = min(mags)
    hit = (pos[0] + direction[0] * t, pos[1] + direction[1] * t, pos[2] + direction[2] * t)
    return vnorm(vsub(hit, probe["center"]))


def inside_box(p, probe):
    return all(probe["min"][i] <= p[i] <= probe["max"][i] for i in range(3))


def az_el(d):
    return (math.degrees(math.atan2(d[0], d[2])), math.degrees(math.asin(max(-1, min(1, d[1])))))


def ang_err(a, b):
    return math.degrees(math.acos(max(-1.0, min(1.0, vdot(vnorm(a), vnorm(b))))))


def blend_weight_a(x):
    """Approximate URP probe blend across the overlap of probe A and B."""
    if x <= -1.0:
        return 1.0
    if x >= 1.0:
        return 0.0
    return 1.0 - (x + 1.0) * 0.5


def ray_point_dist(origin, direction, point):
    w = vsub(point, origin)
    t = vdot(w, direction)
    if t < 0:
        return float("inf")
    c = (origin[0] + direction[0] * t - point[0],
         origin[1] + direction[1] * t - point[1],
         origin[2] + direction[2] * t - point[2])
    return math.sqrt(vdot(c, c))


def apparent_normal(sphere, radius, cam, feature, d_feats, mode):
    """Find the sphere-surface normal (az, el in deg) where the feature appears.

    ideal: reflection ray from the surface passes through the real feature.
    corr:  box-projected lookup direction equals the feature's cubemap dir.
    raw:   raw reflection vector equals the feature's cubemap dir.
    """
    best = (float("inf"), 0.0, 0.0)
    for stage, (az_step, el_step, az_c, el_c, az_r, el_r) in enumerate([
            (6.0, 6.0, 0.0, 0.0, 180.0, 90.0), (1.5, 1.5, None, None, 6.0, 6.0)]):
        if stage == 0:
            azs = [a * az_step - 180.0 for a in range(int(360.0 / az_step))]
            els = [e * el_step - 90.0 for e in range(int(180.0 / el_step) + 1)]
        else:
            _, bc_az, bc_el = best
            azs = [bc_az + (i - 4) * az_step for i in range(9)]
            els = [max(-90.0, min(90.0, bc_el + (i - 4) * el_step)) for i in range(9)]
        for az in azs:
            for el in els:
                ra, re_ = math.radians(az), math.radians(el)
                n = (math.cos(re_) * math.sin(ra), math.sin(re_), math.cos(re_) * math.cos(ra))
                p = (sphere[0] + n[0] * radius, sphere[1] + n[1] * radius, sphere[2] + n[2] * radius)
                if vdot(n, vsub(cam, p)) <= 0.0:
                    continue  # back-facing surface points are not visible
                v = vnorm(vsub(p, cam))
                r = reflect(v, n)
                w_a = blend_weight_a(sphere[0])
                if mode == "ideal":
                    cost = ray_point_dist(p, r, feature)
                elif mode == "raw":
                    # Blended cubemap: feature sits at dA in probe A, dB in probe B.
                    cost = w_a * ang_err(r, d_feats[0]) + (1 - w_a) * ang_err(r, d_feats[1])
                else:  # corr: each probe's box-projected lookup vs its own feature dir
                    ca = box_project(r, p, PROBE_A)
                    cb = box_project(r, p, PROBE_B)
                    cost = w_a * ang_err(ca, d_feats[0]) + (1 - w_a) * ang_err(cb, d_feats[1])
                if cost < best[0]:
                    best = (cost, az, el)
    return best[1], best[2]


def dir_from_az_el(az, el):
    ra, re_ = math.radians(az), math.radians(el)
    return (math.cos(re_) * math.sin(ra), math.sin(re_), math.cos(re_) * math.cos(ra))


def simulate(sphere_fn, cam_fn, feature, steps=120, radius=0.5):
    rows = []
    for i in range(steps):
        t = i / steps * 2.0  # two path periods
        sphere = sphere_fn(t)
        cam = cam_fn(t)
        d_feats = (vnorm(vsub(feature, PROBE_A["center"])),
                   vnorm(vsub(feature, PROBE_B["center"])))
        az_el_i = apparent_normal(sphere, radius, cam, feature, d_feats, "ideal")
        az_el_c = apparent_normal(sphere, radius, cam, feature, d_feats, "corr")
        az_el_r = apparent_normal(sphere, radius, cam, feature, d_feats, "raw")
        di = dir_from_az_el(*az_el_i)
        rows.append({
            "t": t, "sphere": sphere,
            "raw": dir_from_az_el(*az_el_r), "corr": dir_from_az_el(*az_el_c), "ideal": di,
            "err_raw": ang_err(dir_from_az_el(*az_el_r), di),
            "err_corr": ang_err(dir_from_az_el(*az_el_c), di),
            "w_a": blend_weight_a(sphere[0]),
            "inside": (ROOM_MIN[0] <= feature[0] <= ROOM_MAX[0] and
                       ROOM_MIN[1] <= feature[1] <= ROOM_MAX[1] and
                       ROOM_MIN[2] <= feature[2] <= ROOM_MAX[2]),
        })
    return rows


def write_csv(name, rows):
    path = os.path.join(OUT, f"{name}.csv")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["t", "raw_az", "raw_el", "corr_az", "corr_el",
                    "ideal_az", "ideal_el", "err_raw_deg", "err_corr_deg",
                    "blend_w_a", "inside_box"])
        for r in rows:
            ra, re_ = az_el(r["raw"]); ca, ce = az_el(r["corr"]); ia, ie = az_el(r["ideal"])
            w.writerow([f"{r['t']:.4f}", f"{ra:.4f}", f"{re_:.4f}", f"{ca:.4f}", f"{ce:.4f}",
                        f"{ia:.4f}", f"{ie:.4f}", f"{r['err_raw']:.4f}",
                        f"{r['err_corr']:.4f}", f"{r['w_a']:.4f}", int(r["inside"])])
    return path


W, H = 900, 420


def polyline(points, color, width=1.5, dash=""):
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}"{d}/>'


def polyline_segments(points, color, width=1.5, dash="", max_jump=120.0):
    """Split a trajectory into segments so azimuth wraparound (+-180 deg)
    does not draw streaks across the plot."""
    out, seg = [], []
    for pt in points:
        if seg and (abs(pt[0] - seg[-1][0]) > max_jump or abs(pt[1] - seg[-1][1]) > max_jump):
            if len(seg) > 1:
                out.append(polyline(seg, color, width, dash))
            seg = []
        seg.append(pt)
    if len(seg) > 1:
        out.append(polyline(seg, color, width, dash))
    return "\n".join(out)


def write_svg(name, title, rows):
    path = os.path.join(OUT, f"{name}.svg")
    az = [az_el(r["ideal"])[0] for r in rows] + [az_el(r["raw"])[0] for r in rows]
    el = [az_el(r["ideal"])[1] for r in rows] + [az_el(r["raw"])[1] for r in rows]
    az0, az1 = min(az) - 3, max(az) + 3
    el0, el1 = min(el) - 3, max(el) + 3
    emax = max(max(r["err_raw"] for r in rows), max(r["err_corr"] for r in rows), 1.0)
    tmax = rows[-1]["t"]

    def traj_pt(r, key):
        a, e = az_el(r[key])
        x = 60 + (a - az0) / (az1 - az0) * 480
        y = 350 - (e - el0) / (el1 - el0) * 300
        return (x, y)

    def err_pt(r, key):
        x = 600 + r["t"] / tmax * 260
        y = 350 - r[key] / emax * 300
        return (x, y)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'style="background:#14161a;font-family:monospace">',
        f'<text x="20" y="28" fill="#eee" font-size="16">{title}</text>',
        f'<text x="60" y="52" fill="#9aa" font-size="11">apparent feature position on sphere (az/el, deg)</text>',
        f'<text x="600" y="52" fill="#9aa" font-size="11">position error vs ideal (deg), max {emax:.1f}</text>',
        f'<rect x="60" y="50" width="480" height="300" fill="none" stroke="#333"/>',
        f'<rect x="600" y="50" width="260" height="300" fill="none" stroke="#333"/>',
        polyline_segments([traj_pt(r, "ideal") for r in rows], "#dddddd", 2.5, "6 4"),
        polyline_segments([traj_pt(r, "corr") for r in rows], "#22ddff"),
        polyline_segments([traj_pt(r, "raw") for r in rows], "#ff8830"),
        polyline([err_pt(r, "err_corr") for r in rows], "#22ddff"),
        polyline([err_pt(r, "err_raw") for r in rows], "#ff8830"),
        '<text x="60" y="385" fill="#dddddd" font-size="12">--- ideal (true reflection)</text>',
        '<text x="60" y="403" fill="#22ddff" font-size="12">--- box-projected (corrected)</text>',
        '<text x="330" y="403" fill="#ff8830" font-size="12">--- uncorrected (infinity)</text>',
    ]
    if any(not r["inside"] for r in rows):
        parts.append('<text x="330" y="385" fill="#ff5555" font-size="12">'
                     'feature BEYOND proxy box: correction not applicable</text>')
    else:
        parts.append('<text x="330" y="385" fill="#7f7" font-size="12">'
                     'feature inside proxy box: correctable</text>')
    if name == "boundary_crossing":
        wpts = [(600 + r["t"] / tmax * 260, 350 - r["w_a"] * 300) for r in rows]
        parts.append(polyline(wpts, "#bbbbbb", 1.0, "2 3"))
        parts.append('<text x="600" y="403" fill="#bbbbbb" font-size="12">'
                     '-.- probe blend weight (A)</text>')
    parts.append("</svg>")
    with open(path, "w") as f:
        f.write("\n".join(parts))
    return path


def main():
    os.makedirs(OUT, exist_ok=True)
    sphere_static = (0.0, 1.5, 2.0)
    scenarios = [
        ("static_room", "Scenario 1: static room, feature on east wall",
         lambda t: sphere_static, lambda t: (0.0, 1.6, -4.0), FEATURE_INSIDE),
        ("near_wall", "Scenario 2: camera sweeping near the east wall",
         lambda t: (3.8, 1.5, 2.0),
         lambda t: (2.0 * math.sin(t * math.pi), 1.6, -3.0), FEATURE_INSIDE),
        ("boundary_crossing", "Scenario 3: sphere crossing the probe boundary",
         lambda t: (3.5 * math.sin(t * math.pi), 1.5, 2.0),
         lambda t: (0.0, 1.6, -4.0), FEATURE_INSIDE),
        ("beyond_box", "Scenario 4: feature beyond the proxy box (sky/outdoor)",
         lambda t: sphere_static,
         lambda t: (1.5 * math.sin(t * math.pi), 1.6, -4.0), FEATURE_BEYOND),
    ]
    summary = []
    for name, title, sphere_fn, cam_fn, feature in scenarios:
        rows = simulate(sphere_fn, cam_fn, feature)
        csv_path = write_csv(name, rows)
        svg_path = write_svg(name, title, rows)
        mean_raw = sum(r["err_raw"] for r in rows) / len(rows)
        mean_corr = sum(r["err_corr"] for r in rows) / len(rows)
        summary.append((name, rows[0]["inside"], mean_raw, mean_corr, csv_path, svg_path))
    print(f"{'scenario':<20}{'in-box':<8}{'err_raw':<10}{'err_corr':<10}")
    for name, inside, er, ec, cp, sp in summary:
        print(f"{name:<20}{str(inside):<8}{er:<10.2f}{ec:<10.2f}  -> {sp}")


if __name__ == "__main__":
    main()
