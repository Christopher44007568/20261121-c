extends Node3D

const MODEL_COUNT := 360
const CAMERA_FOV := 40.0
const REFERENCE_BATCH := 20

var model: CrowdModel
var camera: Camera3D
var crowd_node: MultiMeshInstance3D
var crowd_mesh: MultiMesh
var crowd_material: ShaderMaterial
var palette_image: Image
var palette_texture: ImageTexture
var palette_floats := PackedFloat32Array()
var palette_max_rows := 0
var debug_mesh: ImmediateMesh
var debug_node: MeshInstance3D
var hud: CrowdHud
var frustum := ConservativeFrustum.new()

var elapsed := 8.0
var paused := false
var bounds_enabled := true
var reference_enabled := true
var sweep_enabled := true

var visible_actors := 0
var pose_usec := 0.0
var cull_usec := 0.0
var pack_usec := 0.0
var palette_usec := 0.0
var upload_usec := 0.0
var reference_cursor := 0
var reference_accum := {}
var reference_last := {
	"actors": 0,
	"vertices": 0,
	"false_culls": 0,
	"false_positives": 0,
	"sweeps": 0,
	"time_ms": 0.0,
}
var reference_total_false_culls := 0
var reference_total_false_positives := 0
var reference_last_sweep_ms := 0.0
var capture_path := ""
var capture_countdown := -1
var frame_index := 0


func _ready() -> void:
	model = CrowdModel.new()
	model.setup(MODEL_COUNT)
	_build_environment()
	_build_camera()
	_build_ground()
	_build_backdrop()
	_build_window()
	_build_crowd()
	_build_debug_layer()
	_build_hud()
	process_priority = 10
	capture_path = OS.get_environment("CROWD_CAPTURE")
	if not capture_path.is_empty():
		capture_countdown = 36
	_update_frame(0.0)


func _process(delta: float) -> void:
	_update_frame(delta if not paused else 0.0)
	frame_index += 1
	if capture_countdown > 0:
		capture_countdown -= 1
		if capture_countdown == 0:
			_save_capture(capture_path)


func _update_frame(delta: float) -> void:
	if not paused:
		elapsed += delta
	_update_camera()
	var viewport_size := get_viewport().get_visible_rect().size
	var aspect := viewport_size.x / maxf(viewport_size.y, 1.0)
	frustum.configure(
		camera.global_transform,
		deg_to_rad(CAMERA_FOV),
		aspect,
		camera.near,
		camera.far
	)

	model.step(delta, elapsed)
	model.cull(frustum)
	visible_actors = model.visible_count()
	pose_usec = lerpf(pose_usec, model.last_pose_and_bounds_usec, 0.14)
	cull_usec = lerpf(cull_usec, model.last_cull_usec, 0.14)
	_pack_gpu_instances()
	_update_reference()
	_update_debug()
	_update_hud()


func _update_camera() -> void:
	var motion := Vector2.ZERO
	if sweep_enabled and not paused:
		motion = Vector2(sin(elapsed * 0.19) * 2.3, cos(elapsed * 0.13) * 0.35)
	var eye := Vector3(motion.x, 9.65 + motion.y, 24.0)
	var target := Vector3(-0.8 + motion.x * 0.45, 2.1, -8.0)
	camera.global_transform = Transform3D(Basis.looking_at(target - eye, Vector3.UP), eye)
	camera.fov = CAMERA_FOV


func _build_environment() -> void:
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.010, 0.016, 0.030)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.16, 0.26, 0.36)
	environment.ambient_light_energy = 0.65
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.tonemap_exposure = 1.12
	var world_env := WorldEnvironment.new()
	world_env.environment = environment
	add_child(world_env)


func _build_camera() -> void:
	camera = Camera3D.new()
	camera.near = 0.10
	camera.far = 120.0
	camera.fov = CAMERA_FOV
	camera.current = true
	add_child(camera)


func _build_ground() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(150.0, 150.0)
	plane.subdivide_width = 8
	plane.subdivide_depth = 8
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/ground.gdshader")
	plane.material = material
	var node := MeshInstance3D.new()
	node.name = "Ground"
	node.mesh = plane
	node.position = Vector3(0.0, -0.03, -15.0)
	add_child(node)


