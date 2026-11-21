#include "common.hpp"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb/stb_image_write.h>
#include <cmath>

namespace {
inline float hash2(int x, int y) {
    uint32_t h = uint32_t(x) * 374761393u + uint32_t(y) * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    h ^= h >> 16;
    return float(h & 0xffffff) / float(0xffffff);
}

// Two mirrored panels share the seam at u = seam_u: right panel flips U so
// that warp/weft threads meet symmetrically at the seam.
struct FabricSample {
    glm::vec3 color;
    glm::vec3 tangentSpaceNormal; // z-up
    glm::vec2 tangentDir;         // unit direction of warp thread in tangent plane
};

FabricSample sample_fabric(float u, float v, float seam_u) {
    // Mirror U for the panel right of the seam.
    float um = (u <= seam_u) ? u : (2.f * seam_u - u);
    float side = (u <= seam_u) ? 1.f : -1.f;

    const float threadPitch = 1.f / 96.f; // 96 threads across the patch
    float warpPhase = um / threadPitch;   // vertical (warp) threads vary along U
    float weftPhase = v / threadPitch;    // horizontal (weft) threads vary along V

    // Over/under weave: alternating height of warp vs weft.
    int warpIndex = int(std::floor(warpPhase));
    int weftIndex = int(std::floor(weftPhase));
    bool warpOver = ((warpIndex + weftIndex) & 1) == 0;

    float warpWave = std::sin(warpPhase * 2.f * PI);
    float weftWave = std::sin(weftPhase * 2.f * PI);
    // Derivatives -> tangent-space normal perturbation.
    float dHdU = (warpOver ? 0.65f : 0.35f) *
                 std::cos(warpPhase * 2.f * PI) * 2.f * PI / threadPitch * side;
    float dHdV = (warpOver ? 0.35f : 0.65f) *
                 std::cos(weftPhase * 2.f * PI) * 2.f * PI / threadPitch;
    const float bumpStrength = 0.004f;
    glm::vec3 n = glm::normalize(glm::vec3(-dHdU * bumpStrength,
                                           -dHdV * bumpStrength, 1.f));

    // Warp thread direction runs mostly along V; mirroring U flips its
    // tangent-plane x component so the physical direction stays continuous.
    // A modest x tilt keeps the anisotropy axis from being perfectly axial.
    glm::vec2 tdir = glm::normalize(glm::vec2(0.25f * side, 1.f));

    // Procedural yarn colour: two slightly different dyed threads + noise.
    float threadShade = 0.5f + 0.5f * (warpOver ? warpWave : weftWave);
    glm::vec3 warpYarn(0.62f, 0.18f, 0.14f);
    glm::vec3 weftYarn(0.78f, 0.66f, 0.42f);
    glm::vec3 base = glm::mix(weftYarn, warpYarn, warpOver ? 0.65f : 0.35f);
    float grain = 0.92f + 0.16f * hash2(int(um * 4096), int(v * 4096));
    glm::vec3 color = base * (0.82f + 0.25f * threadShade) * grain;

    // Visible stitching at the seam: darker thread line.
    float dist = std::abs(u - seam_u);
    if (dist < threadPitch * 0.9f) {
        float stitch = 0.5f + 0.5f * std::sin(v / threadPitch * PI);
        color = glm::mix(color, glm::vec3(0.08f, 0.05f, 0.04f),
                         0.55f * stitch);
    }
    return {color, n, tdir};
}
} // namespace

FabricTextures generate_fabric_textures(uint32_t size) {
    const float seam_u = 0.5f;
    FabricTextures tex;
    tex.albedo = {std::vector<uint8_t>(size_t(size) * size * 4), size, size};
    tex.normal = {std::vector<uint8_t>(size_t(size) * size * 4), size, size};
    tex.tangent = {std::vector<uint8_t>(size_t(size) * size * 4), size, size};

    for (uint32_t y = 0; y < size; ++y) {
        float v = float(y) / float(size - 1);
        for (uint32_t x = 0; x < size; ++x) {
            float u = float(x) / float(size - 1);
            FabricSample s = sample_fabric(u, v, seam_u);
            size_t idx = (size_t(y) * size + x) * 4;

            tex.albedo.rgba[idx + 0] = uint8_t(glm::clamp(s.color.r, 0.f, 1.f) * 255);
            tex.albedo.rgba[idx + 1] = uint8_t(glm::clamp(s.color.g, 0.f, 1.f) * 255);
            tex.albedo.rgba[idx + 2] = uint8_t(glm::clamp(s.color.b, 0.f, 1.f) * 255);
            tex.albedo.rgba[idx + 3] = 255;

            // Encode tangent-space normal [0,1].
            glm::vec3 en = s.tangentSpaceNormal * 0.5f + 0.5f;
            tex.normal.rgba[idx + 0] = uint8_t(en.r * 255);
            tex.normal.rgba[idx + 1] = uint8_t(en.g * 255);
            tex.normal.rgba[idx + 2] = uint8_t(en.z * 255);
            tex.normal.rgba[idx + 3] = 255;

            // Tangent map: xy unit dir encoded around (128,128); alpha stores
            // the bitangent sign which flips under mirrored UV.
            glm::vec2 et = s.tangentDir * 0.5f + 0.5f;
            float bitangentSign = (u <= seam_u) ? 1.f : -1.f;
            tex.tangent.rgba[idx + 0] = uint8_t(glm::clamp(et.x, 0.f, 1.f) * 255);
            tex.tangent.rgba[idx + 1] = uint8_t(glm::clamp(et.y, 0.f, 1.f) * 255);
            tex.tangent.rgba[idx + 2] = 128;
            tex.tangent.rgba[idx + 3] = uint8_t((bitangentSign * 0.5f + 0.5f) * 255);
        }
    }
    return tex;
}

void write_png(const std::string& path, const ImageData& img) {
    if (!stbi_write_png(path.c_str(), int(img.width), int(img.height), 4,
                        img.rgba.data(), int(img.width * 4)))
        throw std::runtime_error("failed to write png: " + path);
}
