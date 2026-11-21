#version 460

layout(location = 0) in vec3 vWorldPos;
layout(location = 1) in vec3 vNormal;
layout(location = 2) in vec2 vUV;
layout(location = 3) in vec4 vTangent;

layout(set = 0, binding = 0) uniform sampler2D texAlbedo;
layout(set = 0, binding = 1) uniform sampler2D texNormal;
layout(set = 0, binding = 2) uniform sampler2D texTangent;

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 lightDir;   // xyz dir to strip centre, w = strip rotation (rad)
    vec4 cameraPos;  // xyz
    vec4 params;     // x anisotropy, y roughT, z roughB, w strip half-width
    vec4 tint;       // rgb tint, a = render mode (float bits)
    vec4 seamX;      // x = seam u
} pc;

layout(location = 0) out vec4 outColor;

const float PI = 3.14159265359;

// Mirror U on the panel right of the seam and return the side sign.
vec2 mirror_uv(vec2 uv, out float side) {
    float seam = pc.seamX.x;
    side = (uv.x <= seam) ? 1.0 : -1.0;
    vec2 m = uv;
    if (uv.x > seam) m.x = 2.0 * seam - uv.x;
    return m;
}

// Anisotropic GGX (Kulla-Conty style). hT/hB are half-vector components in the
// tangent/bitangent frame; ax/ab are the two directional roughnesses.
float d_ggx_aniso(float hT, float hB, float hN, float ax, float ab) {
    // Standard anisotropic GGX (Burley/Kulla): the 1/hN^4 term is folded
    // into q so the expression stays finite at grazing angles.
    float ax2 = ax * ax;
    float ab2 = ab * ab;
    float hN2 = max(hN * hN, 1e-10);
    float q = 1.0 + (hT * hT) / (ax2 * hN2) + (hB * hB) / (ab2 * hN2);
    return 1.0 / (PI * ax * ab * hN2 * q * q);
}

float g_schlick_ggx(float ndotv, float rough) {
    float r = rough + 1.0;
    float k = (r * r) / 8.0;
    return ndotv / (ndotv * (1.0 - k) + k);
}

