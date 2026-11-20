extends SceneTree

const ACTOR_COUNT := 360
const TOTAL_FRAMES := 240


func _init() -> void:
	var model := CrowdModel.new()
	model.setup(ACTOR_COUNT)
	var frustum := ConservativeFrustum.new()
	var cursor := 0
	var actor_checks := 0
	var vertex_checks := 0
	var false_culls := 0
	var false_positives := 0
	var ratio_sum := 0.0
	var elapsed := 8.0

	for frame in TOTAL_FRAMES:
		elapsed += 1.0 / 60.0
		var eye := Vector3(sin(elapsed * 0.19) * 2.3, 9.65 + cos(elapsed * 0.13) * 0.35, 24.0)
		var target := Vector3(-0.8 + sin(elapsed * 0.19) * 1.03, 2.1, -8.0)
		var camera_transform := Transform3D(Basis.looking_at(target - eye, Vector3.UP), eye)
		frustum.configure(camera_transform, deg_to_rad(40.0), 1600.0 / 900.0, 0.10, 120.0)
		model.step(1.0 / 60.0, elapsed)
		model.cull(frustum)
		ratio_sum += float(model.visible_count()) / float(ACTOR_COUNT)
		var result := model.verify_reference_batch(frustum, cursor, 24, false)
		cursor = result.next_cursor
		actor_checks += result.actors
		vertex_checks += result.vertices
		false_culls += result.false_culls
		false_positives += result.false_positives

	var pass_ratio := ratio_sum / float(TOTAL_FRAMES)
	assert(false_culls == 0, "Conservative bounds produced a false cull.")
	print("CULLING_TEST PASS")
	print("  frames=", TOTAL_FRAMES, " avg_pass=", "%.2f%%" % (pass_ratio * 100.0))
	print("  actor_checks=", actor_checks, " vertex_budget=", vertex_checks)
	print("  false_culls=", false_culls, " conservative_false_positives=", false_positives)
	quit()
