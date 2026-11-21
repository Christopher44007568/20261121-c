#!/usr/bin/env python3
"""Plot angle-sweep CSV (theta, T_rgb, R_rgb, MC + analytic) as SVG.

Pure standard library. Produces:
  out/sweep_transmission.svg  per-channel transmittance vs angle + color strip
  out/sweep_reflection.svg    reflectance vs angle (thin/thick, MC vs analytic)
"""
import csv
import math
import sys

W, H = 920, 420
ML, MR, MT, MB = 70, 20, 30, 55

CH_COLORS = ["#d62728", "#2ca02c", "#1f5fd6"]
CH_NAMES = ["R", "G", "B"]


def load(path):
    rows = {}
    with open(path) as f:
        for r in csv.DictReader(f):
            rows.setdefault(float(r["thickness"]), []).append(r)
    return rows


def panel(x0, y0, w, h, title):
    return (f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" fill="#fafafa" '
            f'stroke="#888"/>\n'
            f'<text x="{x0 + w/2}" y="{y0 - 8}" text-anchor="middle" '
            f'font-size="14">{title}</text>\n')


def axes(x0, y0, w, h, xmax, ymax, xlabel):
    s = []
    for i in range(0, 11):
        xv = x0 + w * i / 10
        s.append(f'<line x1="{xv:.1f}" y1="{y0}" x2="{xv:.1f}" y2="{y0+h}" '
                 f'stroke="#e0e0e0"/>')
        s.append(f'<text x="{xv:.1f}" y="{y0+h+16}" text-anchor="middle" '
                 f'font-size="10">{xmax*i//10}</text>')
        yv = y0 + h * i / 10
        s.append(f'<line x1="{x0}" y1="{yv:.1f}" x2="{x0+w}" y2="{yv:.1f}" '
                 f'stroke="#e0e0e0"/>')
        s.append(f'<text x="{x0-6}" y="{yv+3:.1f}" text-anchor="end" '
                 f'font-size="10">{ymax*(10-i)/10:.1f}</text>')
    s.append(f'<text x="{x0 + w/2}" y="{y0+h+40}" text-anchor="middle" '
             f'font-size="12">{xlabel}</text>')
    return "\n".join(s) + "\n"


def polyline(x0, y0, w, h, xmax, ymax, xs, ys, color, dash=""):
    pts = " ".join(f"{x0 + w*x/xmax:.1f},{y0 + h*(1 - y/ymax):.1f}"
                   for x, y in zip(xs, ys))
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<polyline points="{pts}" fill="none" stroke="{color}" '
            f'stroke-width="1.8"{d}/>\n')


def dots(x0, y0, w, h, xmax, ymax, xs, ys, color, step=4):
    out = []
    for x, y in list(zip(xs, ys))[::step]:
        out.append(f'<circle cx="{x0 + w*x/xmax:.1f}" '
                   f'cy="{y0 + h*(1 - y/ymax):.1f}" r="1.6" fill="{color}"/>')
    return "\n".join(out) + "\n"


def color_strip(x0, y0, w, h, xs, cols, xmax):
    out = []
    n = len(xs)
    for i in range(n):
        r, g, b = (max(0, min(255, int(255 * c ** (1 / 2.2) + 0.5)))
                   for c in cols[i])
        x = x0 + w * xs[i] / xmax
        out.append(f'<rect x="{x:.1f}" y="{y0}" width="{w/n + 1:.1f}" '
                   f'height="{h}" fill="rgb({r},{g},{b})"/>')
    return "\n".join(out) + "\n"


def legend(x, y, entries):
    out = []
    for i, (label, color, dash) in enumerate(entries):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        out.append(f'<line x1="{x}" y1="{y + i*16}" x2="{x+24}" '
                   f'y2="{y + i*16}" stroke="{color}" stroke-width="2"{d}/>')
        out.append(f'<text x="{x+30}" y="{y + i*16 + 4}" font-size="11">'
                   f'{label}</text>')
    return "\n".join(out) + "\n"


