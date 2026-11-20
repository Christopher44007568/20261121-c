"""Unit tests for the constrained QEM simplifier and test model."""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from qem_simplify.checks import (classify_constraint_edges,
                                 find_nonmanifold_edges,
                                 orientation_inconsistencies,
                                 degenerate_faces, full_report)
from qem_simplify.generate import build_test_mesh
from qem_simplify.io import build_mesh, load_obj, write_obj
from qem_simplify.simplifier import Simplifier, SimplifyOptions


def grid_mesh(n=8):
    verts = [[x, y, 0.0] for y in range(n) for x in range(n)]
    faces, uv = [], [[0, 0]] * len(verts)
    for y in range(n - 1):
        for x in range(n - 1):
            a = y * n + x
            faces.append([a, a + n, a + n + 1])
            faces.append([a, a + n + 1, a + 1])
    return build_mesh(verts, uv, faces, [0] * len(faces), [0] * len(faces),
                      ["m"], ["p"])


class TestGeneratedModel(unittest.TestCase):
    def setUp(self):
        self.mesh = build_test_mesh()

    def test_manifold_and_oriented(self):
        self.assertEqual(find_nonmanifold_edges(self.mesh), [])
        self.assertEqual(orientation_inconsistencies(self.mesh), [])
        self.assertEqual(degenerate_faces(self.mesh), [])

    def test_has_seams_hard_edges_and_parts(self):
        buckets = classify_constraint_edges(self.mesh)
        self.assertGreater(len(buckets["seam"]), 10)
        self.assertGreater(len(buckets["hard"]), 10)
        self.assertEqual(self.mesh.parts, ["plate", "bracket"])
        self.assertEqual(len(self.mesh.materials), 3)


class TestSimplification(unittest.TestCase):
    def test_grid_reaches_target_and_stays_valid(self):
        mesh = grid_mesh(10)
        target = mesh.num_faces // 2
        got = Simplifier(mesh).run_to(target)
        self.assertLessEqual(got, target + 2)
        self.assertEqual(find_nonmanifold_edges(mesh), [])
        self.assertEqual(orientation_inconsistencies(mesh), [])
        self.assertEqual(degenerate_faces(mesh), [])

    def test_plate_remains_manifold_at_all_ratios(self):
        for ratio in (0.75, 0.5, 0.25, 0.1):
            mesh = build_test_mesh()
            Simplifier(mesh, SimplifyOptions(
                lock_parts=("bracket",))).run_ratio(ratio)
            self.assertEqual(find_nonmanifold_edges(mesh), [])
            self.assertEqual(orientation_inconsistencies(mesh), [])
            self.assertEqual(degenerate_faces(mesh), [])

    def test_hard_edges_never_collapse(self):
        mesh = build_test_mesh()
        hard = {k for k in mesh.edge_faces if mesh.edge_is_hard(k)}
        Simplifier(mesh, SimplifyOptions(
            lock_parts=("bracket",))).run_ratio(0.2)
        surviving = set(mesh.edge_faces)
        self.assertTrue(hard.issubset(surviving))

    def test_locked_part_is_frozen(self):
        mesh = build_test_mesh()
        bracket = {i for i, p in enumerate(mesh.parts) if p == "bracket"}
        bracket_faces_before = {
            f for f in range(mesh.num_faces)
            if int(mesh.face_part[f]) in bracket}
        Simplifier(mesh, SimplifyOptions(
            lock_parts=("bracket",))).run_ratio(0.2)
        bracket_faces_after = {
            f for f in bracket_faces_before if mesh.face_alive[f]}
        self.assertEqual(bracket_faces_before, bracket_faces_after)

    def test_seam_lock_policy_preserves_seams(self):
        mesh = build_test_mesh()
        seams = {k for k in mesh.edge_faces if mesh.edge_is_uv_seam(k)}
        Simplifier(mesh, SimplifyOptions(
            seam_policy="lock", boundary_policy="lock",
            lock_parts=("bracket",))).run_ratio(0.3)
        self.assertTrue(seams.issubset(set(mesh.edge_faces)))


class TestObjRoundtrip(unittest.TestCase):
    def test_roundtrip_keeps_seams_and_hard_edges(self):
        path = "/tmp/_roundtrip.obj"
        original = build_test_mesh()
        write_obj(original, path)
        loaded = load_obj(path)
        b0 = classify_constraint_edges(original)
        b1 = classify_constraint_edges(loaded)
        self.assertEqual(len(b0["seam"]), len(b1["seam"]))
        self.assertEqual(len(b0["hard"]), len(b1["hard"]))
        self.assertEqual(loaded.num_faces, original.num_faces)
        self.assertTrue(full_report(loaded)["manifold"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
