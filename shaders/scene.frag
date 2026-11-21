#version 450 core

in vec3 vWorldPosition;
in vec3 vNormal;

uniform vec3 uCameraPosition;
uniform vec3 uLightPosition;
uniform vec3 uLightColor;
uniform vec3 uBaseColor;
uniform int uIsFloor;

out vec4 fragColor;

float checker(vec2 p) {
    vec2 cell = floor(p / 0.66);
    return mod(cell.x + cell.y, 2.0);
}

void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) {
        n = -n;
    }
    vec3 toLight = uLightPosition - vWorldPosition;
    float lightDistance = length(toLight);
    vec3 l = toLight / max(lightDistance, 1e-4);
    vec3 v = normalize(uCameraPosition - vWorldPosition);
    vec3 h = normalize(l + v);

    vec3 albedo = uBaseColor;
    if (uIsFloor != 0) {
        float tile = checker(vWorldPosition.xz);
        albedo = mix(vec3(0.19, 0.225, 0.245), vec3(0.32, 0.355, 0.370), tile);
        vec2 grid = abs(fract(vWorldPosition.xz / 0.66) - 0.5);
        float gridLine = smoothstep(0.465, 0.492, max(grid.x, grid.y));
        albedo = mix(albedo, vec3(0.39, 0.43, 0.445), gridLine * 0.55);
    }

    float ndl = max(dot(n, l), 0.0);
    float attenuation = 1.0 / (1.0 + 0.045 * lightDistance +
                               0.018 * lightDistance * lightDistance);
    vec3 direct = albedo * uLightColor * (ndl * 1.55 * attenuation);
    float ndh = max(dot(n, h), 0.0);
    float specular = pow(ndh, uIsFloor != 0 ? 32.0 : 56.0) * 0.34 * attenuation;
    vec3 ambient = albedo * vec3(0.085, 0.105, 0.135);
    vec3 color = direct + uLightColor * specular + ambient;

    float distanceToEye = length(vWorldPosition - uCameraPosition);
    float fog = smoothstep(15.0, 29.0, distanceToEye);
    vec3 haze = mix(vec3(0.035, 0.052, 0.070), vec3(0.075, 0.095, 0.115),
                    clamp(vWorldPosition.y / 7.0, 0.0, 1.0));
    color = mix(color, haze, fog);
    color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
    fragColor = vec4(color, 1.0);
}

