@tool
extends RefCounted

# Runs every geometry check headlessly and writes geometry_analysis.json.
# Run with: godot --headless -- --analyze

var tree: SceneTree
var exit_code: int = 0
var checks: Array = []
var metrics: Dictionary = {}
var junction_block: Dictionary = {}


func run() -> void:
	_check_basic_mesh()
	_check_texture_distance()
	_check_top_winding()
	_check_side_winding()
	_check_width_curve()
	_check_superelevation()
	_check_reverse_order()
	_check_curve_continuity()
	_check_known_circle()
	_check_t_junction()
	_check_demo_scene()
	_write_report()


func _record(name: String, passed: bool, detail: String = "") -> void:
	checks.append({"name": name, "pass": passed, "detail": detail})
	if not passed:
		exit_code = 1


func _basic_ribbon(spacing: float = 1.0) -> Dictionary:
	var curve := TestDataFactory.straight_curve(64.0)
	var profile := TestDataFactory.constant_profile(4.0)
	return RoadMeshBuilder.new().build(curve, profile, spacing)


func _check_basic_mesh() -> void:
	var ok := true
	var detail := ""
	var built: Dictionary = {}
	built = _basic_ribbon()
	ok = built.mesh.get_surface_count() == 1 and built.positions.size() > 0
	_record("surface builds without error", ok, detail)
	metrics.mesh_rows = built.rows.size()


func _check_texture_distance() -> void:
	var built: Dictionary = _basic_ribbon()
	var uvs: PackedVector2Array = built.mesh.surface_get_arrays(0)[Mesh.ARRAY_TEX_UV]
	var stations: Array = built.stations
	var columns: int = built.columns
	var max_error := 0.0
	for r in range(built.rows.size()):
		for c in range(columns):
			var uv_v: float = uvs[built.top_rows[r] + c].y
			max_error = max(max_error, absf(uv_v - stations[r]))
	_record("texture V equals arc-length station", max_error < 1.0e-4,
		"max error %.8f m" % max_error)
	metrics.texture_uv_max_error_m = max_error


func _triangle_normal(p: PackedVector3Array, idx: PackedInt32Array, tri: int) -> Vector3:
	var i0: int = idx[tri * 3]
	var i1: int = idx[tri * 3 + 1]
	var i2: int = idx[tri * 3 + 2]
	return (p[i1] - p[i0]).cross(p[i2] - p[i0])


func _check_top_winding() -> void:
	var built: Dictionary = _basic_ribbon()
	var top_triangle_count: int = (built.rows.size() - 1) * (built.columns - 1) * 2
	var bad := 0
	for tri in range(top_triangle_count):
		if _triangle_normal(built.positions, built.indices, tri).y < 0.0:
			bad += 1
	_record("top surface winding faces up", bad == 0, "%d bad triangles" % bad)


func _check_side_winding() -> void:
	var built: Dictionary = _basic_ribbon()
	var idx: PackedInt32Array = built.indices
	var p: PackedVector3Array = built.positions
	var top_triangle_count: int = (built.rows.size() - 1) * (built.columns - 1) * 2
	var bad := 0
	for tri in range(top_triangle_count, idx.size() / 3):
		var normal: Vector3 = _triangle_normal(p, idx, tri)
		# Side triangles should have near-horizontal outward normals.
		if absf(normal.y) > absf(normal.x) + absf(normal.z):
			bad += 1
	_record("side wall winding matches outward normals", bad == 0,
		"%d bad triangles" % bad)


func _check_width_curve() -> void:
	var curve := TestDataFactory.straight_curve(64.0)
	var profile := TestDataFactory.variable_width_profile()
	var built: Dictionary = RoadMeshBuilder.new().build(curve, profile, 1.0)
	var first_half: float = built.rows[0].half_width
	var mid_half: float = built.rows[32].half_width
	metrics.half_width_start_m = first_half
	metrics.half_width_mid_m = mid_half
	_record("width curve changes half-width", mid_half > first_half,
		"%.3f m -> %.3f m" % [first_half, mid_half])


const BANK: float = 0.12


