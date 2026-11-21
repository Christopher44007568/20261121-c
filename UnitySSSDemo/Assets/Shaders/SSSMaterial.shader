// Custom HDRP material feeding the screen-space subsurface-scattering custom pass.
// Pass 0 ("SSSBeauty") renders direct diffuse radiance into the beauty input buffer.
// Pass 1 ("SSSIDThickness") renders a hard material ID and a world-space thickness map.
// The ID buffer is used as a per-tap gate by SSSDiffusion.shader so that adjacent
// geometry carrying different material IDs can never diffuse into each other.
Shader "Custom/HDRP/SSSMaterial"
{
    Properties
    {
        _BaseColor          ("Base color", Color) = (0.86, 0.42, 0.28, 1)
        _Smoothness         ("Smoothness", Range(0, 1)) = 0.55
        _SpecularTint       ("Specular tint", Color) = (1, 1, 1, 1)
        _MaterialID         ("Material ID (0 = no SSS)", Float) = 1
        _VertexThickness    ("Vertex thickness (m)", Range(0.0001, 0.08)) = 0.0012
        _ThicknessScale     ("Thickness map scale", Range(0.01, 4)) = 1
        _WorldScale         ("World scale multiplier", Range(0.1, 8)) = 1
        [Toggle] _EnableSSS  ("Enable SSS response", Float) = 1
    }

    SubShader
    {
        Tags
        {
            "RenderPipeline" = "HDRenderPipeline"
            "RenderType"     = "HDUnlitShader"
        }

        Pass
        {
            Name "SSSBeauty"
            Tags { "LightMode" = "SSSBeauty" }
            ZWrite On
            Cull Back
            HLSLPROGRAM
            #pragma vertex   Vert
            #pragma fragment FragBeauty
            #pragma multi_compile _ DEBUG_DISPLAY
            #include "SSSMaterial.hlsl"
            ENDHLSL
        }

        Pass
        {
            Name "SSSIDThickness"
            Tags { "LightMode" = "SSSIDThickness" }
            ZWrite On
            Cull Back
            HLSLPROGRAM
            #pragma vertex   Vert
            #pragma fragment FragIDThickness
            #include "SSSMaterial.hlsl"
            ENDHLSL
        }
    }
}
