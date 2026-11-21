shader_type spatial;
render_mode unshaded, cull_disabled;

uniform vec3 backing_color : source_color = vec3(0.006, 0.008, 0.012);
uniform vec3 accent_color : source_color = vec3(0.05, 0.22, 0.18);

void fragment() {
	vec2 edge = min(UV, vec2(1.0) - UV);
	float border = 1.0 - smoothstep(0.0, 0.018, min(edge.x, edge.y));
	ALBEDO = mix(backing_color, accent_color, border * 0.8);
}
