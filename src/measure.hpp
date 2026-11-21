#pragma once
#include "common.hpp"
#include <utility>

struct Camera {
    glm::vec3 pos;
    glm::mat4 viewProj;
    float fovY;
};

struct MeasureReport {
    MeasurementResult corrected;
    MeasurementResult naive;
    MeasurementResult specOnly;
    std::vector<std::pair<float, float>> sectionT; // angle, luminance
    std::vector<std::pair<float, float>> sectionB;
};

Camera make_camera(uint32_t w, uint32_t h);
glm::vec2 project(const glm::mat4& vp, glm::vec3 p, uint32_t w, uint32_t h);
std::vector<std::pair<float, float>>
sweep_section_public(const ImageData& img, const Camera& cam, bool horizontal,
                     glm::vec2 center, float radiusPx);

// Analyse a rendered frame. Sphere centre is assumed at the origin, radius 1.
MeasurementResult measure_frame(const ImageData& img, const Camera& cam,
                                float seam_u);

// Write a human-readable report plus CSV cross-sections.
void write_report(const std::string& path, const MeasureReport& rep);
