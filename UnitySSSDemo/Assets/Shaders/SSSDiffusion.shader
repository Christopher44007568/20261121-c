// Full-screen screen-space subsurface scattering pass.
// Two separable 48-tap passes give a 96-tap diffusion footprint.
// Every tap is gated on the material-ID buffer so different material IDs
// never diffuse into each other, and thickness drives Beer-Lambert attenuation.
Shader "Hidden/SSSDiffusion"
{
    SubShader
    {
        Tags
        {
            "RenderPipeline" = "HDRenderPipeline"
        }
        ZWrite Off ZTest Always Cull Off

        Pass
        {
            Name "SSSHorizontal"
            HLSLPROGRAM
            #pragma vertex   FullscreenVert
            #pragma fragment FragH
            #define SSS_DIRECTION float2(1, 0)
            #include "SSSDiffusion.hlsl"
            ENDHLSL
        }

        Pass
        {
            Name "SSSVertical"
            HLSLPROGRAM
            #pragma vertex   FullscreenVert
            #pragma fragment FragV
            #define SSS_DIRECTION float2(0, 1)
            #include "SSSDiffusion.hlsl"
            ENDHLSL
        }

        Pass
        {
            Name "SSSComposite"
            HLSLPROGRAM
            #pragma vertex   FullscreenVert
            #pragma fragment FragComposite
            #define SSS_COMPOSITE_PASS 1
            #include "SSSDiffusion.hlsl"
            ENDHLSL
        }
    }
}
