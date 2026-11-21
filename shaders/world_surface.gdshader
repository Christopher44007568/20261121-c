shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

#include "res://shaders/clip_plane.gdshaderinc"

uniform vec4 surface_color : source_color = vec4(0.8, 0.8, 0.8, 1.0);
uniform float roughness : hint_range(0.0, 1.0) = 0.62;
uniform float metallic : hint_range(0.0, 1.0) = 0.0;
uniform vec3 emission_color : source_color = vec3(0.0);
uniform float emission_energy = 0.0;

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
	ALBEDO = surface_color.rgb;
	ROUGHNESS = roughness;
	METALLIC = metallic;
	EMISSION = emission_color * emission_energy;
}
