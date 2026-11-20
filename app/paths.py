"""Automated camera paths, screen-coordinate trace and frame recording.

Each path is a list of keyframes:
    {"t": seconds, "pos": (x, y, z), "yaw": deg, "pitch": deg,
     "mode": "persp"|"ortho", "fov": deg, "orthoH": world units}
Position/yaw/pitch are smoothstep-interpolated; mode/fov/orthoH switch
at keyframe boundaries (recorded as events so the verifier can allow
the associated projection discontinuity).
"""

from __future__ import annotations

import json
import math
import os

FPS = 60.0


def _kf(t, pos, yaw, pitch, mode="persp", fov=60.0, orthoH=40.0):
    return {"t": t, "pos": pos, "yaw": yaw, "pitch": pitch,
            "mode": mode, "fov": fov, "orthoH": orthoH}


def build_paths():
    """The five automated camera paths (warehouse is ~400x400 m)."""
    paths = {}

    # 1. Dolly straight through annotation A5 (0,1,0): the anchor crosses
    #    the near plane and passes behind the camera. The camera flies
    #    1.5 m above the anchor so the clamp direction stays well-defined
    #    (a perfectly centred pass is intrinsically degenerate).
    paths["near_clip_cross"] = [
        _kf(0.0, (0, 2.5, 12), 0, 0),
        _kf(2.0, (0, 2.5, 0.05), 0, 0),   # near plane is 0.1: pass A5
        _kf(4.0, (0, 2.5, -12), 0, 0),
    ]

    # 2. Fixed camera, yaw/pitch rectangle sweep: anchors traverse all
    #    four screen corners.
    paths["corner_sweep"] = [
        _kf(0.0, (0, 30, 90), 0, -15),
        _kf(1.5, (0, 30, 90), 45, 5),
        _kf(3.0, (0, 30, 90), -45, 5),
        _kf(4.5, (0, 30, 90), -45, -40),
        _kf(6.0, (0, 30, 90), 45, -40),
        _kf(7.5, (0, 30, 90), 0, -15),
    ]

    # 3. 360-degree orbit around the warehouse centre: every annotation
    #    passes behind the camera once.
    orbit = []
    steps = 16
    for i in range(steps + 1):
        ang = 2.0 * math.pi * i / steps
        x, z = 90.0 * math.sin(ang), 90.0 * math.cos(ang)
        yaw = math.degrees(ang) + 180.0  # face the centre
        orbit.append(_kf(8.0 * i / steps, (x, 30.0, z), yaw, -15.0))
    paths["orbit_360"] = orbit

    # 4. Large-scale zoom out 4m -> 240m with an ortho/perspective
    #    toggle at the far end, then back in.
    paths["zoom_scale"] = [
        _kf(0.0, (-20, 21, -16), 0, 0, "persp", 60, 8),
        _kf(2.5, (-20, 60, 240), 0, -8, "persp", 60, 8),
        _kf(3.0, (-20, 60, 240), 0, -8, "ortho", 60, 160),
        _kf(4.5, (-20, 60, 240), 0, -8, "ortho", 60, 160),
        _kf(5.0, (-20, 60, 240), 0, -8, "persp", 60, 8),
        _kf(7.5, (-20, 21, -16), 0, 0, "persp", 60, 8),
    ]

    # 5. Straight diagonal flight across the floor at rack height with a
    #    fixed sideways view: anchors sweep across the screen corners and
    #    pass behind the camera.
    paths["corner_cross"] = [
        _kf(0.0, (-90, 6, -90), -90, 0),
        _kf(3.0, (0, 6, 0), -90, 0),
        _kf(6.0, (90, 6, 90), -90, 0),
    ]

    return paths


def _smooth(u):
    return u * u * (3.0 - 2.0 * u)


def _lerp(a, b, u):
    return a + (b - a) * u


def _lerp_angle(a, b, u):
    d = (b - a + 180.0) % 360.0 - 180.0
    return a + d * u


