"""Rigid transform and camera math correctness."""

from __future__ import annotations

import numpy as np
import pytest

from motion_blur.transform import Camera, Transform, rotation_matrix


def test_rodrigues_matches_known_z_rotation():
    angle = 0.7
    r = rotation_matrix(np.array([0.0, 0.0, 1.0]), angle)
    expected = np.array([
        [np.cos(angle), -np.sin(angle), 0.0],
        [np.sin(angle), np.cos(angle), 0.0],
        [0.0, 0.0, 1.0],
    ])
    np.testing.assert_allclose(r, expected, atol=1e-12)


def test_rotation_is_orthonormal_with_unit_determinant():
    r = rotation_matrix(np.array([1.0, 2.0, 3.0]), 1.234)
    np.testing.assert_allclose(r @ r.T, np.eye(3), atol=1e-12)
    assert np.linalg.det(r) == pytest.approx(1.0)


def test_inverse_roundtrip():
    tf = Transform(rotation_matrix([0.0, 1.0, 0.0], 0.9), np.array([1.0, -2.0, 3.0]))
    points = np.random.default_rng(0).normal(size=(10, 3))
    restored = tf.inverse().transform_points(tf.transform_points(points))
    np.testing.assert_allclose(restored, points, atol=1e-12)


def test_project_unproject_roundtrip():
    camera = Camera(pose=Transform(t=np.array([0.5, -0.25, -4.0])),
                    width=120, height=90)
    points_world = np.array([[0.0, 0.0, 0.0], [1.0, 1.0, 2.0],
                             [-1.5, 0.3, 1.0]])
    xy, depth, valid = camera.project(points_world)
    assert valid.all()
    restored = camera.unproject(xy, depth)
    np.testing.assert_allclose(restored, points_world, atol=1e-10)


def test_points_behind_camera_are_flagged():
    camera = Camera(pose=Transform.identity(), width=64, height=48)
    _xy, _depth, valid = camera.project(np.array([[0.0, 0.0, -1.0]]))
    assert not valid[0]
