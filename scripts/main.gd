extends Node3D

const PlanarMirrorScript := preload("res://scripts/planar_mirror.gd")
const HudScript := preload("res://scripts/hud.gd")
const VerificationRunner := preload("res://scripts/verification_runner.gd")

@onready var main_camera: Camera3D = $MainCamera

var mirror_a: Node
var mirror_b: Node
var hud: Control
var tour_active := false
var tour_index := 0
var tour_elapsed := 0.0
var tour_segment_time := 3.2
var current_pose_name := "K0 / room center"
var _verification_running := false

var camera_path: Array[Dictionary] = [
	{"name": "K0 / room center", "position": Vector3(0.0, 2.35, 7.2), "target": Vector3(-6.0, 2.8, 0.0)},
	{"name": "K1 / approach A", "position": Vector3(-3.4, 2.15, 4.0), "target": Vector3(-6.0, 2.8, 0.0)},
	{"name": "K2 / close to A", "position": Vector3(-5.86, 2.2, 1.25), "target": Vector3(-6.0, 2.7, 0.0)},
	{"name": "K3 / mirror A edge", "position": Vector3(-5.86, 2.2, 6.9), "target": Vector3(-6.0, 2.6, 0.0)},
	{"name": "K4 / cross A edge", "position": Vector3(-6.45, 2.2, 7.15), "target": Vector3(-2.0, 2.3, 4.0)},
	{"name": "K5 / behind A probe", "position": Vector3(-7.2, 2.1, 3.0), "target": Vector3(-7.35, 1.22, 0.0)},
	{"name": "K6 / room toward B", "position": Vector3(0.0, 2.35, -7.2), "target": Vector3(6.0, 2.8, 0.0)},
	{"name": "K7 / close to B", "position": Vector3(5.86, 2.2, -1.25), "target": Vector3(6.0, 2.7, 0.0)},
	{"name": "K8 / across room", "position": Vector3(2.6, 2.2, -4.2), "target": Vector3(-6.0, 2.8, 0.0)},
	{"name": "K9 / center axis A", "position": Vector3(0.0, 2.35, 0.0), "target": Vector3(-6.0, 2.7, 0.0)},
]


func _ready() -> void:
	_build_environment()
	_build_room()
	_build_scene_objects()
	_build_leak_probes()
	_build_mirrors()
	_build_hud()
	main_camera.cull_mask = 1 | 2 | 4
	if "--verify" in OS.get_cmdline_user_args():
		_start_verification()
	else:
		_apply_pose(camera_path[0])


func _process(delta: float) -> void:
	if not tour_active or _verification_running:
		return
	tour_elapsed += delta
	var t := tour_elapsed / tour_segment_time
	if t >= 1.0:
		tour_index = (tour_index + 1) % camera_path.size()
		tour_elapsed = 0.0
		t = 0.0
	var from: Dictionary = camera_path[tour_index]
	var to: Dictionary = camera_path[(tour_index + 1) % camera_path.size()]
	var eased := t * t * (3.0 - 2.0 * t)
	var position: Vector3 = (from.position as Vector3).lerp(to.position as Vector3, eased)
	var target: Vector3 = (from.target as Vector3).lerp(to.target as Vector3, eased)
	main_camera.set_pose(position, target)
	current_pose_name = "%s -> %s" % [from.name, to.name]


func _unhandled_input(event: InputEvent) -> void:
	if _verification_running:
		return
	if event.is_action_pressed("toggle_run"):
		tour_active = not tour_active
		main_camera.input_enabled = not tour_active
		tour_elapsed = 0.0
		if tour_active:
			tour_index = 0
			_apply_pose(camera_path[0])
		else:
			current_pose_name = "FREE / no collision"
		get_viewport().set_input_as_handled()
	if event is InputEventKey and event.pressed and event.keycode == KEY_H:
		hud.visible = not hud.visible
	if event is InputEventKey and event.pressed and event.keycode == KEY_F:
		tour_active = false
		main_camera.input_enabled = true
		current_pose_name = "FREE / no collision"


func _apply_pose(pose: Dictionary) -> void:
	main_camera.set_pose(pose.position, pose.target)
	current_pose_name = str(pose.name)


