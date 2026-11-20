// Shared constants and conventions for the DX12 SSR demo.
// View space: +Z forward, +Y up, +X right; NDC depth in [0,1].
#ifndef SSR_COMMON_HLSLI
#define SSR_COMMON_HLSLI

static const float SSR_Z_NEAR     = 0.1f;
static const float SSR_Z_FAR      = 40.0f;
static const float SSR_THICKNESS  = 0.35f;  // linear view-depth thickness band
static const float SSR_FRONT_EPS  = 0.08f;  // DDA quantization tolerance
static const float SSR_MAX_DIST   = 14.0f; // world units
static const int   SSR_MAX_STEPS  = 160;
static const float SSR_EDGE_FADE  = 0.06f;
static const float TAA_BLEND      = 0.85f;
static const float TAA_DEPTH_REJ  = 0.25f;

struct CameraCB {
    row_major float4x4 view;
    row_major float4x4 proj;
    row_major float4x4 viewProj;
    row_major float4x4 invProj;
    row_major float4x4 prevViewProj;
    float4 cameraEye;        // xyz eye, w aspect
    float4 params;           // x tanHalfFovY, y time, z pathIndex, w frameIndex
};

struct GBufferTex {
    float  depth;
    float  linDepth;
    float3 viewPos;
    float3 viewNormal;
    float3 worldPos;
    float3 worldNormal;
    float3 albedo;
    uint   flags;            // bit0 = ground mirror
};

static const uint GFLAG_GROUND = 1u;

float3 SampleSky(float3 dir){
    float y = saturate(dir.y*0.5f + 0.5f);
    float3 horizon = float3(0.72f, 0.78f, 0.86f);
    float3 zenith  = float3(0.20f, 0.35f, 0.62f);
    float3 col = lerp(horizon, zenith, y);
    float3 sunDir = normalize(float3(-0.45f, 0.65f, -0.35f));
    float sun = pow(saturate(dot(dir, sunDir)), 48.0f);
    return col + float3(1.0f, 0.85f, 0.55f) * sun * 1.4f;
}

#endif