func _build_backdrop() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2(190.0, 48.0)
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/backdrop.gdshader")
	quad.material = material
	var backdrop := MeshInstance3D.new()
	backdrop.name = "Backdrop"
	backdrop.mesh = quad
	backdrop.position = Vector3(0.0, 15.0, -62.0)
	add_child(backdrop)

	var silhouette := StandardMaterial3D.new()
	silhouette.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	silhouette.albedo_color = Color(0.010, 0.019, 0.032)
	var windows := StandardMaterial3D.new()
	windows.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	windows.albedo_color = Color(0.08, 0.32, 0.38)
	windows.emission_enabled = true
	windows.emission = Color(0.04, 0.24, 0.28)
	windows.emission_energy_multiplier = 1.3
	var rng := RandomNumberGenerator.new()
	rng.seed = 91
	for i in 26:
		var width := rng.randf_range(2.5, 7.5)
		var height := rng.randf_range(3.0, 17.0)
		var x := -62.0 + i * 5.0 + rng.randf_range(-1.5, 1.5)
		_add_box(Vector3(x, height * 0.5, -52.0), Vector3(width, height, 2.0), silhouette, "Tower")
		for row in int(height / 2.2):
			if rng.randf() < 0.55:
				var y := 1.0 + row * 2.2
				_add_box(Vector3(x, y, -50.92), Vector3(width * 0.22, 0.12, 0.04), windows, "Window")


func _build_window() -> void:
	var frame := StandardMaterial3D.new()
	frame.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	frame.albedo_color = Color(0.012, 0.018, 0.025)
	var inlay := StandardMaterial3D.new()
	inlay.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	inlay.albedo_color = Color(0.83, 0.49, 0.18)
	inlay.emission_enabled = true
	inlay.emission = Color(0.80, 0.33, 0.08)
	inlay.emission_energy_multiplier = 1.8

	_add_box(Vector3(-9.45, 5.55, 11.7), Vector3(0.38, 9.15, 0.65), frame, "WindowLeft")
	_add_box(Vector3(9.10, 5.55, 11.7), Vector3(0.38, 9.15, 0.65), frame, "WindowRight")
	_add_box(Vector3(-0.18, 10.02, 11.7), Vector3(18.95, 0.36, 0.65), frame, "WindowTop")
	_add_box(Vector3(-0.18, 1.48, 11.7), Vector3(18.95, 0.24, 0.75), frame, "WindowSill")
	_add_box(Vector3(-7.45, 5.55, 11.53), Vector3(0.12, 8.65, 0.22), frame, "WindowMullion")
	_add_box(Vector3(5.90, 5.55, 11.53), Vector3(0.09, 8.65, 0.18), frame, "WindowMullionThin")
	_add_box(Vector3(-9.22, 5.55, 11.48), Vector3(0.05, 8.65, 0.06), inlay, "WindowEdgeLight")
	_add_box(Vector3(8.87, 5.55, 11.48), Vector3(0.05, 8.65, 0.06), inlay, "WindowEdgeLight")
	_add_box(Vector3(-0.18, 9.79, 11.48), Vector3(18.35, 0.05, 0.06), inlay, "WindowEdgeLight")


func _add_box(position: Vector3, size: Vector3, material: Material, node_name: String) -> MeshInstance3D:
	var box := BoxMesh.new()
	box.size = size
	var node := MeshInstance3D.new()
	node.name = node_name
	node.mesh = box
	node.position = position
	node.material_override = material
	add_child(node)
	return node


func _build_crowd() -> void:
	crowd_material = ShaderMaterial.new()
	crowd_material.shader = load("res://shaders/crowd.gdshader")
	crowd_material.set_shader_parameter("fog_color", Color(0.026, 0.070, 0.105))
	var mesh := model.mesh_builder.build_mesh(crowd_material)
	crowd_mesh = MultiMesh.new()
	crowd_mesh.transform_format = MultiMesh.TRANSFORM_3D
	crowd_mesh.use_custom_data = true
	crowd_mesh.mesh = mesh
	crowd_mesh.instance_count = model.actors.size()
	crowd_mesh.visible_instance_count = 0
	crowd_mesh.custom_aabb = AABB(Vector3(-90.0, -10.0, -90.0), Vector3(180.0, 40.0, 180.0))
	crowd_node = MultiMeshInstance3D.new()
	crowd_node.name = "GpuSkinnedCrowd"
	crowd_node.multimesh = crowd_mesh
	crowd_node.extra_cull_margin = 10000.0
	crowd_node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(crowd_node)

	palette_max_rows = model.actors.size() * CrowdModel.BONE_COUNT
	palette_floats.resize(4 * palette_max_rows * 4)
	var data := palette_floats.to_byte_array()
	palette_image = Image.create_from_data(4, palette_max_rows, false, Image.FORMAT_RGBAF, data)
	palette_texture = ImageTexture.create_from_image(palette_image)
	crowd_material.set_shader_parameter("bone_texture", palette_texture)
	crowd_material.set_shader_parameter("palette_size", Vector2(4.0, float(palette_max_rows)))


