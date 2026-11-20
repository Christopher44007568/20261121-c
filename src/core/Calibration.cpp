#include "core/Calibration.h"

#include <algorithm>
#include <cmath>
#include <sstream>

namespace micro {
namespace {

std::optional<double> radiusAtThreshold(const Volume &volume, const Vec3 &center,
                                        const Vec3 &direction,
                                        double searchRadiusUm, double stepUm,
                                        double threshold,
                                        Interpolation interpolation) {
    const Vec3 unitDirection = direction.normalized();
    double previousValue = volume.sampleWorld(center, interpolation);
    if (previousValue < threshold) {
        return std::nullopt;
    }
    for (double distanceUm = stepUm; distanceUm <= searchRadiusUm;
         distanceUm += stepUm) {
        const double value = volume.sampleWorld(
            center + unitDirection * distanceUm, interpolation);
        if (value < threshold) {
            const double fraction = clampd(
                (previousValue - threshold) / (previousValue - value), 0.0, 1.0);
            return distanceUm - stepUm + fraction * stepUm;
        }
        previousValue = value;
    }
    return std::nullopt;
}

Vec3 weightedCentroid(const Volume &volume, const Vec3 &center,
                      double halfSizeUm, double stepUm, double background,
                      Interpolation interpolation) {
    Vec3 sumPosition;
    double sumWeight = 0.0;
    const int steps = std::max(2, static_cast<int>(std::ceil(halfSizeUm / stepUm)));
    const double actualStep = halfSizeUm / steps;
    for (int z = -steps; z <= steps; ++z) {
        for (int y = -steps; y <= steps; ++y) {
            for (int x = -steps; x <= steps; ++x) {
                const Vec3 position =
                    center + Vec3{x * actualStep, y * actualStep, z * actualStep};
                const double value =
                    volume.sampleWorld(position, interpolation) - background;
                const double weight = std::max(0.0, value);
                sumPosition += position * weight;
                sumWeight += weight;
            }
        }
    }
    return sumWeight > 0.0 ? sumPosition / sumWeight : center;
}

double elevationDeg(const Vec3 &delta) {
    return radToDeg(std::atan2(delta.z, std::hypot(delta.x, delta.y)));
}

} // namespace

std::optional<ProfileResult> measureProfile(const Volume &volume, const Vec3 &center,
                                            const Vec3 &direction,
                                            double searchRadiusUm,
                                            double stepUm, double threshold,
                                            Interpolation interpolation) {
    const std::optional<double> positive =
        radiusAtThreshold(volume, center, direction, searchRadiusUm, stepUm,
                          threshold, interpolation);
    const std::optional<double> negative =
        radiusAtThreshold(volume, center, -direction, searchRadiusUm, stepUm,
                          threshold, interpolation);
    if (!positive || !negative) {
        return std::nullopt;
    }
    ProfileResult result;
    result.positiveRadiusUm = *positive;
    result.negativeRadiusUm = *negative;
    result.diameterUm = *positive + *negative;
    result.peak = volume.sampleWorld(center, interpolation);
    return result;
}

InterpolationValidation validateInterpolation(const Phantom &phantom,
                                              Interpolation interpolation) {
    const auto &spec = phantom.spec;
    const Volume &volume = phantom.volume;
    const double threshold = spec.threshold;
    InterpolationValidation result;
    result.interpolation = interpolation;

    const std::array<Vec3, 3> axes = {
        Vec3{1.0, 0.0, 0.0}, Vec3{0.0, 1.0, 0.0}, Vec3{0.0, 0.0, 1.0}};
    for (int axis = 0; axis < 3; ++axis) {
        const auto profile =
            measureProfile(volume, spec.sphereCenterUm, axes[axis],
                           spec.sphereDiameterUm * 0.75, 0.2, threshold,
                           interpolation);
        result.sphereDiameter[axis] = profile ? profile->diameterUm : 0.0;
        result.sphereMeanDiameterUm += result.sphereDiameter[axis] / 3.0;
    }
    result.sphereMeanErrorPct =
        (result.sphereMeanDiameterUm - spec.sphereDiameterUm) /
        spec.sphereDiameterUm * 100.0;

    const Vec3 rodA = spec.rodEndpointA();
    const Vec3 rodB = spec.rodEndpointB();
    const Vec3 axis = (rodB - rodA).normalized();
    Vec3 firstNormal = cross(axis, {0.0, 0.0, 1.0}).normalized();
    Vec3 profileNormal = cross(axis, firstNormal).normalized();
    if (profileNormal.z < 0.0) {
        profileNormal = -profileNormal;
    }
    const auto thickProfile =
        measureProfile(volume, spec.rodCenterUm, profileNormal,
                       spec.rodDiameterUm, 0.1, threshold, interpolation);
    if (thickProfile) {
        result.thickRod = *thickProfile;
    }

    const auto thinProfile =
        measureProfile(volume, spec.thinRodCenterUm, profileNormal,
                       spec.thinRodDiameterUm, 0.05, threshold, interpolation);
    if (thinProfile) {
        result.thinRod = *thinProfile;
    }

    const double centroidHalfSize =
        spec.fiducialDiameterUm * 0.5 + volume.geometry().spacingUm.z;
    const double centroidStep =
        std::max(1.5, volume.geometry().spacingUm.z * 0.2);
    result.measuredFiducialA =
        weightedCentroid(volume, spec.fiducialA, centroidHalfSize, centroidStep,
                         spec.background, interpolation);
    result.measuredFiducialB =
        weightedCentroid(volume, spec.fiducialB, centroidHalfSize, centroidStep,
                         spec.background, interpolation);
    const Vec3 delta = result.measuredFiducialB - result.measuredFiducialA;
    result.fiducialLengthUm = delta.length();
    result.fiducialTiltDeg = elevationDeg(delta);
    result.fiducialLengthErrorPct =
        (result.fiducialLengthUm - spec.fiducialLengthUm) /
        spec.fiducialLengthUm * 100.0;
    result.fiducialTiltErrorDeg = result.fiducialTiltDeg - spec.fiducialTiltDeg;
    return result;
}

ValidationReport runValidation(const Phantom &phantom) {
    ValidationReport report;
    report.spec = phantom.spec;
    for (Interpolation mode : {Interpolation::Nearest, Interpolation::Linear,
                               Interpolation::Cubic}) {
        report.rows.push_back(validateInterpolation(phantom, mode));
    }
    return report;
}

std::string ValidationReport::markdown() const {
    std::ostringstream out;
    out << "# 显微三维切片校准报告\n\n";
    out << "## 体模真值\n\n";
    out << "- 体素尺寸: " << spec.geometry.nx << " x " << spec.geometry.ny
        << " x " << spec.geometry.nz << "\n";
    out << "- 物理间距: X " << spec.geometry.spacingUm.x << " µm, Y "
        << spec.geometry.spacingUm.y << " µm, Z "
        << spec.geometry.spacingUm.z << " µm\n";
    out << "- 校准球直径: " << spec.sphereDiameterUm << " µm\n";
    out << "- 粗杆直径: " << spec.rodDiameterUm << " µm, 薄杆直径: "
        << spec.thinRodDiameterUm << " µm\n";
    out << "- 双标记中心距: " << formatNumber(spec.fiducialLengthUm, 2)
        << " µm, 相对 XY 平面倾角: " << formatNumber(spec.fiducialTiltDeg, 3)
        << "°\n";
    out << "- 测量阈值: " << spec.threshold << " (背景与信号中值)\n\n";

    out << "## 插值方式对比\n\n";
    out << "| 插值 | 球直径 X/Y/Z (µm) | 球直径误差 | 粗杆 FWHM | 薄杆 FWHM | 薄杆峰值 | 标记中心距 (µm) | 距离误差 | 倾角 (°) | 倾角误差 |\n";
    out << "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n";
    for (const auto &row : rows) {
        out << "| " << interpolationDisplayName(row.interpolation) << " | "
            << formatNumber(row.sphereDiameter[0], 2) << " / "
            << formatNumber(row.sphereDiameter[1], 2) << " / "
            << formatNumber(row.sphereDiameter[2], 2) << " | "
            << formatNumber(row.sphereMeanErrorPct, 2) << "% | "
            << formatNumber(row.thickRod.diameterUm, 2) << " µm | "
            << formatNumber(row.thinRod.diameterUm, 2) << " µm | "
            << formatNumber(row.thinRod.peak, 3) << " | "
            << formatNumber(row.fiducialLengthUm, 2) << " | "
            << formatNumber(row.fiducialLengthErrorPct, 2) << "% | "
            << formatNumber(row.fiducialTiltDeg, 3) << " | "
            << formatNumber(row.fiducialTiltErrorDeg, 3) << "° |\n";
    }
    const auto rowFor = [this](Interpolation mode) -> const InterpolationValidation & {
        return *std::find_if(rows.begin(), rows.end(), [mode](const auto &row) {
            return row.interpolation == mode;
        });
    };
    const auto &nearest = rowFor(Interpolation::Nearest);
    const auto &linear = rowFor(Interpolation::Linear);
    const auto &cubic = rowFor(Interpolation::Cubic);
    out << "\n## 薄结构结论\n\n";
    out << "- 最近邻：薄杆 FWHM " << formatNumber(nearest.thinRod.diameterUm, 2)
        << " µm，峰值 " << formatNumber(nearest.thinRod.peak, 3)
        << "。二值边缘保持锐利，但斜切面上会出现阶梯和采样相位跳变。\n";
    out << "- 三线性：薄杆 FWHM " << formatNumber(linear.thinRod.diameterUm, 2)
        << " µm，峰值 " << formatNumber(linear.thinRod.peak, 3)
        << "。部分体积过渡约覆盖一个体素尺度，峰值稳定。\n";
    out << "- 三立方：薄杆 FWHM " << formatNumber(cubic.thinRod.diameterUm, 2)
        << " µm，峰值 " << formatNumber(cubic.thinRod.peak, 3)
        << "。边缘更锐，但峰值超过 1 表示 Catmull-Rom 振铃/过冲；"
           "薄结构应同时看宽度和峰值。\n";
    out << "- 所有距离均由微米物理坐标计算，不受窗口缩放、显示器 DPI 或相机旋转影响。\n";
    return out.str();
}

} // namespace micro

