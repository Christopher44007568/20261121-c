extends SceneTree

const ACTOR_COUNT := 360
const WARMUP_FRAMES := 120
const SAMPLE_FRAMES := 600
const FIXED_DT := 1.0 / 60.0
const REFERENCE_BATCH := 36

var palette_buffer := PackedFloat32Array()
var transform_buffer: Array[Transform3D] = []


func _init() -> void:
	var model := CrowdModel.new()
	model.setup(ACTOR_COUNT)
	palette_buffer.resize(ACTOR_COUNT * CrowdModel.BONE_COUNT * 16)
	transform_buffer.resize(ACTOR_COUNT)

	var frustum := ConservativeFrustum.new()
	var elapsed := 8.0
	var pose_samples: Array[float] = []
	var cull_samples: Array[float] = []
	var pack_samples: Array[float] = []
	var palette_samples: Array[float] = []
	var total_samples: Array[float] = []
	var reference_samples: Array[float] = []
	var visible_ratios: Array[float] = []
	var prop_ratios: Array[float] = []
	var edge_ratios: Array[float] = []
	var crowd_ratios: Array[float] = []
	var reference_cursor := 0
	var reference_actors := 0
	var reference_vertices := 0
	var reference_false_culls := 0
	var reference_false_positives := 0
	var reference_sweeps := 0

	for frame in WARMUP_FRAMES + SAMPLE_FRAMES:
		elapsed += FIXED_DT
		var eye := Vector3(sin(elapsed * 0.19) * 2.3, 9.65 + cos(elapsed * 0.13) * 0.35, 24.0)
		var target := Vector3(-0.8 + sin(elapsed * 0.19) * 1.03, 2.1, -8.0)
		var camera_transform := Transform3D(Basis.looking_at(target - eye, Vector3.UP), eye)
		frustum.configure(camera_transform, deg_to_rad(40.0), 1600.0 / 900.0, 0.10, 120.0)

		var frame_start := Time.get_ticks_usec()
		model.step(FIXED_DT, elapsed)
		model.cull(frustum)
		var pack_start := Time.get_ticks_usec()
		var visible := model.visible_count()
		var row := 0
		for actor in model.actors:
			if not actor.visible:
				continue
			transform_buffer[row] = actor.world_transform
			row += 1
		var pack_usec := Time.get_ticks_usec() - pack_start

		var palette_start := Time.get_ticks_usec()
		row = 0
		for actor in model.actors:
			if not actor.visible:
				continue
			for bone in CrowdModel.BONE_COUNT:
				_write_matrix((row * CrowdModel.BONE_COUNT + bone) * 16, actor.skin[bone])
			row += 1
		var palette_usec := Time.get_ticks_usec() - palette_start

		var reference_start := Time.get_ticks_usec()
		var batch := model.verify_reference_batch(frustum, reference_cursor, REFERENCE_BATCH, false)
		var reference_usec := Time.get_ticks_usec() - reference_start
		reference_cursor = batch.next_cursor
		reference_actors += batch.actors
		reference_vertices += batch.vertices
		reference_false_culls += batch.false_culls
		reference_false_positives += batch.false_positives
		if reference_cursor == 0:
			reference_sweeps += 1

		if frame >= WARMUP_FRAMES:
			var pose_ms := model.last_pose_and_bounds_usec / 1000.0
			var cull_ms := model.last_cull_usec / 1000.0
			var pack_ms := pack_usec / 1000.0
			var palette_ms := palette_usec / 1000.0
			var total_ms := (Time.get_ticks_usec() - frame_start) / 1000.0 - reference_usec / 1000.0
			pose_samples.append(pose_ms)
			cull_samples.append(cull_ms)
			pack_samples.append(pack_ms)
			palette_samples.append(palette_ms)
			total_samples.append(total_ms)
			reference_samples.append(reference_usec / 1000.0)
			visible_ratios.append(float(visible) / float(ACTOR_COUNT))
			var role_counts := model.role_counts()
			prop_ratios.append(float(role_counts.prop_visible) / float(maxi(role_counts.prop_total, 1)))
			edge_ratios.append(float(role_counts.edge_visible) / float(maxi(role_counts.edge_total, 1)))
			crowd_ratios.append(float(role_counts.crowd_visible) / float(maxi(role_counts.crowd_total, 1)))

	var report := {
		"engine": "Godot " + Engine.get_version_info().string,
		"renderer": "gl_compatibility",
		"actor_count": ACTOR_COUNT,
		"bones_per_actor": CrowdModel.BONE_COUNT,
		"vertices_per_actor": model.total_vertices,
		"sampled_frames": SAMPLE_FRAMES,
		"fixed_dt": FIXED_DT,
		"camera_fov_deg": 40.0,
		"culling": {
			"average_visible_ratio": _mean(visible_ratios),
			"average_culled_ratio": 1.0 - _mean(visible_ratios),
			"min_visible_ratio": _min(visible_ratios),
			"max_visible_ratio": _max(visible_ratios),
			"average_visible_actors": _mean(visible_ratios) * ACTOR_COUNT,
			"average_culled_actors": (1.0 - _mean(visible_ratios)) * ACTOR_COUNT,
			"prop_guard_pass_ratio": _mean(prop_ratios),
			"window_edge_pass_ratio": _mean(edge_ratios),
			"distant_crowd_pass_ratio": _mean(crowd_ratios),
		},
		"animation_parameter_update_ms": {
			"pose_and_animated_bounds_avg": _mean(pose_samples),
			"pose_and_animated_bounds_p95": _percentile(pose_samples, 95.0),
			"frustum_cull_avg": _mean(cull_samples),
			"instance_transform_pack_avg": _mean(pack_samples),
			"bone_palette_pack_avg": _mean(palette_samples),
			"cpu_animation_pipeline_avg": _mean(total_samples),
			"cpu_animation_pipeline_p95": _percentile(total_samples, 95.0),
			"note": "Excludes optional per-vertex reference and GPU texture upload.",
		},
		"vertex_reference": {
			"batch_size": REFERENCE_BATCH,
			"frames_per_full_sweep": int(ceil(float(ACTOR_COUNT) / float(REFERENCE_BATCH))),
			"sweeps": reference_sweeps,
			"actor_checks": reference_actors,
			"vertex_checks_upper_bound": reference_vertices,
			"false_culls": reference_false_culls,
			"conservative_false_positives": reference_false_positives,
			"batch_ms_avg": _mean(reference_samples),
			"batch_ms_p95": _percentile(reference_samples, 95.0),
		},
		"scene": {
			"long_prop_guards": int(ACTOR_COUNT * 0.15),
			"window_edge_walkers": int(ACTOR_COUNT * 0.14),
			"distant_and_mid_crowd": ACTOR_COUNT - int(ACTOR_COUNT * 0.15) - int(ACTOR_COUNT * 0.14),
		},
	}
	var file := FileAccess.open("res://artifacts/benchmark.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report, "\t"))
	file.close()

	print("BENCHMARK actors=", ACTOR_COUNT, " frames=", SAMPLE_FRAMES)
	print("PASS avg=", "%.2f%%" % (_mean(visible_ratios) * 100.0),
		" culled=", "%.2f%%" % ((1.0 - _mean(visible_ratios)) * 100.0),
		" range=", "%.2f%%..%.2f%%" % [_min(visible_ratios) * 100.0, _max(visible_ratios) * 100.0])
	print("CPU pose+bounds avg=", "%.3f ms" % _mean(pose_samples),
		" p95=", "%.3f ms" % _percentile(pose_samples, 95.0),
		" pipeline avg=", "%.3f ms" % _mean(total_samples))
	print("REFERENCE sweeps=", reference_sweeps,
		" actor_checks=", reference_actors,
		" vertex_budget=", reference_vertices,
		" false_culls=", reference_false_culls,
		" false_positives=", reference_false_positives)
	quit()


func _write_matrix(offset: int, transform: Transform3D) -> void:
	var x := transform.basis.x
	var y := transform.basis.y
	var z := transform.basis.z
	var o := transform.origin
	palette_buffer[offset] = x.x
	palette_buffer[offset + 1] = x.y
	palette_buffer[offset + 2] = x.z
	palette_buffer[offset + 4] = y.x
	palette_buffer[offset + 5] = y.y
	palette_buffer[offset + 6] = y.z
	palette_buffer[offset + 8] = z.x
	palette_buffer[offset + 9] = z.y
	palette_buffer[offset + 10] = z.z
	palette_buffer[offset + 12] = o.x
	palette_buffer[offset + 13] = o.y
	palette_buffer[offset + 14] = o.z
	palette_buffer[offset + 15] = 1.0


func _mean(values: Array[float]) -> float:
	if values.is_empty():
		return 0.0
	var total := 0.0
	for value in values:
		total += value
	return total / float(values.size())


func _percentile(values: Array[float], percentile: float) -> float:
	if values.is_empty():
		return 0.0
	var sorted := values.duplicate()
	sorted.sort()
	var index := clampi(int(round((percentile / 100.0) * (sorted.size() - 1))), 0, sorted.size() - 1)
	return sorted[index]


func _min(values: Array[float]) -> float:
	var result := INF
	for value in values:
		result = minf(result, value)
	return result


func _max(values: Array[float]) -> float:
	var result := -INF
	for value in values:
		result = maxf(result, value)
	return result