class PathRunner:
    """Drives the controller camera along the scripted paths and records
    the per-frame screen-coordinate trace plus video frames."""

    def __init__(self, out_dir, record_frames=True):
        self.paths = build_paths()
        self.out_dir = out_dir
        self.frames_dir = os.path.join(out_dir, "frames")
        os.makedirs(self.frames_dir, exist_ok=True)
        self.trace_path = os.path.join(out_dir, "trace.jsonl")
        self.record_frames = record_frames
        self._trace = None
        self._queue = []
        self._active = None
        self._window = None
        self._mode = None

    def set_window(self, window):
        self._window = window

    def run_all(self):
        self._queue = list(self.paths.keys())
        self._trace = open(self.trace_path, "w", encoding="utf-8")
        self._start_next()

    def is_running(self):
        return self._active is not None

    def _event(self, obj):
        if self._trace:
            self._trace.write(json.dumps(obj) + "\n")
            self._trace.flush()

    def _start_next(self):
        if not self._queue:
            self._active = None
            if self._trace:
                self._event({"type": "all_done"})
                self._trace.close()
                self._trace = None
            return
        name = self._queue.pop(0)
        self._active = {"name": name, "kfs": self.paths[name], "frame": 0}
        self._mode = None
        self._event({"type": "path_start", "path": name})

    def tick(self, ctrl):
        """Advance the camera. Returns True when the camera state is a
        valid path sample (False on the path-switch tick, which should
        not be traced)."""
        if self._active is None:
            return False
        act = self._active
        kfs = act["kfs"]
        act["frame"] += 1
        t = act["frame"] / FPS
        if t > kfs[-1]["t"]:
            self._event({"type": "path_end", "path": act["name"]})
            self._start_next()
            return False
        # find the active keyframe segment
        k1 = kfs[0]
        for k in kfs:
            if k["t"] <= t:
                k1 = k
        i1 = kfs.index(k1)
        k2 = kfs[min(i1 + 1, len(kfs) - 1)]
        span = max(k2["t"] - k1["t"], 1e-6)
        u = _smooth(min(max((t - k1["t"]) / span, 0.0), 1.0))
        cam = ctrl.cam
        for j, axis in enumerate(("x", "y", "z")):
            setattr(cam, axis, _lerp(k1["pos"][j], k2["pos"][j], u))
        cam.yaw = _lerp_angle(k1["yaw"], k2["yaw"], u)
        cam.pitch = _lerp(k1["pitch"], k2["pitch"], u)
        cam.fov_y = k2["fov"]
        cam.ortho_height = _lerp(k1["orthoH"], k2["orthoH"], u)
        if k2["mode"] != self._mode:
            self._event({"type": "mode_change", "path": act["name"],
                         "frame": act["frame"], "mode": k2["mode"]})
            self._mode = k2["mode"]
        cam.mode = self._mode
        ctrl.path_name = act["name"]
        ctrl.pathChanged.emit()
        # grab video frames at 15 fps
        if self.record_frames and self._window is not None and act["frame"] % 4 == 0:
            img = self._window.grabWindow()
            img.save(os.path.join(self.frames_dir,
                                  f"{act['name']}_{act['frame']:05d}.png"))
        return True

    def trace_frame(self, ctrl, row, ann, res):
        if self._trace is None or self._active is None:
            return
        cam = ctrl.cam
        self._event({
            "type": "frame",
            "path": self._active["name"],
            "frame": self._active["frame"],
            "cam": [round(cam.x, 4), round(cam.y, 4), round(cam.z, 4),
                    round(cam.yaw, 4), round(cam.pitch, 4)],
            "mode": cam.mode, "fov": cam.fov_y, "orthoH": cam.ortho_height,
            "near": cam.near, "far": cam.far,
            "vp": [cam.width, cam.height], "margin": cam.margin,
            "ann": ann["id"], "anchor": list(ann["pos"]),
            "sx": round(res.sx, 3), "sy": round(res.sy, 3),
            "clamped": res.clamped, "behind": res.behind,
            "on": res.on_screen, "occ": bool(getattr(res, "occluded", False)),
            "dir": [round(res.dir_x, 4), round(res.dir_y, 4)],
        })

    def finish(self):
        if self._trace:
            self._trace.close()
            self._trace = None