func _build_debug_layer() -> void:
	debug_mesh = ImmediateMesh.new()
	debug_node = MeshInstance3D.new()
	debug_node.name = "AnimatedConservativeBounds"
	debug_node.mesh = debug_mesh
	debug_node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.albedo_color = Color(1.0, 1.0, 1.0, 0.92)
	material.no_depth_test = false
	debug_node.material_override = material
	add_child(debug_node)


func _build_hud() -> void:
	hud = CrowdHud.new()
	add_child(hud)


func _pack_gpu_instances() -> void:
	var pack_start := Time.get_ticks_usec()
	var row := 0
	for actor in model.actors:
		if not actor.visible:
			continue
		crowd_mesh.set_instance_transform(row, actor.world_transform)
		crowd_mesh.set_instance_custom_data(
			row,
			Color(
				float(row * CrowdModel.BONE_COUNT),
				float(actor.role),
				actor.cosmetics,
				1.0
			)
		)
		for bone in CrowdModel.BONE_COUNT:
			var offset := (row * CrowdModel.BONE_COUNT + bone) * 16
			_write_skin_matrix(offset, actor.skin[bone])
		row += 1
	crowd_mesh.visible_instance_count = row
	pack_usec = lerpf(pack_usec, Time.get_ticks_usec() - pack_start, 0.14)

	var palette_start := Time.get_ticks_usec()
	var bytes := palette_floats.to_byte_array()
	palette_image.set_data(4, palette_max_rows, false, Image.FORMAT_RGBAF, bytes)
	palette_usec = lerpf(palette_usec, Time.get_ticks_usec() - palette_start, 0.14)

	var upload_start := Time.get_ticks_usec()
	palette_texture.update(palette_image)
	upload_usec = lerpf(upload_usec, Time.get_ticks_usec() - upload_start, 0.14)


func _write_skin_matrix(offset: int, transform: Transform3D) -> void:
	var x := transform.basis.x
	var y := transform.basis.y
	var z := transform.basis.z
	var o := transform.origin
	palette_floats[offset] = x.x
	palette_floats[offset + 1] = x.y
	palette_floats[offset + 2] = x.z
	palette_floats[offset + 3] = 0.0
	palette_floats[offset + 4] = y.x
	palette_floats[offset + 5] = y.y
	palette_floats[offset + 6] = y.z
	palette_floats[offset + 7] = 0.0
	palette_floats[offset + 8] = z.x
	palette_floats[offset + 9] = z.y
	palette_floats[offset + 10] = z.z
	palette_floats[offset + 11] = 0.0
	palette_floats[offset + 12] = o.x
	palette_floats[offset + 13] = o.y
	palette_floats[offset + 14] = o.z
	palette_floats[offset + 15] = 1.0


func _update_reference() -> void:
	if not reference_enabled:
		return
	if reference_accum.is_empty():
		reference_accum = {
			"actors": 0,
			"vertices": 0,
			"false_culls": 0,
			"false_positives": 0,
		}
		if reference_last.sweeps == 0:
			reference_accum.sweeps = 0
	var start := Time.get_ticks_usec()
	var batch := model.verify_reference_batch(
		frustum,
		reference_cursor,
		REFERENCE_BATCH,
		false
	)
	reference_cursor = batch.next_cursor
	reference_accum.actors += batch.actors
	reference_accum.vertices += batch.vertices
	reference_accum.false_culls += batch.false_culls
	reference_accum.false_positives += batch.false_positives
	reference_total_false_culls += batch.false_culls
	reference_total_false_positives += batch.false_positives
	var batch_ms := (Time.get_ticks_usec() - start) / 1000.0
	reference_last_sweep_ms = lerpf(reference_last_sweep_ms, batch_ms, 0.08)
	if reference_cursor == 0:
		reference_last = {
			"actors": reference_accum.actors,
			"vertices": reference_accum.vertices,
			"false_culls": reference_accum.false_culls,
			"false_positives": reference_accum.false_positives,
			"sweeps": reference_last.sweeps + 1,
			"time_ms": reference_last_sweep_ms,
		}
		reference_accum = {}