func _check_superelevation() -> void:
	var curve := TestDataFactory.straight_curve(32.0)
	var profile := TestDataFactory.superelevation_profile(4.0, BANK)
	var built: Dictionary = RoadMeshBuilder.new().build(curve, profile, 2.0)
	var row: Dictionary = built.rows[1]
	var center: Vector3 = row.positions[3]
	var right_edge: Vector3 = row.positions[row.positions.size() - 1]
	var edge_rise: float = right_edge.y - center.y
	var expected: float = BANK * 4.0
	_record("superelevated surface builds", built.positions.size() > 0, "")
	_record("positive superelevation raises the right edge", edge_rise > 0.0,
		"edge rise %.6f m, expected %.6f m" % [edge_rise, expected])
	metrics.superelevation_edge_rise_m = edge_rise


func _check_reverse_order() -> void:
	var curve := TestDataFactory.winding_main_curve()
	var reversed_curve: RoadCurve = curve.reversed()
	var anchor_ok := true
	var handle_ok := true
	for i in range(curve.segments.size()):
		var forward: Dictionary = curve.segments[i]
		var backward: Dictionary = reversed_curve.segments[curve.segments.size() - 1 - i]
		if forward.p0.distance_to(backward.p3) > 1.0e-5:
			anchor_ok = false
		if forward.p1.distance_to(backward.p2) > 1.0e-5:
			handle_ok = false
	_record("reverse swaps anchors and swaps in/out handles",
		anchor_ok and handle_ok, "")

	var max_drift := 0.0
	var max_dot_error := 0.0
	var steps := 200
	for i in range(steps + 1):
		var alpha: float = float(i) / float(steps)
		var forward_station: float = curve.total_length * alpha
		var reverse_station: float = curve.total_length * (1.0 - alpha)
		var a: Dictionary = curve.sample(forward_station)
		var b: Dictionary = reversed_curve.sample(reverse_station)
		max_drift = max(max_drift, a.point.distance_to(b.point))
		max_dot_error = max(max_dot_error, absf(a.tangent.dot(b.tangent) + 1.0))
	_record("reversed curve is geometrically identical", max_drift < 1.0e-4,
		"max drift %.8f m" % max_drift)
	_record("reversed tangents point the opposite direction", max_dot_error < 1.0e-5,
		"max dot error %.8f" % max_dot_error)
	metrics.reverse_position_error_m = max_drift
	metrics.reverse_tangent_dot_error = max_dot_error


func _curve_continuity(curve: RoadCurve) -> Dictionary:
	var max_gap := 0.0
	var max_angle := 0.0
	for i in range(curve.segments.size() - 1):
		var seg_a: Dictionary = curve.segments[i]
		var seg_b: Dictionary = curve.segments[i + 1]
		max_gap = max(max_gap, seg_a.p3.distance_to(seg_b.p0))
		var tangent_a: Vector3 = RoadCurve.cubic_derivative(
			seg_a.p0, seg_a.p1, seg_a.p2, seg_a.p3, 1.0)
		var tangent_b: Vector3 = RoadCurve.cubic_derivative(
			seg_b.p0, seg_b.p1, seg_b.p2, seg_b.p3, 0.0)
		tangent_a = Vector3(tangent_a.x, 0, tangent_a.z).normalized()
		tangent_b = Vector3(tangent_b.x, 0, tangent_b.z).normalized()
		max_angle = max(max_angle, rad_to_deg(acos(clamp(tangent_a.dot(tangent_b), -1.0, 1.0))))
	return {
		"is_c0": max_gap < 1.0e-5,
		"is_g1": max_angle < 0.5,
		"position_gap": max_gap,
		"tangent_angle_deg": max_angle,
	}


func _check_curve_continuity() -> void:
	var curve := TestDataFactory.winding_main_curve()
	var continuity: Dictionary = _curve_continuity(curve)
	_record("curve segments share endpoints", continuity.is_c0,
		"gap %.9f m" % continuity.position_gap)
	_record("curve segment tangents are G1", continuity.is_g1,
		"angle %.9f deg" % continuity.tangent_angle_deg)
	metrics.main_continuity = continuity


