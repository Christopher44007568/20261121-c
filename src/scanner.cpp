// Offline laser-scanning prototype on Embree (CPU ray tracing).
//
// Scene: a semi-transparent tilted front plate and an opaque tilted
// backplate. Each scanner ray records up to two echoes (distance +
// surface contribution). Depth maps are exported per scan angle as CSV,
// plus a scene.json describing the exact ground-truth geometry so an
// external script can verify echo ordering, missing values and the
// lateral projection analytically.

#include <embree4/rtcore.h>

#include <cmath>
#include <cstdio>
#include <fstream>
#include <iomanip>
#include <string>
#include <vector>

namespace {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kDeg = kPi / 180.0f;

struct Vec3 {
    float x, y, z;
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
};

float dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

struct Plate {
    std::string name;
    Vec3 center;      // meters
    float yaw_deg;    // rotation about +Y
    float width;      // lateral extent (local X), meters
    float height;     // vertical extent (local Y), meters
    float reflectance;
    float transmittance;  // 0 = opaque
};

struct Material {
    float reflectance;
    float transmittance;
};

struct ScanConfig {
    float az_min_deg = -30.0f, az_max_deg = 30.0f;
    int az_steps = 241;
    float el_min_deg = -12.0f, el_max_deg = 12.0f;
    int el_steps = 61;
};

// Local frame of a yaw-rotated plate: u = lateral, v = up, n = normal.
void plateFrame(const Plate& p, Vec3& u, Vec3& v, Vec3& n) {
    const float c = std::cos(p.yaw_deg * kDeg);
    const float s = std::sin(p.yaw_deg * kDeg);
    u = {c, 0.0f, -s};
    v = {0.0f, 1.0f, 0.0f};
    n = {s, 0.0f, c};
}

unsigned addPlate(RTCDevice device, RTCScene scene, const Plate& plate) {
    Vec3 u, v, n;
    plateFrame(plate, u, v, n);
    const float hw = 0.5f * plate.width;
    const float hh = 0.5f * plate.height;
    const Vec3 c = plate.center;
    // Counter-clockwise corners seen from +n.
    const Vec3 p0 = c + u * (-hw) + v * (-hh);
    const Vec3 p1 = c + u * ( hw) + v * (-hh);
    const Vec3 p2 = c + u * ( hw) + v * ( hh);
    const Vec3 p3 = c + u * (-hw) + v * ( hh);

    RTCGeometry geom = rtcNewGeometry(device, RTC_GEOMETRY_TYPE_TRIANGLE);
    float* vb = static_cast<float*>(rtcSetNewGeometryBuffer(
        geom, RTC_BUFFER_TYPE_VERTEX, 0, RTC_FORMAT_FLOAT3, 3 * sizeof(float), 4));
    const Vec3 pts[4] = {p0, p1, p2, p3};
    for (int i = 0; i < 4; ++i) {
        vb[3 * i + 0] = pts[i].x;
        vb[3 * i + 1] = pts[i].y;
        vb[3 * i + 2] = pts[i].z;
    }
    unsigned* ib = static_cast<unsigned*>(rtcSetNewGeometryBuffer(
        geom, RTC_BUFFER_TYPE_INDEX, 0, RTC_FORMAT_UINT3, 3 * sizeof(unsigned), 2));
    ib[0] = 0; ib[1] = 1; ib[2] = 2;
    ib[3] = 0; ib[4] = 2; ib[5] = 3;
    rtcCommitGeometry(geom);
    const unsigned id = rtcAttachGeometry(scene, geom);
    rtcReleaseGeometry(geom);
    return id;
}

struct Echo {
    float dist = NAN;
    float contrib = NAN;
    int geom = -1;
};

// Collect up to two echoes. Semi-transparent surfaces attenuate the
// throughput and let the ray continue; opaque surfaces terminate it.
int collectEchoes(RTCScene scene, const Vec3& org, const Vec3& dir,
                  const std::vector<Material>& mats, Echo echoes[2]) {
    Vec3 o = org;
    float throughput = 1.0f;
    float traveled = 0.0f;  // distance from the scanner origin
    int count = 0;
    for (int k = 0; k < 2; ++k) {
        RTCRayHit rh;
        rh.ray.org_x = o.x; rh.ray.org_y = o.y; rh.ray.org_z = o.z;
        rh.ray.dir_x = dir.x; rh.ray.dir_y = dir.y; rh.ray.dir_z = dir.z;
        rh.ray.tnear = 1e-4f;
        rh.ray.tfar = 1e30f;
        rh.ray.mask = 0xFFFFFFFFu;
        rh.ray.flags = 0;
        rh.hit.geomID = RTC_INVALID_GEOMETRY_ID;
        rh.hit.instID[0] = RTC_INVALID_GEOMETRY_ID;
        rtcIntersect1(scene, &rh, nullptr);
        if (rh.hit.geomID == RTC_INVALID_GEOMETRY_ID) break;

        const Material& m = mats[rh.hit.geomID];
        Vec3 nrm = {rh.hit.Ng_x, rh.hit.Ng_y, rh.hit.Ng_z};
        const float inv = 1.0f / std::sqrt(dot(nrm, nrm));
        nrm = nrm * inv;
        float cosi = -dot(nrm, dir);
        if (cosi < 0.0f) cosi = -cosi;  // plates are double-sided

        echoes[count].dist = traveled + rh.ray.tfar;
        echoes[count].contrib = throughput * m.reflectance * cosi;
        echoes[count].geom = static_cast<int>(rh.hit.geomID);
        ++count;

        if (m.transmittance <= 0.0f) break;
        throughput *= m.transmittance;
        traveled += rh.ray.tfar;
        o = o + dir * (rh.ray.tfar + 1e-4f);
    }
    return count;
}

void writeCsv(const std::string& path, const std::vector<float>& grid,
              int rows, int cols) {
    std::ofstream f(path);
    f << std::setprecision(9);
    for (int r = 0; r < rows; ++r) {
        for (int c = 0; c < cols; ++c) {
            const float v = grid[r * cols + c];
            if (std::isnan(v)) f << "nan";
            else f << v;
            f << (c + 1 < cols ? ',' : '\n');
        }
    }
}

void writeCsvInt(const std::string& path, const std::vector<int>& grid,
                 int rows, int cols) {
    std::ofstream f(path);
    for (int r = 0; r < rows; ++r) {
        for (int c = 0; c < cols; ++c) {
            f << grid[r * cols + c] << (c + 1 < cols ? ',' : '\n');
        }
    }
}

}  // namespace

