class_name CrowdModel
extends RefCounted

const BONE_COUNT := CrowdMeshBuilder.BONE_COUNT
const ROLE_CROWD := 0
const ROLE_PROP := 1
const ROLE_EDGE := 2

const BONE_PARENT := [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9, 6]
const BONE_LOCAL := [
	[Vector3(0.0, 1.03, 0.0), Vector3.ZERO],
	[Vector3(0.0, 0.12, 0.0), Vector3.ZERO],
	[Vector3(0.0, 0.58, 0.0), Vector3.ZERO],
	[Vector3(-0.30, 0.46, 0.0), Vector3.ZERO],
	[Vector3(0.0, -0.34, 0.0), Vector3.ZERO],
	[Vector3(0.30, 0.46, 0.0), Vector3.ZERO],
	[Vector3(0.0, -0.34, 0.0), Vector3.ZERO],
	[Vector3(-0.15, -0.08, 0.0), Vector3.ZERO],
	[Vector3(0.0, -0.46, 0.0), Vector3.ZERO],
	[Vector3(0.15, -0.08, 0.0), Vector3.ZERO],
	[Vector3(0.0, -0.46, 0.0), Vector3.ZERO],
	[Vector3(0.0, -0.32, 0.0), Vector3.ZERO],
]

var actors: Array[Actor] = []
var bind_globals: Array[Transform3D] = []
var bind_inverses: Array[Transform3D] = []
var mesh_builder: CrowdMeshBuilder
var total_vertices := 0
var prop_vertex_count := 0
var rng := RandomNumberGenerator.new()


class Actor:
	var id := 0
	var role := 0
	var position := Vector3.ZERO
	var home := Vector3.ZERO
	var heading := 0.0
	var phase := 0.0
	var speed := 1.0
	var scale := 1.0
	var direction := 1.0
	var cosmetics := 0.0
	var has_prop := false
	var skin: Array[Transform3D] = []
	var bounds := AABB()
	var visible := true
	var world_transform := Transform3D.IDENTITY
	var reference_safe := true


func _init(seed_value := 20261121) -> void:
	rng.seed = seed_value
	_build_bind_pose()
	_build_mesh()


func _build_bind_pose() -> void:
	bind_globals.resize(BONE_COUNT)
	bind_inverses.resize(BONE_COUNT)
	for i in BONE_COUNT:
		var data: Array = BONE_LOCAL[i]
		var local := Transform3D(Basis.IDENTITY, data[0])
		var parent: int = BONE_PARENT[i]
		bind_globals[i] = local if parent < 0 else bind_globals[parent] * local
		bind_inverses[i] = bind_globals[i].affine_inverse()