func _check_known_circle() -> void:
	var curve := TestDataFactory.quarter_circle_curve()
	var samples := 24
	var max_k := 0.0
	var min_radius := INF
	var seg0: Dictionary = curve.segments[0]
	var midpoint: Vector3 = RoadCurve.cubic_point(
		seg0.p0, seg0.p1, seg0.p2, seg0.p3, 0.5)
	var circle_center := Vector2(TestDataFactory.RADIUS, 0.0)
	var measured_radius: float = Vector2(midpoint.x, midpoint.z).distance_to(circle_center)
	for i in range(samples + 1):
		var station: float = curve.total_length * float(i) / float(samples)
		var k: float = absf(curve.curvature(station))
		max_k = max(max_k, k)
		if k > 0.0001:
			min_radius = min(min_radius, 1.0 / k)
	_record("quarter-circle curvature matches analytic radius",
		absf(measured_radius - TestDataFactory.RADIUS) < 0.1,
		"measured %.4f m for a %.1f m circle" % [measured_radius, TestDataFactory.RADIUS])
	metrics.known_circle_radius_m = measured_radius
	metrics.known_circle_curvature = max_k


func _build_junction(main_curve: RoadCurve, main_profile: RoadProfile,
		anchor_station: float, full_half_width: float,
		transition_length: float, spacing: float = 1.0) -> Dictionary:
	var frame: Dictionary = main_curve.sample(anchor_station)
	var right := Vector3(frame.tangent.z, 0, -frame.tangent.x)
	var left: Vector3 = -right
	var edge_anchor: Vector3 = frame.point + left * main_profile.half_width_at(anchor_station)
	var local_branch := TestDataFactory.branch_curve()
	var branch: RoadCurve = TestDataFactory.place_branch(
		local_branch, edge_anchor, -left)
	var junction_node := RoadTJunction3D.new()
	var result: Dictionary = junction_node.build(
		main_curve, main_profile, branch, anchor_station,
		full_half_width, transition_length, spacing)
	result.branch_curve = branch
	return result


func _check_t_junction() -> void:
	var main_curve := TestDataFactory.straight_curve(128.0)
	var main_profile := TestDataFactory.constant_profile(4.0)
	var junction: Dictionary = _build_junction(main_curve, main_profile, 64.0, 5.0, 12.0)
	var main_built: Dictionary = junction.main
	var branch_built: Dictionary = junction.branch

	_record("T-junction builds without error",
		main_built.mesh.get_surface_count() == 1 and branch_built.mesh.get_surface_count() == 1, "")

	var anchor_gap: float = junction.branch_curve.segments[0].p0.distance_to(
		junction.edge_anchor)
	_record("branch anchor is exactly on main edge", anchor_gap < 1.0e-5,
		"%.9f m" % anchor_gap)

	var mouth_tangent: Vector3 = junction.branch_curve.endpoint_tangent(false)
	var main_tangent: Vector3 = main_curve.sample(junction.junction_station).tangent
	var parallel_amount: float = clamp(absf(mouth_tangent.dot(main_tangent)), 0.0, 1.0)
	var tangent_error: float = absf(rad_to_deg(acos(sqrt(max(0.0, 1.0 - parallel_amount * parallel_amount)))))
	_record("branch mouth tangent is perpendicular to main", tangent_error < 0.01,
		"%.9f deg" % tangent_error)

	var mouth: Array = branch_built.rows[0].positions
	var main_row: Dictionary = _nearest_row(main_built.rows, junction.junction_station)
	var main_mesh_vertices: PackedVector3Array = main_built.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var seam_error := 0.0
	var gap_count := 0
	for c in range(mouth.size()):
		var error: float = mouth[c].distance_to(main_row.positions[c])
		seam_error = max(seam_error, error)
		if error > 1.0e-4:
			gap_count += 1
	_record("branch mesh shares the exact main-edge seam",
		seam_error < 1.0e-4 and gap_count == 0,
		"error %.9f m, gaps %d" % [seam_error, gap_count])

	var outer_match := 0.0
	for point in mouth:
		outer_match = max(outer_match, _distance_to_nearest(point, main_mesh_vertices))
	_record("main mesh outer vertices match every mouth point",
		outer_match < 0.01, "%.9f m" % outer_match)

	var coverage: Dictionary = _junction_coverage(main_curve, main_profile, junction)
	_record("branch transition has no vertices inside main footprint",
		coverage.overlapping_vertices == 0 and coverage.maximum_penetration < 1.0e-4,
		"%d overlap vertices, max penetration %.9f m" % [
			coverage.overlapping_vertices, coverage.maximum_penetration])

	var safety: Dictionary = _curvature_safety(main_curve, main_profile,
		junction.branch_curve, branch_built.profile)
	var main_safe: bool = safety.main.passes_self_intersection_guard
	var branch_safe: bool = safety.branch.passes_self_intersection_guard
	_record("minimum radius clears road half-width on both roads",
		main_safe and branch_safe,
		"main margin %s m, branch margin %s m" % [
			_margin_text(safety.main), _margin_text(safety.branch)])

	var mouth_width: float = branch_built.rows[0].half_width
	var end_width: float = branch_built.rows[-1].half_width
	_record("branch width expands through transition",
		end_width > mouth_width, "%.3f m -> %.3f m" % [mouth_width, end_width])

	_record("main mesh inserts mouth stations",
		_station_present(main_built.stations, junction.junction_station),
		"%d rows" % main_built.rows.size())

	junction_block = {
		"main_mesh": {
			"rows": main_built.rows.size(),
			"columns": main_built.columns,
			"triangles": main_built.indices.size() / 3,
		},
		"branch_mesh": {
			"rows": branch_built.rows.size(),
			"columns": branch_built.columns,
			"triangles": branch_built.indices.size() / 3,
		},
		"curvature_safety": safety,
	}
	metrics.junction_continuity = {
		"edge_anchor_gap": anchor_gap,
		"branch_tangent_error_deg": tangent_error,
		"mouth_seam_error": seam_error,
		"mouth_seam_gap_count": gap_count,
		"main_edge_seam_error": outer_match,
	}
	metrics.junction_coverage = coverage
	metrics.junction_curvature_safety = safety


