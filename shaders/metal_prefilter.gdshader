shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, cull_back, depth_draw_opaque;

uniform sampler2D normal_mip0 : filter_linear, repeat_enable;
uniform sampler2D normal_mip1 : filter_linear, repeat_enable;
uniform sampler2D normal_mip2 : filter_linear, repeat_enable;
uniform sampler2D normal_mip3 : filter_linear, repeat_enable;
uniform sampler2D normal_mip4 : filter_linear, repeat_enable;
uniform sampler2D normal_mip5 : filter_linear, repeat_enable;
uniform sampler2D normal_mip6 : filter_linear, repeat_enable;
uniform sampler2D normal_mip7 : filter_linear, repeat_enable;
uniform sampler2D normal_mip8 : filter_linear, repeat_enable;

uniform vec2 texture_tiles = vec2(12.0, 104.0);
uniform float texture_size = 512.0;
uniform float max_lod = 8.0;

// 0 = raw LOD0 + fixed roughness
// 1 = prefiltered normal + continuous mip/variance roughness
// 2 = prefiltered normal + quantized roughness ladder
uniform int filter_mode = 0;
uniform float base_roughness = 0.16;
uniform float mip_gain = 0.40;
uniform float variance_gain = 0.50;
uniform float roughness_max = 0.87;
uniform float variance_encode_scale = 2.0;
uniform float step_count = 7.0;

uniform vec3 base_color : source_color = vec3(0.46, 0.52, 0.60);
uniform float exposure_gain = 1.0;
uniform float normal_strength = 1.0;


vec4 sample_mip(vec2 uv, float lod) {
	if (lod < 0.5) {
		return textureLod(normal_mip0, uv, 0.0);
	} else if (lod < 1.5) {
		return textureLod(normal_mip1, uv, 0.0);
	} else if (lod < 2.5) {
		return textureLod(normal_mip2, uv, 0.0);
	} else if (lod < 3.5) {
		return textureLod(normal_mip3, uv, 0.0);
	} else if (lod < 4.5) {
		return textureLod(normal_mip4, uv, 0.0);
	} else if (lod < 5.5) {
		return textureLod(normal_mip5, uv, 0.0);
	} else if (lod < 6.5) {
		return textureLod(normal_mip6, uv, 0.0);
	} else if (lod < 7.5) {
		return textureLod(normal_mip7, uv, 0.0);
	}
	return textureLod(normal_mip8, uv, 0.0);
}


vec3 decode_normal(vec4 encoded) {
	return normalize(encoded.xyz * 2.0 - 1.0);
}


void fragment() {
	vec2 tile_uv = UV * texture_tiles;
	vec2 footprint_uv = vec2(
		length(dFdx(tile_uv)),
		length(dFdy(tile_uv))
	);
	float exact_lod = log2(max(footprint_uv.x, footprint_uv.y) * texture_size);
	float lod = clamp(exact_lod, 0.0, max_lod);

	vec4 center_sample;
	vec3 center_normal;
	float local_variance = 0.0;

	if (filter_mode == 0) {
		lod = 0.0;
		center_sample = sample_mip(tile_uv, 0.0);
		center_normal = decode_normal(center_sample);
	} else {
		float lod0 = floor(lod);
		float lod1 = min(lod0 + 1.0, max_lod);
		float blend = fract(lod);
		vec4 sample0 = sample_mip(tile_uv, lod0);
		vec4 sample1 = sample_mip(tile_uv, lod1);
		center_sample = mix(sample0, sample1, blend);
		center_normal = normalize(mix(
			decode_normal(sample0),
			decode_normal(sample1),
			blend
		));

		float tap_step = exp2(lod) / texture_size;
		vec3 normal_x = decode_normal(sample_mip(tile_uv + vec2(tap_step, 0.0), lod0));
		vec3 normal_y = decode_normal(sample_mip(tile_uv + vec2(0.0, tap_step), lod0));
		vec3 normal_xy = decode_normal(sample_mip(tile_uv + vec2(tap_step, tap_step), lod0));
		float resolved_variance = (
			max(0.0, 1.0 - dot(center_normal, normal_x))
			+ max(0.0, 1.0 - dot(center_normal, normal_y))
			+ max(0.0, 1.0 - dot(center_normal, normal_xy))
		) / 3.0;
		float stored_variance = center_sample.a / variance_encode_scale;
		local_variance = mix(
			stored_variance,
			clamp(resolved_variance * 5.0, 0.0, 1.0),
			0.55
		);
	}

	float lod_t = lod / max(max_lod, 1.0);
	float roughness = base_roughness
		+ mip_gain * lod_t
		+ variance_gain * local_variance;
	roughness = clamp(roughness, base_roughness, roughness_max);

	if (filter_mode == 0) {
		roughness = base_roughness;
	} else if (filter_mode == 2) {
		float static_roughness = base_roughness + mip_gain * lod_t;
		float divisions = max(step_count - 1.0, 1.0);
		float normalized = (static_roughness - base_roughness) / (roughness_max - base_roughness);
		roughness = mix(
			base_roughness,
			roughness_max,
			round(clamp(normalized, 0.0, 1.0) * divisions) / divisions
		);
	}

	float macro = 0.5 + 0.5 * sin(UV.x * 39.0 + sin(UV.y * 17.0) * 1.8);
	float edge_darkening = smoothstep(0.0, 0.04, min(UV.x, 1.0 - UV.x));
	ALBEDO = base_color * exposure_gain * (0.92 + 0.08 * macro) * (0.82 + 0.18 * edge_darkening);
	METALLIC = 0.94;
	ROUGHNESS = roughness;
	SPECULAR = 0.52;

	vec3 tangent_normal = normalize(mix(vec3(0.0, 0.0, 1.0), center_normal, normal_strength));
	NORMAL_MAP = tangent_normal * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 1.0;
}
