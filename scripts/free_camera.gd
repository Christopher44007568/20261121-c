extends Camera3D

@export var move_speed := 5.2
@export var boost_multiplier := 3.2
@export var mouse_sensitivity := 0.0022
@export var input_enabled := true

var yaw := 0.0
var pitch := 0.0
var _captured := false
var _home_position := Vector3(0.0, 2.4, 7.5)
var _home_target := Vector3(-6.0, 2.8, 0.0)


func _ready() -> void:
	process_priority = 0
	fov = 70.0
	near = 0.035
	home()


func _unhandled_input(event: InputEvent) -> void:
	if not input_enabled:
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		_captured = true
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		_captured = false
	if event.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		_captured = false
	if event is InputEventMouseMotion and _captured:
		yaw -= event.relative.x * mouse_sensitivity
		pitch = clampf(pitch - event.relative.y * mouse_sensitivity, -1.48, 1.48)
		rotation = Vector3(pitch, yaw, 0.0)
	if event.is_action_pressed("reset_camera"):
		home()


func _process(delta: float) -> void:
	if not input_enabled:
		return
	var local := Vector3.ZERO
	var move := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	local.x = move.x
	local.z = move.y
	local.y = float(Input.is_action_pressed("move_up")) - float(Input.is_action_pressed("move_down"))
	if local.length_squared() > 0.0:
		local = local.normalized()
		var speed := move_speed
		if Input.is_action_pressed("speed_boost"):
			speed *= boost_multiplier
		global_position += (global_transform.basis * local) * speed * delta


func home() -> void:
	global_position = _home_position
	look_at(_home_target, Vector3.UP)
	yaw = rotation.y
	pitch = rotation.x


func set_pose(position: Vector3, target: Vector3) -> void:
	global_position = position
	look_at(target, Vector3.UP)
	yaw = rotation.y
	pitch = rotation.x