func _update_debug() -> void:
	debug_node.visible = bounds_enabled
	if not bounds_enabled:
		return
	debug_mesh.clear_surfaces()
	debug_mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	for actor in model.actors:
		var focus := false
		if actor.role == CrowdModel.ROLE_PROP:
			focus = actor.id % 6 == 0
		elif actor.role == CrowdModel.ROLE_EDGE:
			focus = actor.id % 4 == 0
		else:
			focus = actor.id % 53 == 0
		if not focus:
			continue
		var box_color := Color(0.30, 0.95, 0.82, 0.52)
		if actor.role == CrowdModel.ROLE_PROP:
			box_color = Color(1.0, 0.56, 0.18, 0.62)
		elif actor.role == CrowdModel.ROLE_EDGE:
			box_color = Color(0.22, 0.88, 0.96, 0.62)
		if not actor.visible:
			box_color = Color(1.0, 0.22, 0.16, 0.75)
		_draw_aabb(actor.bounds, box_color)
		if actor.id % 53 == 0:
			_draw_skeleton(actor)
	debug_mesh.surface_end()


func _draw_aabb(box: AABB, color: Color) -> void:
	var p := box.position
	var s := box.size
	var corners := [
		p,
		p + Vector3(s.x, 0.0, 0.0),
		p + Vector3(s.x, 0.0, s.z),
		p + Vector3(0.0, 0.0, s.z),
		p + Vector3(0.0, s.y, 0.0),
		p + Vector3(s.x, s.y, 0.0),
		p + Vector3(s.x, s.y, s.z),
		p + Vector3(0.0, s.y, s.z),
	]
	for pair in [
		[0, 1], [1, 2], [2, 3], [3, 0],
		[4, 5], [5, 6], [6, 7], [7, 4],
		[0, 4], [1, 5], [2, 6], [3, 7],
	]:
		_draw_line(corners[pair[0]], corners[pair[1]], color)


func _draw_skeleton(actor: CrowdModel.Actor) -> void:
	for bone in CrowdModel.BONE_COUNT:
		var parent: int = CrowdModel.BONE_PARENT[bone]
		if parent < 0 or (bone == 11 and not actor.has_prop):
			continue
		var a := actor.world_transform * actor.skin[bone].origin
		var b := actor.world_transform * actor.skin[parent].origin
		_draw_line(a, b, Color(0.95, 0.82, 0.34, 0.90))


func _draw_line(a: Vector3, b: Vector3, color: Color) -> void:
	debug_mesh.surface_set_color(color)
	debug_mesh.surface_add_vertex(a)
	debug_mesh.surface_set_color(color)
	debug_mesh.surface_add_vertex(b)


func _update_hud() -> void:
	var roles := model.role_counts()
	hud.update_metrics({
		"visible": visible_actors,
		"total": model.actors.size(),
		"roles": roles,
		"pose_ms": pose_usec / 1000.0,
		"cull_ms": cull_usec / 1000.0,
		"pack_ms": pack_usec / 1000.0,
		"palette_ms": palette_usec / 1000.0,
		"upload_ms": upload_usec / 1000.0,
		"vertices": model.total_vertices,
		"gpu_vertices": visible_actors * model.total_vertices,
		"reference": reference_last,
		"reference_batch_ms": reference_last_sweep_ms,
		"reference_total_false_culls": reference_total_false_culls,
		"reference_total_false_positives": reference_total_false_positives,
		"bounds": bounds_enabled,
		"paused": paused,
		"sweep": sweep_enabled,
		"elapsed": elapsed,
	})


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.pressed or event.echo:
		return
	match event.keycode:
		KEY_SPACE:
			paused = not paused
			_update_frame(0.0)
		KEY_B:
			bounds_enabled = not bounds_enabled
		KEY_R:
			reference_enabled = not reference_enabled
		KEY_C:
			sweep_enabled = not sweep_enabled
		KEY_F12:
			_save_screenshot()


func _save_screenshot() -> void:
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	var path := ProjectSettings.globalize_path("res://artifacts/crowd-demo.png")
	image.save_png(path)
	print("screenshot saved: ", path)


func _save_capture(path: String) -> void:
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	image.save_png(path)
	print(
		"capture saved: ", path,
		"  visible=", visible_actors,
		" pass=", "%.2f%%" % (100.0 * float(visible_actors) / float(model.actors.size())),
		"  pose_ms=", "%.3f" % (pose_usec / 1000.0),
		"  palette_ms=", "%.3f" % ((palette_usec + upload_usec) / 1000.0),
		"  false_culls=", reference_total_false_culls
	)
	get_tree().quit()
