@tool
class_name RoadMeshBuilder
extends RefCounted

# Builds a two-lane ribbon ArrayMesh from a RoadCurve + RoadProfile.
# UV.v equals the arc-length station so a texture keeps constant world scale
# through bends; UV.u spans 0..1 across the road.

var side_height: float = 0.35


func build(curve: RoadCurve, profile: RoadProfile, spacing: float = 1.0,
		extra_stations: Array = []) -> Dictionary:
	curve.recompute_lengths()
	var stations: Array[float] = curve.sample_stations(spacing)
	for extra in extra_stations:
		if extra > 0.0 and extra < curve.total_length:
			stations.append(extra)
	stations.sort()
	stations = _deduplicate(stations)

	var rows: Array = []
	for station in stations:
		var frame: Dictionary = curve.sample(station)
		rows.append(profile.build_frame(frame, station))

	var columns: int = RoadProfile.COLUMN_OFFSETS.size()
	var positions := PackedVector3Array()
	var uvs := PackedVector2Array()
	var top_rows: Array = []

	for row in rows:
		var first_index: int = positions.size()
		top_rows.append(first_index)
		for c in range(columns):
			positions.append(row.positions[c])
			uvs.append(Vector2(RoadProfile.COLUMN_OFFSETS[c] + 0.5, row.station))

	var indices := PackedInt32Array()
	for r in range(rows.size() - 1):
		var across: Vector3 = rows[r].positions[1] - rows[r].positions[0]
		var rightward: bool = across.dot(rows[r].right) >= 0.0
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

	_append_side_walls(rows, top_rows, columns, positions, uvs, indices)

	var arrays := []
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


func _append_side_walls(rows: Array, top_rows: Array, columns: int,
		positions: PackedVector3Array, uvs: PackedVector2Array,
		indices: PackedInt32Array) -> void:
	# Left wall = column 0, right wall = last column.
	_add_wall(rows, top_rows, 0, true, positions, uvs, indices)
	_add_wall(rows, top_rows, columns - 1, false, positions, uvs, indices)


func _add_wall(rows: Array, top_rows: Array, column: int, is_left: bool,
		positions: PackedVector3Array, uvs: PackedVector2Array,
		indices: PackedInt32Array) -> void:
	var bottom_rows: Array[int] = []
	for r in range(rows.size()):
		var top: Vector3 = positions[top_rows[r] + column]
		var bottom_index: int = positions.size()
		bottom_rows.append(bottom_index)
		positions.append(Vector3(top.x, top.y - side_height, top.z))
		uvs.append(Vector2(0.0, rows[r].station))
	for r in range(rows.size() - 1):
		var t0: int = top_rows[r] + column
		var t1: int = top_rows[r + 1] + column
		var b0: int = bottom_rows[r]
		var b1: int = bottom_rows[r + 1]
		var outward: Vector3 = -rows[r].right if is_left else rows[r].right
		var candidate: Vector3 = (positions[b0] - positions[t0]).cross(
			positions[b1] - positions[t0])
		if candidate.dot(outward) >= 0.0:
			indices.append(t0); indices.append(b0); indices.append(b1)
			indices.append(t0); indices.append(b1); indices.append(t1)
		else:
			indices.append(t0); indices.append(b1); indices.append(b0)
			indices.append(t0); indices.append(t1); indices.append(b1)


func _deduplicate(stations: Array) -> Array:
	var result: Array[float] = []
	for station in stations:
		if result.is_empty() or absf(station - result[-1]) > 1.0e-5:
			result.append(station)
	if result.is_empty():
		return stations
	return result
