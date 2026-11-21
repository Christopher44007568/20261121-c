extends Control

const PANEL_WIDTH := 426
const PANEL_GAP := 1
const HEADER_HEIGHT := 62
const VIEW_HEIGHT := 500
const CHART_TOP := 562
const CHART_BOTTOM := 720
const INK := Color(0.82, 0.87, 0.92)
const MUTED := Color(0.47, 0.55, 0.64)
const FAINT := Color(0.16, 0.22, 0.29)
const BG := Color(0.018, 0.027, 0.040)
const PANEL_COLORS := [
	Color(1.0, 0.40, 0.32),
	Color(0.31, 0.89, 0.91),
	Color(1.0, 0.67, 0.26),
]

var codes: Array = ["A", "B", "C"]
var titles: Array = ["RAW NORMAL", "PREFILTERED", "MIP-STEP ROUGHNESS"]
var subtitles: Array = [
	"LOD 0 only / fixed roughness",
	"filtered normal / mip + local variance",
	"filtered normal / 7 static steps",
]
var summary: Dictionary = {}
var exposure_gains: Dictionary = {}
var live_time := 0.0
var live_lod := 0.0
var live_continuous := 0.16
var live_stepped := 0.16
var font: Font


func _ready() -> void:
	font = ThemeDB.fallback_font
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	queue_redraw()


func configure(mip_summary: Dictionary, gains: Dictionary) -> void:
	summary = mip_summary
	exposure_gains = gains
	queue_redraw()


func configure_title(panel_codes: Array, panel_titles: Array, panel_subtitles: Array) -> void:
	codes = panel_codes
	titles = panel_titles
	subtitles = panel_subtitles
	queue_redraw()


func update_state(time_seconds: float, lod: float, continuous: float, stepped: float) -> void:
	live_time = time_seconds
	live_lod = lod
	live_continuous = continuous
	live_stepped = stepped
	queue_redraw()


func _draw() -> void:
	_draw_header()
	_draw_chart()


func _draw_header() -> void:
	draw_rect(Rect2(0, 0, 1280, HEADER_HEIGHT), Color(BG, 0.98), true)
	draw_line(Vector2(0, HEADER_HEIGHT - 1), Vector2(1280, HEADER_HEIGHT - 1), FAINT, 1.0)

	for panel_index in range(3):
		var x := panel_index * (PANEL_WIDTH + PANEL_GAP)
		var color: Color = PANEL_COLORS[panel_index]
		draw_rect(Rect2(x, 0, 3, HEADER_HEIGHT), color, true)
		draw_rect(Rect2(x, HEADER_HEIGHT - 2, PANEL_WIDTH, 2), Color(color, 0.70), true)
		_text(str(codes[panel_index]), Vector2(x + 16, 32), 24, color)
		_text(str(titles[panel_index]), Vector2(x + 48, 27), 16, INK)
		_text(str(subtitles[panel_index]), Vector2(x + 48, 47), 10, MUTED)
		if panel_index < 2:
			draw_line(
				Vector2(x + PANEL_WIDTH, 7),
				Vector2(x + PANEL_WIDTH, HEADER_HEIGHT - 7),
				Color(0.30, 0.37, 0.44),
				1.0
			)
	_text("NORMAL PREFILTER LAB", Vector2(1090, 21), 10, MUTED)
	_text("NEAR -> FAR  /  14s", Vector2(1090, 39), 9, MUTED)


func _draw_chart() -> void:
	draw_rect(
		Rect2(0, CHART_TOP, 1280, CHART_BOTTOM - CHART_TOP),
		Color(0.014, 0.022, 0.033, 0.98),
		true
	)
	draw_line(Vector2(0, CHART_TOP), Vector2(1280, CHART_TOP), Color(0.20, 0.28, 0.36), 1.0)

	_text("ROUGHNESS RESPONSE", Vector2(20, CHART_TOP + 25), 15, INK)
	_text(
		"R = base + mip_gain * LOD + variance_gain * local normal variance",
		Vector2(20, CHART_TOP + 44),
		10,
		MUTED
	)

	var plot := Rect2(92, CHART_TOP + 50, 1150, 60)
	_draw_grid(plot)
	_draw_curves(plot)
	_draw_live_marker(plot)
	_draw_legend()
	_draw_footer()


func _draw_grid(plot: Rect2) -> void:
	for tick in range(5):
		var value := float(tick) / 4.0
		var y := plot.end.y - value * plot.size.y
		draw_line(
			Vector2(plot.position.x, y),
			Vector2(plot.end.x, y),
			Color(FAINT, 0.65),
			1.0
		)
		_text("%.2f" % value, Vector2(53, y + 4), 9, MUTED)

	for lod in range(9):
		var x := plot.position.x + float(lod) / 8.0 * plot.size.x
		draw_line(
			Vector2(x, plot.position.y),
			Vector2(x, plot.end.y),
			Color(FAINT, 0.38),
			1.0
		)
		if lod % 2 == 0:
			_text(str(lod), Vector2(x - 3, plot.end.y + 14), 9, MUTED)
	_text("MIP LEVEL", Vector2(plot.end.x - 58, plot.end.y + 28), 9, MUTED)


