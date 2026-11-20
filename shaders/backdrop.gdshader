shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque;

varying vec2 v_uv;


void vertex() {
	v_uv = UV;
}


void fragment() {
	float horizon = smoothstep(0.0, 0.68, v_uv.y);
	vec3 bottom = vec3(0.007, 0.012, 0.024);
	vec3 top = vec3(0.020, 0.056, 0.095);
	vec3 color = mix(bottom, top, horizon);
	float glow = exp(-pow((v_uv.y - 0.31) * 9.0, 2.0));
	float side = 0.55 + 0.45 * smoothstep(0.1, 0.9, v_uv.x);
	color += vec3(0.05, 0.22, 0.27) * glow * side;
	float band = smoothstep(0.007, 0.0, abs(v_uv.y - 0.205));
	color += vec3(0.45, 0.23, 0.09) * band * 0.42;
	ALBEDO = color;
}
