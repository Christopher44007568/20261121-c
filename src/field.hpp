#pragma once
#include <cmath>
#include <string>
#include <stdexcept>
#include "vec.hpp"

// Analytic scalar fields. Each has genuine saddle points so that sweeping
// the iso threshold crosses critical values and changes topology.
//
//  blobs : two gaussians; saddle at origin (f ~= 0.197). Components 2 -> 1.
//  torus : g = (sqrt(x^2+y^2)-R)^2 + z^2. Saddle ring at g=0, pinch saddle
//          at origin with g = R^2 = 1: genus 1 -> 0 as iso crosses 1.
//  gyroid: sin/cos periodic minimal surface, dense with saddle faces.
using FieldFn = double (*)(const Vec3&);

inline double field_blobs(const Vec3& p) {
  const double s2 = 0.35;
  auto g = [&](double cx) {
    double dx = p.x - cx;
    return std::exp(-(dx * dx + p.y * p.y + p.z * p.z) / s2);
  };
  return g(-0.9) + g(0.9);
}

inline double field_torus(const Vec3& p) {
  const double R = 1.0;
  double r = std::sqrt(p.x * p.x + p.y * p.y);
  double d = r - R;
  return d * d + p.z * p.z;
}

inline double field_gyroid(const Vec3& p) {
  const double k = 2.0;  // spatial frequency
  return std::sin(k * p.x) * std::cos(k * p.y) +
         std::sin(k * p.y) * std::cos(k * p.z) +
         std::sin(k * p.z) * std::cos(k * p.x);
}

struct FieldInfo {
  FieldFn fn;
  Vec3 domainMin;
  Vec3 domainMax;
  double sweepLo, sweepHi;  // suggested sweep range crossing critical values
};

inline FieldInfo getField(const std::string& name) {
  if (name == "blobs")
    return {field_blobs, {-2.5, -2.5, -2.5}, {2.5, 2.5, 2.5}, 0.05, 0.9};
  if (name == "torus")
    return {field_torus, {-2.5, -2.5, -2.5}, {2.5, 2.5, 2.5}, 0.15, 1.6};
  if (name == "gyroid")
    return {field_gyroid, {-3.2, -3.2, -3.2}, {3.2, 3.2, 3.2}, -1.2, 1.2};
  throw std::runtime_error("unknown field: " + name +
                           " (expected blobs|torus|gyroid)");
}
