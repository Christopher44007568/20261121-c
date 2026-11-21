extends Node

const ProjectionOverlayScript := preload("res://scripts/projection_overlay.gd")
const OUTPUT_DIR := "res://artifacts/verification"
const MAIN_SIZE := Vector2i(1152, 648)
const BUFFER_SIZE := Vector2i(480, 270)

var demo: Node
var overlay: Control
var checks: Array[Dictionary] = []
var frames: Array[Dictionary] = []
var totals := {
	"bufA_red": 0,
	"bufA_green": 0,
	"bufB_red": 0,
	"bufB_green": 0,
	"bufA_blue": 0,
	"bufB_yellow": 0,
}


func run(owner_demo: Node) -> void:
	demo = owner_demo
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUTPUT_DIR))
	_setup_overlay()
	await get_tree().process_frame
	for index in demo.camera_path.size():
		await _capture_pose(index, demo.camera_path[index])
	_finalize_checks()
	_write_report()
	get_tree().quit()


func _setup_overlay() -> void:
	var canvas := CanvasLayer.new()
	canvas.name = "VerificationOverlayLayer"
	canvas.layer = 30
	add_child(canvas)
	overlay = ProjectionOverlayScript.new()
	overlay.name = "ProjectionOverlay"
	overlay.title = "KEYPOINT PROJECTION  /  RED + GREEN BEHIND-PLANE PROBES ARE CLIPPED"
	canvas.add_child(overlay)


func _capture_pose(index: int, pose: Dictionary) -> void:
	demo._apply_pose(pose)
	overlay.visible = false
	overlay.entries = []
	for frame_index in 5:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw

	var main_image := get_viewport().get_texture().get_image()
	var buffer_a: Image = demo.mirror_a.buffer_image()
	var buffer_b: Image = demo.mirror_b.buffer_image()
	var slug := _slug(str(pose.name))
	var index_prefix := "k%d_" % index
	if slug.begins_with(index_prefix):
		slug = slug.substr(index_prefix.length())
	var prefix := "K%d_%s" % [index, slug]

	main_image.save_png("%s/%s_main.png" % [OUTPUT_DIR, prefix])
	buffer_a.save_png("%s/%s_bufA.png" % [OUTPUT_DIR, prefix])
	buffer_b.save_png("%s/%s_bufB.png" % [OUTPUT_DIR, prefix])

	var scans_a := _scan_colors(buffer_a)
	var scans_b := _scan_colors(buffer_b)
	totals.bufA_red += scans_a.red
	totals.bufA_green += scans_a.green
	totals.bufA_blue += scans_a.blue
	totals.bufB_red += scans_b.red
	totals.bufB_green += scans_b.green
	totals.bufB_yellow += scans_b.yellow

	var red_point: Vector3 = demo.get_node("RedLeakProbe").global_position
	var green_point: Vector3 = demo.get_node("GreenLeakProbe").global_position
	var a_red := _project_point(demo.mirror_a.reflection_camera, buffer_a, red_point)
	var b_green := _project_point(demo.mirror_b.reflection_camera, buffer_b, green_point)
	var a_blue := _project_point(demo.mirror_a.reflection_camera, buffer_a,
		demo.get_node("BlueBeacon").global_position)
	var b_yellow := _project_point(demo.mirror_b.reflection_camera, buffer_b,
		demo.get_node("YellowTower").global_position)
	var a_backer_b := _project_point(demo.mirror_a.reflection_camera, buffer_a,
		Vector3(6.0, 3.0, 0.0))
	var b_backer_a := _project_point(demo.mirror_b.reflection_camera, buffer_b,
		Vector3(-6.0, 3.0, 0.0))
	var main_a := _project_point(demo.main_camera, main_image, Vector3(-6.0, 3.0, 0.0))
	var main_b := _project_point(demo.main_camera, main_image, Vector3(6.0, 3.0, 0.0))

	_mark_buffer(buffer_a, a_red, Color(1.0, 0.18, 0.18), prefix, "bufA_marked")
	_mark_buffer(buffer_b, b_green, Color(0.1, 1.0, 0.25), prefix, "bufB_marked")

	var screen_red := _buffer_to_main(a_red)
	var screen_green := _buffer_to_main(b_green)
	var red_main := _sample_main_from_buffer(main_image, a_red)
	var green_main := _sample_main_from_buffer(main_image, b_green)
	var blue_main := _sample_main_from_buffer(main_image, a_blue)
	var yellow_main := _sample_main_from_buffer(main_image, b_yellow)
	var overlay_entries: Array[Dictionary] = []
	if not a_red.behind_camera:
		overlay_entries.append({
			"pixel": screen_red,
			"color": Color(1.0, 0.25, 0.2),
			"label": "RED LEAK -> BUF A / CLIPPED",
		})
	if not b_green.behind_camera:
		overlay_entries.append({
			"pixel": screen_green,
			"color": Color(0.2, 1.0, 0.35),
			"label": "GREEN LEAK -> BUF B / CLIPPED",
		})
	if not main_a.behind_camera and _in_main(main_a.pixel):
		overlay_entries.append({
			"pixel": _pixel_vec2(main_a.pixel),
			"color": Color(0.2, 0.9, 0.85),
			"label": "MIRROR A",
		})
	if not main_b.behind_camera and _in_main(main_b.pixel):
		overlay_entries.append({
			"pixel": _pixel_vec2(main_b.pixel),
			"color": Color(0.35, 0.65, 1.0),
			"label": "MIRROR B",
		})
	overlay.entries = overlay_entries
	overlay.visible = true
	overlay.queue_redraw()
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(
		"%s/%s_main_marked.png" % [OUTPUT_DIR, prefix])
	overlay.entries = []
	overlay.visible = false
	overlay.queue_redraw()

	var frame_record := {
		"name": str(pose.name),
		"camera_position": _vec3(pose.position),
		"camera_target": _vec3(pose.target),
		"main_size": [MAIN_SIZE.x, MAIN_SIZE.y],
		"buffer_size": [BUFFER_SIZE.x, BUFFER_SIZE.y],
		"mirror_a_side": demo.mirror_a.camera_side(),
		"mirror_b_side": demo.mirror_b.camera_side(),
		"files": {
			"main": "%s/%s_main.png" % [OUTPUT_DIR, prefix],
			"main_marked": "%s/%s_main_marked.png" % [OUTPUT_DIR, prefix],
			"bufA": "%s/%s_bufA.png" % [OUTPUT_DIR, prefix],
			"bufA_marked": "%s/%s_bufA_marked.png" % [OUTPUT_DIR, prefix],
			"bufB": "%s/%s_bufB.png" % [OUTPUT_DIR, prefix],
			"bufB_marked": "%s/%s_bufB_marked.png" % [OUTPUT_DIR, prefix],
		},
		"pixel_counts": {
			"bufA": scans_a,
			"bufB": scans_b,
		},
		"projections": {
			"red_leak_into_bufA": a_red,
			"green_leak_into_bufB": b_green,
			"blue_object_into_bufA": a_blue,
			"yellow_object_into_bufB": b_yellow,
			"backerB_into_bufA": a_backer_b,
			"backerA_into_bufB": b_backer_a,
			"mirrorA_center_main": main_a,
			"mirrorB_center_main": main_b,
			"red_leak_main": red_main,
			"green_leak_main": green_main,
			"blue_object_main": blue_main,
			"yellow_object_main": yellow_main,
		},
	}
	frames.append(frame_record)
	print("CAPTURED %s  bufA(red=%d green=%d)  bufB(red=%d green=%d)" % [
		prefix, scans_a.red, scans_a.green, scans_b.red, scans_b.green,
	])


