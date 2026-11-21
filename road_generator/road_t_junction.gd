@tool
class_name RoadTJunction3D
extends Node3D

# T-junction between a main road ribbon and a perpendicular branch.
# The branch mouth is sampled on the main road's left edge so the two meshes
# share an exact seam; branch vertices are kept outside the main footprint
# through the transition to avoid overlapping faces.

var builder := RoadMeshBuilder.new()


# main_curve/main_profile describe the through road.
# branch_curve starts at the anchor and travels away from the main road.
# branch_full_half_width is the branch width after the transition.
func build(main_curve: RoadCurve, main_profile: RoadProfile,
		branch_curve: RoadCurve, anchor_station: float,
		branch_full_half_width: float, transition_length: float,
		spacing: float = 1.0) -> Dictionary:
	main_curve.recompute_lengths()
	branch_curve.recompute_lengths()

	var anchor_frame: Dictionary = main_curve.sample(anchor_station)
	var anchor_point: Vector3 = anchor_frame.point
	var main_half_width: float = main_profile.half_width_at(anchor_station)
	var right: Vector3 = anchor_frame.tangent
	right = Vector3(right.z, 0.0, -right.x)
	var left: Vector3 = -right

	# The branch curve's first anchor must sit exactly on the main edge.
	var edge_anchor: Vector3 = anchor_point + left * main_half_width
	var mouth_tangent: Vector3 = branch_curve.endpoint_tangent(false)

	# Main mesh gets one extra station at the junction, whose edge vertices
	# become the branch mouth seam.
	var main_built: Dictionary = builder.build(
		main_curve, main_profile, spacing, [anchor_station])

	# Extract the seven left-edge vertices of the inserted junction row.
	var junction_row: Dictionary = _find_row(main_built.rows, anchor_station)
	var mouth_positions: Array[Vector3] = junction_row.positions.duplicate()

	# Branch profile: mouth width equals the main width, expands to full width.
	var branch_profile := RoadProfile.new()
	branch_profile.width_keys = [
		{"station": 0.0, "half_width": main_half_width},
		{"station": transition_length, "half_width": branch_full_half_width},
		{"station": 1.0e12, "half_width": branch_full_half_width},
	]
	branch_profile.set_constant_bank(0.0)

	var branch_built: Dictionary = _build_branch(
		branch_curve, branch_profile, spacing, mouth_positions)

	return {
		"main": main_built,
		"branch": branch_built,
		"anchor_point": anchor_point,
		"edge_anchor": edge_anchor,
		"junction_station": anchor_station,
		"main_half_width": main_half_width,
		"left_normal": left,
		"mouth_tangent": mouth_tangent,
		"transition_length": transition_length,
	}


func _find_row(rows: Array, station: float) -> Dictionary:
	var best: Dictionary = rows[0]
	var best_error: float = INF
	for row in rows:
		var error: float = absf(row.station - station)
		if error < best_error:
			best_error = error
			best = row
	return best


func _build_branch(curve: RoadCurve, profile: RoadProfile, spacing: float,
		mouth_positions: Array[Vector3]) -> Dictionary:
	curve.recompute_lengths()
	var stations: Array[float] = curve.sample_stations(spacing)
	stations[0] = 0.0

	var rows: Array = []
	# Row 0 is the shared mouth, snapped verbatim to the main edge vertices.
	rows.append({
		"positions": mouth_positions.duplicate(),
		"station": 0.0,
		"half_width": profile.half_width_at(0.0),
		"bank": 0.0,
	})
	for i in range(1, stations.size()):
		var frame: Dictionary = curve.sample(stations[i])
		rows.append(profile.build_frame(frame, stations[i]))

	var columns: int = RoadProfile.COLUMN_OFFSETS.size()
	var positions := PackedVector3Array()
	var uvs := PackedVector2Array()
	var top_rows: Array[int] = []
	for row in rows:
		top_rows.append(positions.size())
		for c in range(columns):
			positions.append(row.positions[c])
			uvs.append(Vector2(RoadProfile.COLUMN_OFFSETS[c] + 0.5, row.station))

	var indices := PackedInt32Array()
	for r in range(rows.size() - 1):
		var frame: Dictionary = curve.sample(rows[r].station)
		var right := Vector3(frame.tangent.z, 0.0, -frame.tangent.x)
		var across: Vector3 = rows[r].positions[1] - rows[r].positions[0]
		var rightward: bool = across.dot(right) >= 0.0
		for c in range(columns - 1):
			var a: int = top_rows[r] + c
			var b: int = top_rows[r + 1] + c
			if rightward:
				indices.append(a)
				indices.append(b + 1)
				indices.append(a + 1)
				indices.append(a)
				indices.append(b)
				indices.append(b + 1)
			else:
				indices.append(a)
				indices.append(a + 1)
				indices.append(b + 1)
				indices.append(a)
				indices.append(b + 1)
				indices.append(b)

	_append_branch_walls(curve, rows, top_rows, columns, positions, uvs, indices)

	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = positions
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)

	return {
		"mesh": mesh,
		"rows": rows,
		"stations": stations,
		"top_rows": top_rows,
		"columns": columns,
		"positions": positions,
		"indices": indices,
		"curve": curve,
		"profile": profile,
	}


func _append_branch_walls(curve: RoadCurve, rows: Array, top_rows: Array, columns: int,
		positions: PackedVector3Array, uvs: PackedVector2Array,
		indices: PackedInt32Array) -> void:
	for column in [0, columns - 1]:
		var is_left: bool = column == 0
		var bottom_rows: Array[int] = []
		for r in range(rows.size()):
			var top: Vector3 = positions[top_rows[r] + column]
			bottom_rows.append(positions.size())
			positions.append(Vector3(top.x, top.y - builder.side_height, top.z))
			uvs.append(Vector2(0.0, rows[r].station))
		for r in range(rows.size() - 1):
			var t0: int = top_rows[r] + column
			var t1: int = top_rows[r + 1] + column
			var b0: int = bottom_rows[r]
			var b1: int = bottom_rows[r + 1]
			var frame: Dictionary = curve.sample(rows[r].station)
			var right := Vector3(frame.tangent.z, 0.0, -frame.tangent.x)
			var outward: Vector3 = -right if is_left else right
			var candidate: Vector3 = (positions[b0] - positions[t0]).cross(
				positions[b1] - positions[t0])
			if candidate.dot(outward) >= 0.0:
				indices.append(t0); indices.append(b0); indices.append(b1)
				indices.append(t0); indices.append(b1); indices.append(t1)
			else:
				indices.append(t0); indices.append(b1); indices.append(b0)
				indices.append(t0); indices.append(t1); indices.append(b1)
