class_name CrowdHud
extends CanvasLayer

var mono: SystemFont
var sans: SystemFont
var pass_label: Label
var visible_label: Label
var culled_label: Label
var bar_fill: ColorRect
var reference_label: Label
var reference_meta: Label
var role_labels: Array[Label] = []
var cost_labels: Array[Label] = []
var total_cost_label: Label
var palette_meta: Label
var status_label: Label
var clock_label: Label


func _ready() -> void:
	layer = 10
	mono = SystemFont.new()
	mono.font_names = PackedStringArray(["DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", "monospace"])
	sans = SystemFont.new()
	sans.font_names = PackedStringArray(["DejaVu Sans", "Liberation Sans", "Ubuntu", "sans-serif"])

	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_build_title_panel(root)
	_build_pass_panel(root)
	_build_cost_panel(root)
	_build_legend_panel(root)
	_build_clock(root)


func _build_title_panel(root: Control) -> void:
	var panel := _panel(root, Vector2(32, 28), Vector2(566, 146))
	var accent := ColorRect.new()
	accent.color = Color(0.98, 0.52, 0.15)
	accent.position = Vector2(0, 0)
	accent.size = Vector2(4, 146)
	panel.add_child(accent)
	_label(panel, "REALTIME CROWD LAB / GODOT 4", Vector2(24, 15), 12, Color(0.36, 0.78, 0.79), mono)
	_label(panel, "ANIMATION-CONSERVATIVE CULLING", Vector2(24, 35), 24, Color(0.91, 0.96, 1.0), sans)
	_label(panel, "GPU bone palette  /  12 bones per actor  /  long-prop aware", Vector2(24, 70), 13, Color(0.53, 0.66, 0.72), mono)
	_label(panel, "Animated AABB + per-vertex slow reference", Vector2(24, 91), 12, Color(0.40, 0.58, 0.63), mono)
	var state := _label(panel, "LIVE", Vector2(482, 16), 12, Color(0.34, 0.95, 0.65), mono)
	state.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	state.size = Vector2(64, 20)
	status_label = state
	var dot := ColorRect.new()
	dot.color = Color(0.34, 0.95, 0.65)
	dot.position = Vector2(467, 21)
	dot.size = Vector2(7, 7)
	panel.add_child(dot)
	var role_y := 119.0
	var names := ["PROP GUARD", "WINDOW EDGE", "DISTANT"]
	var colors := [Color(1.0, 0.52, 0.16), Color(0.25, 0.88, 0.95), Color(0.60, 0.86, 0.96)]
	for i in 3:
		var tag := _label(panel, names[i], Vector2(24 + i * 178, role_y), 10, colors[i], mono)
		tag.size = Vector2(120, 16)
		var count := _label(panel, "-- / --", Vector2(118 + i * 178, role_y), 10, Color(0.72, 0.81, 0.85), mono)
		count.size = Vector2(58, 16)
		role_labels.append(count)


func _build_pass_panel(root: Control) -> void:
	var panel := _panel_anchored(root, Vector2(1, 0), Vector2(-390, 28), Vector2(-32, 254))
	_label(panel, "FRUSTUM PASS", Vector2(20, 14), 11, Color(0.42, 0.73, 0.77), mono)
	pass_label = _label(panel, "0.0%", Vector2(20, 30), 52, Color(0.35, 0.95, 0.76), sans)
	pass_label.size = Vector2(320, 67)
	visible_label = _label(panel, "0 / 0 actors rendered", Vector2(22, 98), 14, Color(0.75, 0.85, 0.88), mono)
	visible_label.size = Vector2(320, 20)
	var bar_bg := ColorRect.new()
	bar_bg.color = Color(0.08, 0.13, 0.16)
	bar_bg.position = Vector2(22, 126)
	bar_bg.size = Vector2(326, 7)
	panel.add_child(bar_bg)
	bar_fill = ColorRect.new()
	bar_fill.color = Color(0.32, 0.94, 0.73)
	bar_fill.position = Vector2(22, 126)
	bar_fill.size = Vector2(10, 7)
	panel.add_child(bar_fill)
	culled_label = _label(panel, "CULLED 0  /  RATE 0.0%", Vector2(22, 144), 12, Color(0.86, 0.55, 0.30), mono)
	culled_label.size = Vector2(330, 18)
	reference_label = _label(panel, "REFERENCE 0 FALSE CULLS", Vector2(22, 174), 13, Color(0.34, 0.95, 0.65), mono)
	reference_label.size = Vector2(330, 20)
	reference_meta = _label(panel, "slow per-vertex sweep waiting...", Vector2(22, 198), 11, Color(0.45, 0.61, 0.66), mono)
	reference_meta.size = Vector2(330, 36)
	reference_meta.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART


