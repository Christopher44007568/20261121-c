"""Unit tests for the annotation projection math (no Qt required)."""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

from projection import AnnotationProjector, CameraState, project


def make_cam(**kw):
    kw.setdefault("width", 1280)
    kw.setdefault("height", 720)
    kw.setdefault("margin", 48.0)
    return CameraState(**kw)


def test_center_projects_to_center():
    cam = make_cam(x=0, y=0, z=10, yaw=0, pitch=0)
    r = project(0, 0, 0, cam)  # 10 units in front of the camera
    assert r.on_screen and not r.clamped
    assert abs(r.sx - 640) < 1e-6 and abs(r.sy - 360) < 1e-6


def test_point_right_of_camera_projects_right():
    cam = make_cam(y=0, z=10)
    r = project(5, 0, 0, cam)
    assert r.on_screen and r.sx > 640 and abs(r.sy - 360) < 1e-6


def test_behind_point_is_clamped_with_flipped_direction():
    cam = make_cam(y=0, z=10)
    # Point behind and to the world-left of the camera: without the sign
    # flip the raw projection would appear on the right; the clamped
    # label must sit on the LEFT edge (the point is really to the left).
    r = project(-5, 0, 20, cam)
    assert r.behind and r.clamped and not r.on_screen
    assert abs(r.sx - cam.margin) < 1e-6  # left edge
    assert r.dir_x < 0


def test_near_plane_crossing_is_continuous():
    """Anchor flies straight through the camera plane (near-clip pass).
    The clamped screen position must move continuously along the edges
    and must never teleport to the opposite side of the screen."""
    cam = make_cam(x=0, y=0, z=0, yaw=0, pitch=0)
    proj = AnnotationProjector()
    prev = None
    steps = 2000
    for i in range(steps + 1):
        z = 5.0 - 10.0 * i / steps   # from 5 in front to 5 behind
        r = proj.project("a", 1.0, 0.5, z, cam)
        assert math.isfinite(r.sx) and math.isfinite(r.sy)
        if prev is not None:
            jump = math.hypot(r.sx - prev.sx, r.sy - prev.sy)
            assert jump < 60.0, f"teleport at z={z}: jump={jump}"
        prev = r


def test_full_turn_continuity():
    """Camera yaws 360 deg; clamped labels slide around the border
    without discontinuities."""
    cam = make_cam()
    proj = AnnotationProjector()
    prev = None
    for i in range(721):
        cam.yaw = i * 0.5
        r = proj.project("a", 10, 0, 0, cam)
        if prev is not None:
            jump = math.hypot(r.sx - prev.sx, r.sy - prev.sy)
            assert jump < 60.0, f"teleport at yaw={cam.yaw}: {jump}"
        prev = r


def test_clamped_point_lies_on_inset_boundary():
    cam = make_cam(z=10)
    for px, py, pz in [(50, 0, 0), (0, 50, 0), (-50, 3, 0), (3, -50, 0),
                       (50, 50, 20), (-50, -50, 20)]:
        r = project(px, py, pz, cam)
        assert r.clamped
        on_v = abs(abs(r.sx - 640) - (640 - cam.margin)) < 1e-6
        on_h = abs(abs(r.sy - 360) - (360 - cam.margin)) < 1e-6
        assert on_v or on_h, (px, py, pz, r.sx, r.sy)


def test_ortho_behind_point_not_flipped():
    cam = make_cam(y=0, z=10, mode="ortho", ortho_height=20)
    # Behind the camera, far to the right: ortho projection is parallel,
    # so the label must stay on the RIGHT edge (no perspective flip).
    r = project(50, 0, 20, cam)
    assert r.behind and r.clamped
    assert r.sx > 640, r.sx


def test_degenerate_point_uses_last_direction():
    cam = make_cam()
    proj = AnnotationProjector()
    # Establish a last direction: point to the right, behind camera.
    r1 = proj.project("a", cam.x + 5, cam.y, cam.z + 10, cam)  # behind
    assert r1.clamped and r1.dir_x > 0
    # Now exactly on the camera position: direction undefined, must
    # reuse the previous one instead of jumping.
    r2 = proj.project("a", cam.x, cam.y, cam.z, cam)
    assert r2.clamped
    assert abs(r2.sx - r1.sx) < 1e-6 and abs(r2.sy - r1.sy) < 1e-6


def test_beyond_far_plane_is_clamped_not_on_screen():
    cam = make_cam(z=10, far=100)
    r = project(0, 0, -5000, cam)  # way beyond far, straight ahead
    assert not r.on_screen and r.clamped and not r.behind


def test_screen_corners_sweep_visits_all_edges():
    """Sweep yaw/pitch so a fixed anchor crosses all four screen edges."""
    cam = make_cam(z=60, y=30, pitch=-20)
    proj = AnnotationProjector()
    edges = set()
    m = cam.margin
    for i in range(800):
        t = i / 799.0
        if i < 400:
            cam.yaw, cam.pitch = -60 + 120 * (t * 2), -20
        else:
            cam.yaw, cam.pitch = 0, -60 + 80 * (t * 2 - 1)
        r = proj.project("a", 0, 2, 0, cam)
        if r.clamped:
            if abs(r.sx - m) < 1:
                edges.add("L")
            if abs(r.sx - (cam.width - m)) < 1:
                edges.add("R")
            if abs(r.sy - m) < 1:
                edges.add("T")
            if abs(r.sy - (cam.height - m)) < 1:
                edges.add("B")
    assert edges == {"L", "R", "T", "B"}, edges


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print("PASS", fn.__name__)
    print(f"{len(fns)} tests passed")
