"""Frame renderer with retained previous-frame state and playback controls."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .blur import fast_motion_vector, reference_multisample
from .error import compute_stats, per_pixel_error
from .motion import MotionVectors, compute_motion_vectors
from .rasterizer import GBuffer, render_gbuffer
from .scene import SceneObject
from .transform import Camera, Transform


@dataclass
class FrameResult:
    fast: np.ndarray
    reference: np.ndarray
    gbuffer: GBuffer
    motion: MotionVectors
    error: np.ndarray
    stats: object
    t: float
    frame_index: int


@dataclass
class MotionBlurRenderer:
    """Drives a sequence of frames and keeps the previous frame's state.

    The renderer deliberately stores the previous object transforms and
    camera pose (plus the previous G-buffer) so motion vectors can be built
    by reprojection. Pause freezes the clock (identical adjacent transforms),
    and reset discards history so the next frame is treated as a first frame.
    """

    objects: list[SceneObject]
    camera_factory: object
    frame_interval: float = 1.0 / 30.0
    exposure_fraction: float = 0.5
    shutter_center_fraction: float = 0.5
    reference_samples: int = 16
    background: np.ndarray | None = None
    background_depth: float = 30.0
    frame_index: int = 0
    sim_time: float = 0.0
    paused: bool = False
    _prev_gb: GBuffer | None = field(default=None, init=False)
    _prev_camera: Camera | None = field(default=None, init=False)
    _prev_transforms: dict[int, Transform] | None = field(default=None, init=False)
    _prev_time: float | None = field(default=None, init=False)

    def _camera_at(self, t: float) -> Camera:
        return self.camera_factory(t)

    def _current_transforms(self, t: float) -> dict[int, Transform]:
        return {obj.mesh.object_id: obj.world_transform(t) for obj in self.objects}

    def shutter_interval(self, t: float) -> tuple[float, float]:
        """Configurable exposure interval around frame time ``t``."""
        duration = self.exposure_fraction * self.frame_interval
        center = t - self.frame_interval * (0.5 - self.shutter_center_fraction)
        return center - 0.5 * duration, center + 0.5 * duration

    def pause(self) -> None:
        self.paused = True

    def resume(self) -> None:
        self.paused = False

    def reset(self) -> None:
        """Drop all retained history and rewind the clock to frame zero."""
        self.frame_index = 0
        self.sim_time = 0.0
        self.paused = False
        self._prev_gb = None
        self._prev_camera = None
        self._prev_transforms = None
        self._prev_time = None

    def step(self) -> FrameResult:
        t = self.sim_time
        t_prev = self._prev_time
        # The motion segment for this frame spans one frame interval unless
        # playback is paused, in which case the world is frozen.
        frame_delta = 0.0 if self.paused else self.frame_interval
        t_open, t_close = self.shutter_interval(t)
        camera = self._camera_at(t)
        current_transforms = self._current_transforms(t)
        gb = render_gbuffer(self.objects, camera, t, self.background)

        mv = compute_motion_vectors(
            gb, self._prev_gb, self.objects, camera, self._prev_camera,
            current_transforms, self._prev_transforms,
            t_prev=t_prev if t_prev is not None else t,
            t_current=t, t_open=t_open, t_close=t_close,
            frame_delta=frame_delta,
            background_depth=self.background_depth)

        fast = fast_motion_vector(gb, mv)
        reference = reference_multisample(
            self.objects, camera, t_open, t_close,
            self.reference_samples, self.background,
            camera_factory=self._camera_at)
        error = per_pixel_error(fast, reference)
        stats = compute_stats(error, mv)
        result = FrameResult(fast, reference, gb, mv, error, stats,
                             t, self.frame_index)

        # Retain this frame's state for the next frame's reprojection.
        self._prev_gb = gb
        self._prev_camera = camera
        self._prev_transforms = current_transforms
        # Retain the simulation time this frame was evaluated at. When
        # paused the clock does not advance, so the next frame sees dt = 0.
        self._prev_time = self.sim_time
        self.frame_index += 1
        if not self.paused:
            self.sim_time += self.frame_interval
        return result
