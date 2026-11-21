#!/usr/bin/env python3
"""Rasterize the transmitted-color-vs-angle sweep as a PNG strip.

Rows: thin plate (top) and thick block (bottom); x axis = incidence angle.
Uses the analytic solution from the sweep CSV, gamma-encoded.
"""
import csv
import sys

from ppm2png import write_png


def main(csv_path, out_path):
    rows = {}
    with open(csv_path) as f:
        for r in csv.DictReader(f):
            rows.setdefault(float(r["thickness"]), []).append(r)
    thicks = sorted(rows)
    w = max(len(v) for v in rows.values()) * 10
    band, gap = 60, 8
    h = len(thicks) * band + (len(thicks) - 1) * gap
    img = bytearray(b"\xff" * w * h * 3)
    for p, th in enumerate(thicks):
        data = rows[th]
        for i, r in enumerate(data):
            rgb = []
            for ch in "rgb":
                v = float(r[f"T_{ch}"])
                rgb.append(max(0, min(255, int(255 * v ** (1 / 2.2) + 0.5))))
            x = int(i * w / len(data))
            x2 = int((i + 1) * w / len(data))
            for y in range(p * (band + gap), p * (band + gap) + band):
                for xx in range(x, max(x2, x + 1)):
                    o = (y * w + xx) * 3
                    img[o:o+3] = bytes(rgb)
    write_png(out_path, w, h, bytes(img))
    print(f"wrote {out_path} ({w}x{h})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/sweep.csv",
         sys.argv[2] if len(sys.argv) > 2 else "out/transmitted_color.png")
