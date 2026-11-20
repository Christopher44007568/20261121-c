"""Pure-Python port of the Unity ribbon math (see Assets/RibbonMesh/Runtime).

Mirrors the C# implementation closely so the numerical validation below
exercises the same algorithms the Unity component runs.
"""

import math

EPS = 1e-8


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def length(a):
    return math.sqrt(dot(a, a))


def distance(a, b):
    return length(sub(a, b))


def normalize(a):
    n = length(a)
    return scale(a, 1.0 / n) if n > 1e-15 else (0.0, 0.0, 0.0)


def lerp(a, b, t):
    return add(scale(a, 1.0 - t), scale(b, t))


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def remap(a, b, t, va, vb):
    if abs(b - a) < EPS:
        return va
    return add(va, scale(sub(vb, va), (t - a) / (b - a)))


def evaluate_segment(p0, p1, p2, p3, u):
    t0 = 0.0
    t1 = t0 + max(distance(p0, p1), EPS) ** 0.5
    t2 = t1 + max(distance(p1, p2), EPS) ** 0.5
    t3 = t2 + max(distance(p2, p3), EPS) ** 0.5
    t = t1 + (t2 - t1) * u
    a1 = remap(t0, t1, t, p0, p1)
    a2 = remap(t1, t2, t, p1, p2)
    a3 = remap(t2, t3, t, p2, p3)
    b1 = remap(t0, t2, t, a1, a2)
    b2 = remap(t1, t3, t, a2, a3)
    return remap(t1, t2, t, b1, b2)


def spline_evaluate(points, t):
    count = len(points)
    scaled = (t % 1.0) * count
    segment = int(math.floor(scaled)) % count
    u = scaled - math.floor(scaled)
    p0 = points[(segment - 1) % count]
    p1 = points[segment % count]
    p2 = points[(segment + 1) % count]
    p3 = points[(segment + 2) % count]
    return evaluate_segment(p0, p1, p2, p3, u)


def spline_tangent(points, t):
    h = 1e-4
    t0 = (t - h) % 1.0
    t1 = (t + h) % 1.0
    derivative = scale(sub(spline_evaluate(points, t1),
                           spline_evaluate(points, t0)), 1.0 / (2.0 * h))
    if dot(derivative, derivative) < 1e-12:
        count = len(points)
        i = clamp(int(math.floor((t % 1.0) * count)), 0, count - 1)
        derivative = sub(points[(i + 1) % count], points[i])
    return normalize(derivative)


def cyclic_scalar(values, t):
    count = len(values)
    scaled = (t % 1.0) * count
    i = int(math.floor(scaled))
    u = scaled - i
    return values[i % count] * (1.0 - u) + values[(i + 1) % count] * u


def quaternion_from_to(from_v, to_v):
    """Rotation quaternion carrying from_v onto to_v (minimal rotation)."""
    a = normalize(from_v)
    b = normalize(to_v)
    d = clamp(dot(a, b), -1.0, 1.0)
    if d < -1.0 + 1e-9:
        axis = cross(a, (1.0, 0.0, 0.0))
        if length(axis) < 1e-6:
            axis = cross(a, (0.0, 1.0, 0.0))
        return (normalize(axis), 0.0)
    axis = cross(a, b)
    w = 1.0 + d
    q = (axis[0], axis[1], axis[2], w)
    n = math.sqrt(sum(x * x for x in q))
    return (scale(q[:3], 1.0 / n), q[3] / n)


def rotate_vector(q, v):
    axis, w = q
    # v' = 2 * axis * dot(axis, v) + v * (w^2 - dot(axis, axis))
    #      + 2 * w * cross(axis, v), with unit quaternion this simplifies to:
    return add(
        add(scale(v, w * w - dot(axis, axis)),
            scale(axis, 2.0 * dot(axis, v))),
        scale(cross(axis, v), 2.0 * w))


def rotate_around_axis(v, axis, angle):
    axis = normalize(axis)
    c = math.cos(angle)
    s = math.sin(angle)
    return add(add(scale(v, c), scale(cross(axis, v), s)),
               scale(axis, dot(axis, v) * (1.0 - c)))


def reorthogonalize(tangent, candidate):
    projected = sub(candidate, scale(tangent, dot(tangent, candidate)))
    if dot(projected, projected) < 1e-12:
        fallback = (0.0, 1.0, 0.0) if abs(tangent[1]) < 0.9 else (1.0, 0.0, 0.0)
        projected = cross(tangent, fallback)
    return normalize(projected)


def perpendicular(tangent):
    if abs(tangent[0]) <= abs(tangent[1]) and abs(tangent[0]) <= abs(tangent[2]):
        axis = (1.0, 0.0, 0.0)
    elif abs(tangent[1]) <= abs(tangent[2]):
        axis = (0.0, 1.0, 0.0)
    else:
        axis = (0.0, 0.0, 1.0)
    return reorthogonalize(tangent, cross(tangent, axis))


def signed_angle_around(from_v, to_v, axis):
    d = clamp(dot(from_v, to_v), -1.0, 1.0)
    c = dot(axis, cross(from_v, to_v))
    return math.atan2(c, d)
