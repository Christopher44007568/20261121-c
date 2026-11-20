"""Frame transport, arc-length resampling and ribbon assembly (Python port)."""

from ribbon_math import (
    add,
    clamp,
    cross,
    cyclic_scalar,
    distance,
    dot,
    length,
    lerp,
    normalize,
    perpendicular,
    quaternion_from_to,
    reorthogonalize,
    rotate_around_axis,
    rotate_vector,
    signed_angle_around,
    spline_evaluate,
    spline_tangent,
    sub,
    scale,
)


def build_frames(positions, tangents):
    count = len(positions)
    # The caller supplies N interior rings followed by a closing ring that is
    # identical to ring 0 (same position and tangent). Transport therefore has
    # a well-defined final step onto the exact starting frame.
    raw_normals = [None] * count
    tangent0 = normalize(tangents[0])
    raw_normals[0] = perpendicular(tangent0)

    for i in range(1, count):
        previous = normalize(tangents[i - 1])
        current = normalize(tangents[i])
        rotation = quaternion_from_to(previous, current)
        transported = rotate_vector(rotation, raw_normals[i - 1])
        raw_normals[i] = reorthogonalize(current, transported)

    # The closing ring's transported normal lives in ring 0's tangent plane;
    # its angle against the starting normal is the loop's residual twist.
    residual = signed_angle_around(
        raw_normals[count - 1], raw_normals[0], tangent0)

    frames = []
    interior_count = count - 1
    for i in range(count):
        tangent = normalize(tangents[i])
        # Zero correction at ring 0; full +residual at the last ring so it
        # matches the closing sentinel (which equals ring 0 physically).
        corrected = rotate_around_axis(
            raw_normals[i], tangent, residual * i / interior_count)
        normal = reorthogonalize(tangent, corrected)
        binormal = normalize(cross(tangent, normal))
        frames.append({
            "position": positions[i],
            "tangent": tangent,
            "normal": normal,
            "binormal": binormal,
            "raw_normal": raw_normals[i],
        })
    return frames, residual


def sample_dense(points, samples_per_segment):
    total = len(points) * samples_per_segment
    dense = []
    accumulated = 0.0
    previous_position = None
    for i in range(total):
        t = i / total
        position = spline_evaluate(points, t)
        if previous_position is not None:
            accumulated += distance(previous_position, position)
        dense.append({
            "position": position,
            "t": t,
            "arc": accumulated,
        })
        previous_position = position
    # Explicit closing sample at t = 1, identical to t = 0 but carrying the
    # arc length of the final wrap-around segment.
    closing_position = spline_evaluate(points, 0.0)
    accumulated += distance(previous_position, closing_position)
    dense.append({"position": closing_position, "t": 1.0, "arc": accumulated})
    return dense


def resample_arc_length(points, dense, ring_count):
    total_length = dense[-1]["arc"]
    rings = []
    j = 1
    for ring in range(ring_count):
        target = total_length * ring / ring_count
        while j < len(dense) and dense[j]["arc"] < target:
            j += 1
        a = dense[j - 1]
        b = dense[j]
        span = b["arc"] - a["arc"]
        blend = 0.0 if span <= 1e-10 else (target - a["arc"]) / span
        ring_t = a["t"] + (b["t"] - a["t"]) * blend
        ring_position = lerp(a["position"], b["position"], blend)
        # Symmetric central difference on the dense arc-length polyline at the
        # ring's own position. Cyclic indices mean ring 0 and the closing ring
        # evaluate the same two neighbors, hence share position and tangent.
        back = dense[(j - 1) % (len(dense) - 1)]
        forward = dense[j % (len(dense) - 1)]
        ring_tangent = normalize(sub(forward["position"], back["position"]))
        if length(ring_tangent) < 1e-12:
            ring_tangent = spline_tangent(points, ring_t)
        rings.append({
            "position": ring_position,
            "tangent": ring_tangent,
            "t": ring_t,
            "arc": target,
        })
    return rings


def assemble_ribbon(points, widths, offsets, ring_count=220,
                    samples_per_segment=24, texture_repeat=6.0,
                    correct_twist=True):
    dense = sample_dense(points, samples_per_segment)
    # N interior rings plus one explicit closing ring copied from ring 0.
    rings = resample_arc_length(points, dense, ring_count)
    rings.append(dict(rings[0]))
    positions = [r["position"] for r in rings]
    tangents = [r["tangent"] for r in rings]
    all_frames, residual = build_frames(positions, tangents)
    frames = all_frames[:ring_count]
    closing_frame = all_frames[ring_count]

    vertices = []
    uvs = []
    for i in range(ring_count + 1):
        ring = rings[i]
        frame = all_frames[i]
        width = cyclic_scalar(widths, ring["t"]) if widths else 1.0
        offset = clamp(cyclic_scalar(offsets, ring["t"])
                       if offsets else 0.5, 0.0, 1.0)
        across = frame["normal"] if correct_twist else frame["raw_normal"]
        across = reorthogonalize(frame["tangent"], across)
        minus = sub(frame["position"], scale(across, width * offset))
        plus = add(frame["position"], scale(across, width * (1.0 - offset)))
        u = texture_repeat * i / ring_count
        vertices.append((minus, plus))
        uvs.append(((u, 0.0), (u, 1.0)))
    return {
        "frames": frames,
        "closing_frame": closing_frame,
        "residual": residual,
        "vertices": vertices,
        "uvs": uvs,
        "rings": rings,
    }
