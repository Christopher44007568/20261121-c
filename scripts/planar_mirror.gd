class_name PlanarMirror
extends Node3D

const WORLD_LAYER := 1
const MAIN_MIRROR_LAYER := 2
const OPPOSITE_MAIN_MIRROR_LAYER := 3
const BACKER_A_LAYER := 4
const BACKER_B_LAYER := 5
const REFLECTION_A_FLAG := 6
const REFLECTION_B_FLAG := 7

@export var mirror_id := "A"
@export var plane_normal := Vector3.RIGHT
@export var plane_point := Vector3.ZERO
@export var mirror_size := Vector2(12.0, 6.0)
@export var mirror_center_y := 3.0
@export var buffer_size := Vector2i(480, 270)
@export var main_camera: Camera3D

var surface: MeshInstance3D
var backer: MeshInstance3D
var frame_root: Node3D
var viewport: SubViewport
var reflection_camera: Camera3D
var mirror_material: ShaderMaterial
var _backer_layer_bit := BACKER_A_LAYER
var _visible_backer_layer_bit := BACKER_B_LAYER
var _reflection_flag_bit := REFLECTION_A_FLAG


func _ready() -> void:
	process_priority = 1000
	_build_surface()
	_build_frame()
	_build_reflection_buffer()
	sync_from_camera()


func _process(_delta: float) -> void:
	sync_from_camera()


func configure(id: String, normal: Vector3, point: Vector3, camera: Camera3D) -> void:
	mirror_id = id
	plane_normal = normal.normalized()
	plane_point = point
	main_camera = camera
	if id == "A":
		_backer_layer_bit = BACKER_A_LAYER
		_visible_backer_layer_bit = BACKER_B_LAYER
		_reflection_flag_bit = REFLECTION_A_FLAG
	else:
		_backer_layer_bit = BACKER_B_LAYER
		_visible_backer_layer_bit = BACKER_A_LAYER
		_reflection_flag_bit = REFLECTION_B_FLAG


func _build_surface() -> void:
	mirror_material = ShaderMaterial.new()
	mirror_material.shader = preload("res://shaders/mirror.gdshader")
	mirror_material.set_shader_parameter("plane_x", plane_point.x)
	mirror_material.set_shader_parameter("facing_sign", signf(plane_normal.x))
	mirror_material.set_shader_parameter("flip_horizontal", true)

	surface = MeshInstance3D.new()
	surface.name = "MirrorSurface"
	surface.mesh = QuadMesh.new()
	(surface.mesh as QuadMesh).size = mirror_size
	surface.material_override = mirror_material
	surface.position = Vector3(plane_point.x, plane_center_y(), plane_point.z)
	surface.rotation_degrees.y = 90.0 if plane_normal.x > 0.0 else -90.0
	var main_layer := MAIN_MIRROR_LAYER if mirror_id == "A" else OPPOSITE_MAIN_MIRROR_LAYER
	surface.layers = 1 << (main_layer - 1)
	add_child(surface)

	var backer_material := ShaderMaterial.new()
	backer_material.shader = preload("res://shaders/backer.gdshader")
	backer_material.set_shader_parameter("backing_color", Vector3(0.006, 0.008, 0.012))
	backer_material.set_shader_parameter("accent_color", Vector3(0.03, 0.32, 0.25))

	backer = MeshInstance3D.new()
	backer.name = "OneBounceBacker"
	backer.mesh = QuadMesh.new()
	(backer.mesh as QuadMesh).size = mirror_size
	backer.material_override = backer_material
	backer.position = surface.position
	backer.rotation = surface.rotation
	backer.layers = 1 << (_backer_layer_bit - 1)
	add_child(backer)


