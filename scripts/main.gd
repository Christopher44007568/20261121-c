extends Node3D

const NormalPrefilterScript := preload("res://scripts/normal_prefilter.gd")
const PANEL_COUNT := 3
const PANEL_WIDTH := 426
const VIEW_HEIGHT := 500
const VIEW_TOP := 62
const PANEL_GAP := 1
const CAPTURE_FPS := 30
const CAPTURE_FRAMES := 420
const SEQUENCE_SECONDS := 14.0

const PANEL_CODES := ["A", "B", "C"]
const PANEL_TITLES := [
	"RAW NORMAL",
	"PREFILTERED",
	"MIP-STEP ROUGHNESS",
]
const PANEL_SUBTITLES := [
	"LOD 0 only  /  fixed roughness",
	"filtered normal  /  mip + local variance",
	"filtered normal  /  7 static steps",
]

var prefilter
var mip_summary: Dictionary
var panels: Array[Dictionary] = []
var hud: Control
var frame_index := 0
var capture_mode := false
var capture_start := 0.0
var playback_time := 0.0
var exposure_gains := {"A": 1.0, "B": 1.0, "C": 1.0}


func _ready() -> void:
	capture_mode = "--capture" in OS.get_cmdline_user_args()
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--start-at="):
			capture_start = maxf(0.0, argument.trim_prefix("--start-at=").to_float())
	prefilter = NormalPrefilterScript.new()
	prefilter.build()
	mip_summary = prefilter.summary()
	_load_calibration()
	_write_generated_data()
	if DisplayServer.get_name().to_lower() == "headless":
		print("[normal_prefilter] headless validation complete; 3D viewports skipped")
		set_process(false)
		return
	_build_ui()
	_sync_frame(0.0)
	print("[normal_prefilter] capture=%s, frames=%d, fps=%d" % [
		capture_mode, CAPTURE_FRAMES, CAPTURE_FPS
	])


func _process(delta: float) -> void:
	if capture_mode:
		frame_index += 1
		_sync_frame(capture_start + float(frame_index) / float(CAPTURE_FPS))
		if frame_index >= CAPTURE_FRAMES:
			get_tree().quit()
	else:
		playback_time = fmod(playback_time + delta, SEQUENCE_SECONDS)
		_sync_frame(playback_time)


func _write_generated_data() -> void:
	var generated_dir := ProjectSettings.globalize_path("res://artifacts/generated")
	prefilter.save_debug_images(generated_dir)
	DirAccess.make_dir_recursive_absolute(generated_dir)
	_write_json(generated_dir.path_join("mip_stats.json"), mip_summary)
	_write_json(
		generated_dir.path_join("run_metadata.json"),
		{
			"renderer": "Godot 4.2.2 / GL Compatibility",
			"capture_fps": CAPTURE_FPS,
			"capture_frames": CAPTURE_FRAMES,
			"duration_s": SEQUENCE_SECONDS,
			"resolution": "1280x720",
			"panel_size": "%dx%d" % [PANEL_WIDTH, VIEW_HEIGHT],
			"exposure": {
				"auto_exposure": false,
				"mode": "one fixed sequence-wide gain per panel",
				"gains": exposure_gains,
			},
			"camera_motion": {
				"description": "near low dolly to elevated wide dolly",
				"start": [0.0, 0.72, 1.8, -17.8],
				"end": [0.0, 7.2, 11.5, -28.6],
			},
		}
	)


func _load_calibration() -> void:
	var path := "res://calibration.json"
	if FileAccess.file_exists(path):
		var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
		if parsed is Dictionary:
			for code in PANEL_CODES:
				exposure_gains[code] = float(parsed.get(code, 1.0))
	else:
		_write_json(path, exposure_gains)


func _build_ui() -> void:
	var canvas := CanvasLayer.new()
	canvas.name = "Presentation"
	add_child(canvas)

	for panel_index in range(PANEL_COUNT):
		var panel := _build_panel_world(panel_index)
		panels.append(panel)
		var viewport: SubViewport = panel["viewport"]
		var texture_rect := TextureRect.new()
		texture_rect.name = "Panel%sView" % PANEL_CODES[panel_index]
		texture_rect.texture = viewport.get_texture()
		texture_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		texture_rect.stretch_mode = TextureRect.STRETCH_SCALE
		texture_rect.position = Vector2(
			panel_index * (PANEL_WIDTH + PANEL_GAP),
			VIEW_TOP
		)
		texture_rect.size = Vector2(PANEL_WIDTH, VIEW_HEIGHT)
		texture_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		canvas.add_child(texture_rect)

	hud = preload("res://scripts/hud.gd").new()
	hud.name = "LabHUD"
	hud.position = Vector2.ZERO
	hud.size = Vector2(1280, 720)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.add_child(hud)
	hud.configure(mip_summary, exposure_gains)
	if hud.has_method("configure_title"):
		hud.configure_title(PANEL_CODES, PANEL_TITLES, PANEL_SUBTITLES)