def main(csv_path, out_prefix):
    rows = load(csv_path)
    thicks = sorted(rows)

    # ---- transmission figure: two panels + transmitted-color strips ----
    pw = (W - ML - MR - 40) / 2
    ph = H - MT - MB - 60
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" '
           f'height="{H}" font-family="sans-serif">']
    for p, th in enumerate(thicks):
        x0 = ML + p * (pw + 40)
        y0 = MT
        data = rows[th]
        ang = [float(r["theta_deg"]) for r in data]
        svg.append(panel(x0, y0, pw, ph, f"transmittance, L={th}"))
        svg.append(axes(x0, y0, pw, ph, 90, 1.0, "incidence angle (deg)"))
        for c in range(3):
            ta = [float(r[f"T_{'rgb'[c]}"]) for r in data]
            tm = [float(r[f"Tmc_{'rgb'[c]}"]) for r in data]
            svg.append(polyline(x0, y0, pw, ph, 90, 1.0, ang, ta,
                                CH_COLORS[c]))
            svg.append(dots(x0, y0, pw, ph, 90, 1.0, ang, tm, CH_COLORS[c]))
        svg.append(legend(x0 + 8, y0 + 14,
                          [(f"T_{CH_NAMES[c]} analytic / MC dots",
                            CH_COLORS[c], "") for c in range(3)]))
        strip_y = y0 + ph + 48
        cols = [(float(r["T_r"]), float(r["T_g"]), float(r["T_b"]))
                for r in data]
        svg.append(color_strip(x0, strip_y, pw, 18, ang, cols, 90))
        svg.append(f'<text x="{x0 + pw/2}" y="{strip_y + 32}" '
                   f'text-anchor="middle" font-size="11">transmitted color '
                   f'(analytic, gamma-encoded)</text>')
    svg.append("</svg>")
    with open(f"{out_prefix}_transmission.svg", "w") as f:
        f.write("\n".join(svg))

    # ---- reflection figure ----
    ph2 = H - MT - MB
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" '
           f'height="{H}" font-family="sans-serif">']
    x0, y0 = ML, MT
    pw2 = W - ML - MR
    svg.append(panel(x0, y0, pw2, ph2,
                     "reflectance vs angle (lines: analytic, dots: MC)"))
    svg.append(axes(x0, y0, pw2, ph2, 90, 1.0, "incidence angle (deg)"))
    styles = {thicks[0]: "", thicks[1]: "6,3"}
    for th in thicks:
        data = rows[th]
        ang = [float(r["theta_deg"]) for r in data]
        for c in range(3):
            ra = [float(r[f"R_{'rgb'[c]}"]) for r in data]
            rm = [float(r[f"Rmc_{'rgb'[c]}"]) for r in data]
            svg.append(polyline(x0, y0, pw2, ph2, 90, 1.0, ang, ra,
                                CH_COLORS[c], styles[th]))
            svg.append(dots(x0, y0, pw2, ph2, 90, 1.0, ang, rm,
                            CH_COLORS[c], step=6))
    brew = math.degrees(math.atan(1.54))
    bx = x0 + pw2 * brew / 90
    svg.append(f'<line x1="{bx:.1f}" y1="{y0}" x2="{bx:.1f}" y2="{y0+ph2}" '
               f'stroke="#888" stroke-dasharray="2,4"/>')
    svg.append(f'<text x="{bx+4:.1f}" y="{y0+14}" font-size="11">'
               f'Brewster {brew:.1f} deg</text>')
    ent = [(f"R_{CH_NAMES[c]} L={thicks[0]}", CH_COLORS[c], "")
           for c in range(3)]
    ent += [(f"R_{CH_NAMES[c]} L={thicks[1]}", CH_COLORS[c], "6,3")
            for c in range(3)]
    svg.append(legend(x0 + 10, y0 + 16, ent))
    svg.append("</svg>")
    with open(f"{out_prefix}_reflection.svg", "w") as f:
        f.write("\n".join(svg))
    print(f"wrote {out_prefix}_transmission.svg, {out_prefix}_reflection.svg")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/sweep.csv",
         sys.argv[2] if len(sys.argv) > 2 else "out/sweep")
