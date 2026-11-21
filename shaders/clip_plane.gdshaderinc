// Shared reflection-plane clipping.
//
// Each reflection camera carries a private cull bit that is not assigned to
// any geometry. Materials can therefore reject fragments on the wrong side of
// the mirror without affecting the main camera:
//   bit 5 (32) -> mirror A reflection camera
//   bit 6 (64) -> mirror B reflection camera
//
// This is the fragment-stage equivalent of an oblique near-clip plane. It is
// used because Godot 4.2 does not expose Camera3D custom projection matrices.

const float MIRROR_A_X = -6.0;
const float MIRROR_B_X = 6.0;
const float CLIP_BIAS = 0.001;

bool planar_mirror_clip(vec3 world_position, uint camera_layers) {
	bool behind_a = (camera_layers & 32u) != 0u && world_position.x < MIRROR_A_X + CLIP_BIAS;
	bool behind_b = (camera_layers & 64u) != 0u && world_position.x > MIRROR_B_X - CLIP_BIAS;
	return behind_a || behind_b;
}
