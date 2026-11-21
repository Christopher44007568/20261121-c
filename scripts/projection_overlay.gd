extends Control

var entries: Array = []
var title := ""


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


func _draw() -> void:
	var font := ThemeDB.fallback_font
	if not title.is_empty():
		var title_rect := Rect2(28, size.y - 166, 515, 30)
		draw_rect(title_rect, Color(0.004, 0.012, 0.02, 0.9), true)
		draw_string(font, Vector2(42, size.y - 146), title,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(0.6, 0.95, 0.86))
	for entry in entries:
		var pixel: Vector2 = entry.pixel
		var color: Color = entry.color
		var label: String = entry.label
		draw_arc(pixel, 8.0, 0.0, TAU, 28, color, 1.6, true)
		draw_line(pixel - Vector2(13, 0), pixel + Vector2(13, 0), color, 1.2, true)
		draw_line(pixel - Vector2(0, 13), pixel + Vector2(0, 13), color, 1.2, true)
		var text_pos := pixel + Vector2(14, -9)
		var text_size := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11)
		draw_rect(Rect2(text_pos - Vector2(3, 11), text_size + Vector2(7, 5)),
			Color(0.003, 0.009, 0.016, 0.86), true)
		draw_string(font, text_pos, label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, color)
