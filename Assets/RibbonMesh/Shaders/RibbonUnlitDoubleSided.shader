Shader "RibbonMesh/UnlitDoubleSided"
{
    Properties
    {
        _BaseMap ("Ribbon Texture", 2D) = "white" {}
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "Queue" = "Geometry"
        }
        LOD 100
        Cull Off

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            sampler2D _BaseMap;
            float4 _BaseMap_ST;

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionCS = UnityObjectToClipPos(input.positionOS);
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return output;
            }

            fixed4 frag(Varyings input, bool isFrontFace : SV_IsFrontFace) : SV_Target
            {
                fixed4 color = tex2D(_BaseMap, input.uv);
                // Slightly darken the back face so the two sides are distinguishable
                // while Cull Off keeps the ribbon visible from every angle.
                if (!isFrontFace)
                {
                    color.rgb *= 0.72;
                }
                return color;
            }
            ENDCG
        }
    }
}
