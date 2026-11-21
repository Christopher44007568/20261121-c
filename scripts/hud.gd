extends Control

var demo: Node
var _font: Font
var _accent := Color(0.17, 0.94, 0.72)
var _ink := Color(0.78, 0.87, 0.9)
var _muted := Color(0.44, 0.56, 0.62)


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_font = ThemeDB.fallback_font
	queue_redraw()


func bind(owner_demo: Node) -> void:
	demo = owner_demo


func _process(_delta: float) -> void:
	queue_redraw()


func _draw() -> void:
	if demo == null:
		return
	var view := size
	_draw_title()
	_draw_status(view)
	_draw_buffer_panel(view, demo.mirror_a, "BUF A", 0)
	_draw_buffer_panel(view, demo.mirror_b, "BUF B", 1)
	_draw_footer(view)
	_draw_crosshair(view)


func _draw_title() -> void:
	var rect := Rect2(26, 22, 432, 76)
	draw_rect(rect, Color(0.006, 0.014, 0.024, 0.88), true)
	draw_rect(rect, Color(0.12, 0.3, 0.31, 0.72), false, 1.0)
	draw_rect(Rect2(26, 22, 4, 76), _accent, true)
	draw_string(_font, Vector2(45, 51), "PLANAR MIRROR LAB", HORIZONTAL_ALIGNMENT_LEFT,
		-1, 22, Color(0.91, 0.97, 1.0))
	draw_string(_font, Vector2(46, 72), "ONE-BOUNCE PARALLEL MIRRORS / GPU CLIP PLANE",
		HORIZONTAL_ALIGNMENT_LEFT, -1, 10, _accent)
	draw_string(_font, Vector2(46, 88), "480 x 270 reflection buffers  |  no camera collision",
		HORIZONTAL_ALIGNMENT_LEFT, -1, 10, _muted)


func _draw_status(view: Vector2) -> void:
	var rect := Rect2(26, 108, 432, 70)
	draw_rect(rect, Color(0.006, 0.014, 0.024, 0.8), true)
	draw_rect(rect, Color(0.1, 0.22, 0.24, 0.7), false, 1.0)
	var position: Vector3 = demo.main_camera.global_position
	draw_string(_font, Vector2(42, 131), "CAMERA  %+.3f  %+.3f  %+.3f" % [position.x, position.y, position.z],
		HORIZONTAL_ALIGNMENT_LEFT, -1, 12, _ink)
	draw_string(_font, Vector2(42, 151), "PATH    %s" % demo.current_pose_name,
		HORIZONTAL_ALIGNMENT_LEFT, -1, 12, _ink)
	var side_a: String = demo.mirror_a.camera_side().to_upper()
	var side_b: String = demo.mirror_b.camera_side().to_upper()
	draw_string(_font, Vector2(42, 170), "MIRROR A  %s     MIRROR B  %s     LAYERS  1 / 1" % [side_a, side_b],
		HORIZONTAL_ALIGNMENT_LEFT, -1, 11, _accent)


func _draw_buffer_panel(view: Vector2, mirror: Node, label: String, index: int) -> void:
	if mirror == null or mirror.viewport == null:
		return
	var panel_width := 254.0
	var image_width := 238.0
	var image_height := image_width * 9.0 / 16.0
	var x := view.x - panel_width - 26.0
	var y := 92.0 + index * (image_height + 50.0)
	var panel := Rect2(x, y, panel_width, image_height + 37.0)
	draw_rect(panel, Color(0.006, 0.014, 0.024, 0.9), true)
	draw_rect(panel, Color(0.1, 0.28, 0.28, 0.82), false, 1.0)
	draw_rect(Rect2(x, y, panel_width, 3), _accent, true)
	var title := "%s  %d x %d  |  1 BOUNCE" % [label, mirror.buffer_size.x, mirror.buffer_size.y]
	draw_string(_font, Vector2(x + 9, y + 17), title, HORIZONTAL_ALIGNMENT_LEFT, -1, 10, _ink)
	var image_rect := Rect2(x + 8, y + 25, image_width, image_height)
	draw_texture_rect(mirror.viewport.get_texture(), image_rect, false, Color.WHITE)
	draw_rect(image_rect, Color(0.16, 0.36, 0.35, 0.8), false, 1.0)


func _draw_footer(view: Vector2) -> void:
	var rect := Rect2(26, view.y - 92, 472, 66)
	draw_rect(rect, Color(0.006, 0.014, 0.024, 0.84), true)
	draw_rect(rect, Color(0.1, 0.24, 0.24, 0.7), false, 1.0)
	draw_string(_font, Vector2(42, view.y - 67), "WASD / QE  FLY     SHIFT  BOOST     MOUSE  LOOK",
		HORIZONTAL_ALIGNMENT_LEFT, -1, 11, _ink)
	draw_string(_font, Vector2(42, view.y - 49), "P  AUTO PATH     R  HOME     H  HUD     F  FREE",
		HORIZONTAL_ALIGNMENT_LEFT, -1, 11, _ink)
	draw_string(_font, Vector2(42, view.y - 34), "RED / GREEN  mirror-behind clip probes",
		HORIZONTAL_ALIGNMENT_LEFT, -1, 10, _muted)


func _draw_crosshair(view: Vector2) -> void:
	var center := view * 0.5
	draw_line(center - Vector2(9, 0), center - Vector2(3, 0), Color(0.6, 0.9, 0.88, 0.55), 1.0)
	draw_line(center + Vector2(3, 0), center + Vector2(9, 0), Color(0.6, 0.9, 0.88, 0.55), 1.0)
	draw_line(center - Vector2(0, 9), center - Vector2(0, 3), Color(0.6, 0.9, 0.88, 0.55), 1.0)
	draw_line(center + Vector2(0, 3), center + Vector2(0, 9), Color(0.6, 0.9, 0.88, 0.55), 1.0)
