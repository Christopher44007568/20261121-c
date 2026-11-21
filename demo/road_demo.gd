@tool
extends Node3D

# Editor demo: rebuilds the road network whenever the scene is opened or the
# rebuild flag is toggled in the inspector. Works both in the editor and at
# runtime because every generator class is @tool-safe.

@export_range(0.2, 4.0, 0.1) var mesh_spacing: float = 1.0
@export var rebuild: bool = false:
	set(value):
		rebuild = value
		if Engine.is_editor_hint() and value:
			_build_network()
			rebuild = false


func _ready() -> void:
	if get_child_count() == 0:
		_build_network()


func _build_network() -> void:
	for child in get_children():
		child.queue_free()
	var junction: Dictionary = RoadNetworkDemo.build(mesh_spacing)
	RoadNetworkDemo.instantiate(junction, self)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55.0, -35.0, 0.0)
	sun.light_energy = 1.2
	add_child(sun)

	var camera := Camera3D.new()
	camera.position = Vector3(60.0, 70.0, 110.0)
	camera.current = true
	add_child(camera)
	camera.look_at(Vector3(40.0, 0.0, 20.0), Vector3.UP)
