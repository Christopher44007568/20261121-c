"""Optional interactive matplotlib viewer for the view-ray brush.

Matplotlib is imported lazily so the core library and test-suite work on
headless machines without it.  The viewer maps mouse motion to camera
rays, drags paint strokes, right-click/Esc cancels the active stroke, and
redraws the mesh with its per-vertex colors.  The brush radius lives in
world space, so orbiting the camera never changes the painted footprint.
"""

from __future__ import annotations

import numpy as np

from .camera import Camera


class MeshBrushViewer:
    def __init__(self, mesh, engine, camera: Camera):
        try:
            import matplotlib.pyplot as plt
        except ImportError as exc:
            raise RuntimeError(
                "matplotlib is required for MeshBrushViewer; install it "
                "with `pip install matplotlib`") from exc
        self.plt = plt
        self.mesh = mesh
        self.engine = engine
        self.camera = camera
        self.figure = plt.figure()
        self.axes = self.figure.add_subplot(111, projection="3d")
        self._mesh_artist = None
        self.connect_events()
        self.redraw()

    def connect_events(self):
        canvas = self.figure.canvas
        canvas.mpl_connect("button_press_event", self.on_button_press)
        canvas.mpl_connect("button_release_event", self.on_button_release)
        canvas.mpl_connect("motion_notify_event", self.on_motion)
        canvas.mpl_connect("key_press_event", self.on_key_press)

    def _ndc(self, event):
        width = max(event.canvas.get_width_height()[0], 1)
        height = max(event.canvas.get_width_height()[1], 1)
        ndc_x = 2.0 * event.x / width - 1.0
        ndc_y = 2.0 * event.y / height - 1.0
        self.camera.aspect = width / height
        return ndc_x, ndc_y

    def on_button_press(self, event):
        if event.inaxes != self.axes:
            return
        if event.button == 1:
            self.engine.begin_stroke()
            self._paint(event)
        elif event.button == 3 and self.engine.stroke_active:
            self.engine.cancel_stroke()
            self.redraw()

    def on_button_release(self, event):
        if event.button == 1 and self.engine.stroke_active:
            self.engine.end_stroke()
            self.redraw()

    def on_motion(self, event):
        if event.inaxes != self.axes or not self.engine.stroke_active:
            return
        if event.button == 1:
            self._paint(event)

    def on_key_press(self, event):
        if event.key == "escape" and self.engine.stroke_active:
            self.engine.cancel_stroke()
            self.redraw()
        elif event.key == "o":
            self.camera.orbit(0.2, 0.1)
            self.redraw()

    def _paint(self, event):
        ndc_x, ndc_y = self._ndc(event)
        origin, direction = self.camera.screen_ray(ndc_x, ndc_y)
        report = self.engine.dab_from_ray(origin, direction)
        self.redraw()
        return report

    def redraw(self):
        self.axes.clear()
        colors = np.clip(self.engine.layer.vertex_colors, 0.0, 1.0)
        face_colors = colors[self.mesh.faces].mean(axis=1)
        self.axes.plot_trisurf(
            self.mesh.vertices[:, 0],
            self.mesh.vertices[:, 1],
            self.mesh.vertices[:, 2],
            triangles=self.mesh.faces,
            facecolors=face_colors,
            linewidth=0.0,
            antialiased=False,
        )
        self.axes.set_title("left-drag: paint | right-click/Esc: cancel "
                            "| o: orbit")
        self.figure.canvas.draw_idle()

    def show(self):
        self.plt.show()
