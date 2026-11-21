#include "validation.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <sstream>

namespace {

struct PixelClass {
    bool visible = false;
    bool shadow = false;
    int object = -1;
    float depth = 0.0f;
};

PixelClass classifyPixel(const Scene& scene, const Camera& camera, Vec3 lightPosition,
                         int x, int y, int width, int height) {
    Ray ray = camera.rayThroughPixel(x, y, width, height);
    const float minT = camera.nearPlane + 1e-4f;
    RayHit nearest;
    nearest.t = camera.farPlane;
    float floorDistance = 0.0f;
    if (rayPlane(ray, {0.0f, 0.0f, 0.0f}, {0.0f, 1.0f, 0.0f}, minT,
                 camera.farPlane, floorDistance)) {
        const Vec3 floorPoint = ray.origin + ray.direction * floorDistance;
        if (std::abs(floorPoint.x) <= scene.floorHalfExtent &&
            std::abs(floorPoint.z) <= scene.floorHalfExtent) {
            nearest.hit = true;
            nearest.t = floorDistance;
            nearest.position = floorPoint;
            nearest.normal = {0.0f, 1.0f, 0.0f};
            nearest.object = -2;
        }
    }
    for (size_t i = 0; i < scene.casters.size(); ++i) {
        RayHit hit;
        if (rayMesh(scene.casters[i], ray, minT, nearest.t, hit)) {
            nearest = hit;
            nearest.object = static_cast<int>(i);
        }
    }
    if (!nearest.hit) {
        return {};
    }

    PixelClass result;
    result.visible = true;
    result.object = nearest.object;
    result.depth = nearest.t;
    const Vec3 toLight = lightPosition - nearest.position;
    const float distance = length(toLight);
    const Vec3 direction = distance > 1e-6f ? toLight / distance : Vec3{0.0f, 1.0f, 0.0f};
    const Ray shadowRay{nearest.position + direction * 0.004f, direction};
    for (const Mesh& caster : scene.casters) {
        RayHit hit;
        if (rayMesh(caster, shadowRay, 0.004f, distance - 0.008f, hit)) {
            result.shadow = true;
            break;
        }
    }
    return result;
}

bool stableNeighborhood(const Scene& scene, const Camera& camera, Vec3 lightPosition,
                        int x, int y, int width, int height, const PixelClass& center) {
    const int offsets[8][2] = {{-1, 0}, {1, 0}, {0, -1}, {0, 1},
                               {-1, -1}, {1, -1}, {-1, 1}, {1, 1}};
    for (const auto& offset : offsets) {
        const int sx = x + offset[0];
        const int sy = y + offset[1];
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
            return false;
        }
        const PixelClass neighbor = classifyPixel(scene, camera, lightPosition,
                                                  sx, sy, width, height);
        if (!neighbor.visible || neighbor.object != center.object ||
            neighbor.shadow != center.shadow ||
            std::abs(neighbor.depth - center.depth) > 0.08f * std::max(1.0f, center.depth)) {
            return false;
        }
    }
    return true;
}

std::string jsonEscape(const std::string& input) {
    std::string output;
    for (char c : input) {
        if (c == '"' || c == '\\') {
            output.push_back('\\');
        }
        output.push_back(c);
    }
    return output;
}

void writeFrameJson(std::ostringstream& out, const FrameCheck& frame) {
    out << "{\"t\":" << frame.t
        << ",\"camera_inside_shadow\":" << (frame.cameraInsideShadow ? "true" : "false")
        << ",\"camera_inside_caster\":" << (frame.cameraInsideCaster ? "true" : "false")
        << ",\"near_plane_crosses_scene\":"
        << (frame.nearPlaneCrossesScene ? "true" : "false")
        << ",\"samples\":" << frame.samples
        << ",\"mismatches\":" << frame.mismatches
        << ",\"points\":[";
    for (size_t i = 0; i < frame.mismatchPoints.size(); ++i) {
        const PixelSample& point = frame.mismatchPoints[i];
        if (i != 0) {
            out << ',';
        }
        out << "{\"x\":" << point.x << ",\"y\":" << point.y
            << ",\"cpu_shadow\":" << (point.cpuShadow ? "true" : "false")
            << ",\"gpu_shadow\":" << (point.gpuShadow ? "true" : "false") << '}';
    }
    out << "]}";
}

