shader_type spatial;
render_mode unshaded, cull_back, depth_draw_opaque;

uniform sampler2D bone_texture : filter_nearest, repeat_disable;
uniform vec2 palette_size = vec2(4.0, 4320.0);
uniform vec3 fog_color = vec3(0.012, 0.018, 0.035);

varying vec3 v_tint;
varying vec3 v_world_pos;
varying vec3 v_world_normal;
varying float v_role;
varying float v_part;


void vertex() {
	int bone = int(UV2.x + 0.5);
	int base_row = int(INSTANCE_CUSTOM.x + 0.5) + bone;
	float row_y = (float(base_row) + 0.5) / palette_size.y;
	float texel = 1.0 / palette_size.x;
	vec4 c0 = texture(bone_texture, vec2(0.5 * texel, row_y));
	vec4 c1 = texture(bone_texture, vec2(1.5 * texel, row_y));
	vec4 c2 = texture(bone_texture, vec2(2.5 * texel, row_y));
	vec4 c3 = texture(bone_texture, vec2(3.5 * texel, row_y));
	mat4 bone_matrix = mat4(c0, c1, c2, c3);

	vec3 skinned = (bone_matrix * vec4(VERTEX, 1.0)).xyz;
	vec3 normal = normalize(mat3(bone_matrix) * NORMAL);
	VERTEX = skinned;
	NORMAL = normal;
	v_world_pos = (MODEL_MATRIX * vec4(skinned, 1.0)).xyz;
	v_world_normal = normalize((MODEL_MATRIX * vec4(normal, 0.0)).xyz);

	v_role = INSTANCE_CUSTOM.y;
	v_part = UV2.y;
	vec3 tint = vec3(0.36, 0.55, 0.82);
	if (v_part > 0.5 && v_part < 1.5) {
		tint = vec3(1.0, 0.47, 0.09);
	} else if (v_part > 1.5 && v_part < 2.5) {
		tint = vec3(0.78, 0.56, 0.42);
	} else if (v_part > 2.5 && v_part < 3.5) {
		tint = vec3(0.13, 0.24, 0.40);
	} else if (v_part > 3.5) {
		tint = vec3(0.92, 0.40, 0.09);
	}
	if (v_role > 0.5 && v_role < 1.5) {
		tint = mix(tint, vec3(0.95, 0.44, 0.14), 0.12);
	} else if (v_role > 1.5) {
		tint = mix(tint, vec3(0.20, 0.82, 0.82), 0.16);
	}
	float cosmetic = INSTANCE_CUSTOM.z;
	tint *= mix(vec3(0.82, 0.92, 1.04), vec3(1.04, 0.92, 0.80), cosmetic);
	v_tint = tint;
}


void fragment() {
	vec3 normal = normalize(v_world_normal);
	vec3 view_dir = normalize(CAMERA_POSITION_WORLD - v_world_pos);
	vec3 key_dir = normalize(vec3(-0.42, 0.82, 0.38));
	float key = max(dot(normal, key_dir), 0.0);
	float rim = pow(1.0 - max(dot(normal, view_dir), 0.0), 2.0);
	vec3 color = v_tint * (0.60 + 0.38 * key);
	color += v_tint * rim * 0.22;
	if (v_part > 0.5) {
		color += vec3(1.0, 0.48, 0.08) * 0.42;
	}
	float camera_distance = distance(CAMERA_POSITION_WORLD, v_world_pos);
	color = mix(color, fog_color, smoothstep(34.0, 86.0, camera_distance) * 0.66);
	ALBEDO = color;
	EMISSION = color * 0.035;
	ROUGHNESS = 0.82;
}