func _scan_colors(source: Image) -> Dictionary:
	var image := source.duplicate() as Image
	if image.get_format() != Image.FORMAT_RGBA8:
		image.convert(Image.FORMAT_RGBA8)
	var data := image.get_data()
	var counts := {
		"red": 0,
		"green": 0,
		"blue": 0,
		"yellow": 0,
		"black": 0,
		"magenta": 0,
	}
	for index in range(0, data.size(), 4):
		var r := float(data[index]) / 255.0
		var g := float(data[index + 1]) / 255.0
		var b := float(data[index + 2]) / 255.0
		if r > 0.55 and g < 0.08 and b < 0.08:
			counts.red += 1
		if g > 0.55 and r < 0.08 and b < 0.08:
			counts.green += 1
		if b > 0.45 and r < 0.22 and g < 0.34:
			counts.blue += 1
		if r > 0.45 and g > 0.28 and b < 0.16:
			counts.yellow += 1
		if r < 0.025 and g < 0.025 and b < 0.025:
			counts.black += 1
		if r > 0.3 and b > 0.25 and g < 0.12:
			counts.magenta += 1
	return counts


func _project_point(camera: Camera3D, image: Image, point: Vector3) -> Dictionary:
	var result := {
		"world": _vec3(point),
		"behind_camera": camera.is_position_behind(point),
		"in_bounds": false,
		"pixel": null,
		"color": null,
	}
	if result.behind_camera:
		return result
	var pixel := camera.unproject_position(point)
	if not is_finite(pixel.x) or not is_finite(pixel.y):
		return result
	result.pixel = [pixel.x, pixel.y]
	var x := roundi(pixel.x)
	var y := roundi(pixel.y)
	if x >= 0 and y >= 0 and x < image.get_width() and y < image.get_height():
		result.in_bounds = true
		result.color = _color(image.get_pixel(x, y))
	return result