func _build_mesh() -> void:
	mesh_builder = CrowdMeshBuilder.new()
	var suit := Color(0.58, 0.80, 1.0)
	var dark := Color(0.22, 0.36, 0.56)
	var skin := Color(0.96, 0.74, 0.56)
	var accent := Color(1.0, 0.60, 0.22)
	var glow := Color(1.0, 0.72, 0.24)

	mesh_builder.append_box(0, Vector3(0.0, 0.0, 0.0), Vector3(0.38, 0.26, 0.25), dark, 3)
	mesh_builder.append_beam(1, Vector3(0.0, 0.02, 0.0), Vector3(0.0, 0.62, 0.0), 0.23, 0.19, suit)
	mesh_builder.append_box(1, Vector3(0.0, 0.47, 0.0), Vector3(0.52, 0.12, 0.24), suit)
	mesh_builder.append_box(2, Vector3(0.0, 0.16, 0.0), Vector3(0.29, 0.32, 0.27), skin, 2)
	mesh_builder.append_box(2, Vector3(0.0, 0.34, 0.0), Vector3(0.32, 0.08, 0.30), dark, 3)

	mesh_builder.append_beam(3, Vector3(0.0, 0.0, 0.0), Vector3(0.0, -0.34, 0.0), 0.075, 0.065, suit)
	mesh_builder.append_beam(4, Vector3(0.0, 0.0, 0.0), Vector3(0.0, -0.32, 0.0), 0.062, 0.050, dark, 3)
	mesh_builder.append_box(4, Vector3(0.0, -0.34, 0.0), Vector3(0.15, 0.17, 0.14), skin, 2)
	mesh_builder.append_beam(5, Vector3(0.0, 0.0, 0.0), Vector3(0.0, -0.34, 0.0), 0.075, 0.065, suit)
	mesh_builder.append_beam(6, Vector3(0.0, 0.0, 0.0), Vector3(0.0, -0.32, 0.0), 0.062, 0.050, dark, 3)
	mesh_builder.append_box(6, Vector3(0.0, -0.34, 0.0), Vector3(0.15, 0.17, 0.14), skin, 2)

	mesh_builder.append_beam(7, Vector3(0.0, 0.0, 0.0), Vector3(0.0, -0.46, 0.0), 0.105, 0.082, dark, 3)
	mesh_builder.append_beam(8, Vector3(0.0, 0.0, 0.0), Vector3(0.0, -0.44, 0.0), 0.080, 0.062, suit)
	mesh_builder.append_box(8, Vector3(0.0, -0.46, -0.05), Vector3(0.17, 0.12, 0.30), accent, 4)
	mesh_builder.append_beam(9, Vector3(0.0, 0.0, 0.0), Vector3(0.0, -0.46, 0.0), 0.105, 0.082, dark, 3)
	mesh_builder.append_beam(10, Vector3(0.0, 0.0, 0.0), Vector3(0.0, -0.44, 0.0), 0.080, 0.062, suit)
	mesh_builder.append_box(10, Vector3(0.0, -0.46, -0.05), Vector3(0.17, 0.12, 0.30), accent, 4)

	mesh_builder.append_beam(11, Vector3(0.0, -1.15, 0.0), Vector3(0.0, 3.55, 0.0), 0.038, 0.038, glow, 1, 7)
	mesh_builder.append_beam(11, Vector3(0.0, -0.24, 0.0), Vector3(0.0, 0.24, 0.0), 0.070, 0.070, dark, 1)
	mesh_builder.append_box(11, Vector3(0.0, 3.62, 0.0), Vector3(0.24, 0.24, 0.24), accent, 1)
	mesh_builder.append_box(11, Vector3(0.0, -1.20, 0.0), Vector3(0.16, 0.16, 0.16), accent, 1)
	total_vertices = mesh_builder.vertex_count()
	prop_vertex_count = mesh_builder.bone_ids.count(11)


func setup(actor_count: int) -> void:
	actors.clear()
	var prop_count := int(actor_count * 0.15)
	var edge_count := int(actor_count * 0.14)
	var crowd_count := actor_count - prop_count - edge_count
	for i in prop_count:
		actors.append(_make_actor(i, ROLE_PROP))
	for i in edge_count:
		actors.append(_make_actor(prop_count + i, ROLE_EDGE))
	for i in crowd_count:
		actors.append(_make_actor(prop_count + edge_count + i, ROLE_CROWD))
	for actor in actors:
		_compute_skin_and_bounds(actor, 0.0)


func _make_actor(id: int, role: int) -> Actor:
	var actor := Actor.new()
	actor.id = id
	actor.role = role
	actor.skin.resize(BONE_COUNT)
	actor.phase = rng.randf_range(0.0, TAU)
	actor.cosmetics = rng.randf()
	actor.scale = rng.randf_range(0.90, 1.08)
	actor.speed = rng.randf_range(0.72, 1.12)
	if role == ROLE_PROP:
		actor.home = Vector3(rng.randf_range(-13.5, -2.8), 0.0, rng.randf_range(-5.0, 6.5))
		actor.heading = rng.randf_range(-0.9, 0.9)
		actor.has_prop = true
		actor.scale *= 1.03
	elif role == ROLE_EDGE:
		actor.home = Vector3(rng.randf_range(-21.0, -12.5), 0.0, rng.randf_range(-0.5, 5.5))
		actor.direction = 1.0 if rng.randf() > 0.5 else -1.0
		actor.heading = PI * 0.5 if actor.direction > 0.0 else -PI * 0.5
		actor.speed *= 1.25
		actor.has_prop = rng.randf() < 0.30
	else:
		var roll := rng.randf()
		if roll < 0.50:
			actor.home = Vector3(rng.randf_range(-21.0, 21.0), 0.0, rng.randf_range(-35.0, -14.0))
			actor.scale *= 0.80
		elif roll < 0.80:
			actor.home = Vector3(rng.randf_range(-48.0, 48.0), 0.0, rng.randf_range(-32.0, 9.0))
			actor.scale *= 0.94
		elif roll < 0.96:
			var side := -1.0 if rng.randf() < 0.5 else 1.0
			actor.home = Vector3(side * rng.randf_range(19.0, 36.0), 0.0, rng.randf_range(-8.0, 11.0))
		else:
			actor.home = Vector3(rng.randf_range(-30.0, 30.0), 0.0, rng.randf_range(16.0, 30.0))
		actor.heading = rng.randf_range(-PI, PI)
		actor.has_prop = false
	actor.position = actor.home
	return actor


