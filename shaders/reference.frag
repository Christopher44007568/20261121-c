#version 430 core

layout(r32ui, binding = 0) uniform uimage2D uHeads;

layout(std430, binding = 1) buffer FragmentCounter {
    uint count;
    uint overflow;
};

struct PackedNode {
    uvec4 data;
};

layout(std430, binding = 2) buffer FragmentNodes {
    PackedNode nodes[];
};

uniform vec3 uColor;
uniform float uAlpha;
uniform uint uNodeCapacity;

in vec3 vWorldPosition;
in vec3 vWorldNormal;
in vec3 vViewDirection;

void main() {
    uint index = atomicAdd(count, 1u);
    if (index >= uNodeCapacity) {
        atomicAdd(overflow, 1u);
        return;
    }

    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(vViewDirection);
    vec3 keyDirection = normalize(vec3(-0.45, 0.78, 0.52));
    float diffuse = max(dot(normal, keyDirection), 0.0);
    float rim = pow(1.0 - abs(dot(normal, viewDirection)), 2.4);
    vec3 lit = uColor * (0.34 + 0.66 * diffuse) + vec3(0.22, 0.38, 0.48) * rim;
    float alpha = clamp(uAlpha, 0.0, 1.0);

    uint previous = imageAtomicExchange(uHeads, ivec2(gl_FragCoord.xy), index + 1u);
    nodes[index].data = uvec4(
        packHalf2x16(lit.rg),
        packHalf2x16(vec2(lit.b, alpha)),
        floatBitsToUint(gl_FragCoord.z),
        previous);
}
