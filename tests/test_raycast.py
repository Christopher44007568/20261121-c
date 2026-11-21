import numpy as np

from meshbrush import BVH, Camera, TriangleMesh
from tests.meshes import grid_mesh, two_parallel_sheets


def test_bvh_nearest_hit_picks_front_sheet():
    mesh, front_count = two_parallel_sheets(gap=0.02)
    bvh = BVH(mesh)
    origin = np.array([0.6, 0.6, 3.0])
    hit = bvh.cast_ray(origin, np.array([0.0, 0.0, -1.0]))
    assert hit is not None
    assert hit.face_id < front_count
    assert hit.front_facing
    assert abs(hit.point[2]) < 1.0e-9


def test_ray_misses_when_pointing_away():
    mesh = grid_mesh(3, 3, spacing=0.5)
    bvh = BVH(mesh)
    hit = bvh.cast_ray(np.array([0.75, 0.75, 2.0]),
                       np.array([0.0, 0.0, 1.0]))
    assert hit is None


def test_back_sheet_is_geometrically_reachable_by_camera_below():
    mesh, front_count = two_parallel_sheets(gap=0.02)
    bvh = BVH(mesh)
    origin = np.array([0.6, 0.6, -3.0])
    hit = bvh.cast_ray(origin, np.array([0.0, 0.0, 1.0]))
    assert hit is not None
    assert hit.face_id >= front_count


def test_camera_screen_ray_centre_matches_view_direction():
    camera = Camera(position=(0.0, 0.0, 4.0), target=(0.0, 0.0, 0.0),
                    up=(0.0, 1.0, 0.0))
    origin, direction = camera.screen_ray(0.0, 0.0)
    assert np.allclose(origin, camera.position)
    assert np.allclose(direction, [0.0, 0.0, -1.0])


def test_world_radius_to_pixels_shrinks_with_distance():
    camera = Camera(position=(0.0, 0.0, 5.0), target=(0.0, 0.0, 0.0),
                    up=(0.0, 1.0, 0.0), fov_y_deg=45.0)
    near = camera.world_radius_to_pixels(0.3, 5.0, 800)
    far = camera.world_radius_to_pixels(0.3, 10.0, 800)
    assert near > far
    assert abs(near - 2.0 * far) < 1.0e-9