func _build_frame() -> void:
	frame_root = Node3D.new()
	frame_root.name = "Frame"
	add_child(frame_root)

	var frame_material := ShaderMaterial.new()
	frame_material.shader = preload("res://shaders/world_surface.gdshader")
	frame_material.set_shader_parameter("surface_color", Color(0.035, 0.055, 0.065))
	frame_material.set_shader_parameter("roughness", 0.34)
	frame_material.set_shader_parameter("metallic", 0.55)

	var rail := 0.13
	var depth := 0.2
	var half_w := mirror_size.x * 0.5
	var half_h := mirror_size.y * 0.5
	_add_frame_bar(frame_material, Vector3(mirror_size.x, rail, depth),
		Vector3(0.0, half_h + rail * 0.5, 0.0))
	_add_frame_bar(frame_material, Vector3(mirror_size.x, rail, depth),
		Vector3(0.0, -half_h - rail * 0.5, 0.0))
	_add_frame_bar(frame_material, Vector3(rail, mirror_size.y + rail * 2.0, depth),
		Vector3(half_w + rail * 0.5, 0.0, 0.0))
	_add_frame_bar(frame_material, Vector3(rail, mirror_size.y + rail * 2.0, depth),
		Vector3(-half_w - rail * 0.5, 0.0, 0.0))
	frame_root.position = surface.position
	frame_root.rotation = surface.rotation


func _add_frame_bar(material: ShaderMaterial, size: Vector3, offset: Vector3) -> void:
	var bar := MeshInstance3D.new()
	bar.mesh = BoxMesh.new()
	(bar.mesh as BoxMesh).size = size
	bar.material_override = material
	bar.position = offset
	bar.layers = 1 << (WORLD_LAYER - 1)
	frame_root.add_child(bar)


func _build_reflection_buffer() -> void:
	viewport = SubViewport.new()
	viewport.name = "ReflectionBuffer"
	viewport.size = buffer_size
	viewport.own_world_3d = false
	viewport.transparent_bg = false
	viewport.handle_input_locally = false
	viewport.gui_disable_input = true
	viewport.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.msaa_3d = Viewport.MSAA_DISABLED
	viewport.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	viewport.use_debanding = false
	add_child(viewport)

	reflection_camera = Camera3D.new()
	reflection_camera.name = "ReflectedCamera"
	reflection_camera.current = true
	reflection_camera.keep_aspect = Camera3D.KEEP_HEIGHT
	reflection_camera.fov = 70.0
	reflection_camera.near = 0.035
	reflection_camera.far = 100.0
	reflection_camera.cull_mask = (1 << (WORLD_LAYER - 1)) \
		| (1 << (_visible_backer_layer_bit - 1)) \
		| (1 << (_reflection_flag_bit - 1))
	viewport.add_child(reflection_camera)

	mirror_material.set_shader_parameter("reflection_tex", viewport.get_texture())


func plane_center_y() -> float:
	return mirror_center_y


func sync_from_camera() -> void:
	if main_camera == null or reflection_camera == null:
		return
	var normal := plane_normal.normalized()
	var camera_transform := main_camera.global_transform
	var reflected_origin := reflect_point(camera_transform.origin, normal)
	var forward := -camera_transform.basis.z
	var up := camera_transform.basis.y
	var reflected_forward := reflect_direction(forward, normal).normalized()
	var reflected_up := reflect_direction(up, normal).normalized()
	if absf(reflected_up.dot(reflected_forward)) > 0.999:
		reflected_up = Vector3.UP
	var camera_basis := Basis.looking_at(reflected_forward, reflected_up)
	reflection_camera.global_transform = Transform3D(camera_basis, reflected_origin)
	reflection_camera.fov = main_camera.fov
	reflection_camera.near = main_camera.near
	reflection_camera.far = main_camera.far


func reflect_point(point: Vector3, normal: Vector3) -> Vector3:
	var distance := (point - plane_point).dot(normal)
	return point - normal * 2.0 * distance


func reflect_direction(direction: Vector3, normal: Vector3) -> Vector3:
	return direction - normal * 2.0 * direction.dot(normal)


func camera_side() -> String:
	if main_camera == null:
		return "unknown"
	var signed_distance := (main_camera.global_position - plane_point).dot(plane_normal)
	if absf(signed_distance) < 0.05:
		return "at-plane"
	return "front" if signed_distance > 0.0 else "back"


func buffer_image() -> Image:
	if viewport == null:
		return null
	return viewport.get_texture().get_image()