void writePathJson(std::ostringstream& out, const PathCheck& path) {
    out << "{\"light_phase\":" << path.lightPhase
        << ",\"inside_shadow_frames\":" << path.insideShadowFrames
        << ",\"outside_shadow_frames\":" << path.outsideShadowFrames
        << ",\"enter_exit_transitions\":" << path.enterExitTransitions
        << ",\"near_plane_crossing_frames\":" << path.nearPlaneCrossingFrames
        << ",\"camera_inside_caster_any\":"
        << (path.cameraInsideCasterAny ? "true" : "false")
        << ",\"frames\":[";
    for (size_t i = 0; i < path.frames.size(); ++i) {
        if (i != 0) {
            out << ',';
        }
        writeFrameJson(out, path.frames[i]);
    }
    out << "]}";
}

}  // namespace

bool nearPlaneCrossesScene(const Scene& scene, const Camera& camera) {
    const Mat4 view = camera.view();
    for (const Mesh& mesh : scene.casters) {
        for (const Vertex& vertex : mesh.vertices) {
            const Vec4 viewPosition = view * Vec4{vertex.position.x, vertex.position.y,
                                                  vertex.position.z, 1.0f};
            const float depth = -viewPosition.z;
            if (depth > 0.0f && depth < camera.nearPlane) {
                return true;
            }
        }
    }
    return false;
}

bool cameraInsideAnyCaster(const Scene& scene, const Camera& camera) {
    for (const Mesh& mesh : scene.casters) {
        if (pointInsideMesh(mesh, camera.position)) {
            return true;
        }
    }
    return false;
}

bool cameraInsideShadow(const Scene& scene, const Camera& camera, Vec3 lightPosition) {
    return pointInShadow(camera.position, lightPosition, scene.casters, 0.004f);
}

FrameCheck validateFrame(const Scene& scene, const Camera& camera, Vec3 lightPosition,
                         const std::vector<uint8_t>& stencil, int width, int height,
                         float t, bool collectStableSamples, int stride) {
    FrameCheck frame;
    frame.t = t;
    frame.cameraInsideShadow = cameraInsideShadow(scene, camera, lightPosition);
    frame.cameraInsideCaster = cameraInsideAnyCaster(scene, camera);
    frame.nearPlaneCrossesScene = nearPlaneCrossesScene(scene, camera);
    if (!collectStableSamples || stencil.size() != static_cast<size_t>(width) * height) {
        return frame;
    }

    for (int y = stride / 2; y < height; y += stride) {
        for (int x = stride / 2; x < width; x += stride) {
            const PixelClass center = classifyPixel(scene, camera, lightPosition,
                                                    x, y, width, height);
            if (!center.visible || center.object != -2) {
                continue;
            }
            if (!stableNeighborhood(scene, camera, lightPosition, x, y, width, height,
                                    center)) {
                continue;
            }
            ++frame.samples;
            const bool gpuShadow = stencil[static_cast<size_t>(y) * width + x] != 0;
            if (frame.spotChecks.size() < 24 && frame.samples % 29 == 1) {
                frame.spotChecks.push_back({x, y, center.shadow, gpuShadow, center.object});
            }
            if (gpuShadow != center.shadow) {
                ++frame.mismatches;
                if (frame.mismatchPoints.size() < 16) {
                    frame.mismatchPoints.push_back(
                        {x, y, center.shadow, gpuShadow, center.object});
                }
            }
        }
    }
    return frame;
}