func _build_environment() -> void:
	var world_environment := WorldEnvironment.new()
	world_environment.name = "WorldEnvironment"
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.009, 0.014, 0.025)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.34, 0.48, 0.64)
	environment.ambient_light_energy = 0.62
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	world_environment.environment = environment
	add_child(world_environment)

	var key_light := DirectionalLight3D.new()
	key_light.name = "KeyLight"
	key_light.rotation_degrees = Vector3(-54.0, -28.0, 0.0)
	key_light.light_color = Color(0.72, 0.85, 1.0)
	key_light.light_energy = 1.15
	key_light.shadow_enabled = true
	add_child(key_light)

	var warm_light := OmniLight3D.new()
	warm_light.name = "WarmFill"
	warm_light.position = Vector3(-2.0, 4.0, 2.0)
	warm_light.light_color = Color(1.0, 0.45, 0.22)
	warm_light.light_energy = 2.2
	warm_light.omni_range = 11.0
	add_child(warm_light)

	var cool_light := OmniLight3D.new()
	cool_light.name = "CoolFill"
	cool_light.position = Vector3(3.0, 3.4, -3.0)
	cool_light.light_color = Color(0.15, 0.65, 1.0)
	cool_light.light_energy = 2.4
	cool_light.omni_range = 10.0
	add_child(cool_light)


func _surface_material(color: Color, roughness := 0.62, metallic := 0.0,
		emission_color := Color.BLACK, emission_energy := 0.0) -> ShaderMaterial:
	var material := ShaderMaterial.new()
	material.shader = preload("res://shaders/world_surface.gdshader")
	material.set_shader_parameter("surface_color", color)
	material.set_shader_parameter("roughness", roughness)
	material.set_shader_parameter("metallic", metallic)
	material.set_shader_parameter("emission_color", Vector3(emission_color.r, emission_color.g, emission_color.b))
	material.set_shader_parameter("emission_energy", emission_energy)
	return material


func _add_box(name: String, position: Vector3, size: Vector3, material: Material) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.name = name
	instance.mesh = BoxMesh.new()
	(instance.mesh as BoxMesh).size = size
	instance.material_override = material
	instance.position = position
	add_child(instance)
	return instance


func _add_sphere(name: String, position: Vector3, radius: float, material: Material) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.name = name
	instance.mesh = SphereMesh.new()
	(instance.mesh as SphereMesh).radius = radius
	(instance.mesh as SphereMesh).height = radius * 2.0
	(instance.mesh as SphereMesh).radial_segments = 32
	(instance.mesh as SphereMesh).rings = 16
	instance.material_override = material
	instance.position = position
	add_child(instance)
	return instance


func _add_cylinder(name: String, position: Vector3, radius: float, height: float,
		material: Material) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.name = name
	instance.mesh = CylinderMesh.new()
	(instance.mesh as CylinderMesh).top_radius = radius
	(instance.mesh as CylinderMesh).bottom_radius = radius
	(instance.mesh as CylinderMesh).height = height
	(instance.mesh as CylinderMesh).radial_segments = 28
	instance.material_override = material
	instance.position = position
	add_child(instance)
	return instance


func _build_room() -> void:
	var floor := MeshInstance3D.new()
	floor.name = "ReflectiveFloor"
	floor.mesh = PlaneMesh.new()
	(floor.mesh as PlaneMesh).size = Vector2(30.0, 25.0)
	var floor_material := ShaderMaterial.new()
	floor_material.shader = preload("res://shaders/floor_grid.gdshader")
	floor_material.set_shader_parameter("floor_color", Color(0.035, 0.052, 0.072))
	floor_material.set_shader_parameter("line_color", Color(0.12, 0.68, 0.72))
	floor_material.set_shader_parameter("cell_size", 1.0)
	floor.material_override = floor_material
	add_child(floor)

	var wall_material := _surface_material(Color(0.035, 0.05, 0.07), 0.82)
	_add_box("NorthWall", Vector3(0.0, 4.0, -12.2), Vector3(30.0, 8.0, 0.3), wall_material)
	_add_box("SouthWall", Vector3(0.0, 4.0, 12.2), Vector3(30.0, 8.0, 0.3), wall_material)
	_add_box("Ceiling", Vector3(0.0, 8.15, 0.0), Vector3(30.0, 0.25, 24.5), wall_material)

	var strip_material := _surface_material(Color(0.04, 0.18, 0.2), 0.24, 0.35,
		Color(0.05, 0.9, 0.8), 1.8)
	for z in [-8.8, 8.8]:
		_add_box("LightStrip", Vector3(0.0, 0.045, z), Vector3(21.0, 0.035, 0.075), strip_material)
	for x in [-8.9, 8.9]:
		_add_box("LightStrip", Vector3(x, 0.045, 0.0), Vector3(0.075, 0.035, 16.5), strip_material)

	var pillar_material := _surface_material(Color(0.045, 0.065, 0.08), 0.4, 0.65)
	for position in [
		Vector3(-8.7, 4.0, -8.7), Vector3(8.7, 4.0, -8.7),
		Vector3(-8.7, 4.0, 8.7), Vector3(8.7, 4.0, 8.7),
	]:
		_add_cylinder("CornerPillar", position, 0.18, 8.0, pillar_material)


