class_name CrowdMeshBuilder
extends RefCounted

const BONE_COUNT := 12

var vertices := PackedVector3Array()
var normals := PackedVector3Array()
var colors := PackedColorArray()
var uv2s := PackedVector2Array()
var bone_ids := PackedInt32Array()
var bone_local_aabb: Array[AABB] = []
var _bone_seen: Array[bool] = []


func _init() -> void:
	bone_local_aabb.resize(BONE_COUNT)
	_bone_seen.resize(BONE_COUNT)
	for i in BONE_COUNT:
		bone_local_aabb[i] = AABB()
		_bone_seen[i] = false


func vertex_count() -> int:
	return vertices.size()


func append_box(bone: int, center: Vector3, size: Vector3, color: Color, part := 0) -> void:
	var h := size * 0.5
	var corners := [
		center + Vector3(-h.x, -h.y, -h.z),
		center + Vector3(h.x, -h.y, -h.z),
		center + Vector3(h.x, h.y, -h.z),
		center + Vector3(-h.x, h.y, -h.z),
		center + Vector3(-h.x, -h.y, h.z),
		center + Vector3(h.x, -h.y, h.z),
		center + Vector3(h.x, h.y, h.z),
		center + Vector3(-h.x, h.y, h.z),
	]
	var faces := [
		[0, 3, 2, 1, Vector3(0, 0, -1)],
		[4, 5, 6, 7, Vector3(0, 0, 1)],
		[0, 1, 5, 4, Vector3(0, -1, 0)],
		[3, 7, 6, 2, Vector3(0, 1, 0)],
		[0, 4, 7, 3, Vector3(-1, 0, 0)],
		[1, 2, 6, 5, Vector3(1, 0, 0)],
	]
	for face in faces:
		var normal: Vector3 = face[4]
		for tri in [[0, 1, 2], [0, 2, 3]]:
			for k in tri:
				_append_vertex(corners[face[k]], normal, color, bone, part)


func append_beam(
	bone: int,
	a: Vector3,
	b: Vector3,
	radius_a: float,
	radius_b: float,
	color: Color,
	part := 0,
	sides := 6
) -> void:
	var axis := (b - a).normalized()
	var side := axis.cross(Vector3.UP)
	if side.length_squared() < 0.0001:
		side = axis.cross(Vector3.FORWARD)
	side = side.normalized()
	var forward := side.cross(axis).normalized()
	var ring_a: Array[Vector3] = []
	var ring_b: Array[Vector3] = []
	var normal_a: Array[Vector3] = []
	var normal_b: Array[Vector3] = []
	for i in sides:
		var angle := TAU * float(i) / float(sides)
		var radial := side * cos(angle) + forward * sin(angle)
		ring_a.append(a + radial * radius_a)
		ring_b.append(b + radial * radius_b)
		normal_a.append(radial)
		normal_b.append(radial)
	for i in sides:
		var j := (i + 1) % sides
		_append_quad(
			ring_a[i], ring_a[j], ring_b[j], ring_b[i],
			normal_a[i], normal_a[j], normal_b[j], normal_b[i],
			color, bone, part
		)
	_append_cap(a, ring_a, -axis, color, bone, part)
	_append_cap(b, ring_b, axis, color, bone, part)


func _append_cap(
	center: Vector3,
	ring: Array[Vector3],
	normal: Vector3,
	color: Color,
	bone: int,
	part: int
) -> void:
	for i in ring.size():
		var j := (i + 1) % ring.size()
		_append_vertex(center, normal, color, bone, part)
		_append_vertex(ring[i], normal, color, bone, part)
		_append_vertex(ring[j], normal, color, bone, part)


func _append_quad(
	a: Vector3, b: Vector3, c: Vector3, d: Vector3,
	na: Vector3, nb: Vector3, nc: Vector3, nd: Vector3,
	color: Color, bone: int, part: int
) -> void:
	_append_vertex(a, na, color, bone, part)
	_append_vertex(b, nb, color, bone, part)
	_append_vertex(c, nc, color, bone, part)
	_append_vertex(a, na, color, bone, part)
	_append_vertex(c, nc, color, bone, part)
	_append_vertex(d, nd, color, bone, part)


func _append_vertex(
	p: Vector3,
	n: Vector3,
	color: Color,
	bone: int,
	part: int
) -> void:
	vertices.append(p)
	normals.append(n.normalized())
	colors.append(color)
	uv2s.append(Vector2(float(bone), float(part)))
	bone_ids.append(bone)
	var box := bone_local_aabb[bone]
	if not _bone_seen[bone]:
		box = AABB(p, Vector3.ZERO)
		_bone_seen[bone] = true
	else:
		box = box.expand(p)
	bone_local_aabb[bone] = box


func build_mesh(material: Material) -> ArrayMesh:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_TEX_UV2] = uv2s
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	if material != null:
		mesh.surface_set_material(0, material)
	return mesh