std::string validationJson(const std::string& glVersion, const std::string& glRenderer,
                           const std::string& glslVersion, const SampleCheck& hero,
                           const PathCheck& shadowPath, const PathCheck& nearPath,
                           const RenderResult& stats) {
    int pathSamples = 0;
    int pathMismatches = 0;
    for (const PathCheck* path : {&shadowPath, &nearPath}) {
        for (const FrameCheck& frame : path->frames) {
            pathSamples += frame.samples;
            pathMismatches += frame.mismatches;
        }
    }
    const bool pass = stats.nonManifoldEdges == 0 && hero.mismatches == 0 &&
                      pathMismatches == 0 && shadowPath.enterExitTransitions >= 2 &&
                      shadowPath.insideShadowFrames > 0 &&
                      shadowPath.outsideShadowFrames > 0 &&
                      nearPath.nearPlaneCrossingFrames > 0 &&
                      !shadowPath.cameraInsideCasterAny &&
                      !nearPath.cameraInsideCasterAny;
    std::ostringstream out;
    out << std::fixed << std::setprecision(6);
    out << "{\n"
        << "  \"pass\": " << (pass ? "true" : "false") << ",\n"
        << "  \"opengl\": {\"version\":\"" << jsonEscape(glVersion)
        << "\",\"renderer\":\"" << jsonEscape(glRenderer)
        << "\",\"glsl\":\"" << jsonEscape(glslVersion) << "\"},\n"
        << "  \"shadow_volume\": {\"triangles\":" << stats.volumeTriangles
        << ",\"silhouette_edges\":" << stats.silhouetteEdgeCount
        << ",\"front_cap_indices\":" << stats.frontCapIndices
        << ",\"back_cap_indices\":" << stats.backCapIndices
        << ",\"side_indices\":" << stats.sideIndices
        << ",\"non_manifold_edges\":" << stats.nonManifoldEdges << "},\n"
        << "  \"hero_pixel_check\": {\"cpu_ray_samples\":" << hero.samples
        << ",\"gpu_cpu_mismatches\":" << hero.mismatches
        << ",\"mismatch_rate\":"
        << (hero.samples > 0 ? static_cast<double>(hero.mismatches) / hero.samples : 0.0)
        << ",\"spot_checks\":[";
    for (size_t i = 0; i < hero.points.size(); ++i) {
        const PixelSample& point = hero.points[i];
        if (i != 0) {
            out << ',';
        }
        out << "{\"x\":" << point.x << ",\"y\":" << point.y
            << ",\"cpu_shadow\":" << (point.cpuShadow ? "true" : "false")
            << ",\"gpu_shadow\":" << (point.gpuShadow ? "true" : "false") << '}';
    }
    out << "],\"mismatch_points\":[";
    for (size_t i = 0; i < hero.mismatchPoints.size(); ++i) {
        const PixelSample& point = hero.mismatchPoints[i];
        if (i != 0) {
            out << ',';
        }
        out << "{\"x\":" << point.x << ",\"y\":" << point.y
            << ",\"cpu_shadow\":" << (point.cpuShadow ? "true" : "false")
            << ",\"gpu_shadow\":" << (point.gpuShadow ? "true" : "false") << '}';
    }
    out << "]},\n"
        << "  \"path_pixel_check\": {\"cpu_ray_samples\":" << pathSamples
        << ",\"gpu_cpu_mismatches\":" << pathMismatches << "},\n"
        << "  \"camera_shadow_crossing_path\": ";
    writePathJson(out, shadowPath);
    out << ",\n  \"near_clip_crossing_path\": ";
    writePathJson(out, nearPath);
    out << ",\n  \"notes\": {"
        << "\"method\":\"z-fail stencil with finite front/back caps, GL_DEPTH_CLAMP, and GL_LESS\","
        << "\"sample_filter\":\"floor receiver, CPU classification stable in 8-neighborhood\","
        << "\"cpu_ray_origin\":\"near-plane-clipped visible surface\","
        << "\"caster_surfaces\":\"redrawn after shadow application; CPU check targets floor receivers\"}\n}\n";
    return out.str();
}

void writeFramesCsv(const std::string& path, const PathCheck& shadowPath,
                    const PathCheck& nearPath) {
    std::ofstream stream(path);
    stream << "path,t,light_phase,inside_shadow,inside_caster,near_crosses,samples,mismatches\n";
    const auto writePath = [&](const char* name, const PathCheck& pathCheck) {
        for (const FrameCheck& frame : pathCheck.frames) {
            stream << name << ',' << frame.t << ',' << pathCheck.lightPhase << ','
                   << (frame.cameraInsideShadow ? 1 : 0) << ','
                   << (frame.cameraInsideCaster ? 1 : 0) << ','
                   << (frame.nearPlaneCrossesScene ? 1 : 0) << ','
                   << frame.samples << ',' << frame.mismatches << '\n';
        }
    };
    writePath("shadow_path", shadowPath);
    writePath("near_path", nearPath);
}