func _build_cost_panel(root: Control) -> void:
	var panel := _panel_anchored(root, Vector2(0, 1), Vector2(32, -278), Vector2(400, -28))
	_label(panel, "ANIMATION PARAMETER UPDATE", Vector2(20, 14), 11, Color(0.42, 0.73, 0.77), mono)
	var rows := [
		"CPU pose + animated bounds",
		"Frustum cull",
		"Instance transform packing",
		"Palette byte packing",
		"Bone texture upload",
	]
	for i in rows.size():
		var name := _label(panel, rows[i], Vector2(20, 38 + i * 26), 11, Color(0.57, 0.69, 0.73), mono)
		name.size = Vector2(250, 18)
		var value := _label(panel, "0.00 ms", Vector2(270, 38 + i * 26), 11, Color(0.88, 0.94, 0.96), mono)
		value.size = Vector2(95, 18)
		value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		cost_labels.append(value)
	var line := ColorRect.new()
	line.color = Color(0.15, 0.30, 0.34)
	line.position = Vector2(20, 174)
	line.size = Vector2(346, 1)
	panel.add_child(line)
	_label(panel, "TOTAL / FRAME", Vector2(20, 185), 11, Color(0.58, 0.76, 0.78), mono)
	total_cost_label = _label(panel, "0.00 ms", Vector2(252, 180), 18, Color(0.98, 0.65, 0.30), mono)
	total_cost_label.size = Vector2(112, 25)
	total_cost_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	palette_meta = _label(panel, "12 bones  /  4x0 RGBA32F", Vector2(20, 218), 10, Color(0.37, 0.53, 0.58), mono)
	palette_meta.size = Vector2(345, 18)


func _build_legend_panel(root: Control) -> void:
	var panel := _panel_anchored(root, Vector2(1, 1), Vector2(-404, -238), Vector2(-32, -28))
	_label(panel, "ANIMATED BOUNDS", Vector2(20, 14), 11, Color(0.42, 0.73, 0.77), mono)
	_label(panel, "orange   long-prop guard", Vector2(20, 39), 11, Color(1.0, 0.56, 0.18), mono)
	_label(panel, "cyan     window-edge walker", Vector2(20, 60), 11, Color(0.22, 0.88, 0.96), mono)
	_label(panel, "teal     distant gather", Vector2(20, 81), 11, Color(0.30, 0.90, 0.78), mono)
	_label(panel, "red      culled candidate", Vector2(20, 102), 11, Color(1.0, 0.27, 0.20), mono)
	var line := ColorRect.new()
	line.color = Color(0.15, 0.30, 0.34)
	line.position = Vector2(20, 127)
	line.size = Vector2(338, 1)
	panel.add_child(line)
	_label(panel, "SPACE pause   B bounds   R reference   C sweep   F12 png", Vector2(20, 141), 10, Color(0.57, 0.69, 0.73), mono)
	_label(panel, "GPU: 1 MultiMesh draw, vertex-shader skinning", Vector2(20, 163), 10, Color(0.37, 0.58, 0.62), mono)


func _build_clock(root: Control) -> void:
	clock_label = _label(root, "T+00.0s  /  GPU BONE PALETTE", Vector2(600, 878 - 20), 10, Color(0.38, 0.55, 0.60), mono)
	clock_label.position = Vector2(32, 878)
	clock_label.size = Vector2(360, 16)


