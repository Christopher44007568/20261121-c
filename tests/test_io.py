import numpy as np

from meshbrush import load_obj, save_obj
from tests.meshes import grid_mesh


def test_obj_round_trip(tmp_path):
    mesh = grid_mesh(3, 2, spacing=0.4)
    colors = np.random.default_rng(0).random((mesh.num_vertices, 3))
    path = tmp_path / "painted.obj"
    save_obj(str(path), mesh, vertex_colors=colors)
    loaded = load_obj(str(path))
    assert np.allclose(loaded.vertices, mesh.vertices)
    assert np.array_equal(loaded.faces, mesh.faces)
    assert loaded.num_faces == mesh.num_faces


def test_load_obj_triangulates_quads(tmp_path):
    path = tmp_path / "quad.obj"
    path.write_text(
        "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n",
        encoding="utf-8")
    mesh = load_obj(str(path))
    assert mesh.num_faces == 2
    assert mesh.faces.shape[1] == 3
