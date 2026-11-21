extends SceneTree


func _initialize() -> void:
	var curve := RoadCurve.new()
	curve.add_segment(Vector3(0, 0, 0), Vector3(0, 0, 10),
		Vector3(0, 0, 20), Vector3(0, 0, 30))
	curve.recompute_lengths()
	var profile := RoadProfile.new()
	profile.set_constant_width(4.0)
	profile.set_constant_bank(0.0)
	var built := RoadMeshBuilder.new().build(curve, profile, 1.0)
	print("rows=", built.rows.size(), " columns=", built.columns,
		" verts=", built.positions.size(), " tris=", built.indices.size() / 3)
	quit()