func _panel(root: Control, position: Vector2, size: Vector2) -> Panel:
	var panel := Panel.new()
	panel.position = position
	panel.size = size
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_theme_stylebox_override("panel", _panel_style())
	root.add_child(panel)
	return panel


func _panel_anchored(
	root: Control,
	anchor: Vector2,
	top_left_offset: Vector2,
	bottom_right_offset: Vector2
) -> Panel:
	var panel := Panel.new()
	panel.anchor_left = anchor.x
	panel.anchor_right = anchor.x
	panel.anchor_top = anchor.y
	panel.anchor_bottom = anchor.y
	panel.offset_left = top_left_offset.x
	panel.offset_top = top_left_offset.y
	panel.offset_right = bottom_right_offset.x
	panel.offset_bottom = bottom_right_offset.y
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_theme_stylebox_override("panel", _panel_style())
	root.add_child(panel)
	return panel


func _panel_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.015, 0.030, 0.045, 0.88)
	style.border_color = Color(0.12, 0.34, 0.38, 0.72)
	style.set_border_width_all(1)
	style.corner_radius_top_left = 3
	style.corner_radius_top_right = 3
	style.corner_radius_bottom_left = 3
	style.corner_radius_bottom_right = 3
	return style


func _label(
	parent: Node,
	text: String,
	position: Vector2,
	font_size: int,
	color: Color,
	font: Font
) -> Label:
	var label := Label.new()
	label.text = text
	label.position = position
	label.add_theme_font_override("font", font)
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label


func update_metrics(metrics: Dictionary) -> void:
	var total: int = metrics.total
	var visible: int = metrics.visible
	var ratio := float(visible) / float(maxi(total, 1))
	var culled := total - visible
	pass_label.text = "%.1f%%" % (ratio * 100.0)
	visible_label.text = "%d / %d actors rendered" % [visible, total]
	culled_label.text = "CULLED %d  /  RATE %.1f%%" % [culled, (1.0 - ratio) * 100.0]
	bar_fill.size = Vector2(maxf(8.0, 326.0 * ratio), 7)
	var roles: Dictionary = metrics.roles
	var counts := [
		[roles.prop_visible, roles.prop_total],
		[roles.edge_visible, roles.edge_total],
		[roles.crowd_visible, roles.crowd_total],
	]
	for i in 3:
		role_labels[i].text = "%d / %d" % counts[i]
	var costs := [metrics.pose_ms, metrics.cull_ms, metrics.pack_ms, metrics.palette_ms, metrics.upload_ms]
	for i in 5:
		cost_labels[i].text = "%.2f ms" % costs[i]
	var total_cost: float = (
		metrics.pose_ms + metrics.cull_ms + metrics.pack_ms
		+ metrics.palette_ms + metrics.upload_ms
	)
	total_cost_label.text = "%.2f ms" % total_cost
	palette_meta.text = "12 bones  /  4x%d RGBA32F  /  %.2f MiB" % [
		visible * 12,
		4.0 * visible * 12.0 * 16.0 / 1048576.0,
	]
	var reference: Dictionary = metrics.reference
	var false_culls: int = reference.false_culls
	reference_label.text = "REFERENCE %d FALSE CULLS" % false_culls
	reference_label.add_theme_color_override(
		"font_color",
		Color(0.34, 0.95, 0.65) if false_culls == 0 else Color(1.0, 0.30, 0.22)
	)
	reference_meta.text = "%d actors / %d vertex budget per sweep\nbatch %.1f ms  ·  18-frame full sweep" % [
		reference.actors,
		reference.vertices,
		reference.time_ms,
	]
	status_label.text = "PAUSED" if metrics.paused else "LIVE"
	status_label.add_theme_color_override(
		"font_color",
		Color(0.98, 0.62, 0.25) if metrics.paused else Color(0.34, 0.95, 0.65)
	)
	clock_label.text = "T+%05.1fs  /  %d GPU-SKINNED VERTICES  /  %d FPS  /  BOUNDS %s  /  SWEEP %s" % [
		metrics.elapsed,
		metrics.gpu_vertices,
		Engine.get_frames_per_second(),
		"ON" if metrics.bounds else "OFF",
		"ON" if metrics.sweep else "OFF",
	]
