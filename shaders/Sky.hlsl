// Full-screen sky / background pass for empty G-buffer pixels. Viewport
// dimensions are expected in params (z=width, w=height); the renderer fills
// them when wiring this pass. Direction is reconstructed in view space and
// transformed back to world space before sampling the procedural sky.
#include "Common.hlsli"
ConstantBuffer<CameraCB> CB : register(b0);
float4 PSMain(float4 p:SV_POSITION): SV_Target0 {
    float aspect = CB.cameraEye.w;
    float tanY = CB.params.x;
    float2 ndc = float2(p.x/CB.params.z, p.y/CB.params.w)*2.0f - 1.0f;
    float3 d = normalize(float3(ndc.x*tanY*aspect, ndc.y*tanY, 1.0f));
    float3 wd = normalize(mul((float3x3)CB.view, d));
    return float4(SampleSky(wd), 1.0f);
}
