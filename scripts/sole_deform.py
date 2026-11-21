"""Analytic low-poly sole deformation: forefoot bend plus heel twist.

Both deformers are rigid rotations with smooth spatial ramps, applied to the
rest positions each frame, so the low sculpt acts as a rotation-propagating
driver for the transfer.
"""
import math

import numpy as np

from sole_builder import center_z


def _smoothstep_np(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def deform_positions(rest, length, bend_deg, twist_deg):
    """Return deformed copy of rest (n,3) positions.

    bend_deg:  forefoot rotation about the X axis at the bend pivot.
    twist_deg: heel rotation about the long (Y) axis, strongest at the heel.
    """
    pos = np.array(rest, dtype=np.float64, copy=True)
    y = pos[:, 1]
    y_twist_end = 0.34 * length
    ramp = np.clip((y_twist_end - y) / y_twist_end, 0.0, 1.0)
    phi = math.radians(twist_deg) * _smoothstep_np(ramp)
    zc = np.array([center_z(float(yi), length) for yi in y])
    x = pos[:, 0]
    zrel = pos[:, 2] - zc
    cos_p, sin_p = np.cos(phi), np.sin(phi)
    pos[:, 0] = x * cos_p - zrel * sin_p
    pos[:, 2] = zc + x * sin_p + zrel * cos_p
    y_bend = 0.62 * length
    z_bend = center_z(y_bend, length)
    softness = 0.06 * length
    ramp = _smoothstep_np((y - (y_bend - softness)) / (2.0 * softness))
    theta = math.radians(bend_deg) * ramp
    yrel = pos[:, 1] - y_bend
    zrel = pos[:, 2] - z_bend
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    pos[:, 1] = y_bend + yrel * cos_t - zrel * sin_t
    pos[:, 2] = z_bend + yrel * sin_t + zrel * cos_t
    return pos


def pose_at_frame(frame, frame_start, frame_end, bend_max=29.0, twist_max=36.0):
    """Smooth 0-to-max ramp of both angles across the frame range."""
    t = (frame - frame_start) / max(1, frame_end - frame_start)
    t = t * t * (3.0 - 2.0 * t)
    return bend_max * t, twist_max * t
