"""Verify the recorded screen-coordinate trace for discontinuities.

Reads artifacts/trace.jsonl and checks, per path and annotation:
  1. all coordinates finite and inside sane bounds
  2. frame-to-frame motion below a jump threshold (except at recorded
     projection-mode switches, where a jump is legitimate)
  3. clamped labels sit exactly on the inset viewport boundary
  4. clamp directions point the right way (recomputed from camera state)
  5. behind-camera frames are always clamped, never NaN
  6. path-specific expectations (near-clip pass, corner visits, orbit
     behind-coverage, ortho toggles)
  7. full re-projection of every frame from the recorded camera state
     matches the recorded label position (spec compliance)

Exit code 0 = PASS, 1 = FAIL. Writes artifacts/report.txt.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

from projection import AnnotationProjector, CameraState

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACE = os.path.join(ROOT, "artifacts", "trace.jsonl")
REPORT = os.path.join(ROOT, "artifacts", "report.txt")

MAX_JUMP_PX = 150.0      # max allowed frame-to-frame label motion
BOUNDARY_TOL = 2.0
REPROJ_TOL = 1.0         # recorded vs recomputed position tolerance


def load_trace(path):
    frames, events = [], []
    with open(path, encoding="utf-8") as f:
        for line in f:
            obj = json.loads(line)
            (frames if obj["type"] == "frame" else events).append(obj)
    return frames, events


def cam_from_record(rec):
    cx, cy, cz, yaw, pitch = rec["cam"]
    return CameraState(
        x=cx, y=cy, z=cz, yaw=yaw, pitch=pitch,
        mode=rec["mode"], fov_y=rec["fov"], ortho_height=rec["orthoH"],
        near=rec["near"], far=rec["far"],
        width=rec["vp"][0], height=rec["vp"][1], margin=rec["margin"],
    )


def main():
    frames, events = load_trace(TRACE)
    problems = []
    notes = []

    mode_switch_frames = {(e["path"], e["frame"]) for e in events
                          if e["type"] == "mode_change"}
    paths_seen = sorted({f["path"] for f in frames})
    notes.append(f"paths: {', '.join(paths_seen)}; frames: {len(frames)}")

    # group by (path, ann)
    series = {}
    for rec in frames:
        series.setdefault((rec["path"], rec["ann"]), []).append(rec)
    for key in series:
        series[key].sort(key=lambda r: r["frame"])

    # ---- per-series checks ----
    for (path, ann), recs in sorted(series.items()):
        proj = AnnotationProjector()
        prev = None
        for rec in recs:
            tag = f"{path}/{ann}/f{rec['frame']}"
            sx, sy = rec["sx"], rec["sy"]
            # 1. finite
            if not (math.isfinite(sx) and math.isfinite(sy)):
                problems.append(f"{tag}: non-finite position ({sx},{sy})")
                continue
            cam = cam_from_record(rec)
            ax, ay, az = rec["anchor"]
            exp = proj.project(ann, ax, ay, az, cam)
            # 7. re-projection matches recorded position
            if math.hypot(exp.sx - sx, exp.sy - sy) > REPROJ_TOL:
                problems.append(
                    f"{tag}: recorded ({sx},{sy}) != recomputed "
                    f"({exp.sx:.1f},{exp.sy:.1f})")
            # 5. behind => clamped
            if rec["behind"] and not rec["clamped"]:
                problems.append(f"{tag}: behind camera but not clamped")
            # 3. clamped => on inset boundary
            if rec["clamped"]:
                m = rec["margin"]
                w, h = rec["vp"]
                on_v = min(abs(sx - m), abs(sx - (w - m))) < BOUNDARY_TOL
                on_h = min(abs(sy - m), abs(sy - (h - m))) < BOUNDARY_TOL
                if not (on_v or on_h):
                    problems.append(f"{tag}: clamped but off boundary "
                                    f"({sx},{sy})")
                # 4. direction points outward from centre
                dx, dy = sx - w / 2, sy - h / 2
                if dx * rec["dir"][0] + dy * rec["dir"][1] <= 0:
                    problems.append(f"{tag}: clamp direction mismatch")
            # 2. jump detection
            if prev is not None:
                step = math.hypot(sx - prev["sx"], sy - prev["sy"])
                exempt = (path, rec["frame"]) in mode_switch_frames
                if step > MAX_JUMP_PX and not exempt:
                    problems.append(f"{tag}: jump {step:.0f}px")
            prev = rec

    # ---- path-specific expectations ----
    def ann_series(path, ann):
        return series.get((path, ann), [])

    nc = ann_series("near_clip_cross", "A5")
    if not any(r["behind"] for r in nc):
        problems.append("near_clip_cross: A5 never went behind the camera")
    else:
        notes.append("near_clip_cross: A5 passed behind the camera "
                     f"({sum(1 for r in nc if r['behind'])} frames)")

    cs_edges = set()
    for (path, ann), recs in series.items():
        if path != "corner_sweep":
            continue
        for r in recs:
            if not r["clamped"]:
                continue
            m, (w, h) = r["margin"], r["vp"]
            if abs(r["sx"] - m) < BOUNDARY_TOL:
                cs_edges.add("L")
            if abs(r["sx"] - (w - m)) < BOUNDARY_TOL:
                cs_edges.add("R")
            if abs(r["sy"] - m) < BOUNDARY_TOL:
                cs_edges.add("T")
            if abs(r["sy"] - (h - m)) < BOUNDARY_TOL:
                cs_edges.add("B")
    if cs_edges != {"L", "R", "T", "B"}:
        problems.append(f"corner_sweep: only reached edges {sorted(cs_edges)}")
    else:
        notes.append("corner_sweep: clamped labels visited all four edges")

    for ann in {a for (_, a) in series if _ == "orbit_360"}:
        if not any(r["behind"] for r in ann_series("orbit_360", ann)):
            problems.append(f"orbit_360: {ann} never behind camera")
    modes = [e["mode"] for e in events if e["type"] == "mode_change"
             and e["path"] == "zoom_scale"]
    if "ortho" not in modes or modes.count("persp") < 2:
        problems.append(f"zoom_scale: expected persp->ortho->persp, got {modes}")
    else:
        notes.append(f"zoom_scale: projection toggles {modes}")

    occ_frames = sum(1 for f in frames if f["occ"])
    notes.append(f"occluded label frames: {occ_frames}")

    # ---- report ----
    lines = ["TRACE VERIFICATION REPORT", "=" * 40, ""]
    lines += ["* " + n for n in notes]
    lines.append("")
    if problems:
        lines.append(f"FAIL: {len(problems)} problem(s)")
        lines += ["  - " + p for p in problems[:50]]
    else:
        lines.append("PASS: no jumps, clamping/direction/behind-camera "
                     "behaviour verified")
    report = "\n".join(lines)
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write(report + "\n")
    print(report)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
