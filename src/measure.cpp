#include "measure.hpp"
#include <fstream>
#include <cmath>
#include <glm/gtc/matrix_transform.hpp>

Camera make_camera(uint32_t w, uint32_t h) {
    Camera cam;
    cam.fovY = 35.f * PI / 180.f;
    cam.pos = glm::vec3(0.f, 0.35f, 4.2f);
    glm::mat4 view = glm::lookAt(cam.pos, glm::vec3(0.f), glm::vec3(0, 1, 0));
    glm::mat4 proj = glm::perspective(cam.fovY, float(w) / float(h), 0.1f, 50.f);
    proj[1][1] *= -1.f; // Vulkan clip space
    cam.viewProj = proj * view;
    return cam;
}

glm::vec2 project(const glm::mat4& vp, glm::vec3 p, uint32_t w, uint32_t h) {
    glm::vec4 c = vp * glm::vec4(p, 1.f);
    glm::vec3 ndc = glm::vec3(c) / c.w;
    return {(ndc.x * 0.5f + 0.5f) * w, (1.f - (ndc.y * 0.5f + 0.5f)) * h};
}

namespace {
struct RGB {
    float r, g, b;
};

RGB pixel(const ImageData& img, int x, int y) {
    auto p = sample_pixel(img, x, y);
    return {p[0], p[1], p[2]};
}

float lum(RGB c) { return 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b; }

glm::vec3 pixel_ray(const Camera& cam, glm::vec2 px, uint32_t w, uint32_t h) {
    float aspect = float(w) / float(h);
    float t = std::tan(cam.fovY * 0.5f);
    float nx = (px.x / w * 2.f - 1.f) * t * aspect;
    float ny = (1.f - px.y / h * 2.f) * t;
    glm::vec3 fwd = glm::normalize(-cam.pos);
    glm::vec3 right = glm::normalize(glm::cross(fwd, glm::vec3(0, 1, 0)));
    glm::vec3 up = glm::cross(right, fwd);
    return glm::normalize(right * nx + up * ny + fwd);
}

bool hit_unit_sphere(glm::vec3 o, glm::vec3 d, glm::vec3& hit) {
    float b = 2.f * glm::dot(o, d);
    float c = glm::dot(o, o) - 1.f;
    float disc = b * b - 4.f * c;
    if (disc < 0.f) return false;
    float t = (-b - std::sqrt(disc)) * 0.5f;
    if (t < 0.f) t = (-b + std::sqrt(disc)) * 0.5f;
    if (t < 0.f) return false;
    hit = o + d * t;
    return true;
}

} // namespace

// Sweep a screen-space line through the sphere centre. Every pixel is mapped
// back to a point on the unit sphere and its angular offset from centre is
// recorded, yielding a highlight cross-section in tangent/bitangent direction.
std::vector<std::pair<float, float>>
sweep_section_public(const ImageData& img, const Camera& cam, bool horizontal,
                     glm::vec2 center, float radiusPx) {
    std::vector<std::pair<float, float>> prof;
    int half = int(radiusPx * 0.85f);
    // Average a few rows/columns so a sub-pixel-narrow lobe is still sampled.
    const int AVG = 5;
    for (int k = -half; k <= half; ++k) {
        float lsum = 0.f;
        int cnt = 0;
        float ang = 0.f;
        for (int a = -AVG / 2; a <= AVG / 2; ++a) {
            glm::vec2 px = horizontal
                               ? glm::vec2(center.x + k, center.y + a)
                               : glm::vec2(center.x + a, center.y + k);
            glm::vec3 hit;
            if (!hit_unit_sphere(cam.pos,
                                 pixel_ray(cam, px, img.width, img.height), hit))
                continue;
            ang = glm::degrees(std::asin(glm::clamp(
                horizontal ? hit.x : hit.y, -1.f, 1.f)));
            lsum += lum(pixel(img, int(px.x), int(px.y)));
            ++cnt;
        }
        if (cnt) prof.emplace_back(ang, lsum / cnt);
    }
    return prof;
}

