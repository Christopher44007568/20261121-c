shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque;

uniform sampler2D reflection_tex : source_color, filter_linear, repeat_disable;
uniform float plane_x = -6.0;
uniform float facing_sign = 1.0;
uniform bool flip_horizontal = true;
uniform vec3 tint : source_color = vec3(0.88, 0.94, 1.0);
uniform vec3 backside_color : source_color = vec3(0.025, 0.035, 0.045);
uniform float reflection_energy = 1.0;

void fragment() {
	bool is_backside = (facing_sign > 0.0 && CAMERA_POSITION_WORLD.x < plane_x)
		|| (facing_sign < 0.0 && CAMERA_POSITION_WORLD.x > plane_x);

	if (is_backside) {
		ALBEDO = backside_color;
	} else {
		vec2 uv = SCREEN_UV;
		if (flip_horizontal) {
			uv.x = 1.0 - uv.x;
		}
		vec3 reflected = texture(reflection_tex, uv).rgb;
		float edge_falloff = smoothstep(0.0, 0.035, uv.x) * smoothstep(0.0, 0.035, 1.0 - uv.x);
		ALBEDO = reflected * tint * reflection_energy * mix(0.72, 1.0, edge_falloff);
	}
}
