#pragma once
#include "math.hpp"
#include <vector>
#include <string>

struct Material {
    Vec3 albedo;
};

struct Vec3i { int x, y, z; };

struct Triangle {
    int a, b, c;
    int material;
};

struct Mesh {
    std::vector<Vec3> positions;
    std::vector<Triangle> tris;
    int addVertex(const Vec3& p) {
        positions.push_back(p);
        return static_cast<int>(positions.size()) - 1;
    }
};

struct Scene {
    Mesh mesh;
    std::vector<Material> materials;
    Vec3 sunDir;          // unit vector: direction the light travels toward
    float sunElevationRad;

    int addMaterial(const Vec3& albedo);
    void addBox(const Vec3& center, const Vec3& half, int mat);
    // Per-face material override: indices order +x,-x,+y,-y,+z,-z, -1 keeps mat.
    void addBoxFaced(const Vec3& center, const Vec3& half, int mat,
                     const int faceMat[6]);
    void addPole(const Vec3& base, float height, float radius, int mat);
    void addIcoSphere(const Vec3& center, float radius, int subdiv, int mat);
};

Scene buildScene(float sunElevationDeg);