MeasurementResult measure_frame(const ImageData& img, const Camera& cam,
                                float seam_u) {
    MeasurementResult res{};
    glm::vec2 center = project(cam.viewProj, glm::vec3(0), img.width, img.height);
    // Sphere silhouette radius in pixels from a known grazing point.
    float radiusPx = float(img.height) * 0.5f * 0.82f;

    // Spatial spread of the lit pixels along the two orthogonal screen axes.
    // Each lit pixel is projected on the unit-sphere coordinate matching the
    // axis; luminance-weighted RMS gives the highlight cross-section width.
    auto spread = [&](bool alongX) {
        float wsum = 0.f, m = 0.f, m2 = 0.f;
        int radius = int(radiusPx);
        for (int y = int(center.y) - radius; y <= int(center.y) + radius; ++y) {
            for (int x = int(center.x) - radius; x <= int(center.x) + radius;
                 ++x) {
                glm::vec3 hit;
                if (!hit_unit_sphere(
                        cam.pos,
                        pixel_ray(cam, glm::vec2(x, y), img.width, img.height),
                        hit))
                    continue;
                float l = lum(pixel(img, x, y));
                if (l < 0.02f) continue;
                float coord = alongX ? hit.x : hit.y;
                wsum += l;
                m += l * coord;
                m2 += l * coord * coord;
            }
        }
        if (wsum < 1e-6f) return std::pair<float, float>{0.f, 0.f};
        float centroid = m / wsum;
        float rms = std::sqrt(std::max(0.f, m2 / wsum - centroid * centroid));
        return std::pair<float, float>{
            glm::degrees(std::asin(glm::clamp(centroid, -1.f, 1.f))),
            glm::degrees(std::asin(glm::clamp(rms, -1.f, 1.f)))};
    };
    auto st = spread(true);
    auto sb = spread(false);
    res.peak_angle_t = st.first;
    res.width_t = st.second;
    res.peak_angle_b = sb.first;
    res.width_b = sb.second;

    // Seam continuity: the seam meridian is at world +X after the CPU rotation.
    // Sample a vertical band of points just to either side of it, at the
    // latitude where the strip highlight crosses.
    glm::vec3 leftSum(0), rightSum(0);
    float leftN = 0.f, rightN = 0.f;
    float leftPeak = 0.f, rightPeak = 0.f;
    int band = int(radiusPx * 0.5f);
    for (int dy = -band; dy <= band; dy += 2) {
        float y = float(dy) / band * 0.6f;
        for (int side : {-1, 1}) {
            float x = side * 0.02f;
            float z = std::sqrt(std::max(0.f, 1.f - x * x - y * y));
            glm::vec3 hit(x, y, z);
            if (glm::dot(glm::normalize(hit),
                         glm::normalize(cam.pos - hit)) <= 0.f)
                continue;
            glm::vec2 px = project(cam.viewProj, hit, img.width, img.height);
            RGB c = pixel(img, int(px.x), int(px.y));
            float l = lum(c);
            glm::vec3 col(c.r, c.g, c.b);
            if (side < 0) {
                leftSum += col;
                leftN += 1.f;
                leftPeak = std::max(leftPeak, l);
            } else {
                rightSum += col;
                rightN += 1.f;
                rightPeak = std::max(rightPeak, l);
            }
        }
    }
    if (leftN > 0.f) res.color_left = leftSum / leftN;
    if (rightN > 0.f) res.color_right = rightSum / rightN;
    res.color_delta = glm::distance(res.color_left, res.color_right);
    res.direction_jump = std::abs(leftPeak - rightPeak);
    (void)seam_u;
    return res;
}

void write_report(const std::string& path, const MeasureReport& rep) {
    std::ofstream f(path);
    f << "Anisotropic GGX fabric ball - highlight cross-section measurements\n";
    f << "Angles in degrees; colours in tone-mapped sRGB [0,1].\n\n";
    auto dump = [&](const char* name, const MeasurementResult& m) {
        f << "[" << name << "]\n";
        f << "  tangent   section peak centroid: " << m.peak_angle_t << " deg\n";
        f << "  bitangent section peak centroid: " << m.peak_angle_b << " deg\n";
        f << "  tangent   lobe RMS width: " << m.width_t << " deg\n";
        f << "  bitangent lobe RMS width: " << m.width_b << " deg\n";
        f << "  anisotropy width ratio (T/B): "
          << (m.width_b > 1e-5f ? m.width_t / m.width_b : 0.f) << "\n";
        f << "  seam colour left  = (" << m.color_left.r << ", "
          << m.color_left.g << ", " << m.color_left.b << ")\n";
        f << "  seam colour right = (" << m.color_right.r << ", "
          << m.color_right.g << ", " << m.color_right.b << ")\n";
        f << "  seam colour delta (RGB distance): " << m.color_delta << "\n";
        f << "  highlight luminance jump across seam: "
          << m.direction_jump << "\n\n";
    };
    dump("mirror-aware tangent frame (handedness corrected)", rep.corrected);
    dump("naive interpolated tangent frame", rep.naive);
    dump("specular-only GGX lobe (clean cross-sections)", rep.specOnly);

    f << "CSV: angle_deg,tangent_section_lum,bitangent_section_lum\n";
    size_t n = std::max(rep.sectionT.size(), rep.sectionB.size());
    for (size_t i = 0; i < n; ++i) {
        float angle = -60.f + 120.f * float(i) / float(n ? n - 1 : 1);
        f << angle << ","
          << (i < rep.sectionT.size() ? rep.sectionT[i].second : 0.f) << ","
          << (i < rep.sectionB.size() ? rep.sectionB[i].second : 0.f) << "\n";
    }
}
