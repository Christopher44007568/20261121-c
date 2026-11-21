#include "diagnostics.hpp"
#include "raster.hpp"
#include <cstdio>
#include <algorithm>
#include <cmath>

static const float kPi = 3.14159265358979f;

static float screenPixelsPerMeter(const CameraParams& cp, float viewDepth) {
    float tanHalfY = std::tan(cp.fovYDeg * 0.5f * kPi / 180.0f);
    float worldPerPixel = (2.0f * viewDepth * tanHalfY) / 540.0f;
    return 1.0f / worldPerPixel;
}

static std::vector<Cascade> buildAll(const CameraState& cam,
                                     const CameraParams& cp,
                                     const CSMConfig& cfg,
                                     const Vec3& sunDir,
                                     const std::vector<float>& splits) {
    std::vector<Cascade> out;
    for (int i = 0; i < kCascadeCount; ++i)
        out.push_back(fitCascade(i, splits[i], splits[i + 1], cam, cp,
                                 sunDir, cfg));
    return out;
}

DiagnosticReport runDiagnostics(const Scene& scene,
                                const TrajectoryConfig& traj,
                                const CameraParams& camParams,
                                const CSMConfig& csmCfg,
                                std::vector<ColorBuffer>& shadowMaps) {
    DiagnosticReport r;
    r.depthConvention =
        "forward [0,1]: near=0, far=1, min-depth wins, "
        "occluded when stored + bias < receiver";
    std::vector<float> splits = cascadeSplits(csmCfg);
    CameraState mid = trajectoryFrame(traj, traj.frames / 2);
    std::vector<Cascade> cascades =
        buildAll(mid, camParams, csmCfg, scene.sunDir, splits);

    shadowMaps.clear();
    for (Cascade& c : cascades) {
        shadowMaps.emplace_back(csmCfg.shadowMapSize, csmCfg.shadowMapSize);
        ShadowRenderOpts sro;
        sro.texelWorld = c.texelWorld;
        renderShadowDepth(shadowMaps.back(), scene, c.lightVP, sro);
    }

    // ---- Per-cascade texel density ------------------------------------
    float sinElev = std::sin(scene.sunElevationRad);
    for (const Cascade& c : cascades) {
        CascadeMetrics m;
        m.index = c.index;
        m.nearDepth = c.nearDepth;
        m.farDepth = c.farDepth;
        m.sphereRadius = c.sphereRadius;
        m.texelWorld = c.texelWorld;
        // On the ground plane, one light-space texel projects to
        // texelWorld / sin(elevation) meters of ground distance.
        m.effectiveTexelsPerMeter = sinElev / c.texelWorld;
        m.screenPixelsPerMeterAtFar =
            screenPixelsPerMeter(camParams, c.farDepth);
        m.shadowTexelsPerCameraPixel =
            m.effectiveTexelsPerMeter / m.screenPixelsPerMeterAtFar;
        m.snapResidualTexels = c.snapResidualTexels;
        m.snapResidualWorld = c.snapResidualWorld;
        m.frustumCovered = c.frustumCovered;
        r.cascades.push_back(m);
    }

    // ---- Boundary depth convention ------------------------------------
    // Probe a ground point just inside each split. The same receiver depth
    // must read back identically from both neighbouring cascades, and the
    // selector must hand off to the upper cascade at the boundary.
    for (int b = 1; b < kCascadeCount; ++b) {
        BoundaryCheck bc;
        bc.boundary = b;
        bc.splitDepth = splits[b];
        float probeDepth = splits[b] - 0.025f;
        bc.probeViewDepth = probeDepth;
        bc.lowerCascade = b - 1;
        bc.upperCascade = b;
        // Exact split view depth; nudge to the camera's right so the probe
        // sits in direct sun within the frustum sphere, away from the wall.
        Vec3 probe = mid.pos + mid.forward() * probeDepth;
        probe += mid.right() * 2.0f;
        probe.y = 0.0f;

        const Cascade& lower = cascades[b - 1];
        const Cascade& upper = cascades[b];
        Vec3 lowerNdc = projectLight(lower, probe);
        Vec3 upperNdc = projectLight(upper, probe);
        int lx = static_cast<int>((lowerNdc.x * .5f + .5f) * csmCfg.shadowMapSize);
        int ly = static_cast<int>((lowerNdc.y * .5f + .5f) * csmCfg.shadowMapSize);
        int ux = static_cast<int>((upperNdc.x * .5f + .5f) * csmCfg.shadowMapSize);
        int uy = static_cast<int>((upperNdc.y * .5f + .5f) * csmCfg.shadowMapSize);
        float lowerStored = shadowSample(shadowMaps[b - 1], lx, ly);
        float upperStored = shadowSample(shadowMaps[b], ux, uy);
        bc.lowerNdc = lowerNdc.z;
        bc.lowerStored = lowerStored;
        bc.lowerError = std::abs(lowerNdc.z - lowerStored);
        bc.upperNdc = upperNdc.z;
        bc.upperStored = upperStored;
        bc.upperError = std::abs(upperNdc.z - upperStored);

        auto selector = [&](float d) {
            for (int i = 0; i < kCascadeCount; ++i)
                if (d < splits[i + 1]) return i;
            return kCascadeCount - 1;
        };
        int below = selector(splits[b] - 0.05f);
        int at = selector(splits[b]);
        int above = selector(splits[b] + 0.05f);
        bc.selectedAtSplit = at;
        bc.passed = below == b - 1 && at == b && above == b &&
                    bc.lowerError < 0.01f && bc.upperError < 0.01f;
        r.boundaries.push_back(bc);
    }

    // ---- Coverage after viewpoint turns -------------------------------
    // Sweep yaw across the full trajectory range; every cascade frustum
    // corner must stay inside its fitted light frustum.
    r.rotation.cascadeChecks = 0;
    r.rotation.maxAbsNdcXY = 0;
    r.rotation.minNdcZ = 1.0f;
    r.rotation.maxNdcZ = 0.0f;
    const int kYawSteps = 8;
    for (int s = 0; s < kYawSteps; ++s) {
        CameraState turned = mid;
        float half = traj.yawSweepPeakToPeakDeg * 0.5f * kPi / 180.0f;
        turned.yaw = -half + 2.0f * half * s / (kYawSteps - 1);
        for (int i = 0; i < kCascadeCount; ++i) {
            Cascade c = fitCascade(i, splits[i], splits[i + 1], turned,
                                   camParams, scene.sunDir, csmCfg);
            Vec3 corners[8];
            frustumCorners(turned, camParams, splits[i], splits[i + 1], corners);
            for (const Vec3& corner : corners) {
                Vec3 ndc = projectLight(c, corner);
                r.rotation.maxAbsNdcXY = std::max(
                    r.rotation.maxAbsNdcXY,
                    std::max(std::abs(ndc.x), std::abs(ndc.y)));
                r.rotation.minNdcZ = std::min(r.rotation.minNdcZ, ndc.z);
                r.rotation.maxNdcZ = std::max(r.rotation.maxNdcZ, ndc.z);
            }
            r.rotation.cascadeChecks++;
            if (!c.frustumCovered) r.rotation.passed = false;
        }
    }
    r.rotation.passed = r.rotation.maxAbsNdcXY <= 1.0f &&
                        r.rotation.minNdcZ >= 0.0f &&
                        r.rotation.maxNdcZ <= 1.0f;

    // ---- Position jitter under texel snapping -------------------------
    const int kSamples = 120;
    r.jitter.sampledFrames = kSamples;
    r.jitter.cascadeSamples = kSamples * kCascadeCount;
    r.jitter.maxSubtexelOffset = 0;
    r.jitter.maxWorldOffset = 0;
    r.jitter.centersOnIntegerTexels = true;
    for (int s = 0; s < kSamples; ++s) {
        int frame = static_cast<int>(
            static_cast<float>(s) * (traj.frames - 1) / (kSamples - 1));
        CameraState cam = trajectoryFrame(traj, frame);
        for (int i = 0; i < kCascadeCount; ++i) {
            Cascade c = fitCascade(i, splits[i], splits[i + 1], cam,
                                   camParams, scene.sunDir, csmCfg);
            r.jitter.maxSubtexelOffset = std::max(
                r.jitter.maxSubtexelOffset, c.snapResidualTexels);
            r.jitter.maxWorldOffset = std::max(
                r.jitter.maxWorldOffset, c.snapResidualWorld);
            // The recorded light-space origin is snapped onto integer texels.
            float gx = c.snappedLightOrigin.x / c.texelWorld;
            float gy = c.snappedLightOrigin.y / c.texelWorld;
            if (std::abs(gx - std::round(gx)) > 1e-3f ||
                std::abs(gy - std::round(gy)) > 1e-3f)
                r.jitter.centersOnIntegerTexels = false;
        }
    }
    r.jitter.passed = r.jitter.maxSubtexelOffset <= 0.5001f &&
                      r.jitter.centersOnIntegerTexels;

    // ---- Trajectory / scenario summary --------------------------------
    r.frames = traj.frames;
    r.fps = traj.fps;
    r.durationSeconds = traj.frames / traj.fps;
    r.travelMeters = traj.speed * r.durationSeconds;
    r.speedMps = traj.speed;
    r.stepM = traj.speed / traj.fps;
    r.yawSweepDeg = traj.yawSweepPeakToPeakDeg;
    r.sunElevationDeg = scene.sunElevationRad * 180.0f / kPi;
    r.wallLengthM = 124.0f;
    r.lowSun = r.sunElevationDeg <= 12.0f;
    r.slowPan = r.speedMps <= 1.5f;

    bool cascadeOk = true;
    for (const CascadeMetrics& m : r.cascades)
        cascadeOk &= m.frustumCovered;
    bool boundaryOk = true;
    for (const BoundaryCheck& bc : r.boundaries) boundaryOk &= bc.passed;
    r.passed = cascadeOk && boundaryOk && r.rotation.passed && r.jitter.passed;
    return r;
}

