#ifndef COMMON_HLSLI
#define COMMON_HLSLI

#include "temporal_core.hlsli"

cbuffer FrameCB : register(b0)
{
    matrix gViewProj;
    matrix gPrevViewProj;
    matrix gInvViewProj;
    float4 gCameraPos;
    float4 gLightDir;
    float4 gParams;    // x time, y frameIndex, z renderW, w renderH
    float4 gJitter;   // xy current jitter px, zw previous jitter px
    float4 gOutputSize;
};

cbuffer ObjectCB : register(b1)
{
    matrix gWorld;
    matrix gPrevWorld;
    float4 gAlbedoRoughness;
    float4 gMetallic;
};

struct VsIn
{
    float3 posLocal : POSITION;
    float3 normal   : NORMAL;
};

struct GbOut
{
    float4 positionCs : SV_POSITION;
    float3 normalW    : NORMAL0;
    float3 positionW  : POSITION0;
    float2 uv         : TEXCOORD0;
    float3 positionL  : TEXCOORD1;
};

#endif
