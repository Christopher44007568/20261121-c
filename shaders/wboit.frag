#version 430 core

layout(location = 0) out vec4 outAccumulation;
layout(location = 1) out vec4 outRevealage;

in vec3 vWorldPosition;
in vec3 vWorldNormal;
in vec3 vViewDirection;

uniform vec3 uColor;
uniform float uAlpha;

void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(vViewDirection);
    vec3 keyDirection = normalize(vec3(-0.45, 0.78, 0.52));
    float diffuse = max(dot(normal, keyDirection), 0.0);
    float rim = pow(1.0 - abs(dot(normal, viewDirection)), 2.4);
    vec3 lit = uColor * (0.34 + 0.66 * diffuse) + vec3(0.22, 0.38, 0.48) * rim;

    float alpha = clamp(uAlpha, 0.0, 1.0);
    float depth = gl_FragCoord.z;
    float weight = clamp(
        pow(alpha * 9.0 + 0.02, 3.0) * 1.2e7 * pow(1.0 - depth * 0.92, 3.0),
        0.02, 5000.0);

    outAccumulation = vec4(lit * alpha * weight, alpha * weight);
    outRevealage = vec4(alpha, alpha, alpha, alpha);
}