void writeDiagnosticsJSON(const std::string& path, const DiagnosticReport& r) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return;
    std::fprintf(f, "{\n");
    std::fprintf(f, "  \"passed\": %s,\n", r.passed ? "true" : "false");
    std::fprintf(f, "  \"depth_convention\": \"%s\",\n",
                 r.depthConvention.c_str());
    std::fprintf(f, "  \"trajectory\": {\n");
    std::fprintf(f, "    \"frames\": %d,\n", r.frames);
    std::fprintf(f, "    \"fps\": %f,\n", r.fps);
    std::fprintf(f, "    \"duration_seconds\": %f,\n", r.durationSeconds);
    std::fprintf(f, "    \"travel_meters\": %f,\n", r.travelMeters);
    std::fprintf(f, "    \"camera_speed_mps\": %f,\n", r.speedMps);
    std::fprintf(f, "    \"camera_step_m\": %f,\n", r.stepM);
    std::fprintf(f, "    \"yaw_sweep_degrees\": %f,\n", r.yawSweepDeg);
    std::fprintf(f, "    \"sun_elevation_degrees\": %f,\n", r.sunElevationDeg);
    std::fprintf(f, "    \"wall_length_m\": %f,\n", r.wallLengthM);
    std::fprintf(f, "    \"low_sun\": %s,\n", r.lowSun ? "true" : "false");
    std::fprintf(f, "    \"slow_pan\": %s\n", r.slowPan ? "true" : "false");
    std::fprintf(f, "  },\n");
    std::fprintf(f, "  \"cascades\": [\n");
    for (size_t i = 0; i < r.cascades.size(); ++i) {
        const CascadeMetrics& m = r.cascades[i];
        std::fprintf(f,
            "    {\"index\": %d, \"near_depth\": %f, \"far_depth\": %f, "
            "\"sphere_radius\": %f, \"texel_world_size\": %f, "
            "\"effective_shadow_texels_per_meter\": %f, "
            "\"screen_pixels_per_meter_at_far\": %f, "
            "\"shadow_texels_per_camera_pixel\": %f, "
            "\"snap_residual_texels\": %f, \"snap_residual_world_m\": %f, "
            "\"current_frustum_covered\": %s}%s\n",
            m.index, m.nearDepth, m.farDepth, m.sphereRadius, m.texelWorld,
            m.effectiveTexelsPerMeter, m.screenPixelsPerMeterAtFar,
            m.shadowTexelsPerCameraPixel, m.snapResidualTexels,
            m.snapResidualWorld, m.frustumCovered ? "true" : "false",
            i + 1 < r.cascades.size() ? "," : "");
    }
    std::fprintf(f, "  ],\n");
    std::fprintf(f, "  \"boundaries\": [\n");
    for (size_t i = 0; i < r.boundaries.size(); ++i) {
        const BoundaryCheck& b = r.boundaries[i];
        std::fprintf(f,
            "    {\"boundary\": %d, \"split_depth\": %f, "
            "\"probe_view_depth\": %f, \"lower_cascade\": %d, "
            "\"upper_cascade\": %d, \"lower_ndc\": %f, \"lower_stored\": %f, "
            "\"lower_error\": %f, \"upper_ndc\": %f, \"upper_stored\": %f, "
            "\"upper_error\": %f, \"selected_at_split\": %d, "
            "\"passed\": %s}%s\n",
            b.boundary, b.splitDepth, b.probeViewDepth, b.lowerCascade,
            b.upperCascade, b.lowerNdc, b.lowerStored, b.lowerError,
            b.upperNdc, b.upperStored, b.upperError, b.selectedAtSplit,
            b.passed ? "true" : "false",
            i + 1 < r.boundaries.size() ? "," : "");
    }
    std::fprintf(f, "  ],\n");
    std::fprintf(f,
        "  \"rotation_coverage\": {\"cascade_checks\": %d, "
        "\"maximum_abs_ndc_xy\": %f, \"minimum_ndc_z\": %f, "
        "\"maximum_ndc_z\": %f, \"passed\": %s},\n",
        r.rotation.cascadeChecks, r.rotation.maxAbsNdcXY,
        r.rotation.minNdcZ, r.rotation.maxNdcZ,
        r.rotation.passed ? "true" : "false");
    std::fprintf(f,
        "  \"position_jitter\": {\"sampled_frames\": %d, "
        "\"cascade_samples\": %d, \"maximum_subtexel_offset\": %f, "
        "\"maximum_world_offset_m\": %f, "
        "\"centers_on_integer_texels\": %s, \"passed\": %s}\n",
        r.jitter.sampledFrames, r.jitter.cascadeSamples,
        r.jitter.maxSubtexelOffset, r.jitter.maxWorldOffset,
        r.jitter.centersOnIntegerTexels ? "true" : "false",
        r.jitter.passed ? "true" : "false");
    std::fprintf(f, "}\n");
    std::fclose(f);
}

