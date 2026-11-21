class_name NormalPrefilter
extends RefCounted

const BASE_SIZE := 512
const MIP_LEVELS := 9
const CELLS_PER_TILE := 16
const VARIANCE_ENCODE_SCALE := 4.0

const ROUGHNESS_BASE := 0.16
const ROUGHNESS_MIP_GAIN := 0.40
const ROUGHNESS_VARIANCE_GAIN := 0.50
const ROUGHNESS_MAX := 0.87
const STEP_COUNT := 7

var base_normal: Image
var mip_images: Array[Image] = []
var mip_textures: Array[ImageTexture] = []
var mean_variances: PackedFloat32Array = []
var max_variances: PackedFloat32Array = []
var build_seconds := 0.0


func build(size: int = BASE_SIZE, levels: int = MIP_LEVELS) -> void:
	var started := Time.get_ticks_msec()
	base_normal = _make_base_normal(size)
	mip_images.clear()
	mip_textures.clear()
	mean_variances.clear()
	max_variances.clear()

	mip_images.append(base_normal)
	for level in range(1, levels):
		mip_images.append(_downsample_normal(mip_images[level - 1], level))

	for image in mip_images:
		mip_textures.append(ImageTexture.create_from_image(image))
		var summary := _variance_summary(image)
		mean_variances.append(summary.x)
		max_variances.append(summary.y)

	build_seconds = float(Time.get_ticks_msec() - started) / 1000.0
	print("[normal_prefilter] %d^2, %d levels, %.0f ms" % [
		size, levels, build_seconds * 1000.0
	])
	for level in range(levels):
		print("  LOD %d  %4d^2  mean_var=%.4f  max_var=%.4f  r=%.3f" % [
			level,
			mip_images[level].get_width(),
			mean_variances[level],
			max_variances[level],
			roughness_for(level, mean_variances[level])
		])


func _make_base_normal(size: int) -> Image:
	var image := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var inv_size := 1.0 / float(size)
	for y in range(size):
		var v := (float(y) + 0.5) * inv_size
		for x in range(size):
			var u := (float(x) + 0.5) * inv_size
			var h_left := _micro_height(u - inv_size, v)
			var h_right := _micro_height(u + inv_size, v)
			var h_down := _micro_height(u, v - inv_size)
			var h_up := _micro_height(u, v + inv_size)
			var dhdx := (h_right - h_left) / (2.0 * inv_size) * 0.025
			var dhdy := (h_up - h_down) / (2.0 * inv_size) * 0.025
			var normal := Vector3(-dhdx, -dhdy, 1.0).normalized()
			var local_variance := clampf(
				(normal.x * normal.x + normal.y * normal.y) * 1.15,
				0.0,
				1.0
			)
			image.set_pixel(x, y, _encode_normal(normal, local_variance))
	return image


func _micro_height(u: float, v: float) -> float:
	var p := Vector2(
		fposmod(u * float(CELLS_PER_TILE), 1.0),
		fposmod(v * float(CELLS_PER_TILE), 1.0)
	)
	var q := (p - Vector2(0.5, 0.5)).abs()
	var square_distance := maxf(q.x, q.y) * 2.0
	var pad := 1.0 - smoothstep(0.72, 0.98, square_distance)
	var bevel := smoothstep(0.38, 0.78, square_distance)
	var table := (0.52 - 0.25 * bevel) * pad
	var center_cross := 0.026 * pad * (
		exp(-pow((q.x - 0.5) * 22.0, 2.0))
		+ exp(-pow((q.y - 0.5) * 22.0, 2.0))
	)
	var brushed := 0.010 * sin(v * TAU * 96.0) * pad
	return table + center_cross + brushed


func _downsample_normal(source: Image, level: int) -> Image:
	var source_size := source.get_width()
	var target_size := maxi(source_size / 2, 1)
	var target := Image.create(target_size, target_size, false, Image.FORMAT_RGBA8)
	for y in range(target_size):
		var sy := mini(y * 2, source_size - 1)
		for x in range(target_size):
			var sx := mini(x * 2, source_size - 1)
			var samples: Array[Vector4] = []
			for oy in range(2):
				for ox in range(2):
					var px := mini(sx + ox, source_size - 1)
					var py := mini(sy + oy, source_size - 1)
					samples.append(_decode_normal(source.get_pixel(px, py)))

			var mean := Vector3.ZERO
			var inherited_variance := 0.0
			for sample in samples:
				mean += Vector3(sample.x, sample.y, sample.z)
				inherited_variance += sample.w
			mean = mean.normalized()
			inherited_variance *= 0.25

			var spread := 0.0
			for sample in samples:
				spread += maxf(0.0, 1.0 - mean.dot(Vector3(sample.x, sample.y, sample.z)))
			spread *= 0.25
			var variance := clampf(inherited_variance + spread, 0.0, 1.0)
			target.set_pixel(x, y, _encode_normal(mean, variance))
	return target


