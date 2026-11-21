// C++ shim: makes temporal_core.hlsli (an HLSL/C++ common subset) compile with
// a standard C++17 toolchain. Only the language features used by the shared
// core are emulated; no rendering APIs are involved.
#ifndef SHIM_CPP_H
#define SHIM_CPP_H

#include <algorithm>
#include <cmath>
#include <cstdint>

#define CORE_INLINE inline
#define OUT_PARAM /* HLSL out keyword; no-op in C++ */

struct float2
{
    float x, y;
    float2() : x(0.0f), y(0.0f) {}
    float2(float s) : x(s), y(s) {}
    float2(float x_, float y_) : x(x_), y(y_) {}
};

struct float3
{
    float x, y, z;
    float3() : x(0.0f), y(0.0f), z(0.0f) {}
    float3(float s) : x(s), y(s), z(s) {}
    float3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}
};

struct float4
{
    float x, y, z, w;
    float4() : x(0.0f), y(0.0f), z(0.0f), w(0.0f) {}
    float4(float s) : x(s), y(s), z(s), w(s) {}
    float4(float x_, float y_, float z_, float w_)
        : x(x_), y(y_), z(z_), w(w_) {}
};

inline float2 operator+(const float2& a, const float2& b)
{ return float2(a.x + b.x, a.y + b.y); }
inline float2 operator-(const float2& a, const float2& b)
{ return float2(a.x - b.x, a.y - b.y); }
inline float2 operator*(const float2& a, const float2& b)
{ return float2(a.x * b.x, a.y * b.y); }
inline float2 operator/(const float2& a, const float2& b)
{ return float2(a.x / b.x, a.y / b.y); }
inline float2 operator*(float s, const float2& a)
{ return float2(s * a.x, s * a.y); }
inline float2 operator*(const float2& a, float s) { return s * a; }

inline float3 operator+(const float3& a, const float3& b)
{ return float3(a.x + b.x, a.y + b.y, a.z + b.z); }
inline float3 operator-(const float3& a, const float3& b)
{ return float3(a.x - b.x, a.y - b.y, a.z - b.z); }
inline float3 operator*(const float3& a, const float3& b)
{ return float3(a.x * b.x, a.y * b.y, a.z * b.z); }
inline float3 operator/(const float3& a, const float3& b)
{ return float3(a.x / b.x, a.y / b.y, a.z / b.z); }
inline float3 operator*(float s, const float3& a)
{ return float3(s * a.x, s * a.y, s * a.z); }
inline float3 operator*(const float3& a, float s) { return s * a; }

inline float4 operator+(const float4& a, const float4& b)
{ return float4(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w); }
inline float4 operator-(const float4& a, const float4& b)
{ return float4(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w); }
inline float4 operator*(const float4& a, const float4& b)
{ return float4(a.x * b.x, a.y * b.y, a.z * b.z, a.w * b.w); }
inline float4 operator/(const float4& a, const float4& b)
{ return float4(a.x / b.x, a.y / b.y, a.z / b.z, a.w / b.w); }
inline float4 operator*(float s, const float4& a)
{ return float4(s * a.x, s * a.y, s * a.z, s * a.w); }
inline float4 operator*(const float4& a, float s) { return s * a; }

// ---- HLSL intrinsic emulation ---------------------------------------------

inline float abs(float x) { return std::fabs(x); }
inline float exp(float x) { return std::exp(x); }
inline float min(float a, float b) { return std::min(a, b); }
inline float max(float a, float b) { return std::max(a, b); }
inline float clamp(float x, float lo, float hi)
{ return std::max(lo, std::min(hi, x)); }
inline float smoothstep(float e0, float e1, float x)
{
    float t = clamp((x - e0) / (e1 - e0), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

inline float2 min(const float2& a, const float2& b)
{ return float2(std::min(a.x, b.x), std::min(a.y, b.y)); }
inline float2 max(const float2& a, const float2& b)
{ return float2(std::max(a.x, b.x), std::max(a.y, b.y)); }

inline float3 min(const float3& a, const float3& b)
{ return float3(std::min(a.x, b.x), std::min(a.y, b.y), std::min(a.z, b.z)); }
inline float3 max(const float3& a, const float3& b)
{ return float3(std::max(a.x, b.x), std::max(a.y, b.y), std::max(a.z, b.z)); }

inline float4 min(const float4& a, const float4& b)
{ return float4(std::min(a.x, b.x), std::min(a.y, b.y),
                std::min(a.z, b.z), std::min(a.w, b.w)); }
inline float4 max(const float4& a, const float4& b)
{ return float4(std::max(a.x, b.x), std::max(a.y, b.y),
                std::max(a.z, b.z), std::max(a.w, b.w)); }

#include "temporal_core.hlsli"

#endif // SHIM_CPP_H