func _build_panel_world(panel_index: int) -> Dictionary:
	var viewport := SubViewport.new()
	viewport.name = "Panel%sWorld" % PANEL_CODES[panel_index]
	viewport.size = Vector2i(PANEL_WIDTH, VIEW_HEIGHT)
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.own_world_3d = true
	viewport.msaa_3d = Viewport.MSAA_DISABLED
	viewport.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	viewport.gui_disable_input = true
	add_child(viewport)

	var root := Node3D.new()
	root.name = "World"
	viewport.add_child(root)
	_add_environment(root)
	_add_lighting(root)

	var material := _make_material(panel_index)
	var metal := MeshInstance3D.new()
	metal.name = "MicroMetal"
	var plane := PlaneMesh.new()
	plane.size = Vector2(14.0, 140.0)
	metal.mesh = plane
	metal.material_override = material
	metal.position = Vector3(0.0, 0.0, -55.0)
	root.add_child(metal)

	var underlay := MeshInstance3D.new()
	underlay.name = "Underlay"
	var underlay_plane := PlaneMesh.new()
	underlay_plane.size = Vector2(20.0, 160.0)
	underlay.mesh = underlay_plane
	var underlay_material := StandardMaterial3D.new()
	underlay_material.albedo_color = Color(0.012, 0.016, 0.022)
	underlay_material.roughness = 0.92
	underlay_material.metallic = 0.0
	underlay.material_override = underlay_material
	underlay.position = Vector3(0.0, -0.025, -55.0)
	root.add_child(underlay)

	var camera := Camera3D.new()
	camera.name = "Camera"
	camera.fov = 58.0
	camera.near = 0.04
	camera.far = 150.0
	camera.current = true
	root.add_child(camera)

	return {
		"viewport": viewport,
		"camera": camera,
		"material": material,
	}


func _make_material(panel_index: int) -> ShaderMaterial:
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/metal_prefilter.gdshader")
	for level in range(prefilter.mip_textures.size()):
		material.set_shader_parameter("normal_mip%d" % level, prefilter.mip_textures[level])
	material.set_shader_parameter("texture_tiles", Vector2(16.0, 220.0))
	material.set_shader_parameter("texture_size", float(prefilter.base_normal.get_width()))
	material.set_shader_parameter("max_lod", float(prefilter.mip_images.size() - 1))
	material.set_shader_parameter("filter_mode", panel_index)
	material.set_shader_parameter("base_roughness", NormalPrefilterScript.ROUGHNESS_BASE)
	material.set_shader_parameter("mip_gain", NormalPrefilterScript.ROUGHNESS_MIP_GAIN)
	material.set_shader_parameter("variance_gain", NormalPrefilterScript.ROUGHNESS_VARIANCE_GAIN)
	material.set_shader_parameter("roughness_max", NormalPrefilterScript.ROUGHNESS_MAX)
	material.set_shader_parameter(
		"variance_encode_scale",
		NormalPrefilterScript.VARIANCE_ENCODE_SCALE
	)
	material.set_shader_parameter("step_count", float(NormalPrefilterScript.STEP_COUNT))
	material.set_shader_parameter(
		"exposure_gain",
		float(exposure_gains[PANEL_CODES[panel_index]])
	)
	material.set_shader_parameter("normal_strength", 1.0)
	return material


func _add_environment(root: Node3D) -> void:
	var environment := Environment.new()
	environment.background_mode = Environment.BG_SKY
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_energy = 0.62
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	environment.tonemap_mode = Environment.TONE_MAPPER_ACES
	environment.tonemap_exposure = 1.0
	environment.tonemap_white = 5.0

	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color(0.035, 0.060, 0.105)
	sky_material.sky_horizon_color = Color(0.34, 0.43, 0.54)
	sky_material.sky_curve = 0.16
	sky_material.ground_bottom_color = Color(0.008, 0.012, 0.018)
	sky_material.ground_horizon_color = Color(0.15, 0.19, 0.24)
	sky_material.ground_curve = 0.08
	sky_material.sun_angle_max = 18.0
	sky_material.sun_curve = 0.12

	var sky := Sky.new()
	sky.sky_material = sky_material
	environment.sky = sky

	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	root.add_child(world_environment)