func _build_scene_objects() -> void:
	var blue_material := _surface_material(Color(0.015, 0.08, 1.0), 0.22, 0.12,
		Color(0.02, 0.15, 1.0), 0.65)
	var yellow_material := _surface_material(Color(1.0, 0.68, 0.03), 0.3, 0.05,
		Color(1.0, 0.45, 0.01), 0.42)
	var cyan_material := _surface_material(Color(0.03, 0.72, 0.72), 0.32, 0.12,
		Color(0.0, 0.7, 0.72), 0.28)
	var orange_material := _surface_material(Color(1.0, 0.22, 0.035), 0.28, 0.1,
		Color(1.0, 0.14, 0.02), 0.46)
	var white_material := _surface_material(Color(0.72, 0.85, 0.94), 0.2, 0.08,
		Color(0.34, 0.62, 1.0), 0.22)
	var magenta_material := _surface_material(Color(0.72, 0.012, 0.46), 0.36, 0.08,
		Color(0.82, 0.01, 0.42), 0.32)

	_add_box("BlueBeacon", Vector3(3.25, 1.0, 2.25), Vector3(1.5, 2.0, 1.5), blue_material)
	_add_box("YellowTower", Vector3(-3.2, 1.25, -2.65), Vector3(1.35, 2.5, 1.35), yellow_material)
	_add_box("CyanCube", Vector3(-1.95, 0.55, 2.75), Vector3(1.1, 1.1, 1.1), cyan_material)
	_add_sphere("OrangeOrb", Vector3(2.15, 0.72, -3.05), 0.72, orange_material)
	_add_cylinder("WhiteColumn", Vector3(-2.25, 1.35, -4.7), 0.52, 2.7, white_material)
	_add_box("MagentaSlab", Vector3(-0.7, 1.9, -8.7), Vector3(1.2, 3.8, 0.28), magenta_material)

	var plinth_material := _surface_material(Color(0.055, 0.07, 0.08), 0.28, 0.7)
	_add_box("BluePlinth", Vector3(3.25, 0.06, 2.25), Vector3(2.0, 0.12, 2.0), plinth_material)
	_add_box("YellowPlinth", Vector3(-3.2, 0.06, -2.65), Vector3(1.8, 0.12, 1.8), plinth_material)

	var rail_material := _surface_material(Color(0.03, 0.18, 0.17), 0.3, 0.5,
		Color(0.02, 0.48, 0.4), 0.8)
	_add_box("BlueRail", Vector3(3.25, 2.15, 2.25), Vector3(1.62, 0.055, 1.62), rail_material)
	_add_box("YellowRail", Vector3(-3.2, 2.62, -2.65), Vector3(1.47, 0.055, 1.47), rail_material)


func _build_leak_probes() -> void:
	var red_material := _surface_material(Color(0.9, 0.005, 0.005), 0.22, 0.0,
		Color(1.0, 0.0, 0.0), 2.3)
	var green_material := _surface_material(Color(0.0, 0.9, 0.035), 0.22, 0.0,
		Color(0.0, 1.0, 0.025), 2.3)
	var stand_material := _surface_material(Color(0.04, 0.055, 0.06), 0.3, 0.7)

	_add_cylinder("RedLeakStand", Vector3(-7.35, 0.55, 0.0), 0.05, 1.1, stand_material)
	var red := _add_sphere("RedLeakProbe", Vector3(-7.35, 1.22, 0.0), 0.42, red_material)
	red.layers = 1
	_add_cylinder("GreenLeakStand", Vector3(7.35, 0.55, 0.0), 0.05, 1.1, stand_material)
	var green := _add_sphere("GreenLeakProbe", Vector3(7.35, 1.22, 0.0), 0.42, green_material)
	green.layers = 1


func _build_mirrors() -> void:
	mirror_a = PlanarMirrorScript.new()
	mirror_a.name = "MirrorA"
	mirror_a.configure("A", Vector3.RIGHT, Vector3(-6.0, 3.0, 0.0), main_camera)
	add_child(mirror_a)

	mirror_b = PlanarMirrorScript.new()
	mirror_b.name = "MirrorB"
	mirror_b.configure("B", Vector3.LEFT, Vector3(6.0, 3.0, 0.0), main_camera)
	add_child(mirror_b)


func _build_hud() -> void:
	hud = HudScript.new()
	hud.name = "HUD"
	var canvas := CanvasLayer.new()
	canvas.name = "Interface"
	canvas.layer = 20
	add_child(canvas)
	canvas.add_child(hud)
	hud.bind(self)


func _start_verification() -> void:
	_verification_running = true
	tour_active = false
	main_camera.input_enabled = false
	hud.visible = false
	var runner := VerificationRunner.new()
	runner.name = "VerificationRunner"
	add_child(runner)
	runner.run(self)