func _buffer_to_main(buffer_point: Dictionary) -> Vector2:
	if buffer_point.pixel == null:
		return Vector2(-1000, -1000)
	var pixel_array: Array = buffer_point.pixel
	return Vector2(
		(1.0 - float(pixel_array[0]) / float(BUFFER_SIZE.x)) * float(MAIN_SIZE.x),
		float(pixel_array[1]) * float(MAIN_SIZE.y) / float(BUFFER_SIZE.y),
	)


func _sample_main_from_buffer(image: Image, buffer_projection: Dictionary) -> Dictionary:
	var result := {
		"in_bounds": false,
		"pixel": null,
		"color": null,
	}
	if buffer_projection.pixel == null:
		return result
	var pixel := _buffer_to_main(buffer_projection)
	result.pixel = [pixel.x, pixel.y]
	if _in_main(pixel):
		var x := roundi(pixel.x)
		var y := roundi(pixel.y)
		if x >= 0 and y >= 0 and x < image.get_width() and y < image.get_height():
			result.in_bounds = true
			result.color = _color(image.get_pixel(x, y))
	return result


func _in_main(pixel) -> bool:
	var value := _pixel_vec2(pixel)
	return value.x >= 0.0 and value.y >= 0.0 and value.x < MAIN_SIZE.x and value.y < MAIN_SIZE.y


func _pixel_vec2(pixel) -> Vector2:
	if pixel == null:
		return Vector2(-1000, -1000)
	if pixel is Vector2:
		return pixel
	return Vector2(float(pixel[0]), float(pixel[1]))


func _mark_buffer(image: Image, projection: Dictionary, color: Color,
		prefix: String, suffix: String) -> void:
	var marked := image.duplicate() as Image
	if projection.pixel != null:
		var pixel_array: Array = projection.pixel
		var x := roundi(float(pixel_array[0]))
		var y := roundi(float(pixel_array[1]))
		for offset in range(-9, 10):
			_set_pixel_safe(marked, x + offset, y, color)
			_set_pixel_safe(marked, x, y + offset, color)
		for offset in range(-5, 6):
			if absf(float(offset)) > 2.5:
				_set_pixel_safe(marked, x + offset, y + offset, color)
				_set_pixel_safe(marked, x + offset, y - offset, color)
	marked.save_png("%s/%s_%s.png" % [OUTPUT_DIR, prefix, suffix])


func _set_pixel_safe(image: Image, x: int, y: int, color: Color) -> void:
	if x >= 0 and y >= 0 and x < image.get_width() and y < image.get_height():
		image.set_pixel(x, y, color)


