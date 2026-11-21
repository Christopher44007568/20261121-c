#include "scene.hpp"

int Scene::addMaterial(const Vec3& albedo) {
    materials.push_back({albedo});
    return static_cast<int>(materials.size()) - 1;
}

void Scene::addBox(const Vec3& center, const Vec3& half, int mat) {
    int none[6] = {-1,-1,-1,-1,-1,-1};
    addBoxFaced(center, half, mat, none);
}

void Scene::addBoxFaced(const Vec3& center, const Vec3& h, int mat,
                        const int faceMat[6]) {
    Vec3 p[8] = {
        center + Vec3(-h.x,-h.y,-h.z), center + Vec3( h.x,-h.y,-h.z),
        center + Vec3( h.x, h.y,-h.z), center + Vec3(-h.x, h.y,-h.z),
        center + Vec3(-h.x,-h.y, h.z), center + Vec3( h.x,-h.y, h.z),
        center + Vec3( h.x, h.y, h.z), center + Vec3(-h.x, h.y, h.z)
    };
    int base = static_cast<int>(mesh.positions.size());
    for (const Vec3& v : p) mesh.addVertex(v);
    auto addTri = [&](int i, int j, int k, int fm) {
        mesh.tris.push_back({base + i, base + j, base + k,
                             fm >= 0 ? fm : mat});
    };
    // Winding chosen so each face normal points away from the box center.
    addTri(4, 5, 6, faceMat[2]); addTri(4, 6, 7, faceMat[2]); // +y
    addTri(0, 2, 1, faceMat[3]); addTri(0, 3, 2, faceMat[3]); // -y
    addTri(5, 1, 2, faceMat[0]); addTri(5, 2, 6, faceMat[0]); // +x
    addTri(0, 4, 7, faceMat[1]); addTri(0, 7, 3, faceMat[1]); // -x
    addTri(4, 0, 1, faceMat[4]); addTri(4, 1, 5, faceMat[4]); // +z
    addTri(1, 3, 2, faceMat[5]); addTri(1, 2, 6, faceMat[5]); // -z
}

void Scene::addPole(const Vec3& base, float height, float radius, int mat) {
    const int seg = 12;
    int start = static_cast<int>(mesh.positions.size());
    for (int i = 0; i < seg; ++i) {
        float a = 2.0f * 3.14159265f * i / seg;
        Vec3 ring{radius * std::cos(a), 0, radius * std::sin(a)};
        mesh.addVertex(base + ring);
        mesh.addVertex(base + ring + Vec3(0, height, 0));
    }
    for (int i = 0; i < seg; ++i) {
        int j = (i + 1) % seg;
        int b0 = start + i * 2, t0 = b0 + 1;
        int b1 = start + j * 2, t1 = b1 + 1;
        mesh.tris.push_back({b0, t1, b1, mat});
        mesh.tris.push_back({b0, t0, t1, mat});
    }
}

static void subdivideIco(std::vector<Vec3>& verts, std::vector<Vec3i>& faces,
                         int levels) {
    for (int lvl = 0; lvl < levels; ++lvl) {
        const int nOld = static_cast<int>(verts.size());
        std::vector<Vec3> next = verts;
        // midpoint index keyed by unordered vertex pair; indices refer to the
        // final `next` array, where new vertices start at nOld.
        std::vector<int> mid(nOld * nOld, -1);
        auto midpoint = [&](int a, int b) {
            int lo = std::min(a, b), hi = std::max(a, b);
            int key = lo * nOld + hi;
            if (mid[key] >= 0) return mid[key];
            next.push_back(normalize(verts[a] + verts[b]));
            mid[key] = static_cast<int>(next.size()) - 1;
            return mid[key];
        };
        std::vector<Vec3i> nextFaces;
        for (const Vec3i& f : faces) {
            int ab = midpoint(f.x, f.y), bc = midpoint(f.y, f.z), ca = midpoint(f.z, f.x);
            nextFaces.push_back({f.x, ab, ca});
            nextFaces.push_back({f.y, bc, ab});
            nextFaces.push_back({f.z, ca, bc});
            nextFaces.push_back({ab, bc, ca});
        }
        verts = next;
        faces = nextFaces;
    }
}

