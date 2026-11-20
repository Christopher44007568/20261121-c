class_name ConservativeFrustum
extends RefCounted

var planes: Array[Plane] = []
var eye := Vector3.ZERO
var forward := Vector3.FORWARD
var right := Vector3.RIGHT
var up := Vector3.UP
var near := 0.1
var far := 100.0
var tan_x := 0.5
var tan_y := 0.3


func configure(
	camera_transform: Transform3D,
	vertical_fov_radians: float,
	aspect: float,
	near_distance: float,
	far_distance: float
) -> void:
	eye = camera_transform.origin
	right = camera_transform.basis.x.normalized()
	up = camera_transform.basis.y.normalized()
	forward = -camera_transform.basis.z.normalized()
	near = near_distance
	far = far_distance
	tan_y = tan(vertical_fov_radians * 0.5)
	tan_x = tan_y * aspect
	planes.clear()
	planes.append(_plane(near, -forward, eye + forward * near))
	planes.append(_plane(far, forward, eye + forward * far))
	planes.append(_plane(0.0, -right - tan_x * forward, eye))
	planes.append(_plane(0.0, right - tan_x * forward, eye))
	planes.append(_plane(0.0, -up - tan_y * forward, eye))
	planes.append(_plane(0.0, up - tan_y * forward, eye))


func _plane(_kind: float, outward_normal: Vector3, point: Vector3) -> Plane:
	var n := outward_normal.normalized()
	return Plane(n, n.dot(point))


func contains_point(point: Vector3) -> bool:
	for plane in planes:
		if plane.distance_to(point) > 0.00001:
			return false
	return true


func intersects_aabb(box: AABB) -> bool:
	var center := box.get_center()
	var extent := box.size * 0.5
	for plane in planes:
		var n := plane.normal
		var center_distance := n.dot(center) - plane.d
		var support := absf(n.x) * extent.x + absf(n.y) * extent.y + absf(n.z) * extent.z
		if center_distance - support > 0.00001:
			return false
	return true


func camera_space(point: Vector3) -> Vector3:
	var delta := point - eye
	return Vector3(delta.dot(right), delta.dot(up), delta.dot(forward))