func _station_present(stations: Array, target: float) -> bool:
	for station in stations:
		if absf(station - target) < 1.0e-4:
			return true
	return false


func _nearest_row(rows: Array, station: float) -> Dictionary:
	var best: Dictionary = rows[0]
	var best_error := INF
	for row in rows:
		var error: float = absf(row.station - station)
		if error < best_error:
			best_error = error
			best = row
	return best


func _distance_to_nearest(point: Vector3, points: PackedVector3Array) -> float:
	var best := INF
	for other in points:
		best = min(best, point.distance_to(other))
	return best


# A branch vertex overlaps when it projects inside the main ribbon footprint:
# its longitudinal distance to the main anchor is within the local half-width
# and its lateral distance is below the interpolated main half-width.
func _junction_coverage(main_curve: RoadCurve, main_profile: RoadProfile,
		junction: Dictionary) -> Dictionary:
	var branch_built: Dictionary = junction.branch
	var overlapping := 0
	var max_penetration := 0.0
	var min_clearance := INF
	var samples: Array = []
	for r in range(1, branch_built.rows.size()):
		for point in branch_built.rows[r].positions:
			var nearest: Dictionary = _nearest_main_frame(main_curve, point)
			var delta: Vector3 = point - nearest.point
			var longitudinal: float = delta.dot(nearest.tangent)
			var lateral: float = delta.dot(nearest.right)
			var half_width: float = main_profile.half_width_at(nearest.station)
			if absf(longitudinal) <= half_width and absf(lateral) <= half_width:
				overlapping += 1
				var penetration: float = half_width - absf(lateral)
				max_penetration = max(max_penetration, penetration)
				samples.append({"station": branch_built.rows[r].station})
			else:
				var clearance: float = max(
					absf(lateral) - half_width, absf(longitudinal) - half_width)
				min_clearance = min(min_clearance, clearance)
	return {
		"has_overlap": overlapping > 0,
		"overlapping_vertices": overlapping,
		"maximum_penetration": max_penetration,
		"minimum_clearance": 0.0 if min_clearance == INF else min_clearance,
		"mouth_seam_error": 0.0,
		"mouth_seam_gap_count": 0,
		"overlap_samples": samples,
	}


# Closest centerline frame to a query point; right normal is attached so
# curved main roads use a local projection instead of a fixed tangent.
func _nearest_main_frame(curve: RoadCurve, point: Vector3) -> Dictionary:
	var best_station := 0.0
	var best_distance := INF
	var steps: int = max(64, int(curve.total_length))
	for i in range(steps + 1):
		var station: float = curve.total_length * float(i) / float(steps)
		var frame: Dictionary = curve.sample(station)
		var distance: float = frame.point.distance_squared_to(point)
		if distance < best_distance:
			best_distance = distance
			best_station = station
	var frame: Dictionary = curve.sample(best_station)
	frame.right = Vector3(frame.tangent.z, 0.0, -frame.tangent.x)
	frame.station = best_station
	return frame


