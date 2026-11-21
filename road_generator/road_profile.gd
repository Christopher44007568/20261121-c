@tool
class_name RoadProfile
extends RefCounted

# Cross-section and road-surface profile.
# Seven columns span the full width: outer shoulder, lane edges, lane centre
# lines and the crown, giving two lanes with shoulders on both sides.

const COLUMN_OFFSETS: Array[float] = [-1.0, -0.75, -0.5, 0.0, 0.5, 0.75, 1.0]

# Half-width keyframes: [{"station": float, "half_width": float}, ...]
var width_keys: Array = []
# Superelevation keyframes: [{"station": float, "bank": float}]
# bank is signed cross-slope as rise/run; positive raises the right edge.
var bank_keys: Array = []


func set_constant_width(half_width: float) -> void:
	width_keys = [
		{"station": 0.0, "half_width": half_width},
		{"station": 1.0e12, "half_width": half_width},
	]


func set_constant_bank(bank: float) -> void:
	bank_keys = [
		{"station": 0.0, "bank": bank},
		{"station": 1.0e12, "bank": bank},
	]


func half_width_at(station: float) -> float:
	return _interpolate(width_keys, station, "half_width")


func bank_at(station: float) -> float:
	return _interpolate(bank_keys, station, "bank")


func _interpolate(keys: Array, station: float, value_name: String) -> float:
	if keys.is_empty():
		return 0.0
	if station <= keys[0].station:
		return keys[0][value_name]
	for i in range(keys.size() - 1):
		var a: Dictionary = keys[i]
		var b: Dictionary = keys[i + 1]
		if station <= b.station:
			var span: float = b.station - a.station
			var alpha: float = 0.0 if span <= 0.00001 else (station - a.station) / span
			return lerp(a[value_name], b[value_name], alpha)
	return keys[-1][value_name]


func max_half_width(up_to_station: float = INF) -> float:
	var result: float = 0.0
	for key in width_keys:
		if key.station <= up_to_station:
			result = max(result, key.half_width)
	return result


# Full cross-section in world space for one sampled frame.
# Returns {"positions": Array[Vector3], "station": float, "half_width": float}
func build_frame(frame: Dictionary, station: float) -> Dictionary:
	var half_width: float = half_width_at(station)
	var bank: float = bank_at(station)
	var center: Vector3 = frame.point
	var tangent: Vector3 = frame.tangent
	# Right-hand normal in the XZ plane. For tangent (tx, 0, tz) the right
	# side normal is (tz, 0, -tx).
	var right := Vector3(tangent.z, 0.0, -tangent.x)
	var positions: Array[Vector3] = []
	for offset in COLUMN_OFFSETS:
		var lateral: float = offset * half_width
		var vertical: float = bank * lateral
		positions.append(center + right * lateral + Vector3.UP * vertical)
	return {"positions": positions, "station": station, "half_width": half_width,
		"bank": bank, "right": right}
