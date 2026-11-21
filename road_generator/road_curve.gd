@tool
class_name RoadCurve
extends RefCounted

# A chain of cubic Bezier segments joined C0/G1, parameterised by arc length.
# All math is in the XZ plane (Godot's ground plane); Y is vertical.

var segments: Array = []
var segment_lengths: Array[float] = []
var cumulative: Array[float] = [0.0]
var total_length: float = 0.0


static func cubic_point(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: float) -> Vector3:
	var u: float = 1.0 - t
	var uu: float = u * u
	var tt: float = t * t
	return p0 * (uu * u) + p1 * (3.0 * uu * t) + p2 * (3.0 * u * tt) + p3 * (tt * t)


static func cubic_derivative(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: float) -> Vector3:
	var u: float = 1.0 - t
	return (p1 - p0) * (3.0 * u * u) + (p2 - p1) * (6.0 * u * t) + (p3 - p2) * (3.0 * t * t)


static func make_bezier_segment(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3) -> Dictionary:
	return {"p0": p0, "p1": p1, "p2": p2, "p3": p3}


func add_segment(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3) -> void:
	segments.append(make_bezier_segment(p0, p1, p2, p3))


func add_point_chain(anchors: Array[Vector3], handles_in: Array[Vector3], handles_out: Array[Vector3]) -> void:
	for i in range(anchors.size() - 1):
		add_segment(anchors[i], handles_out[i], handles_in[i + 1], anchors[i + 1])


func recompute_lengths(samples_per_segment: int = 64) -> void:
	segment_lengths.clear()
	cumulative.clear()
	cumulative.append(0.0)
	var acc: float = 0.0
	for seg in segments:
		var length: float = 0.0
		var prev: Vector3 = cubic_point(seg.p0, seg.p1, seg.p2, seg.p3, 0.0)
		for i in range(1, samples_per_segment + 1):
			var t: float = float(i) / float(samples_per_segment)
			var current: Vector3 = cubic_point(seg.p0, seg.p1, seg.p2, seg.p3, t)
			length += current.distance_to(prev)
			prev = current
		segment_lengths.append(length)
		acc += length
		cumulative.append(acc)
	total_length = acc


# Returns segment index and local t for a given arc-length station.
func locate_station(station: float) -> Dictionary:
	var s: float = clamp(station, 0.0, total_length)
	var idx: int = 0
	while idx < segment_lengths.size() - 1 and s > cumulative[idx + 1]:
		idx += 1
	var local: float = 0.0
	if segment_lengths[idx] > 0.0:
		local = (s - cumulative[idx]) / segment_lengths[idx]
	return {"index": idx, "t": clamp(local, 0.0, 1.0)}


func sample(station: float) -> Dictionary:
	if segments.is_empty():
		push_error("RoadCurve has no segments")
		return {}
	var loc: Dictionary = locate_station(station)
	var seg: Dictionary = segments[loc.index]
	var t: float = loc.t
	var point: Vector3 = cubic_point(seg.p0, seg.p1, seg.p2, seg.p3, t)
	var derivative: Vector3 = cubic_derivative(seg.p0, seg.p1, seg.p2, seg.p3, t)
	var tangent := Vector3(derivative.x, 0.0, derivative.z).normalized()
	return {"point": point, "tangent": tangent, "segment": loc.index, "t": t,
		"station": clamp(station, 0.0, total_length)}


# Signed curvature in the XZ plane: positive bends left of travel direction.
func curvature(station: float) -> float:
	var loc: Dictionary = locate_station(station)
	var seg: Dictionary = segments[loc.index]
	var t: float = loc.t
	var d1: Vector3 = cubic_derivative(seg.p0, seg.p1, seg.p2, seg.p3, t)
	var d2: Vector3 = _second_derivative(seg, t)
	var cross_y: float = d1.x * d2.z - d1.z * d2.x
	var speed_sq: float = d1.x * d1.x + d1.z * d1.z
	if speed_sq <= 0.00001:
		return 0.0
	return cross_y / (speed_sq * sqrt(speed_sq))


func _second_derivative(seg: Dictionary, t: float) -> Vector3:
	var u: float = 1.0 - t
	return (seg.p2 - 2.0 * seg.p1 + seg.p0) * (6.0 * u) + (seg.p3 - 2.0 * seg.p2 + seg.p1) * (6.0 * t)


# Uniform arc-length stations including both ends.
func sample_stations(spacing: float) -> Array[float]:
	var stations: Array[float] = []
	var count: int = max(1, int(ceil(total_length / spacing)))
	for i in range(count + 1):
		stations.append(min(total_length, i * spacing))
	return stations


# Reverse the whole chain: reversed anchor order and swapped in/out handles.
func reversed() -> RoadCurve:
	var result := RoadCurve.new()
	for i in range(segments.size() - 1, -1, -1):
		var seg: Dictionary = segments[i]
		result.add_segment(seg.p3, seg.p2, seg.p1, seg.p0)
	result.recompute_lengths()
	return result


func endpoint_tangent(at_end: bool) -> Vector3:
	if segments.is_empty():
		return Vector3.FORWARD
	var seg: Dictionary = segments[-1 if at_end else 0]
	var d: Vector3 = cubic_derivative(seg.p0, seg.p1, seg.p2, seg.p3, 1.0 if at_end else 0.0)
	var tangent := Vector3(d.x, 0.0, d.z).normalized()
	return tangent
