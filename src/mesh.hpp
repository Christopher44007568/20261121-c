#pragma once

#include "math.hpp"

#include <cstdint>
#include <string>
#include <vector>

struct Vertex {
    Vec3 position;
    Vec3 normal;
};

struct Mesh {
    std::string name;
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
    Vec3 color{0.7f, 0.7f, 0.7f};
    bool castsShadow = true;
};

struct SilhouetteEdge {
    uint32_t a = 0;
    uint32_t b = 0;
};

struct ShadowVolume {
    std::vector<Vec3> positions;
    std::vector<uint32_t> frontCapIndices;
    std::vector<uint32_t> backCapIndices;
    std::vector<uint32_t> sideIndices;
    std::vector<SilhouetteEdge> silhouetteEdges;
    int triangleCount = 0;
    int nonManifoldEdges = 0;
    int degenerateEdges = 0;

    size_t indices() const {
        return frontCapIndices.size() + backCapIndices.size() + sideIndices.size();
    }
};

Mesh makeBox(std::string name, Vec3 center, Vec3 halfExtents, Vec3 color);
Mesh makeSphere(std::string name, Vec3 center, float radius, int stacks, int slices, Vec3 color);
Mesh makeFloor(float halfX, float halfZ, Vec3 color);

ShadowVolume buildShadowVolume(const Mesh& mesh, Vec3 lightPosition, float extrusionDistance);

bool rayMesh(const Mesh& mesh, const Ray& ray, float minT, float maxT, RayHit& hit);
bool pointInsideMesh(const Mesh& mesh, Vec3 point);
bool pointInShadow(Vec3 point, Vec3 lightPosition, const std::vector<Mesh>& casters,
                   float surfaceBias = 0.002f);

Vec3 meshBoundsCenter(const Mesh& mesh);
float meshBoundsRadius(const Mesh& mesh);

