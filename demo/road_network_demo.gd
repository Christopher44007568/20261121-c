@tool
class_name RoadNetworkDemo
extends RefCounted

# Builds the editor demo network: a winding two-lane main road with width
# change and superelevation, plus a T-junction branch with a transition.

const ANCHOR_STATION: float = 64.0


static func build(spacing: float = 1.0) -> Dictionary:
	var main_curve := TestDataFactory.winding_main_curve()
	var main_profile := RoadProfile.new()
	main_profile.width_keys = [
		{"station": 0.0, "half_width": 3.8},
		{"station": 60.0, "half_width": 4.61},
		{"station": 120.0, "half_width": 4.0},
		{"station": 1.0e12, "half_width": 4.0},
	]
	# Superelevation follows the bend direction, capped at 8%.
	main_profile.bank_keys = [
		{"station": 0.0, "bank": 0.0},
		{"station": 30.0, "bank": -0.06},
		{"station": 70.0, "bank": 0.08},
		{"station": 110.0, "bank": 0.07},
		{"station": 1.0e12, "bank": 0.0},
	]

	var frame: Dictionary = main_curve.sample(ANCHOR_STATION)
	var right := Vector3(frame.tangent.z, 0, -frame.tangent.x)
	var left: Vector3 = -right
	var edge_anchor: Vector3 = frame.point + left * main_profile.half_width_at(ANCHOR_STATION)
	var local_branch := TestDataFactory.branch_curve()
	var branch_curve: RoadCurve = TestDataFactory.place_branch(
		local_branch, edge_anchor, -left)

	var junction_node := RoadTJunction3D.new()
	var junction: Dictionary = junction_node.build(
		main_curve, main_profile, branch_curve, ANCHOR_STATION,
		3.85, 14.0, spacing)
	junction.node = junction_node
	junction.main_curve = main_curve
	junction.main_profile = main_profile
	junction.branch_curve = branch_curve
	return junction


# Instantiates the network as MeshInstance3D children of junction_node.
static func instantiate(junction: Dictionary, parent: Node3D) -> Array:
	var nodes: Array = []
	for key in ["main", "branch"]:
		var instance := MeshInstance3D.new()
		instance.name = key.capitalize() + "RoadMesh"
		instance.mesh = junction[key].mesh
		parent.add_child(instance)
		nodes.append(instance)
	return nodes
