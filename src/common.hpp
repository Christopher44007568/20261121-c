#pragma once
#include <vulkan/vulkan.h>
#include <glm/glm.hpp>
#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include <array>

#define VK_CHECK(expr)                                                       \
    do {                                                                     \
        VkResult _r = (expr);                                                \
        if (_r != VK_SUCCESS)                                                \
            throw std::runtime_error(std::string("Vulkan error ") +         \
                                     std::to_string(_r) + " at " #expr);    \
    } while (0)

constexpr uint32_t TEX_SIZE = 512;
constexpr uint32_t RENDER_W = 768;
constexpr uint32_t RENDER_H = 768;
constexpr float PI = 3.14159265358979323846f;

// Vertex layout for the subdivided sphere.
struct Vertex {
    glm::vec3 pos;
    glm::vec3 normal;
    glm::vec2 uv;
    glm::vec4 tangent; // xyz tangent, w = bitangent sign (+1 / -1)
};

// Push constants consumed by fabric.frag / fabric.vert.
struct PushConstants {
    glm::mat4 viewProj;
    glm::vec4 lightDir;       // xyz direction toward the strip centre, w = angle(rad)
    glm::vec4 cameraPos;      // xyz
    glm::vec4 params;         // anisotropy, roughnessX, roughnessY, lightWidth
    glm::vec4 tint;           // rgb base tint, a mode bitfield
    glm::vec4 seamX;          // x = seam u coordinate, yzw unused
};

enum RenderMode : uint32_t {
    MODE_FABRIC = 0,   // full material: normal+tangent maps, anisotropic GGX
    MODE_TANGENT = 1,  // tangent vector -> RGB debug view
    MODE_NORMAL = 2,   // normal map -> RGB debug view
    MODE_UV = 3        // uv -> RGB debug view (shows mirrored panels)
};

struct ImageData {
    std::vector<uint8_t> rgba;
    uint32_t width = 0;
    uint32_t height = 0;
};

// Textures are generated on the CPU (procedural fabric) then uploaded.
struct FabricTextures {
    ImageData albedo;   // woven cloth colour with seam tint
    ImageData normal;   // tangent-space normal map
    ImageData tangent;  // tangent map: rgb = tangent dir in tangent plane, a = sign
};

FabricTextures generate_fabric_textures(uint32_t size);
std::vector<Vertex> build_sphere(uint32_t lat_segments, uint32_t long_segments,
                                 float seam_u);
std::vector<uint32_t> build_sphere_indices(uint32_t lat_segments,
                                           uint32_t long_segments);

struct MeasurementResult {
    float peak_angle_t = 0.f;   // highlight centroid angle in tangent section
    float peak_angle_b = 0.f;   // highlight centroid angle in bitangent section
    float width_t = 0.f;        // angular width of lobe (degrees)
    float width_b = 0.f;
    glm::vec3 color_left;       // average highlight colour just left of seam
    glm::vec3 color_right;      // average highlight colour just right of seam
    float color_delta = 0.f;    // euclidean RGB distance across the seam
    float direction_jump = 0.f; // |peak_left - peak_right| in degrees (ideal: 0)
};

void write_png(const std::string& path, const ImageData& img);

// Returns RGBA [0,1] at pixel (x,y), clamped to image bounds.
inline std::array<float, 4> sample_pixel(const ImageData& img, int x, int y) {
    x = glm::clamp(x, 0, int(img.width) - 1);
    y = glm::clamp(y, 0, int(img.height) - 1);
    size_t i = (size_t(y) * img.width + x) * 4;
    return {img.rgba[i] / 255.f, img.rgba[i + 1] / 255.f,
            img.rgba[i + 2] / 255.f, img.rgba[i + 3] / 255.f};
}
