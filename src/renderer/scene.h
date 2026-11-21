#pragma once
#include "renderer_common.h"

struct MaterialCBuffer
{
    dx::XMFLOAT4 albedoRoughness; // xyz albedo, w roughness
    dx::XMFLOAT4 metallicPad;     // x metallic
};

struct ObjectConstants
{
    dx::XMFLOAT4X4 world;
    dx::XMFLOAT4X4 prevWorld;
    MaterialCBuffer material;
};

struct FrameConstants
{
    dx::XMFLOAT4X4 viewProj;
    dx::XMFLOAT4X4 prevViewProj;
    dx::XMFLOAT4X4 invViewProj;
    dx::XMFLOAT4 cameraPos;
    dx::XMFLOAT4 lightDir;       // xyz direction, w intensity
    dx::XMFLOAT4 params;         // x time, y frameIndex, z renderW, w renderH
    dx::XMFLOAT4 jitter;         // xy current jitter px, zw previous jitter px
    dx::XMFLOAT4 outputSize;     // xy output size, zw output texel size
};

struct SceneObject
{
    dx::XMFLOAT3 center;
    float radius;
    dx::XMFLOAT3 albedo;
    float roughness;
    float metallic;
    dx::XMFLOAT3 velocity;   // world units per second
};

class Scene
{
public:
    std::vector<SceneObject> objects;
    dx::XMFLOAT3 cameraPos = dx::XMFLOAT3(0.0f, 1.0f, -6.0f);

    Scene();
    void Advance(float dt);
    // yaw includes the scripted sudden jumps used by the benchmark shot.
    float CameraYaw(int frame) const;
    dx::XMMATRIX View(int frame) const;
    dx::XMMATRIX Projection(int w, int h, dx::XMFLOAT2 jitterPx) const;

private:
    float time_ = 0.0f;
};
