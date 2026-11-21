#include "mesh.hpp"

#include <cmath>
#include <map>
#include <set>
#include <utility>

namespace {

struct EdgeRecord {
    int count = 0;
    int face[2] = {-1, -1};
    uint32_t orientedA[2] = {0, 0};
    uint32_t orientedB[2] = {0, 0};
};

uint32_t addVertex(Mesh& mesh, Vec3 position, Vec3 normal) {
    mesh.vertices.push_back({position, normal});
    return static_cast<uint32_t>(mesh.vertices.size() - 1);
}

void addQuad(Mesh& mesh, Vec3 a, Vec3 b, Vec3 c, Vec3 d, Vec3 normal) {
    const uint32_t base = static_cast<uint32_t>(mesh.vertices.size());
    addVertex(mesh, a, normal);
    addVertex(mesh, b, normal);
    addVertex(mesh, c, normal);
    addVertex(mesh, d, normal);
    mesh.indices.insert(mesh.indices.end(),
                        {base, base + 1, base + 2, base, base + 2, base + 3});
}

struct WeldedPosition {
    Vec3 position;
    int id = -1;
};

int weldId(std::vector<WeldedPosition>& welded, Vec3 p) {
    for (size_t i = 0; i < welded.size(); ++i) {
        if (lengthSquared(welded[i].position - p) < 1e-10f) {
            return welded[i].id;
        }
    }
    const int id = static_cast<int>(welded.size());
    welded.push_back({p, id});
    return id;
}

}  // namespace

Mesh makeBox(std::string name, Vec3 center, Vec3 h, Vec3 color) {
    Mesh mesh;
    mesh.name = std::move(name);
    mesh.color = color;
    const Vec3 x{h.x, 0.0f, 0.0f};
    const Vec3 y{0.0f, h.y, 0.0f};
    const Vec3 z{0.0f, 0.0f, h.z};
    const Vec3 c = center;

    addQuad(mesh, c + x - y - z, c + x + y - z, c + x + y + z, c + x - y + z,
            {1, 0, 0});
    addQuad(mesh, c - x - y + z, c - x + y + z, c - x + y - z, c - x - y - z,
            {-1, 0, 0});
    addQuad(mesh, c - x + y + z, c + x + y + z, c + x + y - z, c - x + y - z,
            {0, 1, 0});
    addQuad(mesh, c - x - y - z, c + x - y - z, c + x - y + z, c - x - y + z,
            {0, -1, 0});
    addQuad(mesh, c - x - y + z, c + x - y + z, c + x + y + z, c - x + y + z,
            {0, 0, 1});
    addQuad(mesh, c + x - y - z, c - x - y - z, c - x + y - z, c + x + y - z,
            {0, 0, -1});
    return mesh;
}

Mesh makeSphere(std::string name, Vec3 center, float radius, int stacks, int slices, Vec3 color) {
    Mesh mesh;
    mesh.name = std::move(name);
    mesh.color = color;
    stacks = std::max(3, stacks);
    slices = std::max(3, slices);

    addVertex(mesh, center + Vec3{0.0f, radius, 0.0f}, {0.0f, 1.0f, 0.0f});
    for (int i = 1; i < stacks; ++i) {
        const float theta = kPi * static_cast<float>(i) / static_cast<float>(stacks);
        const float sy = std::cos(theta);
        const float sr = std::sin(theta);
        for (int j = 0; j < slices; ++j) {
            const float phi = 2.0f * kPi * static_cast<float>(j) / static_cast<float>(slices);
            const Vec3 n{sr * std::cos(phi), sy, sr * std::sin(phi)};
            addVertex(mesh, center + n * radius, n);
        }
    }
    const uint32_t bottom = static_cast<uint32_t>(mesh.vertices.size());
    addVertex(mesh, center + Vec3{0.0f, -radius, 0.0f}, {0.0f, -1.0f, 0.0f});

    const auto ring = [slices](int layer, int j) {
        return static_cast<uint32_t>(1 + (layer - 1) * slices + (j % slices));
    };
    for (int j = 0; j < slices; ++j) {
        mesh.indices.insert(mesh.indices.end(),
                            {0, ring(1, j + 1), ring(1, j)});
    }
    for (int i = 1; i < stacks - 1; ++i) {
        for (int j = 0; j < slices; ++j) {
            const uint32_t a = ring(i, j);
            const uint32_t b = ring(i, j + 1);
            const uint32_t c = ring(i + 1, j);
            const uint32_t d = ring(i + 1, j + 1);
            mesh.indices.insert(mesh.indices.end(), {a, b, c, b, d, c});
        }
    }
    for (int j = 0; j < slices; ++j) {
        mesh.indices.insert(mesh.indices.end(),
                            {bottom, ring(stacks - 1, j), ring(stacks - 1, j + 1)});
    }
    return mesh;
}