void main() {
    uint mode = floatBitsToUint(pc.tint.a);
    float side;
    vec2 muv = mirror_uv(vUV, side);

    vec3 albedo = texture(texAlbedo, muv).rgb * pc.tint.rgb;
    vec3 nTan = texture(texNormal, muv).xyz * 2.0 - 1.0;
    vec4 tSample = texture(texTangent, muv);
    vec2 warpDirTan = tSample.xy * 2.0 - 1.0;
    float bitanSign = tSample.a * 2.0 - 1.0;

    // ---- Tangent frame handling under mirrored UV ----
    vec3 nGeom = normalize(vNormal);
    vec3 tBase = normalize(vTangent.xyz - nGeom * dot(vTangent.xyz, nGeom));

    // The mirrored panel flips U. A mirror-correct frame flips the bitangent
    // handedness (side = -1), keeping the tangent itself continuous at seam.
    // The naive frame ignores this and always assumes +1 handedness.
    bool useNaive = (mode & 0x100u) != 0u;
    float handedness = useNaive ? 1.0 : side;
    vec3 T = tBase;
    vec3 B = normalize(cross(nGeom, T)) * handedness;

    // Rotate the tangent-space normal perturbation into world space. The
    // perturbation is kept subtle so the macro specular lobe stays coherent.
    vec3 N = normalize(nGeom + T * nTan.x * 0.12 + B * nTan.y * 0.12);

    // Warp (anisotropy) axis: tangent-map direction rotated into the world.
    // Under corrected framing the axis stays continuous across the seam.
    vec3 anisoAxis = normalize(T * warpDirTan.x + B * warpDirTan.y);
    vec3 anisoBit = normalize(cross(N, anisoAxis));

    if (mode == 1u) { // tangent debug
        outColor = vec4(anisoAxis * 0.5 + 0.5, 1.0);
        return;
    }
    if (mode == 2u) { // normal debug
        outColor = vec4(N * 0.5 + 0.5, 1.0);
        return;
    }
    if (mode == 3u) { // uv debug (visualise mirrored panels + seam)
        outColor = vec4(fract(muv), 0.5 + 0.5 * side, 1.0);
        return;
    }
    vec3 V = normalize(pc.cameraPos.xyz - vWorldPos);
    float ndv = max(dot(N, V), 1e-4);
    vec3 Lcenter = normalize(pc.lightDir.xyz);
    float stripAngle = pc.lightDir.w;
    vec3 up = abs(Lcenter.y) < 0.95 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    vec3 stripAxis = normalize(cross(up, Lcenter));
    vec3 stripSide = normalize(cross(Lcenter, stripAxis));
    vec3 axis = stripAxis * cos(stripAngle) +
                stripSide * sin(stripAngle);
    if (mode == 4u) { // raw anisotropic NDF debug (no tonemap)
        outColor = vec4(anisoAxis * 0.5 + 0.5, 1.0);
        return;
    }
    if (mode == 7u) { // specular-only measurement view (no diffuse/sheen)
        vec3 Vm = normalize(pc.cameraPos.xyz - vWorldPos);
        float ndvm = max(dot(N, Vm), 1e-4);
        vec3 specm = vec3(0.0);
        for (int i = 0; i < 17; ++i) {
            float tt = (float(i) / 16.0 - 0.5) * 2.0 * pc.params.w;
            vec3 Lm = normalize(Lcenter * cos(tt) + axis * sin(tt));
            float ndlm = max(dot(N, Lm), 0.0);
            if (ndlm <= 0.0) continue;
            vec3 Hm = normalize(Lm + Vm);
            float Dm = d_ggx_aniso(dot(Hm, anisoAxis), dot(Hm, anisoBit),
                                   dot(Hm, N), max(pc.params.y, 1e-3),
                                   max(pc.params.z, 1e-3));
            float Gm = g_schlick_ggx(ndlm, max(pc.params.y, pc.params.z)) *
                       g_schlick_ggx(ndvm, max(pc.params.y, pc.params.z));
            vec3 Fm = vec3(0.04) + (vec3(1.0) - 0.04) *
                       pow(1.0 - max(dot(Hm, Vm), 0.0), 5.0);
            specm += Dm * Gm * Fm / max(4.0 * ndvm * ndlm, 1e-4) * ndlm;
        }
        specm = specm / 17.0 * 6.0;
        outColor = vec4(clamp(specm, vec3(0.0), vec3(1.0)), 1.0);
        return;
    }

    float ax = max(pc.params.y, 1e-3);          // roughness along warp
    float ab = max(pc.params.z, 1e-3);          // roughness across warp
    float halfWidth = pc.params.w;

    // Integrate the anisotropic GGX specular over the angular extent of the
    // strip light by sampling several light directions along the strip.
    vec3 specular = vec3(0.0);
    const int SAMPLES = 17;
    for (int i = 0; i < SAMPLES; ++i) {
        float t = (float(i) / float(SAMPLES - 1) - 0.5) * 2.0 * halfWidth;
        vec3 L = normalize(Lcenter * cos(t) + axis * sin(t));
        float ndlSampled = max(dot(N, L), 0.0);
        if (ndlSampled <= 0.0) continue;
        vec3 H = normalize(L + V);
        float ndf = d_ggx_aniso(dot(H, anisoAxis), dot(H, anisoBit),
                                dot(H, N), ax, ab);
        float ndl = ndlSampled;
        float g = g_schlick_ggx(ndl, max(ax, ab)) *
                  g_schlick_ggx(ndv, max(ax, ab));
        vec3 f = vec3(0.04) + (vec3(1.0) - 0.04) *
                 pow(1.0 - max(dot(H, V), 0.0), 5.0);
        specular += (ndf * g * f / max(4.0 * ndv * ndl, 1e-4)) * ndl;
    }
    specular /= float(SAMPLES);
    specular *= vec3(1.0, 0.96, 0.9) * 6.0;

    // Simple cloth diffuse: wrapped Lambert with a velvet sheen.
    float ndl = max(dot(N, Lcenter), 0.0);
    vec3 diffuse = albedo * (ndl * 0.85 + 0.15) / PI;
    float sheen = pow(1.0 - ndv, 3.0) * 0.15;
    vec3 color = diffuse + specular + sheen * albedo;

    // ACES-ish tone map (keeps bright anisotropic highlights crisp) + gamma.
    color = (color * (2.51 * color + 0.03)) /
            (color * (2.43 * color + 0.59) + 0.14);
    color = clamp(color, 0.0, 1.0);
    outColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}