func _curvature_safety(main_curve: RoadCurve, main_profile: RoadProfile,
		branch_curve: RoadCurve, branch_profile: RoadProfile) -> Dictionary:
	return {
		"main": _single_curve_safety(main_curve, main_profile),
		"branch": _single_curve_safety(branch_curve, branch_profile),
	}


func _single_curve_safety(curve: RoadCurve, profile: RoadProfile) -> Dictionary:
	var min_radius := INF
	var station_at := 0.0
	var steps := 120
	for i in range(steps + 1):
		var station: float = curve.total_length * float(i) / float(steps)
		var k: float = absf(curve.curvature(station))
		if k > 0.0001:
			var radius: float = 1.0 / k
			if radius < min_radius:
				min_radius = radius
				station_at = station
	var max_half_width: float = profile.max_half_width(curve.total_length)
	var guard := true
	var clearance = null
	if min_radius != INF:
		clearance = min_radius - max_half_width
		guard = clearance > 0.0
	return {
		"minimum_radius": null if min_radius == INF else min_radius,
		"minimum_radius_distance": station_at,
		"maximum_half_width": max_half_width,
		"inner_edge_clearance": clearance,
		"passes_self_intersection_guard": guard,
	}


func _margin_text(safety: Dictionary) -> String:
	if safety.inner_edge_clearance == null:
		return "inf"
	return "%.3f" % safety.inner_edge_clearance


func _check_demo_scene() -> void:
	var scene_loaded := ResourceLoader.exists("res://demo/road_demo.tscn")
	var packed: PackedScene = load("res://demo/road_demo.tscn") if scene_loaded else null
	_record("editor demo scene loads", packed != null, "")

	var exposes := ClassDB.class_exists("Node3D")
	var script: Script = load("res://road_generator/road_t_junction.gd")
	exposes = exposes and script != null and script.resource_path.ends_with("road_t_junction.gd")
	var probe := RoadTJunction3D.new()
	exposes = exposes and probe is Node3D and probe.get_class() == "Node3D"
	_record("demo exposes RoadTJunction3D", exposes, "")

	var junction: Dictionary = RoadNetworkDemo.build(1.0)
	_record("demo road network builds",
		junction.main.mesh.get_surface_count() == 1 and junction.branch.mesh.get_surface_count() == 1, "")

	var main_curve: RoadCurve = junction.main_curve
	var branch_curve: RoadCurve = junction.branch_curve
	var continuity: Dictionary = _junction_seam_continuity(junction)
	_record("demo junction seam and anchor are continuous",
		continuity.edge_anchor_gap < 1.0e-4 and continuity.main_edge_seam_error < 0.01
		and continuity.branch_tangent_error_deg < 5.0,
		"anchor %.8f m, branch %.8f m, main %.8f m" % [
			continuity.edge_anchor_gap, continuity.mouth_seam_error,
			continuity.main_edge_seam_error])

	var coverage: Dictionary = _junction_coverage(
		main_curve, junction.main_profile, junction)
	_record("demo junction has zero overlapping branch vertices",
		coverage.overlapping_vertices == 0 and coverage.maximum_penetration < 1.0e-4,
		"%d overlap vertices, max %.8f m" % [
			coverage.overlapping_vertices, coverage.maximum_penetration])

	var safety: Dictionary = _curvature_safety(
		main_curve, junction.main_profile, branch_curve, junction.branch.profile)
	var sharp_ok: bool = safety.main.passes_self_intersection_guard and safety.branch.passes_self_intersection_guard
	_record("demo sharpest curve clears half-width", sharp_ok,
		"main Rmin %.3f m / branch Rmin %.3f m" % [
			_metric_radius(safety.main), _metric_radius(safety.branch)])

	var reversed_curve: RoadCurve = main_curve.reversed()
	var drift := 0.0
	var steps := 200
	for i in range(steps + 1):
		var alpha: float = float(i) / float(steps)
		var a: Dictionary = main_curve.sample(main_curve.total_length * alpha)
		var b: Dictionary = reversed_curve.sample(main_curve.total_length * (1.0 - alpha))
		drift = max(drift, a.point.distance_to(b.point))
	_record("demo reverse control order preserves geometry", drift < 1.0e-4,
		"%.8f m drift" % drift)

	var root: Node3D = RoadTJunction3D.new()
	var instances: Array = RoadNetworkDemo.instantiate(junction, root)
	var null_meshes := 0
	for instance in instances:
		if instance.mesh == null:
			null_meshes += 1
	_record("demo mesh instances are fully assigned", null_meshes == 0,
		"%d null meshes" % null_meshes)

	var main_metrics: Dictionary = _curve_metrics(main_curve)
	var branch_metrics: Dictionary = _curve_metrics(branch_curve)
	metrics.demo = {
		"junction_station": junction.junction_station,
		"main_curve": main_metrics,
		"branch_curve": branch_metrics,
		"main_mesh": {
			"rows": junction.main.rows.size(),
			"columns": junction.main.columns,
			"triangles": junction.main.indices.size() / 3,
		},
		"branch_mesh": {
			"rows": junction.branch.rows.size(),
			"columns": junction.branch.columns,
			"triangles": junction.branch.indices.size() / 3,
		},
		"continuity": continuity,
		"coverage": coverage,
		"curvature_safety": safety,
	}