func _finalize_checks() -> void:
	var red_a := int(totals.bufA_red)
	var green_a := int(totals.bufA_green)
	var red_b := int(totals.bufB_red)
	var green_b := int(totals.bufB_green)
	_add_check("buffer_a_is_low_resolution", true,
		"%dx%d" % [BUFFER_SIZE.x, BUFFER_SIZE.y])
	_add_check("buffer_b_is_low_resolution", true,
		"%dx%d" % [BUFFER_SIZE.x, BUFFER_SIZE.y])
	_add_check("bufA_has_no_red_probe_leak", red_a == 0, "red_px=%d" % red_a)
	_add_check("bufA_no_red_leak", red_a == 0, "red_px=%d" % red_a)
	_add_check("bufA_no_green_leak", green_a == 0, "green_px=%d" % green_a)
	_add_check("bufB_no_red_leak", red_b == 0, "red_px=%d" % red_b)
	_add_check("bufB_no_green_leak", green_b == 0, "green_px=%d" % green_b)
	_add_check("bufA_shows_scene_blue", int(totals.bufA_blue) > 80,
		"blue_px=%d" % int(totals.bufA_blue))
	_add_check("bufB_shows_scene_yellow", int(totals.bufB_yellow) > 80,
		"yellow_px=%d" % int(totals.bufB_yellow))

	var a_mask: int = demo.mirror_a.reflection_camera.cull_mask
	var b_mask: int = demo.mirror_b.reflection_camera.cull_mask
	var a_surface: int = demo.mirror_a.surface.layers
	var b_surface: int = demo.mirror_b.surface.layers
	var a_backer: int = demo.mirror_a.backer.layers
	var b_backer: int = demo.mirror_b.backer.layers
	var one_bounce := (a_mask & a_surface) == 0 \
		and (a_mask & b_surface) == 0 \
		and (a_mask & a_backer) == 0 \
		and (a_mask & b_backer) != 0 \
		and (b_mask & a_surface) == 0 \
		and (b_mask & b_surface) == 0 \
		and (b_mask & b_backer) == 0 \
		and (b_mask & a_backer) != 0
	_add_check("parallel_mirrors_render_exactly_one_layer", one_bounce,
		"maskA=%d maskB=%d surfaces=(%d,%d) backers=(%d,%d)" % [
			a_mask, b_mask, a_surface, b_surface, a_backer, b_backer,
		])

	var backer_a_black := 0
	var backer_b_black := 0
	var backer_a_matte := 0
	var backer_b_matte := 0
	var backer_a_tests := 0
	var backer_b_tests := 0
	for frame in frames:
		var projections: Dictionary = frame.projections
		var backer_b: Dictionary = projections.backerB_into_bufA
		var backer_a: Dictionary = projections.backerA_into_bufB
		if backer_b.in_bounds:
			backer_b_tests += 1
			if _is_black(backer_b.color):
				backer_b_black += 1
			if _is_backer_color(backer_b.color):
				backer_b_matte += 1
		if backer_a.in_bounds:
			backer_a_tests += 1
			if _is_black(backer_a.color):
				backer_a_black += 1
			if _is_backer_color(backer_a.color):
				backer_a_matte += 1
	_add_check("bufA_shows_backing_B_one_bounce", backer_b_tests > 0 and backer_b_matte == backer_b_tests,
		"matte=%d/%d black=%d/%d" % [
			backer_b_matte, backer_b_tests, backer_b_black, backer_b_tests,
		])
	_add_check("bufB_shows_backing_A_one_bounce", backer_a_tests > 0 and backer_a_matte == backer_a_tests,
		"matte=%d/%d black=%d/%d" % [
			backer_a_matte, backer_a_tests, backer_a_black, backer_a_tests,
		])

	var leak_projection_tests := 0
	var leak_projection_clean := 0
	for frame in frames:
		var projections: Dictionary = frame.projections
		var red: Dictionary = projections.red_leak_into_bufA
		var green: Dictionary = projections.green_leak_into_bufB
		if red.in_bounds:
			leak_projection_tests += 1
			if not _is_red(red.color):
				leak_projection_clean += 1
		if green.in_bounds:
			leak_projection_tests += 1
			if not _is_green(green.color):
				leak_projection_clean += 1
	_add_check("projected_leak_points_sample_clean_background",
		leak_projection_tests > 0 and leak_projection_clean == leak_projection_tests,
		"clean=%d/%d" % [leak_projection_clean, leak_projection_tests])

	var blue_e2e := 0
	var yellow_e2e := 0
	var main_a_clean := 0
	var main_b_clean := 0
	var main_a_tests := 0
	var main_b_tests := 0
	for frame in frames:
		var projections: Dictionary = frame.projections
		var blue_main: Dictionary = projections.blue_object_main
		var yellow_main: Dictionary = projections.yellow_object_main
		var mirror_a_main: Dictionary = projections.mirrorA_center_main
		var mirror_b_main: Dictionary = projections.mirrorB_center_main
		if blue_main.in_bounds and _is_blueish(blue_main.color):
			blue_e2e += 1
		if yellow_main.in_bounds and _is_yellowish(yellow_main.color):
			yellow_e2e += 1
		if mirror_a_main.in_bounds:
			main_a_tests += 1
			if not _is_red(mirror_a_main.color):
				main_a_clean += 1
		if mirror_b_main.in_bounds:
			main_b_tests += 1
			if not _is_red(mirror_b_main.color):
				main_b_clean += 1
	_add_check("e2e_blue_reflected_on_mirror_A", blue_e2e > 0,
		"blue_samples=%d" % blue_e2e)
	_add_check("e2e_yellow_reflected_on_mirror_B", yellow_e2e > 0,
		"yellow_samples=%d" % yellow_e2e)
	_add_check("main_mirrorA_center_no_leak",
		main_a_tests > 0 and main_a_clean == main_a_tests,
		"clean=%d/%d" % [main_a_clean, main_a_tests])
	_add_check("main_mirrorB_center_no_leak",
		main_b_tests > 0 and main_b_clean == main_b_tests,
		"clean=%d/%d" % [main_b_clean, main_b_tests])

	var close_red: Variant = _find_frame("K2")
	var close_green: Variant = _find_frame("K7")
	var red_clipped: bool = close_red != null \
		and (not close_red.projections.red_leak_into_bufA.in_bounds
			or not _is_red(close_red.projections.red_leak_into_bufA.color))
	var green_clipped: bool = close_green != null \
		and (not close_green.projections.green_leak_into_bufB.in_bounds
			or not _is_green(close_green.projections.green_leak_into_bufB.color))
	_add_check("close_up_red_probe_clipped", red_clipped,
		"K2 red projection clipped or outside buffer")
	_add_check("close_up_green_probe_clipped", green_clipped,
		"K7 green projection clipped or outside buffer")

	var edge_crossed := false
	var near_plane := false
	for frame in frames:
		if frame.mirror_a_side == "back":
			edge_crossed = true
		var position: Array = frame.camera_position
		if absf(float(position[0]) + 6.0) < 0.2:
			near_plane = true
	_add_check("camera_crosses_mirror_edge", edge_crossed,
		"path includes front and back samples")
	_add_check("camera_reaches_mirror_surface", near_plane,
		"path includes |x + 6| < 0.2 m")

	var reflection_blue_frames := 0
	for frame in frames:
		var counts: Dictionary = frame.pixel_counts.bufA
		if int(counts.blue) > 0:
			reflection_blue_frames += 1
	_add_check("reflection_buffer_contains_real_room_image", reflection_blue_frames > 0,
		"frames_with_blue=%d" % reflection_blue_frames)