Mesh makeFloor(float halfX, float halfZ, Vec3 color) {
    Mesh mesh;
    mesh.name = "floor";
    mesh.color = color;
    mesh.castsShadow = false;
    const int nx = 24;
    const int nz = 24;
    for (int iz = 0; iz <= nz; ++iz) {
        for (int ix = 0; ix <= nx; ++ix) {
            const float x = -halfX + 2.0f * halfX * static_cast<float>(ix) / nx;
            const float z = -halfZ + 2.0f * halfZ * static_cast<float>(iz) / nz;
            addVertex(mesh, {x, 0.0f, z}, {0.0f, 1.0f, 0.0f});
        }
    }
    for (int iz = 0; iz < nz; ++iz) {
        for (int ix = 0; ix < nx; ++ix) {
            const uint32_t a = static_cast<uint32_t>(iz * (nx + 1) + ix);
            const uint32_t b = a + 1;
            const uint32_t c = a + static_cast<uint32_t>(nx + 1);
            const uint32_t d = c + 1;
            mesh.indices.insert(mesh.indices.end(), {a, c, b, b, c, d});
        }
    }
    return mesh;
}

ShadowVolume buildShadowVolume(const Mesh& mesh, Vec3 lightPosition, float extrusionDistance) {
    ShadowVolume volume;
    volume.positions.resize(mesh.vertices.size() * 2);
    for (size_t i = 0; i < mesh.vertices.size(); ++i) {
        const Vec3 p = mesh.vertices[i].position;
        volume.positions[i] = p;
        Vec3 direction = p - lightPosition;
        const float d = length(direction);
        direction = d > 1e-6f ? direction / d : Vec3{0.0f, 1.0f, 0.0f};
        volume.positions[mesh.vertices.size() + i] = p + direction * extrusionDistance;
    }

    const size_t triangleCount = mesh.indices.size() / 3;
    volume.triangleCount = static_cast<int>(triangleCount);
    std::vector<bool> lightFacing(triangleCount, false);
    std::vector<Vec3> faceNormal(triangleCount);

    std::vector<WeldedPosition> welded;
    std::vector<int> positionId(mesh.vertices.size(), -1);
    for (size_t i = 0; i < mesh.vertices.size(); ++i) {
        positionId[i] = weldId(welded, mesh.vertices[i].position);
    }

    std::map<std::pair<int, int>, EdgeRecord> edges;
    for (size_t t = 0; t < triangleCount; ++t) {
        const uint32_t i0 = mesh.indices[t * 3 + 0];
        const uint32_t i1 = mesh.indices[t * 3 + 1];
        const uint32_t i2 = mesh.indices[t * 3 + 2];
        const Vec3 a = mesh.vertices[i0].position;
        const Vec3 b = mesh.vertices[i1].position;
        const Vec3 c = mesh.vertices[i2].position;
        const Vec3 n = normalize(cross(b - a, c - a));
        faceNormal[t] = n;
        lightFacing[t] = dot(n, lightPosition - (a + b + c) / 3.0f) > 1e-5f;

        const uint32_t tri[3] = {i0, i1, i2};
        for (int e = 0; e < 3; ++e) {
            const uint32_t va = tri[e];
            const uint32_t vb = tri[(e + 1) % 3];
            const int pa = positionId[va];
            const int pb = positionId[vb];
            if (pa == pb) {
                ++volume.degenerateEdges;
                continue;
            }
            const auto key = std::minmax(pa, pb);
            EdgeRecord& record = edges[key];
            if (record.count < 2) {
                record.face[record.count] = static_cast<int>(t);
                record.orientedA[record.count] = va;
                record.orientedB[record.count] = vb;
            }
            ++record.count;
        }
    }

    for (size_t t = 0; t < triangleCount; ++t) {
        if (!lightFacing[t]) {
            continue;
        }
        const uint32_t i0 = mesh.indices[t * 3 + 0];
        const uint32_t i1 = mesh.indices[t * 3 + 1];
        const uint32_t i2 = mesh.indices[t * 3 + 2];
        const uint32_t n = static_cast<uint32_t>(mesh.vertices.size());
        volume.frontCapIndices.insert(volume.frontCapIndices.end(), {i0, i1, i2});
        volume.backCapIndices.insert(volume.backCapIndices.end(), {n + i2, n + i1, n + i0});
    }

    for (const auto& [key, record] : edges) {
        (void)key;
        if (record.count != 2) {
            ++volume.nonManifoldEdges;
            continue;
        }
        const int f0 = record.face[0];
        const int f1 = record.face[1];
        if (f0 < 0 || f1 < 0 || lightFacing[f0] == lightFacing[f1]) {
            continue;
        }
        const int frontSlot = lightFacing[f0] ? 0 : 1;
        const uint32_t a = record.orientedA[frontSlot];
        const uint32_t b = record.orientedB[frontSlot];
        volume.silhouetteEdges.push_back({a, b});

        const uint32_t n = static_cast<uint32_t>(mesh.vertices.size());
        const uint32_t a2 = n + a;
        const uint32_t b2 = n + b;
        volume.sideIndices.insert(volume.sideIndices.end(),
                                  {a, a2, b2, a, b2, b});
    }
    return volume;
}