int main(int argc, char** argv) {
    const std::string outdir = (argc > 1) ? argv[1] : "artifacts";

    // Ground-truth scene: semi-transparent front plate, opaque backplate.
    // The lateral offset of the backplate creates an occlusion edge where
    // rays transmitted through the front plate miss the backplate.
    const std::vector<Plate> plates = {
        {"front_semitransparent", {0.00f, 0.0f, 2.0f},  20.0f, 1.20f, 1.00f, 0.40f, 0.60f},
        {"back_opaque",           {0.90f, 0.0f, 3.5f}, -15.0f, 1.60f, 1.20f, 0.90f, 0.00f},
    };
    const ScanConfig cfg;

    RTCDevice device = rtcNewDevice(nullptr);
    RTCScene scene = rtcNewScene(device);
    std::vector<Material> mats;
    for (const Plate& p : plates) {
        const unsigned id = addPlate(device, scene, p);
        if (id != mats.size()) return 1;  // expect dense geomIDs
        mats.push_back({p.reflectance, p.transmittance});
    }
    rtcCommitScene(scene);

    const int rows = cfg.el_steps, cols = cfg.az_steps;
    std::vector<float> depth[2], contrib[2];
    std::vector<int> geomId[2];
    for (int k = 0; k < 2; ++k) {
        depth[k].assign(rows * cols, NAN);
        contrib[k].assign(rows * cols, NAN);
        geomId[k].assign(rows * cols, -1);
    }

    const Vec3 org{0.0f, 0.0f, 0.0f};
    for (int r = 0; r < rows; ++r) {
        const float el = (cfg.el_min_deg +
            (cfg.el_max_deg - cfg.el_min_deg) * r / (rows - 1)) * kDeg;
        for (int c = 0; c < cols; ++c) {
            const float az = (cfg.az_min_deg +
                (cfg.az_max_deg - cfg.az_min_deg) * c / (cols - 1)) * kDeg;
            const Vec3 dir{std::cos(el) * std::sin(az), std::sin(el),
                           std::cos(el) * std::cos(az)};
            Echo echoes[2];
            const int n = collectEchoes(scene, org, dir, mats, echoes);
            for (int k = 0; k < n; ++k) {
                depth[k][r * cols + c] = echoes[k].dist;
                contrib[k][r * cols + c] = echoes[k].contrib;
                geomId[k][r * cols + c] = echoes[k].geom;
            }
        }
    }

    const char* names[4] = {"depth_echo1.csv", "depth_echo2.csv",
                            "contrib_echo1.csv", "contrib_echo2.csv"};
    for (int k = 0; k < 2; ++k) {
        writeCsv(outdir + "/" + names[k], depth[k], rows, cols);
        writeCsv(outdir + "/" + names[k + 2], contrib[k], rows, cols);
        writeCsvInt(outdir + "/geom_echo" + std::to_string(k + 1) + ".csv",
                    geomId[k], rows, cols);
    }

    // Ground-truth description for the independent verifier.
    std::ofstream js(outdir + "/scene.json");
    js << "{\n  \"scanner_origin\": [0, 0, 0],\n"
       << "  \"azimuth_deg\": [" << cfg.az_min_deg << ", " << cfg.az_max_deg
       << ", " << cfg.az_steps << "],\n"
       << "  \"elevation_deg\": [" << cfg.el_min_deg << ", " << cfg.el_max_deg
       << ", " << cfg.el_steps << "],\n"
       << "  \"plates\": [\n";
    for (size_t i = 0; i < plates.size(); ++i) {
        const Plate& p = plates[i];
        js << "    {\"name\": \"" << p.name << "\", \"center\": [" << p.center.x
           << ", " << p.center.y << ", " << p.center.z << "], \"yaw_deg\": "
           << p.yaw_deg << ", \"width\": " << p.width << ", \"height\": "
           << p.height << ", \"reflectance\": " << p.reflectance
           << ", \"transmittance\": " << p.transmittance << "}"
           << (i + 1 < plates.size() ? ",\n" : "\n");
    }
    js << "  ]\n}\n";

    rtcReleaseScene(scene);
    rtcReleaseDevice(device);
    std::printf("scan written to %s (%d x %d rays)\n", outdir.c_str(), rows, cols);
    return 0;
}