func _add_lighting(root: Node3D) -> void:
	var key := DirectionalLight3D.new()
	key.name = "Key"
	key.rotation_degrees = Vector3(-57.0, -34.0, -4.0)
	key.light_color = Color(1.0, 0.87, 0.72)
	key.light_energy = 2.45
	key.shadow_enabled = false
	root.add_child(key)

	var fill := DirectionalLight3D.new()
	fill.name = "Fill"
	fill.rotation_degrees = Vector3(-25.0, 142.0, 2.0)
	fill.light_color = Color(0.48, 0.66, 1.0)
	fill.light_energy = 0.72
	fill.shadow_enabled = false
	root.add_child(fill)

	var warm_glint := OmniLight3D.new()
	warm_glint.name = "WarmGlint"
	warm_glint.position = Vector3(2.4, 1.25, 2.7)
	warm_glint.light_color = Color(1.0, 0.67, 0.35)
	warm_glint.light_energy = 4.8
	warm_glint.omni_range = 5.6
	warm_glint.shadow_enabled = false
	root.add_child(warm_glint)

	var cool_glint := OmniLight3D.new()
	cool_glint.name = "CoolGlint"
	cool_glint.position = Vector3(-2.7, 0.9, -3.2)
	cool_glint.light_color = Color(0.21, 0.58, 1.0)
	cool_glint.light_energy = 3.4
	cool_glint.omni_range = 8.0
	cool_glint.shadow_enabled = false
	root.add_child(cool_glint)


func _sync_frame(time_seconds: float) -> void:
	var t := clampf(time_seconds, 0.0, SEQUENCE_SECONDS)
	var normalized := smoothstep(0.0, 1.0, t / SEQUENCE_SECONDS)
	var camera_y := lerpf(0.72, 7.2, normalized)
	var camera_z := lerpf(1.8, 11.5, normalized)
	var camera_pitch := lerpf(-0.31, -0.50, normalized)
	var camera_yaw := deg_to_rad(sin(t * 0.43) * 0.55)
	var camera_roll := deg_to_rad(sin(t * 0.31) * 0.22)

	for panel in panels:
		var camera: Camera3D = panel["camera"]
		camera.position = Vector3(
			sin(t * 0.61) * 0.055,
			camera_y,
			camera_z
		)
		camera.rotation = Vector3(camera_pitch, camera_yaw, camera_roll)

	var lod := _estimate_lod(camera_y, camera_pitch)
	var variance := _variance_at_lod(lod)
	var continuous: float = prefilter.roughness_for(floori(lod), variance)
	var stepped: float = prefilter.stepped_roughness_for(floori(lod), variance)
	if hud != null and hud.has_method("update_state"):
		hud.update_state(t, lod, continuous, stepped)


func _estimate_lod(camera_y: float, pitch: float) -> float:
	var distance := camera_y / maxf(0.05, -sin(pitch))
	var vfov := deg_to_rad(58.0)
	var aspect := float(PANEL_WIDTH) / float(VIEW_HEIGHT)
	var hfov := 2.0 * atan(tan(vfov * 0.5) * aspect)
	var vertical_world_per_pixel := 2.0 * distance * tan(vfov * 0.5) / float(VIEW_HEIGHT)
	var horizontal_world_per_pixel := 2.0 * distance * tan(hfov * 0.5) / float(PANEL_WIDTH)
	var vertical_texels_per_world := 512.0 * 220.0 / 140.0
	var horizontal_texels_per_world := 512.0 * 16.0 / 14.0
	var footprint := maxf(
		vertical_world_per_pixel * vertical_texels_per_world,
		horizontal_world_per_pixel * horizontal_texels_per_world
	)
	return clampf(log(footprint) / log(2.0), 0.0, 8.0)


func _variance_at_lod(lod: float) -> float:
	var table: Array = mip_summary["table"]
	var lod0 := clampi(floori(lod), 0, table.size() - 1)
	var lod1 := mini(lod0 + 1, table.size() - 1)
	var blend := lod - float(lod0)
	return lerpf(
		float(table[lod0]["mean_normal_variance"]),
		float(table[lod1]["mean_normal_variance"]),
		blend
	)


func _write_json(path: String, data: Dictionary) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Could not write %s" % path)
		return
	file.store_string(JSON.stringify(data, "\t"))