std::string formatDiagnosticText(const DiagnosticReport& r) {
    char buf[512];
    std::string out = "Cascade shadow diagnostics\n";
    out += "Depth convention : " + r.depthConvention + "\n";
    std::snprintf(buf, sizeof(buf),
        "Trajectory       : %d frames @ %.3f fps, %.3f s, speed %.2f m/s, "
        "yaw sweep %.3f deg\n",
        r.frames, r.fps, r.durationSeconds, r.speedMps, r.yawSweepDeg);
    out += buf;
    std::snprintf(buf, sizeof(buf),
        "Sun / wall       : %.3f deg elevation, %.2f m wall\n\n",
        r.sunElevationDeg, r.wallLengthM);
    out += buf;
    out += "Cascade  Range (m)       Texel (m)  Shadow tx/m  "
           "Camera px/m  tx/px  Snap (tx)  Coverage\n";
    for (const CascadeMetrics& m : r.cascades) {
        std::snprintf(buf, sizeof(buf),
            "%7d  %7.3f - %8.3f  %10.3f  %11.3f  %12.3f  %5.3f  %9.3f  %s\n",
            m.index, m.nearDepth, m.farDepth, m.texelWorld,
            m.effectiveTexelsPerMeter, m.screenPixelsPerMeterAtFar,
            m.shadowTexelsPerCameraPixel, m.snapResidualTexels,
            m.frustumCovered ? "PASS" : "FAIL");
        out += buf;
    }
    out += "\nBoundary depth checks\n";
    for (const BoundaryCheck& b : r.boundaries) {
        std::snprintf(buf, sizeof(buf),
            "  split %d @ %.3f m: lower ndc %.3f / stored %.3f "
            "(err %.4f), upper ndc %.3f / stored %.3f (err %.4f), "
            "select %d->%d->%d [%s]\n",
            b.boundary, b.splitDepth, b.lowerNdc, b.lowerStored, b.lowerError,
            b.upperNdc, b.upperStored, b.upperError,
            b.lowerCascade, b.selectedAtSplit, b.upperCascade,
            b.passed ? "PASS" : "FAIL");
        out += buf;
    }
    std::snprintf(buf, sizeof(buf),
        "\nRotation coverage : %d cascade checks, max |xy| %.3f, "
        "z [%.3f, %.3f] [%s]\n",
        r.rotation.cascadeChecks, r.rotation.maxAbsNdcXY,
        r.rotation.minNdcZ, r.rotation.maxNdcZ,
        r.rotation.passed ? "PASS" : "FAIL");
    out += buf;
    std::snprintf(buf, sizeof(buf),
        "Position jitter   : %d frames, max %.3f texel / %.3f m snap "
        "offset, integer grid [%s]\n",
        r.jitter.sampledFrames, r.jitter.maxSubtexelOffset,
        r.jitter.maxWorldOffset,
        r.jitter.centersOnIntegerTexels ? "PASS" : "FAIL");
    out += buf;
    out += "Overall           : ";
    out += r.passed ? "PASS\n" : "FAIL\n";
    return out;
}
