"""Camera projection helpers matching the Unity measurement path."""

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class CameraSpec:
    height_px: int = 720
    fov_y_deg: float = 30.0
    distance_at_1x_m: float = 0.336

    @property
    def tan_half_fov(self) -> float:
        return math.tan(math.radians(self.fov_y_deg) * 0.5)


def pixels_per_metre(camera: CameraSpec, scale: float) -> float:
    """H / (2 d tan(FovY/2)); distance scales with world scale."""
    distance = camera.distance_at_1x_m * scale
    return camera.height_px / (2.0 * distance * camera.tan_half_fov)


def metres_per_pixel(camera: CameraSpec, scale: float) -> float:
    return 1.0 / pixels_per_metre(camera, scale)