func _encode_normal(normal: Vector3, variance: float) -> Color:
	return Color(
		normal.x * 0.5 + 0.5,
		normal.y * 0.5 + 0.5,
		normal.z * 0.5 + 0.5,
		clampf(variance * VARIANCE_ENCODE_SCALE, 0.0, 1.0)
	)


func _decode_normal(color: Color) -> Vector4:
	var normal := Vector3(
		color.r * 2.0 - 1.0,
		color.g * 2.0 - 1.0,
		color.b * 2.0 - 1.0
	).normalized()
	return Vector4(normal.x, normal.y, normal.z, color.a / VARIANCE_ENCODE_SCALE)


func _variance_summary(image: Image) -> Vector2:
	var total := 0.0
	var maximum := 0.0
	var size := image.get_width()
	for y in range(size):
		for x in range(size):
			var variance := image.get_pixel(x, y).a / VARIANCE_ENCODE_SCALE
			total += variance
			maximum = maxf(maximum, variance)
	return Vector2(total / float(size * size), maximum)


func roughness_for(level: int, variance: float) -> float:
	var mip_t := float(level) / float(maxi(MIP_LEVELS - 1, 1))
	return clampf(
		ROUGHNESS_BASE
			+ ROUGHNESS_MIP_GAIN * mip_t
			+ ROUGHNESS_VARIANCE_GAIN * variance,
		0.0,
		ROUGHNESS_MAX
	)


func stepped_roughness_for(level: int, variance: float) -> float:
	var continuous := roughness_for(level, 0.0)
	var normalized := (continuous - ROUGHNESS_BASE) / (ROUGHNESS_MAX - ROUGHNESS_BASE)
	var steps := float(STEP_COUNT - 1)
	var quantized: float = round(clampf(normalized, 0.0, 1.0) * steps) / steps
	return lerpf(ROUGHNESS_BASE, ROUGHNESS_MAX, quantized)


func save_debug_images(output_dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(output_dir)
	base_normal.save_png(output_dir.path_join("normal_base.png"))
	for level in range(mip_images.size()):
		var image := mip_images[level]
		image.save_png(output_dir.path_join("mip_%02d.png" % level))


func summary(step_count: int = STEP_COUNT) -> Dictionary:
	var table: Array[Dictionary] = []
	for level in range(mip_images.size()):
		var mean_variance := mean_variances[level]
		var continuous := roughness_for(level, mean_variance)
		var stepped := stepped_roughness_for(level, mean_variance)
		table.append({
			"level": level,
			"size": mip_images[level].get_width(),
			"mean_normal_variance": mean_variance,
			"max_normal_variance": max_variances[level],
			"prefiltered_roughness": continuous,
			"stepped_roughness": stepped,
		})

	var max_jump := 0.0
	var jump_total := 0.0
	var jumps := 0
	for level in range(1, table.size()):
		var jump: float = absf(
			float(table[level]["stepped_roughness"])
			- float(table[level - 1]["stepped_roughness"])
		)
		max_jump = maxf(max_jump, jump)
		jump_total += jump
		jumps += 1

	return {
		"texture_size": base_normal.get_width(),
		"mip_levels": mip_images.size(),
		"cells_per_tile": CELLS_PER_TILE,
		"variance_encode_scale": VARIANCE_ENCODE_SCALE,
		"roughness_model": {
			"base": ROUGHNESS_BASE,
			"mip_gain": ROUGHNESS_MIP_GAIN,
			"variance_gain": ROUGHNESS_VARIANCE_GAIN,
			"max": ROUGHNESS_MAX,
			"step_count": step_count,
			"max_step_jump": max_jump,
			"mean_step_jump": jump_total / float(maxi(jumps, 1)),
		},
		"table": table,
	}