func _draw_curves(plot: Rect2) -> void:
	var table: Array = summary.get("table", [])
	if table.is_empty():
		return

	var a_points := PackedVector2Array()
	var b_points := PackedVector2Array()
	for row in table:
		var level := float(row["level"])
		var x := _chart_x(plot, level)
		a_points.append(Vector2(x, _chart_y(plot, float(row["prefiltered_roughness"]) * 0.0 + float(summary["roughness_model"]["base"]))))
		b_points.append(Vector2(x, _chart_y(plot, float(row["prefiltered_roughness"]))))
	draw_polyline(a_points, Color(PANEL_COLORS[0], 0.95), 2.0, true)
	draw_polyline(b_points, Color(PANEL_COLORS[1], 0.98), 2.4, true)

	var c_points := PackedVector2Array()
	for row_index in range(table.size()):
		var row: Dictionary = table[row_index]
		var x := _chart_x(plot, float(row["level"]))
		var y := _chart_y(plot, float(row["stepped_roughness"]))
		if row_index == 0:
			c_points.append(Vector2(x, y))
		else:
			c_points.append(Vector2(x, c_points[c_points.size() - 1].y))
			c_points.append(Vector2(x, y))
	draw_polyline(c_points, Color(PANEL_COLORS[2], 0.98), 2.2, true)

	draw_circle(b_points[b_points.size() - 1], 3.0, PANEL_COLORS[1])
	draw_circle(c_points[c_points.size() - 1], 3.0, PANEL_COLORS[2])


func _draw_live_marker(plot: Rect2) -> void:
	var x := _chart_x(plot, live_lod)
	var dash := 5.0
	var y := plot.position.y
	while y < plot.end.y:
		draw_line(
			Vector2(x, y),
			Vector2(x, minf(y + dash, plot.end.y)),
			Color(0.83, 0.89, 0.94, 0.65),
			1.0
		)
		y += dash * 2.0
	draw_circle(Vector2(x, _chart_y(plot, live_continuous)), 3.5, PANEL_COLORS[1])
	draw_circle(Vector2(x, _chart_y(plot, live_stepped)), 3.5, PANEL_COLORS[2])
	draw_rect(
		Rect2(
			minf(x + 5.0, plot.end.x - 132.0),
			plot.position.y + 4.0,
			126.0,
			29.0
		),
		Color(0.014, 0.022, 0.033, 0.88),
		true
	)
	_text(
		"LIVE LOD %.2f" % live_lod,
		Vector2(minf(x + 7.0, plot.end.x - 95.0), plot.position.y + 13),
		10,
		Color(0.78, 0.86, 0.92)
	)
	_text(
		"rB %.3f   rC %.3f" % [live_continuous, live_stepped],
		Vector2(minf(x + 7.0, plot.end.x - 125.0), plot.position.y + 28),
		9,
		MUTED
	)


func _draw_legend() -> void:
	var x := 414.0
	var y := CHART_TOP + 18.0
	var labels := [
		"A  fixed 0.16",
		"B  mip + variance",
		"C  7 static steps",
	]
	for index in range(3):
		var color: Color = PANEL_COLORS[index]
		draw_line(Vector2(x, y + 22), Vector2(x + 18, y + 22), color, 3.0)
		_text(labels[index], Vector2(x, y + 8), 10, INK)
		x += 148.0
	_text(
		"STEP LIMIT  %.2f   /   %d LEVELS" % [
			float(summary.get("roughness_model", {}).get("max_step_jump", 0.0)),
			int(summary.get("roughness_model", {}).get("step_count", 7)),
		],
		Vector2(844, y + 8),
		9,
		MUTED
	)


func _draw_footer() -> void:
	var progress := clampf(live_time / 14.0, 0.0, 1.0)
	var x0 := 20.0
	var x1 := 1260.0
	var y := 716.0
	draw_line(Vector2(x0, y), Vector2(x1, y), Color(FAINT, 0.9), 2.0)
	draw_line(Vector2(x0, y), Vector2(lerpf(x0, x1, progress), y), Color(PANEL_COLORS[1], 0.9), 2.0)
	_text(
		"EXPOSURE LOCK  A %.3f  B %.3f  C %.3f  /  no per-frame auto exposure" % [
			float(exposure_gains.get("A", 1.0)),
			float(exposure_gains.get("B", 1.0)),
			float(exposure_gains.get("C", 1.0)),
		],
		Vector2(20, 708),
		9,
		MUTED
	)
	_text(
		"%.1fs / 14.0s   near" % live_time,
		Vector2(1056, 708),
		9,
		MUTED
	)


func _chart_x(plot: Rect2, lod: float) -> float:
	return plot.position.x + clampf(lod / 8.0, 0.0, 1.0) * plot.size.x


func _chart_y(plot: Rect2, roughness: float) -> float:
	return plot.end.y - clampf(roughness, 0.0, 1.0) * plot.size.y


func _text(text: String, position: Vector2, size: int, color: Color) -> void:
	draw_string(font, position, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)
