"""Application controller: camera rig, annotation model, focus, occlusion."""

from __future__ import annotations

import math
import os

from PySide6.QtCore import (
    QAbstractListModel,
    QModelIndex,
    QObject,
    Qt,
    Property,
    Signal,
    Slot,
)
from PySide6.QtGui import QQuaternion, QVector3D

from projection import AnnotationProjector, CameraState

ANNOTATIONS = [
    {"id": "A1", "name": "入库口-01", "color": "#e74c3c", "pos": (-60.0, 3.0, -60.0)},
    {"id": "A2", "name": "货架A-3层", "color": "#e67e22", "pos": (-20.0, 24.5, -20.0)},
    {"id": "A3", "name": "冷链区", "color": "#3498db", "pos": (40.0, 6.5, -50.0)},
    {"id": "A4", "name": "出库月台", "color": "#2ecc71", "pos": (70.0, 3.0, 40.0)},
    {"id": "A5", "name": "AGV-07", "color": "#9b59b6", "pos": (0.0, 1.0, 0.0)},
    {"id": "A6", "name": "高位叉车", "color": "#1abc9c", "pos": (-40.0, 12.0, 30.0)},
    {"id": "A7", "name": "盘点异常", "color": "#e84393", "pos": (25.0, 9.0, 60.0)},
    {"id": "A8", "name": "消防通道", "color": "#f1c40f", "pos": (-70.0, 2.0, 60.0)},
]


class AnnotationModel(QAbstractListModel):
    NameRole = Qt.UserRole + 1
    ColorRole = Qt.UserRole + 2
    XRole = Qt.UserRole + 3
    YRole = Qt.UserRole + 4
    ClampedRole = Qt.UserRole + 5
    AngleRole = Qt.UserRole + 6
    OccludedRole = Qt.UserRole + 7
    BehindRole = Qt.UserRole + 8
    DepthRole = Qt.UserRole + 9

    def __init__(self, parent=None):
        super().__init__(parent)
        self._rows = [
            {
                "name": a["name"],
                "color": a["color"],
                "x": 0.0,
                "y": 0.0,
                "clamped": False,
                "angle": 0.0,
                "occluded": False,
                "behind": False,
                "depth": "",
            }
            for a in ANNOTATIONS
        ]

    def rowCount(self, parent=QModelIndex()):
        return len(self._rows)

    def roleNames(self):
        return {
            self.NameRole: b"name",
            self.ColorRole: b"color",
            self.XRole: b"x",
            self.YRole: b"y",
            self.ClampedRole: b"clamped",
            self.AngleRole: b"angle",
            self.OccludedRole: b"occluded",
            self.BehindRole: b"behind",
            self.DepthRole: b"depth",
        }

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid():
            return None
        row = self._rows[index.row()]
        key = {
            self.NameRole: "name",
            self.ColorRole: "color",
            self.XRole: "x",
            self.YRole: "y",
            self.ClampedRole: "clamped",
            self.AngleRole: "angle",
            self.OccludedRole: "occluded",
            self.BehindRole: "behind",
            self.DepthRole: "depth",
        }.get(role)
        return row.get(key) if key else None

    def update_row(self, row, values: dict):
        idx = self.index(row)
        self._rows[row].update(values)
        self.dataChanged.emit(idx, idx)


