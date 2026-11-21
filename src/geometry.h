#pragma once
#include "appstate.h"

struct Vertex {
    float px, py, pz;
    float nx, ny, nz;
    float u, v;
};

struct MeshData {
    std::vector<Vertex> verts;
    std::vector<uint32_t> indices;
};

MeshData BuildSphere(float radius, int slices, int stacks);
MeshData BuildGlasses();
MeshData BuildQuad(float w, float h); // pivot at top-center, hangs downward

// Procedural hair-strand alpha texture, RGBA8, full mip chain.
// Returns pixels per mip level (level 0 first).
std::vector<std::vector<uint8_t>> BuildHairTexture(int size, int& outMipCount);
