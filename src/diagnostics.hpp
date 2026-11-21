#pragma once
#include "csm.hpp"
#include "scene.hpp"
#include "raster.hpp"
#include <string>
#include <vector>

struct CascadeMetrics {
    int index;
    float nearDepth, farDepth, sphereRadius;
    float texelWorld;
    float effectiveTexelsPerMeter;
    float screenPixelsPerMeterAtFar;
    float shadowTexelsPerCameraPixel;
    float snapResidualTexels, snapResidualWorld;
    bool frustumCovered;
};

struct BoundaryCheck {
    int boundary;
    float splitDepth, probeViewDepth;
    int lowerCascade, upperCascade;
    float lowerNdc, lowerStored, lowerError;
    float upperNdc, upperStored, upperError;
    int selectedAtSplit;
    bool passed;
};

struct RotationCoverage {
    int cascadeChecks;
    float maxAbsNdcXY, minNdcZ, maxNdcZ;
    bool passed;
};

struct PositionJitter {
    int sampledFrames, cascadeSamples;
    float maxSubtexelOffset, maxWorldOffset;
    bool centersOnIntegerTexels;
    bool passed;
};

struct DiagnosticReport {
    bool passed;
    std::string depthConvention;
    std::vector<CascadeMetrics> cascades;
    std::vector<BoundaryCheck> boundaries;
    RotationCoverage rotation;
    PositionJitter jitter;
    // Trajectory / scenario summary.
    int frames;
    float fps, durationSeconds, travelMeters, speedMps, stepM;
    float yawSweepDeg, sunElevationDeg, wallLengthM;
    bool lowSun, slowPan;
};

DiagnosticReport runDiagnostics(const Scene& scene,
                                const TrajectoryConfig& traj,
                                const CameraParams& camParams,
                                const CSMConfig& csmCfg,
                                std::vector<ColorBuffer>& shadowMaps);

void writeDiagnosticsJSON(const std::string& path, const DiagnosticReport& r);
std::string formatDiagnosticText(const DiagnosticReport& r);