class AppController(QObject):
    cameraChanged = Signal()
    pathChanged = Signal()
    occlusionQuery = Signal()  # QML listens and calls back setOcclusion

    def __init__(self, parent=None):
        super().__init__(parent)
        self.cam = CameraState(x=0.0, y=45.0, z=150.0, yaw=0.0, pitch=-16.0)
        self.model = AnnotationModel(self)
        self.projector = AnnotationProjector()
        self.results = [None] * len(ANNOTATIONS)
        self.path_name = ""
        self._focus = None  # (t, t0, dur, from_cam, to_cam)
        self._tick_count = 0
        self.runner = None  # set by main

    # ---- camera rig exposed to QML ----

    def _quat(self):
        hy = math.radians(self.cam.yaw) * 0.5
        hp = math.radians(self.cam.pitch) * 0.5
        qy = QQuaternion(math.cos(hy), 0.0, math.sin(hy), 0.0)
        qx = QQuaternion(math.cos(hp), math.sin(hp), 0.0, 0.0)
        return qy * qx

    @Property(QVector3D, notify=cameraChanged)
    def camPosition(self):
        return QVector3D(self.cam.x, self.cam.y, self.cam.z)

    @Property(QQuaternion, notify=cameraChanged)
    def camRotation(self):
        return self._quat()

    @Property(bool, notify=cameraChanged)
    def orthoMode(self):
        return self.cam.mode == "ortho"

    @Property(float, notify=cameraChanged)
    def fovY(self):
        return self.cam.fov_y

    @Property(float, notify=cameraChanged)
    def orthoHeight(self):
        return self.cam.ortho_height

    @Property(float, notify=cameraChanged)
    def clipNear(self):
        return self.cam.near

    @Property(float, notify=cameraChanged)
    def clipFar(self):
        return self.cam.far

    @Property(str, notify=pathChanged)
    def pathName(self):
        return self.path_name

    @Property(QObject, constant=True)
    def annotations(self):
        return self.model

    @Property("QVariantList", constant=True)
    def anchors(self):
        return [
            {"x": a["pos"][0], "y": a["pos"][1], "z": a["pos"][2], "c": a["color"]}
            for a in ANNOTATIONS
        ]

    # ---- per-frame update ----

    def tick(self, trace_cb=None):
        self._tick_count += 1
        tracing = True
        if self.runner is not None:
            tracing = self.runner.tick(self)
        self._update_focus()
        for i, ann in enumerate(ANNOTATIONS):
            r = self.projector.project(ann["id"], *ann["pos"], self.cam)
            r.occluded = bool(self.model._rows[i]["occluded"])
            self.results[i] = r
            self.model.update_row(i, {
                "x": r.sx,
                "y": r.sy,
                "clamped": r.clamped,
                "angle": r.angle,
                "behind": r.behind,
                "depth": f"{r.depth:.1f}m",
            })
            if trace_cb is not None and tracing:
                trace_cb(i, ann, r)
        self.cameraChanged.emit()
        if self._tick_count % 6 == 0:
            self.occlusionQuery.emit()

    # ---- occlusion (QML calls back) ----

    @Slot(result="QVariantList")
    def occlusionQueryRows(self):
        out = []
        for i, r in enumerate(self.results):
            if r is not None:
                ax, ay, az = ANNOTATIONS[i]["pos"]
                euclid = math.sqrt((ax - self.cam.x) ** 2
                                   + (ay - self.cam.y) ** 2
                                   + (az - self.cam.z) ** 2)
                out.append({"row": i, "x": r.sx, "y": r.sy,
                            "dist": euclid, "on": r.on_screen})
        return out

    @Slot()
    def runAllPaths(self):
        if self.runner is not None and not self.runner.is_running():
            self.runner.run_all()

    @Slot(int, bool)
    def setOcclusion(self, row, occluded):
        if 0 <= row < len(ANNOTATIONS):
            if occluded and not self.model._rows[row]["occluded"]:
                print(f"[occlusion] {ANNOTATIONS[row]['id']} occluded")
            self.model.update_row(row, {"occluded": occluded})
            if self.results[row] is not None:
                self.results[row].occluded = occluded

    # ---- click to locate ----

    @Slot(int)
    def focusAnnotation(self, row):
        if not (0 <= row < len(ANNOTATIONS)):
            return
        ax, ay, az = ANNOTATIONS[row]["pos"]
        _, _, fwd = self.cam.basis()
        dist = 8.0
        to = CameraState(**vars(self.cam))
        to.x, to.y, to.z = ax - fwd[0] * dist, ay - fwd[1] * dist + 2.0, az - fwd[2] * dist
        dx, dy, dz = ax - to.x, ay - to.y, az - to.z
        horiz = math.hypot(dx, dz)
        to.yaw = math.degrees(math.atan2(-dx, -dz))
        to.pitch = math.degrees(math.atan2(dy, horiz))
        self._focus = (0.0, CameraState(**vars(self.cam)), to)

    def _update_focus(self):
        if self._focus is None:
            return
        t, frm, to = self._focus
        t += 1.0 / (60.0 * 1.2)  # 1.2 s at 60 Hz
        u = min(t, 1.0)
        s = u * u * (3.0 - 2.0 * u)
        for k in ("x", "y", "z", "yaw", "pitch"):
            setattr(self.cam, k, getattr(frm, k) + (getattr(to, k) - getattr(frm, k)) * s)
        if u >= 1.0:
            self._focus = None
        else:
            self._focus = (t, frm, to)

    @Slot()
    def toggleProjection(self):
        self.cam.mode = "ortho" if self.cam.mode == "persp" else "persp"
        self.cameraChanged.emit()