func step(delta: float, elapsed: float) -> void:
	var cull_start := Time.get_ticks_usec()
	for actor in actors:
		_update_motion(actor, delta, elapsed)
		_compute_skin_and_bounds(actor, elapsed)
	last_pose_and_bounds_usec = Time.get_ticks_usec() - cull_start


var last_pose_and_bounds_usec := 0
var last_cull_usec := 0


func _update_motion(actor: Actor, delta: float, elapsed: float) -> void:
	if actor.role == ROLE_PROP:
		var orbit := elapsed * 0.16 + actor.phase
		actor.position.x = actor.home.x + sin(orbit) * 1.45
		actor.position.z = actor.home.z + cos(orbit * 0.73) * 0.75
		actor.heading = sin(orbit * 0.5) * 0.75
	elif actor.role == ROLE_EDGE:
		actor.position.x += actor.direction * actor.speed * 1.15 * delta
		if actor.position.x > -6.5:
			actor.position.x = -6.5
			actor.direction = -1.0
			actor.heading = -PI * 0.5
		elif actor.position.x < -22.5:
			actor.position.x = -22.5
			actor.direction = 1.0
			actor.heading = PI * 0.5
	else:
		var sway := elapsed * 0.28 + actor.phase
		actor.position.x = actor.home.x + sin(sway) * 0.16
		actor.position.z = actor.home.z + cos(sway * 0.83) * 0.12


func _compute_skin_and_bounds(actor: Actor, elapsed: float) -> void:
	var walk := sin(elapsed * 2.05 * actor.speed + actor.phase)
	var walk_other := -walk
	var idle := sin(elapsed * 0.85 + actor.phase)
	var prop_swing := sin(elapsed * 1.15 * actor.speed + actor.phase)
	if actor.role == ROLE_PROP:
		walk = sin(elapsed * 1.1 * actor.speed + actor.phase) * 0.42
		walk_other = -walk
		prop_swing = sin(elapsed * 1.3 + actor.phase)

	var locals: Array[Transform3D] = []
	locals.resize(BONE_COUNT)
	locals[0] = Transform3D(
		Basis(Vector3.BACK, idle * 0.025),
		Vector3(0.0, 1.03 + absf(walk) * 0.035, 0.0)
	)
	locals[1] = Transform3D(
		Basis.from_euler(Vector3(idle * 0.035, 0.0, -walk * 0.05)),
		Vector3(0.0, 0.12, 0.0)
	)
	locals[2] = Transform3D(
		Basis.from_euler(Vector3(-idle * 0.05, idle * 0.16, 0.0)),
		Vector3(0.0, 0.58, 0.0)
	)
	locals[3] = Transform3D(
		Basis.from_euler(Vector3(walk_other * 0.68, 0.0, 0.30)),
		Vector3(-0.30, 0.46, 0.0)
	)
	locals[4] = Transform3D(
		Basis.from_euler(Vector3(-0.22 - absf(walk) * 0.16, 0.0, 0.0)),
		Vector3(0.0, -0.34, 0.0)
	)
	locals[5] = Transform3D(
		Basis.from_euler(Vector3(walk * 0.68, 0.0, -0.30)),
		Vector3(0.30, 0.46, 0.0)
	)
	locals[6] = Transform3D(
		Basis.from_euler(Vector3(-0.22 - absf(walk) * 0.16, 0.0, 0.0)),
		Vector3(0.0, -0.34, 0.0)
	)
	locals[7] = Transform3D(
		Basis.from_euler(Vector3(walk * 0.48, 0.0, 0.0)),
		Vector3(-0.15, -0.08, 0.0)
	)
	locals[8] = Transform3D(
		Basis.from_euler(Vector3(maxf(0.0, -walk) * 0.58, 0.0, 0.0)),
		Vector3(0.0, -0.46, 0.0)
	)
	locals[9] = Transform3D(
		Basis.from_euler(Vector3(walk_other * 0.48, 0.0, 0.0)),
		Vector3(0.15, -0.08, 0.0)
	)
	locals[10] = Transform3D(
		Basis.from_euler(Vector3(maxf(0.0, -walk_other) * 0.58, 0.0, 0.0)),
		Vector3(0.0, -0.46, 0.0)
	)
	if actor.has_prop:
		locals[5].basis = Basis.from_euler(Vector3(-1.0 + prop_swing * 0.18, 0.0, -0.65))
		locals[6].basis = Basis.from_euler(Vector3(-0.48, 0.0, 0.0))
		locals[11] = Transform3D(
			Basis.from_euler(Vector3(-0.48 + prop_swing * 0.20, prop_swing * 0.12, 0.88 + prop_swing * 0.25)),
			Vector3(0.0, -0.32, 0.0)
		)
	else:
		locals[11] = Transform3D(Basis.from_scale(Vector3(0.001, 0.001, 0.001)), Vector3(0.0, -0.32, 0.0))

	var pose_globals: Array[Transform3D] = []
	pose_globals.resize(BONE_COUNT)
	for i in BONE_COUNT:
		var parent: int = BONE_PARENT[i]
		pose_globals[i] = locals[i] if parent < 0 else pose_globals[parent] * locals[i]
	for i in BONE_COUNT:
		actor.skin[i] = pose_globals[i]
	var basis := Basis(Vector3.UP, actor.heading).scaled(Vector3.ONE * actor.scale)
	actor.world_transform = Transform3D(basis, actor.position)
	actor.bounds = _animated_bounds(actor)


