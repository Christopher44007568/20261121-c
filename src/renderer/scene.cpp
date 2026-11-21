#include "scene.h"

Scene::Scene()
{
    objects = {
        { { -1.6f, 0.1f, 1.2f }, 1.1f, { 0.85f, 0.25f, 0.20f }, 0.18f, 0.05f, { 0.6f, 0.0f, 0.0f } },
        { {  0.3f,-0.2f, 2.6f }, 0.8f, { 0.25f, 0.55f, 0.90f }, 0.35f, 0.10f, { -0.5f, 0.3f, 0.0f } },
        { {  1.7f, 0.4f, 0.4f }, 0.7f, { 0.95f, 0.80f, 0.25f }, 0.60f, 0.90f, { 0.0f, 0.0f, 0.0f } },
        { {  0.0f, 0.0f, 6.5f }, 2.2f, { 0.35f, 0.35f, 0.38f }, 0.85f, 0.00f, { 0.0f, 0.0f, 0.0f } }
    };
}

void Scene::Advance(float dt)
{
    time_ += dt;
    for (SceneObject& o : objects)
    {
        o.center.x += o.velocity.x * dt;
        o.center.y += o.velocity.y * dt;
        o.center.z += o.velocity.z * dt;
    }
}

float Scene::CameraYaw(int frame) const
{
    float yaw = 0.10f * sinf(frame * 0.09f);
    if (frame >= 20) yaw += 0.35f;   // sudden jump: velocity discontinuity
    if (frame >= 41) yaw -= 0.55f;
    return yaw;
}

dx::XMMATRIX Scene::View(int frame) const
{
    float yaw = CameraYaw(frame);
    dx::XMVECTOR pos = dx::XMLoadFloat3(&cameraPos);
    dx::XMVECTOR target = dx::XMVectorAdd(
        pos, dx::XMVectorSet(sinf(yaw), 0.0f, cosf(yaw), 0.0f));
    return dx::XMMatrixLookAtLH(pos, target, dx::XMVectorSet(0, 1, 0, 0));
}

dx::XMMATRIX Scene::Projection(int w, int h, dx::XMFLOAT2 jitterPx) const
{
    float fov = 1.0048f;
    dx::XMMATRIX p = dx::XMMatrixPerspectiveFovLH(
        fov, (float)w / (float)h, 0.1f, 100.0f);
    // Sub-pixel jitter in NDC. Offsetting projection this way shifts the
    // sample position while keeping the viewport mapping unchanged.
    p.r[2].m128_f32[0] += (2.0f * jitterPx.x) / (float)w;
    p.r[2].m128_f32[1] += (2.0f * jitterPx.y) / (float)h;
    return p;
}
