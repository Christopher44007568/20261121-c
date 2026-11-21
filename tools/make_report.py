#!/usr/bin/env python3
"""Summarize results/metrics.csv into a markdown benchmark report."""
import csv
import os
import sys


def main(csv_path, out_path):
    rows = []
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            rows.append({k: float(v) for k, v in row.items()})

    def avg(key, predicate=lambda r: True):
        sel = [r[key] for r in rows if predicate(r)]
        return sum(sel) / len(sel)

    def reduction(new, base):
        return 100.0 * (1.0 - new / base)

    steady = lambda r: int(r["frame"]) not in (20, 21, 30, 31, 41, 42)
    jump = lambda r: int(r["frame"]) in (20, 21, 41, 42)
    resize = lambda r: int(r["frame"]) in (30, 31)

    lines = []
    lines.append("# Dynamic Resolution + TAAU Benchmark Report\n")
    lines.append("CPU reference harness; identical temporal core "
                 "(`temporal_core.hlsli`) is shared with the DX11 compute "
                 "shader. Output resolution 960x540, 60 frames.\n")

    lines.append("## Averaged metrics\n")
    lines.append("| Metric | No history | TAAU | TAAU change |")
    lines.append("|---|---|---|---|")
    lines.append(f"| Edge RMSE (all frames) | {avg('edge_nohist'):.5f} | "
                 f"{avg('edge_taau'):.5f} | "
                 f"{reduction(avg('edge_taau'), avg('edge_nohist')):.1f}% lower |")
    lines.append(f"| Edge RMSE (steady frames) | {avg('edge_nohist', steady):.5f} | "
                 f"{avg('edge_taau', steady):.5f} | "
                 f"{reduction(avg('edge_taau', steady), avg('edge_nohist', steady)):.1f}% lower |")
    lines.append(f"| Thin-line RMSE | {avg('line_nohist'):.5f} | "
                 f"{avg('line_taau'):.5f} | "
                 f"{reduction(avg('line_taau'), avg('line_nohist')):.1f}% lower |")
    lines.append(f"| Edge flicker | {avg('flicker_nohist'):.6f} | "
                 f"{avg('flicker_taau'):.6f} | "
                 f"{reduction(avg('flicker_taau'), avg('flicker_nohist')):.1f}% lower |")
    lines.append(f"| GPU time (ms/frame) | {avg('gpu_ms_nohist'):.3f} | "
                 f"{avg('gpu_ms_taau'):.3f} | "
                 f"{reduction(avg('gpu_ms_taau'), avg('gpu_ms_ref')):.1f}% lower than ref |")
    lines.append(f"| Reference GPU time (ms/frame) | {avg('gpu_ms_ref'):.3f} | "
                 f"{avg('gpu_ms_ref'):.3f} | baseline |\n")

    lines.append("## Stress shots\n")
    lines.append("| Shot | No-history flicker | TAAU flicker | Interpretation |")
    lines.append("|---|---|---|---|")
    lines.append(f"| Velocity jump (frames 20-21, 41-42) | "
                 f"{avg('flicker_nohist', jump):.6f} | "
                 f"{avg('flicker_taau', jump):.6f} | TAAU relaxes history "
                 "to avoid ghosting, then reconverges |")
    lines.append(f"| Window resize (frames 30-31) | "
                 f"{avg('flicker_nohist', resize):.6f} | "
                 f"{avg('flicker_taau', resize):.6f} | History retained at "
                 "0.25 confidence instead of a hard clear |\n")

    lines.append("## GPU time model\n")
    lines.append("The harness uses an analytic ms/megapixel cost model "
                 "(`GpuCostModel`). The DX11 app replaces it with D3D11 "
                 "disjoint timestamp queries (`GpuTimer`) and writes "
                 "`benchmark_gpu.csv` in `benchmark` mode.\n")

    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "results"
    main(os.path.join(base, "metrics.csv"),
         os.path.join(base, "report.md"))
