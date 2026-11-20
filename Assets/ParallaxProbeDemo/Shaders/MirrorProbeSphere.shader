Shader "ParallaxProbeDemo/MirrorProbeSphere"
{
    Properties
    {
        [KeywordEnum(Off, BoxProjection)] _CorrectionMode ("Parallax Correction", Float) = 1
        [Toggle] _PreserveIntensity ("Preserve Intensity Across Probe Blend", Float) = 1
        _Smoothness ("Smoothness (mip selection)", Range(0, 1)) = 1.0
        _Tint ("Tint", Color) = (1, 1, 1, 1)
        [Toggle] _ShowBlendWeight ("Debug: Visualize Probe Blend Weight", Float) = 0
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }

        Pass
        {
            Name "MirrorForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/EntityLighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float _CorrectionMode;
                float _PreserveIntensity;
                float _Smoothness;
                float4 _Tint;
                float _ShowBlendWeight;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
            };

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.normalWS   = TransformObjectToWorldNormal(input.normalOS);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                return output;
            }

            // Reflection direction optionally pushed through the probe proxy box.
            float3 CorrectedDirection(float3 reflectWS, float3 positionWS,
                                      float4 probePosition, float3 boxMin, float3 boxMax)
            {
                if (_CorrectionMode < 0.5)
                    return reflectWS; // raw cubemap lookup, feature treated as infinitely far
                return BoxProjectedCubemapDirection(reflectWS, positionWS, probePosition, boxMin.xyz, boxMax.xyz);
            }

            float3 SampleProbe(TEXTURECUBE_PARAM(tex, samp), float4 hdr,
                               float3 reflectWS, float3 positionWS,
                               float4 probePosition, float3 boxMin, float3 boxMax, float mip)
            {
                float3 dir = CorrectedDirection(reflectWS, positionWS, probePosition, boxMin, boxMax);
                float3 encoded = SAMPLE_TEXTURECUBE_LOD(tex, samp, dir, mip).rgb;
                return DecodeHDREnvironment(encoded, hdr);
            }

            half4 frag(Varyings input) : SV_Target
            {
                float3 normalWS = normalize(input.normalWS);
                float3 viewWS   = GetWorldSpaceNormalizeViewDir(input.positionWS);
                float3 reflectWS = reflect(-viewWS, normalWS);

                float perceptualRoughness = 1.0 - _Smoothness;
                float mip = PerceptualRoughnessToMipmapLevel(perceptualRoughness);

                // Blend weight between the two probes influencing this renderer.
                // URP stores it in unity_SpecCube0_BoxMin.w (1 = probe0 only).
                float weight0 = saturate(unity_SpecCube0_BoxMin.w);

                float3 env0 = SampleProbe(TEXTURECUBE_ARGS(unity_SpecCube0, samplerunity_SpecCube0),
                                          unity_SpecCube0_HDR, reflectWS, input.positionWS,
                                          unity_SpecCube0_ProbePosition,
                                          unity_SpecCube0_BoxMin.xyz, unity_SpecCube0_BoxMax.xyz, mip);

                float3 env = env0;
                UNITY_BRANCH
                if (weight0 < 0.999)
                {
                    float3 env1 = SampleProbe(TEXTURECUBE_ARGS(unity_SpecCube1, samplerunity_SpecCube1),
                                              unity_SpecCube1_HDR, reflectWS, input.positionWS,
                                              unity_SpecCube1_ProbePosition,
                                              unity_SpecCube1_BoxMin.xyz, unity_SpecCube1_BoxMax.xyz, mip);

                    float3 lerped = lerp(env1, env0, weight0);

                    if (_PreserveIntensity > 0.5)
                    {
                        // Renormalize so the blended result keeps the luminance
                        // implied by the weight, avoiding a brightness dip when
                        // the two probes disagree in hue/saturation.
                        float lumTarget = lerp(Luminance(env1), Luminance(env0), weight0);
                        float lumActual = max(Luminance(lerped), 1e-4);
                        env = lerped * (lumTarget / lumActual);
                    }
                    else
                    {
                        env = lerped;
                    }
                }

                if (_ShowBlendWeight > 0.5)
                    return half4(weight0, 0.0, 1.0 - weight0, 1.0);

                return half4(env * _Tint.rgb, 1.0);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