bool rayMesh(const Mesh& mesh, const Ray& ray, float minT, float maxT, RayHit& hit) {
    bool found = false;
    float nearest = maxT;
    Vec3 nearestNormal;
    int nearestTriangle = -1;
    for (size_t t = 0; t < mesh.indices.size() / 3; ++t) {
        const Vec3 a = mesh.vertices[mesh.indices[t * 3 + 0]].position;
        const Vec3 b = mesh.vertices[mesh.indices[t * 3 + 1]].position;
        const Vec3 c = mesh.vertices[mesh.indices[t * 3 + 2]].position;
        float distance = 0.0f;
        Vec3 normal;
        if (rayTriangle(ray, a, b, c, minT, nearest, distance, normal)) {
            found = true;
            nearest = distance;
            nearestNormal = normal;
            nearestTriangle = static_cast<int>(t);
        }
    }
    if (found) {
        hit.hit = true;
        hit.t = nearest;
        hit.position = ray.origin + ray.direction * nearest;
        hit.normal = nearestNormal;
        hit.triangle = nearestTriangle;
    }
    return found;
}

bool pointInsideMesh(const Mesh& mesh, Vec3 point) {
    const Vec3 directions[3] = {
        normalize(Vec3{0.5773f, 0.5774f, 0.5771f}),
        normalize(Vec3{-0.331f, 0.812f, 0.479f}),
        normalize(Vec3{0.719f, -0.313f, 0.620f}),
    };
    int insideVotes = 0;
    for (Vec3 direction : directions) {
        Ray ray{point, direction};
        int crossings = 0;
        for (size_t t = 0; t < mesh.indices.size() / 3; ++t) {
            const Vec3 a = mesh.vertices[mesh.indices[t * 3 + 0]].position;
            const Vec3 b = mesh.vertices[mesh.indices[t * 3 + 1]].position;
            const Vec3 c = mesh.vertices[mesh.indices[t * 3 + 2]].position;
            float distance = 0.0f;
            Vec3 normal;
            if (rayTriangle(ray, a, b, c, 1e-4f, 1000.0f, distance, normal)) {
                ++crossings;
            }
        }
        insideVotes += (crossings % 2) != 0 ? 1 : 0;
    }
    return insideVotes >= 2;
}

bool pointInShadow(Vec3 point, Vec3 lightPosition, const std::vector<Mesh>& casters,
                   float surfaceBias) {
    const Vec3 delta = lightPosition - point;
    const float distance = length(delta);
    if (distance < surfaceBias) {
        return false;
    }
    const Ray ray{point, delta / distance};
    for (const Mesh& mesh : casters) {
        RayHit hit;
        if (rayMesh(mesh, ray, surfaceBias, distance - surfaceBias, hit)) {
            return true;
        }
    }
    return false;
}

Vec3 meshBoundsCenter(const Mesh& mesh) {
    if (mesh.vertices.empty()) {
        return {0.0f, 0.0f, 0.0f};
    }
    Vec3 lo = mesh.vertices[0].position;
    Vec3 hi = lo;
    for (const Vertex& v : mesh.vertices) {
        lo.x = std::min(lo.x, v.position.x);
        lo.y = std::min(lo.y, v.position.y);
        lo.z = std::min(lo.z, v.position.z);
        hi.x = std::max(hi.x, v.position.x);
        hi.y = std::max(hi.y, v.position.y);
        hi.z = std::max(hi.z, v.position.z);
    }
    return (lo + hi) * 0.5f;
}

float meshBoundsRadius(const Mesh& mesh) {
    const Vec3 center = meshBoundsCenter(mesh);
    float radius = 0.0f;
    for (const Vertex& v : mesh.vertices) {
        radius = std::max(radius, length(v.position - center));
    }
    return radius;
}
