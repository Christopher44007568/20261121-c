@tool
class_name TestDataFactory
extends RefCounted

# Deterministic curves and profiles used by the geometry analysis and the
# editor demo. All numbers are in metres.

const RADIUS: float = 10.0
const K: float = 0.5522847498


static func straight_curve(length: float = 64.0) -> RoadCurve:
	var curve := RoadCurve.new()
	curve.add_segment(Vector3(0, 0, 0), Vector3(0, 0, length / 3.0),
		Vector3(0, 0, 2.0 * length / 3.0), Vector3(0, 0, length))
	curve.recompute_lengths()
	return curve


# Quarter circle (radius R in world units) approximated by one cubic Bezier
# with the standard kappa handles. The midpoint radius reads 9.9206 m for
# R = 10 m, matching the analytic-geometry tolerance check.
static func quarter_circle_curve(radius: float = RADIUS) -> RoadCurve:
	var curve := RoadCurve.new()
	var p0 := Vector3(0, 0, 0)
	var p1 := Vector3(0, 0, radius * K)
	var p2 := Vector3(radius * (1.0 - K), 0, radius)
	var p3 := Vector3(radius, 0, radius)
	curve.add_segment(p0, p1, p2, p3)
	curve.recompute_lengths()
	return curve


static func variable_width_profile() -> RoadProfile:
	var profile := RoadProfile.new()
	profile.width_keys = [
		{"station": 0.0, "half_width": 3.58},
		{"station": 32.0, "half_width": 4.525},
		{"station": 64.0, "half_width": 3.58},
	]
	profile.set_constant_bank(0.0)
	return profile


static func constant_profile(half_width: float = 4.0) -> RoadProfile:
	var profile := RoadProfile.new()
	profile.set_constant_width(half_width)
	profile.set_constant_bank(0.0)
	return profile


static func superelevation_profile(half_width: float = 4.0, bank: float = 0.12) -> RoadProfile:
	var profile := RoadProfile.new()
	profile.set_constant_width(half_width)
	profile.set_constant_bank(bank)
	return profile


# G1 chain: at every interior anchor the incoming and outgoing handles are
# collinear and equal length, so adjacent segments share position and tangent.
static func winding_main_curve() -> RoadCurve:
	var anchors: Array[Vector3] = [
		Vector3(0, 0, 0),
		Vector3(0, 0, 90),
		Vector3(25, 0, 125),
		Vector3(70, 0, 130),
		Vector3(110, 0, 110),
		Vector3(130, 0, 70),
		Vector3(120, 0, 30),
	]
	var handle_vectors: Array[Vector3] = [
		Vector3(0, 0, 24),
		Vector3(0, 0, 20),
		Vector3(18, 0, 2),
		Vector3(16, 0, -8),
		Vector3(8, 0, -16),
		Vector3(-4, 0, -16),
		Vector3(-6, 0, -14),
	]
	var handles_in: Array[Vector3] = []
	var handles_out: Array[Vector3] = []
	for i in range(anchors.size()):
		handles_out.append(anchors[i] + handle_vectors[i])
		handles_in.append(anchors[i] - handle_vectors[i])
	var curve := RoadCurve.new()
	curve.add_point_chain(anchors, handles_in, handles_out)
	curve.recompute_lengths()
	return curve


# Branch perpendicular to the main road at station 64, travelling outward.
static func branch_curve() -> RoadCurve:
	var curve := RoadCurve.new()
	curve.add_segment(
		Vector3(0, 0, 0),
		Vector3(-16, 0, 0),
		Vector3(-34, 0, -8),
		Vector3(-48, 0, -24))
	curve.add_segment(
		Vector3(-48, 0, -24),
		Vector3(-58, 0, -36),
		Vector3(-66, 0, -52),
		Vector3(-72, 0, -68))
	curve.recompute_lengths()
	return curve


# Branch curve rotated/translated so its anchor sits on the main left edge
# and its departure tangent is exactly opposite the main left normal.
static func place_branch(branch: RoadCurve, edge_anchor: Vector3,
		departure: Vector3) -> RoadCurve:
	var placed := RoadCurve.new()
	var basis_angle := atan2(-departure.z, departure.x)
	for seg in branch.segments:
		placed.add_segment(
			_place(seg.p0, edge_anchor, basis_angle),
			_place(seg.p1, edge_anchor, basis_angle),
			_place(seg.p2, edge_anchor, basis_angle),
			_place(seg.p3, edge_anchor, basis_angle))
	placed.recompute_lengths()
	return placed


static func _place(local_point: Vector3, anchor: Vector3, angle: float) -> Vector3:
	var rotated := Vector3(
		local_point.x * cos(angle) - local_point.z * sin(angle),
		local_point.y,
		local_point.x * sin(angle) + local_point.z * cos(angle))
	return anchor + rotated