func _animated_bounds(actor: Actor) -> AABB:
	var world := actor.world_transform
	var result := AABB()
	var initialized := false
	for bone in BONE_COUNT:
		if bone == 11 and not actor.has_prop:
			continue
		var local_box := mesh_builder.bone_local_aabb[bone]
		var skin := actor.skin[bone]
		for corner_index in 8:
			var corner := local_box.get_endpoint(corner_index)
			var point := world * (skin * corner)
			if not initialized:
				result = AABB(point, Vector3.ZERO)
				initialized = true
			else:
				result = result.expand(point)
	return result.grow(0.035)


func cull(frustum: ConservativeFrustum) -> void:
	var start := Time.get_ticks_usec()
	for actor in actors:
		actor.visible = frustum.intersects_aabb(actor.bounds)
	last_cull_usec = Time.get_ticks_usec() - start


func visible_count() -> int:
	var count := 0
	for actor in actors:
		if actor.visible:
			count += 1
	return count


func role_counts() -> Dictionary:
	var result := {
		"prop_total": 0,
		"prop_visible": 0,
		"edge_total": 0,
		"edge_visible": 0,
		"crowd_total": 0,
		"crowd_visible": 0,
	}
	for actor in actors:
		if actor.role == ROLE_PROP:
			result.prop_total += 1
			result.prop_visible += int(actor.visible)
		elif actor.role == ROLE_EDGE:
			result.edge_total += 1
			result.edge_visible += int(actor.visible)
		else:
			result.crowd_total += 1
			result.crowd_visible += int(actor.visible)
	return result


func verify_reference_batch(
	frustum: ConservativeFrustum,
	cursor: int,
	batch_size: int,
	include_hidden_vertices := true
) -> Dictionary:
	var result := {
		"actors": 0,
		"vertices": 0,
		"false_culls": 0,
		"false_positives": 0,
		"next_cursor": cursor,
	}
	if actors.is_empty():
		return result
	var count := mini(batch_size, actors.size())
	for n in count:
		var index := (cursor + n) % actors.size()
		var actor := actors[index]
		var any_inside := false
		for vertex_index in mesh_builder.vertices.size():
			var bone := mesh_builder.bone_ids[vertex_index]
			if bone == 11 and not actor.has_prop and not include_hidden_vertices:
				continue
			var point := actor.world_transform * (actor.skin[bone] * mesh_builder.vertices[vertex_index])
			if frustum.contains_point(point):
				any_inside = true
				if not actor.visible:
					result.false_culls += 1
					actor.reference_safe = false
				break
		if not any_inside and actor.visible:
			result.false_positives += 1
		result.actors += 1
		result.vertices += mesh_builder.vertices.size()
	result.next_cursor = (cursor + count) % actors.size()
	return result


func average_vertex_count_per_actor() -> float:
	return float(mesh_builder.vertices.size())
