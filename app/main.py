"""Warehouse 3D annotation demo (Qt Quick 3D).

Usage:
    python app/main.py            # interactive
    python app/main.py --auto     # run all camera paths, record trace+video,
                                  # verify the trace, then quit
"""

import argparse
import math
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PySide6.QtCore import QTimer, QUrl, QObject
from PySide6.QtGui import QGuiApplication, QVector3D
from PySide6.QtQuick import QQuickView

from controller import ANNOTATIONS, AppController
from paths import PathRunner

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS = os.path.join(ROOT, "artifacts")
FFMPEG = (shutil.which("ffmpeg")
          or ("/home/hj/.local/bin/ffmpeg"
              if os.path.exists("/home/hj/.local/bin/ffmpeg") else None))


def self_check(view, ctrl):
    """Compare our projection with View3D.mapFrom3DScene (ground truth)
    for every on-screen annotation, in both projection modes."""
    worst = 0.0
    for mode in ("persp", "ortho"):
        ctrl.cam.mode = mode
        ctrl.tick()
        for i, ann in enumerate(ANNOTATIONS):
            r = ctrl.results[i]
            if r is None or not r.on_screen:
                continue
            p = view.mapFrom3DScene(QVector3D(*ann["pos"]))
            err = math.hypot(p.x() - r.sx, p.y() - r.sy)
            worst = max(worst, err)
            if err > 2.0:
                print(f"[selfcheck] {mode} {ann['id']}: err={err:.2f}px "
                      f"ours=({r.sx:.1f},{r.sy:.1f}) qt=({p.x():.1f},{p.y():.1f})")
    ctrl.cam.mode = "persp"
    ctrl.tick()
    print(f"[selfcheck] max on-screen deviation vs Qt: {worst:.2f}px")
    return worst


def make_video(frames_dir, out_path, path_order):
    if not FFMPEG:
        print("[video] ffmpeg not found, keeping PNG frames only")
        return False
    order = {name: i for i, name in enumerate(path_order)}
    names = [n for n in os.listdir(frames_dir) if n.endswith(".png")]
    # sort by (path run order, frame number)
    def sort_key(n):
        stem = n[:-4]
        for p in sorted(path_order, key=len, reverse=True):
            if stem.startswith(p + "_"):
                return (order[p], int(stem[len(p) + 1:]))
        return (len(order), 0)
    names.sort(key=sort_key)
    if not names:
        return False
    lst = os.path.join(frames_dir, "concat.txt")
    with open(lst, "w", encoding="utf-8") as f:
        for n in names:
            f.write(f"file '{n}'\nduration {1.0/15.0:.6f}\n")
        f.write(f"file '{names[-1]}'\n")  # concat demuxer end-marker
    cmd = [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", lst,
           "-c:v", "libx264", "-pix_fmt", "yuv420p",
           "-loglevel", "error", out_path]
    subprocess.run(cmd, cwd=frames_dir, check=True)
    print(f"[video] wrote {out_path}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--auto", action="store_true", help="run all paths and quit")
    ap.add_argument("--no-frames", action="store_true", help="skip PNG capture")
    ap.add_argument("--snapshot", default="", help="save one frame and quit")
    args = ap.parse_args()

    app = QGuiApplication(sys.argv)
    ctrl = AppController()
    ctrl.cam.width, ctrl.cam.height = 1280, 720
    runner = PathRunner(ARTIFACTS, record_frames=not args.no_frames)
    ctrl.runner = runner

    view_win = QQuickView()
    view_win.setTitle("Warehouse 3D Annotations")
    view_win.setResizeMode(QQuickView.SizeRootObjectToView)
    view_win.resize(1280, 720)
    engine = view_win.engine()
    engine.rootContext().setContextProperty("app", ctrl)
    qml_dir = os.path.join(ROOT, "app", "qml")
    engine.addImportPath(qml_dir)
    view_win.setSource(QUrl.fromLocalFile(os.path.join(qml_dir, "main.qml")))
    if view_win.status() != QQuickView.Ready:
        print("QML load failed")
        return 1
    view_win.show()
    view = view_win.findChild(QObject, "view3d")
    runner.set_window(view_win)  # QQuickView is a QQuickWindow

    timer = QTimer()
    timer.setInterval(16)
    timer.timeout.connect(lambda: ctrl.tick(
        lambda row, ann, res: runner.trace_frame(ctrl, row, ann, res)))
    timer.start()

    state = {"checked": False, "done": False}

    def watchdog():
        if not state["checked"] and ctrl._tick_count > 30:
            state["checked"] = True
            self_check(view, ctrl)
            if args.snapshot:
                view_win.grabWindow().save(args.snapshot)
                app.quit()
                return
            if args.auto:
                runner.run_all()
        if args.auto and state["checked"] and not state["done"] \
                and not runner.is_running() and runner._trace is None \
                and ctrl._tick_count > 60:
            state["done"] = True
            timer.stop()
            make_video(runner.frames_dir, os.path.join(ARTIFACTS, "recording.mp4"),
                       list(runner.paths.keys()))
            app.quit()

    wd = QTimer()
    wd.setInterval(100)
    wd.timeout.connect(watchdog)
    wd.start()

    rc = app.exec()
    runner.finish()
    return rc


if __name__ == "__main__":
    sys.exit(main())
