"""View-ray circular brush toolkit for triangle-mesh painting."""

from .bvh import BVH, RayHit
from .brush import (BrushEngine, BrushSettings, DabReport, PaintLayer,
                    Stroke, StrokeResult)
from .camera import Camera
from .geometry import angle_between, normalize, ray_triangle
from .io import load_obj, save_obj
from .mesh import FaceQuality, TriangleMesh
from .stats import (fraction_painted, painted_area_by_component,
                    painted_face_count, sliver_painted_faces)

__all__ = [
    "BVH", "RayHit",
    "BrushEngine", "BrushSettings", "DabReport", "PaintLayer",
    "Stroke", "StrokeResult",
    "Camera",
    "angle_between", "normalize", "ray_triangle",
    "FaceQuality", "TriangleMesh",
    "load_obj", "save_obj",
    "fraction_painted", "painted_area_by_component",
    "painted_face_count", "sliver_painted_faces",
]
