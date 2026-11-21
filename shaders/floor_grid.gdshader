shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

#include "res://shaders/clip_plane.gdshaderinc"

uniform vec4 floor_color : source_color = vec4(0.08, 0.1, 0.13, 1.0);
uniform vec4 line_color : source_color = vec4(0.32, 0.65, 0.72, 1.0);
uniform float cell_size = 1.0;
uniform float line_width = 0.018;

varying vec3 world_position;
varying flat uint reflection_camera_layers;

void vertex() {
	reflection_camera_layers = CAMERA_VISIBLE_LAYERS;
	world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	if (planar_mirror_clip(world_position, reflection_camera_layers)) {
		discard;
	}
	vec2 grid = abs(fract(world_position.xz / cell_size - 0.5) - 0.5);
	float line = 1.0 - smoothstep(line_width, line_width * 2.5, min(grid.x, grid.y));
	float major = 1.0 - smoothstep(line_width, line_width * 2.0,
		min(abs(fract(world_position.x / 5.0) - 0.5),
			abs(fract(world_position.z / 5.0) - 0.5)));
	ALBEDO = mix(floor_color.rgb, line_color.rgb, line * 0.52 + major * 0.3);
	ROUGHNESS = 0.86;
	METALLIC = 0.05;
}
