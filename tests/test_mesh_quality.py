import numpy as np

from meshbrush import TriangleMesh
from tests.meshes import forked_sheet, sliver_mesh


def test_fork_edge_is_non_manifold_and_manifold_edges_are_not():
    mesh = forked_sheet()
    table = mesh.edge_faces()
    fork_edge = (0, 1)
    assert len(table[fork_edge]) == 3
    assert not mesh.edge_is_manifold(fork_edge)
    manifold_edges = [edge for edge, faces in table.items()
                      if edge != fork_edge]
    assert all(len(table[edge]) <= 2 for edge in manifold_edges)


def test_fork_branches_share_one_edge_connected_component():
    mesh = forked_sheet()
    labels = mesh.connected_components()
    assert np.unique(labels).tolist() == [0]


def test_quality_flags_sliver_and_reports_minimum_angle():
    mesh = sliver_mesh()
    quality = mesh.quality()
    assert not quality.is_sliver[0]
    assert quality.is_sliver[1]
    assert quality.min_angle_rad[1] < quality.min_angle_rad[0]
    assert quality.area[1] > 0.0


def test_repeated_quality_call_is_cached():
    mesh = sliver_mesh()
    first = mesh.quality()
    second = mesh.quality()
    assert first is second
    stricter = mesh.quality(min_angle_deg=45.0)
    assert stricter is not first
    assert stricter.is_sliver.all()


def test_invalid_shape_raises():
    with np.testing.assert_raises(ValueError):
        TriangleMesh(np.zeros(4), np.array([[0, 1, 2]]))
