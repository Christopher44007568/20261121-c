"""End-to-end experiment: LOD generation, silhouette metrics and figures."""

from __future__ import annotations

import csv
import copy
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from .io import load_obj
from .lod import build_lod_levels
from .silhouette import measure_lod
from .simplifier import SimplifyOptions


def run_experiment(input_obj, out_root, ratios, cameras, resolution=256,
                   lock_parts=("bracket",), policy="penalize"):
    lod_dir = os.path.join(out_root, "lod")
    fig_dir = os.path.join(out_root, "figures")
    os.makedirs(fig_dir, exist_ok=True)
    reference = load_obj(input_obj)
    # build_lod_levels collapses its argument in place; keep an untouched
    # copy as the ground-truth reference for silhouette comparison
    reference = copy.deepcopy(reference)
    working = copy.deepcopy(reference)
    options = SimplifyOptions(
        lock_parts=tuple(lock_parts),
        seam_policy=policy, boundary_policy=policy)
    manifest = build_lod_levels(working, ratios, lod_dir, options)

    rows = []
    for level in manifest["levels"]:
        lod_mesh = load_obj(level["obj"])
        stats = measure_lod(reference, lod_mesh, cameras, resolution)
        for st in stats:
            rows.append({
                "level": level["level"],
                "faces": level["report"]["faces"],
                "vertices": level["report"]["vertices"],
                "camera": st["camera"],
                "iou": st["iou"],
                "mean_contour_distance": st["mean_contour_distance"],
                "symmetric_diff_pixels": st["symmetric_diff_pixels"],
                "symmetric_diff_area": st["symmetric_diff_area"],
                "manifold": level["report"]["manifold"],
                "oriented": level["report"]["oriented"],
                "degenerate_faces": level["report"]["degenerate_faces"],
                "hard_edges_remaining": level["hard_edges_remaining"],
                "seam_edges_remaining": level["seam_edges_remaining"],
                "locked_missing": level["constraints"]["locked_missing"],
            })

    csv_path = os.path.join(out_root, "silhouette_metrics.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    _plot_tradeoff(rows, cameras, fig_dir)
    with open(os.path.join(out_root, "experiment_summary.json"), "w",
              encoding="utf-8") as fh:
        json.dump({"cameras": cameras, "resolution": resolution,
                   "rows": rows, "manifest": "lod/manifest.json"}, fh,
                  indent=2)
    return rows, csv_path


def _plot_tradeoff(rows, cameras, fig_dir):
    faces_levels = sorted({r["faces"] for r in rows}, reverse=True)
    # IoU vs face count, one line per camera
    plt.figure(figsize=(7, 4.5))
    for cam in cameras:
        pts = sorted([(r["faces"], r["iou"]) for r in rows
                      if r["camera"] == cam], reverse=True)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        plt.plot(xs, ys, marker="o", label=cam)
    plt.xlabel("triangle count")
    plt.ylabel("silhouette IoU")
    plt.title("Silhouette fidelity vs mesh complexity")
    plt.grid(alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(fig_dir, "iou_vs_faces.png"), dpi=140)
    plt.close()

    plt.figure(figsize=(7, 4.5))
    for cam in cameras:
        pts = sorted([(r["faces"], r["mean_contour_distance"])
                      for r in rows if r["camera"] == cam], reverse=True)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        plt.plot(xs, ys, marker="s", label=cam)
    plt.xlabel("triangle count")
    plt.ylabel("mean symmetric contour distance (model units)")
    plt.title("Contour error vs mesh complexity")
    plt.grid(alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(fig_dir, "contour_vs_faces.png"), dpi=140)
    plt.close()