void Scene::addIcoSphere(const Vec3& center, float radius, int subdiv, int mat) {
    const float t = (1.0f + std::sqrt(5.0f)) / 2.0f;
    std::vector<Vec3> verts = {
        {-1, t, 0}, {1, t, 0}, {-1, -t, 0}, {1, -t, 0},
        {0, -1, t}, {0, 1, t}, {0, -1, -t}, {0, 1, -t},
        {t, 0, -1}, {t, 0, 1}, {-t, 0, -1}, {-t, 0, 1}
    };
    for (Vec3& v : verts) v = normalize(v);
    std::vector<Vec3i> faces = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    subdivideIco(verts, faces, subdiv);
    int start = static_cast<int>(mesh.positions.size());
    for (const Vec3& v : verts) mesh.addVertex(center + v * radius);
    for (const Vec3i& f : faces)
        mesh.tris.push_back({start + f.x, start + f.y, start + f.z, mat});
}

Scene buildScene(float sunElevationDeg) {
    Scene s;
    int ground = s.addMaterial({0.45f, 0.24f, 0.18f});   // brown soil
    int wall   = s.addMaterial({0.22f, 0.16f, 0.16f});   // dark maroon wall
    int orange = s.addMaterial({0.95f, 0.62f, 0.25f});
    int dark   = s.addMaterial({0.12f, 0.09f, 0.06f});
    int yellow = s.addMaterial({0.95f, 0.90f, 0.30f});
    int white  = s.addMaterial({0.92f, 0.90f, 0.86f});

    // Tiled zero-thickness ground plane. Smaller triangles keep clipping and
    // perspective interpolation well-conditioned across the camera frustum;
    // solid side faces would otherwise corrupt grazing-angle shadow depth.
    const int kTiles = 32;
    const float kExtent = 160.0f;
    auto groundVid = [&](int i, int j) {
        Vec3 v(-kExtent + 2.0f * kExtent * i / kTiles, 0.0f,
               -kExtent + 2.0f * kExtent * j / kTiles);
        return s.mesh.addVertex(v);
    };
    for (int i = 0; i < kTiles; ++i) {
        for (int j = 0; j < kTiles; ++j) {
            int a = groundVid(i, j);
            int b = groundVid(i + 1, j);
            int c = groundVid(i + 1, j + 1);
            int d = groundVid(i, j + 1);
            s.mesh.tris.push_back({a, c, b, ground});
            s.mesh.tris.push_back({a, d, c, ground});
        }
    }

    // 124 m long straight wall running parallel to the camera path. It sits
    // on the +z side; the sun shines from -z so the camera-facing wall face
    // is lit while its 25 m shadow is thrown toward +z, clear of the probes.
    s.addBox({2.0f, 4.0f, 12.0f}, {62.0f, 4.0f, 0.5f}, wall);

    // Hero orange cube ahead of the trajectory start.
    s.addBox({6.0f, 1.0f, 3.0f}, {1.0f, 1.0f, 1.0f}, orange);

    // Dark box presenting a yellow face toward the camera.
    int faces[6] = {-1, -1, -1, -1, -1, yellow};
    s.addBoxFaced({11.0f, 0.75f, 4.5f}, {0.75f, 0.75f, 0.75f}, dark, faces);

    // White pole with a sphere cap (signpost).
    s.addPole({16.0f, 0.0f, 2.0f}, 3.2f, 0.12f, white);
    s.addIcoSphere({16.0f, 3.5f, 2.0f}, 0.35f, 2, white);

    // Small distant cube so far cascades contain real casters.
    s.addBox({30.0f, 0.5f, 5.0f}, {0.5f, 0.5f, 0.5f}, orange);

    const float elev = sunElevationDeg * 3.14159265f / 180.0f;
    // Sun shines from the -z (camera-right) side toward +z, lighting the
    // wall face seen by the camera and throwing its shadow behind the wall.
    Vec3 groundDir = normalize(Vec3(-0.6f, 0.0f, 1.0f));
    s.sunDir = normalize(Vec3(groundDir.x * std::cos(elev),
                              std::sin(elev),
                              groundDir.z * std::cos(elev)));
    s.sunElevationRad = elev;
    return s;
}
