shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque;

uniform vec3 base_color : source_color = vec3(0.018, 0.034, 0.052);
uniform vec3 grid_color : source_color = vec3(0.10, 0.35, 0.43);
uniform vec3 stage_color : source_color = vec3(0.95, 0.42, 0.15);
uniform vec3 fog_color : source_color = vec3(0.010, 0.016, 0.030);

varying vec3 v_world;


void vertex() {
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}


void fragment() {
	vec2 p = v_world.xz;
	vec2 cell = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(0.0001));
	float grid = 1.0 - min(min(cell.x, cell.y), 1.0);
	vec2 cell5 = abs(fract(p / 5.0 - 0.5) - 0.5) / max(fwidth(p / 5.0), vec2(0.0001));
	float grid5 = 1.0 - min(min(cell5.x, cell5.y), 1.0);

	vec2 stage_center = vec2(-6.5, 0.2);
	float stage_r = length(p - stage_center);
	float ring_a = smoothstep(0.08, 0.0, abs(stage_r - 9.0));
	float ring_b = smoothstep(0.12, 0.0, abs(stage_r - 12.5));
	float stage_glow = smoothstep(14.0, 0.0, stage_r);

	vec3 color = base_color;
	color += grid_color * grid * 0.22;
	color += grid_color * grid5 * 0.36;
	color += stage_color * (ring_a * 0.36 + ring_b * 0.14);
	color += vec3(0.12, 0.20, 0.24) * stage_glow * 0.35;
	float distance_fade = smoothstep(18.0, 70.0, length(p));
	color = mix(color, fog_color, distance_fade * 0.86);
	ALBEDO = color;
}
