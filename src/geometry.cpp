#include "common.hpp"
#include <cmath>

namespace {
glm::vec3 sphere_normal(float theta, float phi) {
    return glm::vec3(std::sin(theta) * std::cos(phi),
                     std::cos(theta),
                     std::sin(theta) * std::sin(phi));
}
} // namespace

// Indexed UV sphere. The u = seam_u meridian is a real topological seam in UV
// space (vertices duplicated at phi=0/2pi) so mirrored sampling never bleeds
// across panels. The mirror itself is applied in the fragment shader.
std::vector<Vertex> build_sphere(uint32_t lat_segments, uint32_t long_segments,
                                 float seam_u) {
    (void)seam_u;
    std::vector<Vertex> verts;
    for (uint32_t j = 0; j <= lat_segments; ++j) {
        float v = float(j) / float(lat_segments);
        float theta = v * PI;
        for (uint32_t i = 0; i <= long_segments; ++i) {
            float u = float(i) / float(long_segments);
            // Put the sphere's UV seam (u=0/1) at +X so that it coincides
            // with the fabric texture's mirrored seam at u=0.5: phi spans
            // [-pi, pi] across u in [0, 1], seam at phi=+/-pi.
            float phi = (u - 0.5f) * 2.f * PI;
            glm::vec3 n = sphere_normal(theta, phi);
            // dP/dphi: longitudinal tangent following increasing u.
            glm::vec3 t = glm::normalize(glm::vec3(
                -std::sin(theta) * std::sin(phi), 0.f,
                std::sin(theta) * std::cos(phi)));
            if (theta < 1e-4f || theta > PI - 1e-4f) t = glm::vec3(1.f, 0.f, 0.f);
            verts.push_back({n, n, {u, v}, {t, 1.f}});
        }
    }

    std::vector<uint32_t> indices;
    for (uint32_t j = 0; j < lat_segments; ++j) {
        for (uint32_t i = 0; i < long_segments; ++i) {
            uint32_t a = j * (long_segments + 1) + i;
            uint32_t b = a + 1;
            uint32_t c = a + (long_segments + 1);
            uint32_t d = c + 1;
            indices.insert(indices.end(), {a, c, b, b, c, d});
        }
    }
    return verts;
}

std::vector<uint32_t> build_sphere_indices(uint32_t lat_segments,
                                           uint32_t long_segments) {
    std::vector<uint32_t> indices;
    indices.reserve(lat_segments * long_segments * 6);
    for (uint32_t j = 0; j < lat_segments; ++j) {
        for (uint32_t i = 0; i < long_segments; ++i) {
            uint32_t a = j * (long_segments + 1) + i;
            uint32_t b = a + 1;
            uint32_t c = a + (long_segments + 1);
            uint32_t d = c + 1;
            indices.insert(indices.end(), {a, c, b, b, c, d});
        }
    }
    return indices;
}