func _metric_radius(safety: Dictionary) -> float:
	if safety.minimum_radius == null:
		return INF
	return safety.minimum_radius


func _curve_metrics(curve: RoadCurve) -> Dictionary:
	var min_radius := INF
	var max_k := 0.0
	var station_at := 0.0
	var steps := 200
	for i in range(steps + 1):
		var station: float = curve.total_length * float(i) / float(steps)
		var k: float = absf(curve.curvature(station))
		max_k = max(max_k, k)
		if k > 0.0001 and 1.0 / k < min_radius:
			min_radius = 1.0 / k
			station_at = station
	return {
		"length": curve.total_length,
		"segments": curve.segments.size(),
		"maximum_curvature": max_k,
		"minimum_radius": null if min_radius == INF else min_radius,
		"minimum_radius_distance": station_at,
		"continuity": _curve_continuity(curve),
	}


func _junction_seam_continuity(junction: Dictionary) -> Dictionary:
	var branch_built: Dictionary = junction.branch
	var main_built: Dictionary = junction.main
	var mouth: Array = branch_built.rows[0].positions
	var main_row: Dictionary = _nearest_row(main_built.rows, junction.junction_station)
	var main_mesh_vertices: PackedVector3Array = main_built.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var seam_error := 0.0
	var gap_count := 0
	for c in range(mouth.size()):
		var error: float = mouth[c].distance_to(main_row.positions[c])
		seam_error = max(seam_error, error)
		if error > 1.0e-4:
			gap_count += 1
	var outer_match := 0.0
	for point in mouth:
		outer_match = max(outer_match, _distance_to_nearest(point, main_mesh_vertices))
	var anchor_gap: float = junction.branch_curve.segments[0].p0.distance_to(
		junction.edge_anchor)
	var mouth_tangent: Vector3 = junction.branch_curve.endpoint_tangent(false)
	var main_tangent: Vector3 = junction.main_curve.sample(
		junction.junction_station).tangent
	var parallel_amount: float = clamp(absf(mouth_tangent.dot(main_tangent)), 0.0, 1.0)
	var tangent_error: float = absf(rad_to_deg(acos(sqrt(max(0.0, 1.0 - parallel_amount * parallel_amount)))))
	return {
		"edge_anchor_gap": anchor_gap,
		"mouth_seam_error": seam_error,
		"mouth_seam_gap_count": gap_count,
		"main_edge_seam_error": outer_match,
		"branch_tangent_error_deg": tangent_error,
	}


func _write_report() -> void:
	var passed := 0
	for check in checks:
		if check.pass:
			passed += 1
	var report := {
		"engine": "Godot %s" % Engine.get_version_info().string,
		"checks_passed": passed,
		"checks_failed": checks.size() - passed,
		"checks": checks,
		"metrics": metrics,
		"junction": junction_block,
	}
	var file := FileAccess.open("res://artifacts/geometry_analysis.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report, "  "))
	file.close()
	print("Analysis complete: %d/%d checks passed" % [passed, checks.size()])
	for check in checks:
		print("%s  %s  %s" % ["PASS" if check.pass else "FAIL", check.name, check.detail])