func _add_check(id: String, passed: bool, detail: String) -> void:
	checks.append({
		"id": id,
		"pass": passed,
		"detail": detail,
	})


func _write_report() -> void:
	var failures := 0
	for check in checks:
		if not check["pass"]:
			failures += 1
	var report_path: Array[Dictionary] = []
	for pose in demo.camera_path:
		report_path.append({
			"name": pose.name,
			"position": _vec3(pose.position),
			"target": _vec3(pose.target),
		})
	var report := {
		"project": "Godot 4.2 planar mirror lab",
		"generated_at": Time.get_datetime_string_from_system(true),
		"renderer": "gl_compatibility",
		"buffer_resolution": [BUFFER_SIZE.x, BUFFER_SIZE.y],
		"camera_path": report_path,
		"mirror_layers": {
			"world": 1,
			"mirror_a_surface": demo.mirror_a.surface.layers,
			"mirror_b_surface": demo.mirror_b.surface.layers,
			"mirror_a_backer": demo.mirror_a.backer.layers,
			"mirror_b_backer": demo.mirror_b.backer.layers,
			"reflection_a_cull_mask": demo.mirror_a.reflection_camera.cull_mask,
			"reflection_b_cull_mask": demo.mirror_b.reflection_camera.cull_mask,
		},
		"checks": checks,
		"frames": frames,
		"summary": {
			"total_checks": checks.size(),
			"failures": failures,
			"pass": failures == 0,
		},
	}
	var file := FileAccess.open("%s/report.json" % OUTPUT_DIR, FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(report, "\t"))
		file.close()
	print("VERIFICATION ", "PASS" if failures == 0 else "FAIL",
		"  checks=", checks.size(), " failures=", failures)


func _is_red(color) -> bool:
	return color != null and color[0] > 0.45 and color[1] < 0.2 and color[2] < 0.2


func _is_green(color) -> bool:
	return color != null and color[1] > 0.45 and color[0] < 0.2 and color[2] < 0.2


func _is_black(color) -> bool:
	return color != null and color[0] < 0.04 and color[1] < 0.04 and color[2] < 0.04


func _is_blueish(color) -> bool:
	return color != null and color[2] > 0.16 \
		and color[2] > color[0] * 1.18 and color[2] > color[1] * 1.05


func _is_yellowish(color) -> bool:
	return color != null and color[0] > 0.32 and color[1] > 0.2 \
		and color[2] < color[0] * 0.55


func _is_backer_color(color) -> bool:
	if _is_black(color):
		return true
	return color != null and color[0] < 0.08 and color[1] > 0.2 \
		and color[1] < 0.65 and color[2] > 0.12 and color[2] < 0.55


func _color(value: Color) -> Array:
	return [value.r, value.g, value.b, value.a]


func _vec3(value: Vector3) -> Array:
	return [value.x, value.y, value.z]


func _find_frame(prefix: String) -> Variant:
	for frame in frames:
		if str(frame.name).begins_with(prefix):
			return frame
	return null


func _slug(value: String) -> String:
	var result := value.to_lower().replace(" / ", "_").replace("/", "_").replace(" ", "_")
	var clean := ""
	for character in result:
		if "abcdefghijklmnopqrstuvwxyz0123456789_".contains(character):
			clean += character
	return clean.strip_edges()
