// CPU path tracer: absorptive amber block with embedded droplets.
// Handles nested-dielectric ordering (medium stack), total internal
// reflection, and Beer-Lambert absorption over path length.
// Modes: validate | sweep | render   (see README.md)
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <random>
#include <vector>
#include <string>
#include <algorithm>

#ifdef _OPENMP
#include <omp.h>
#endif

// ---------------- vec3 ----------------
struct Vec3 {
    double x, y, z;
    Vec3() : x(0), y(0), z(0) {}
    Vec3(double v) : x(v), y(v), z(v) {}
    Vec3(double a, double b, double c) : x(a), y(b), z(c) {}
    Vec3 operator+(const Vec3& o) const { return {x+o.x, y+o.y, z+o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x-o.x, y-o.y, z-o.z}; }
    Vec3 operator*(double s) const { return {x*s, y*s, z*s}; }
    Vec3 operator*(const Vec3& o) const { return {x*o.x, y*o.y, z*o.z}; }
    Vec3 operator/(double s) const { return {x/s, y/s, z/s}; }
    Vec3& operator+=(const Vec3& o) { x+=o.x; y+=o.y; z+=o.z; return *this; }
    Vec3& operator*=(const Vec3& o) { x*=o.x; y*=o.y; z*=o.z; return *this; }
    Vec3& operator*=(double s) { x*=s; y*=s; z*=s; return *this; }
    double dot(const Vec3& o) const { return x*o.x + y*o.y + z*o.z; }
    Vec3 cross(const Vec3& o) const {
        return {y*o.z - z*o.y, z*o.x - x*o.z, x*o.y - y*o.x};
    }
    double len() const { return std::sqrt(dot(*this)); }
    Vec3 norm() const { double l = len(); return l > 0 ? *this / l : Vec3(0); }
    double maxc() const { return std::max(x, std::max(y, z)); }
    static Vec3 reflect(const Vec3& d, const Vec3& n) {
        return d - n * (2.0 * d.dot(n));
    }
    // Refract unit dir d (pointing into surface) with unit normal n
    // (oriented against d) and eta = n1/n2. Returns false on TIR.
    static bool refract(const Vec3& d, const Vec3& n, double eta, Vec3& out) {
        double cosi = -d.dot(n);
        double sin2t = eta * eta * (1.0 - cosi * cosi);
        if (sin2t > 1.0) return false;           // total internal reflection
        double cost = std::sqrt(1.0 - sin2t);
        out = d * eta + n * (eta * cosi - cost);
        return true;
    }
};

// Exact unpolarized Fresnel reflectance (used by both MC and analytics,
// so the acceptance test compares geometry/absorption, not approximations).
inline double fresnel_reflectance(double cosi, double n1, double n2) {
    double eta = n1 / n2;
    double sin2t = eta * eta * (1.0 - cosi * cosi);
    if (sin2t >= 1.0) return 1.0;                // TIR
    double cost = std::sqrt(1.0 - sin2t);
    double rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
    double rp = (n2 * cosi - n1 * cost) / (n2 * cosi + n1 * cost);
    return 0.5 * (rs * rs + rp * rp);
}

// ---------------- RNG ----------------
struct Rng {
    std::mt19937_64 gen;
    std::uniform_real_distribution<double> uni{0.0, 1.0};
    explicit Rng(uint64_t seed) : gen(seed) {}
    double next() { return uni(gen); }
};

// ---------------- media ----------------
// sigma_a: RGB absorption coefficient (1/length). Beer-Lambert:
// throughput *= exp(-sigma_a * distance_travelled_in_medium).
struct Medium {
    double ior;
    Vec3 sigma_a;
};

enum MediumId { MED_AIR = 0, MED_AMBER = 1, MED_DROPLET = 2, MED_BUBBLE = 3 };

static const Medium MEDIA[] = {
    {1.0,   Vec3(0.0)},                          // air
    {1.54,  Vec3(0.08, 0.45, 1.60)},             // amber: absorbs blue most
    {1.33,  Vec3(0.06, 0.05, 0.04)},             // droplet (watery inclusion)
    {1.00,  Vec3(0.0)},                          // air bubble inclusion
};

// Medium stack for nested dielectrics. Non-overlapping nested media only
// (droplets fully inside amber, amber fully inside air).
struct MediumStack {
    int st[8];
    int n = 0;
    void reset() { n = 1; st[0] = MED_AIR; }
    int top() const { return st[n - 1]; }
    void push(int m) { if (n < 8) st[n++] = m; }
    void pop() { if (n > 1) --n; }
    bool contains(int m) const {
        for (int i = 0; i < n; ++i) if (st[i] == m) return true;
        return false;
    }
};

inline Vec3 beer_lambert(const Vec3& sigma_a, double dist) {
    return {std::exp(-sigma_a.x * dist),
            std::exp(-sigma_a.y * dist),
            std::exp(-sigma_a.z * dist)};
}

// ---------------- analytic parallel-plate ----------------
// Infinite slab of thickness L, index n2 in medium n1, unpolarized light
// at incidence angle theta_i. Includes all internal multiple reflections
// and Beer-Lambert absorption along each slanted pass (length L/cos_t).
struct SlabAnalytic {
    Vec3 T, R;      // total transmittance / reflectance per channel
    double cos_t;
};

inline SlabAnalytic slab_analytic(double theta_i, double n1, double n2,
                                  const Vec3& sigma_a, double L) {
    SlabAnalytic out;
    double eta = n1 / n2;
    double sin2t = eta * eta * (1.0 - std::cos(theta_i) * std::cos(theta_i));
    double cos_t = sin2t < 1.0 ? std::sqrt(1.0 - sin2t) : 0.0;
    out.cos_t = cos_t;
    double R12 = fresnel_reflectance(std::cos(theta_i), n1, n2);
    double R21 = (R12 >= 1.0) ? 1.0 : fresnel_reflectance(cos_t, n2, n1);
    double tau[3] = {std::exp(-sigma_a.x * L / cos_t),
                     std::exp(-sigma_a.y * L / cos_t),
                     std::exp(-sigma_a.z * L / cos_t)};
    double T12 = 1.0 - R12, T21 = 1.0 - R21;
    double tc[3], rc[3];
    for (int c = 0; c < 3; ++c) {
        double t2 = tau[c] * tau[c];
        double denom = 1.0 - R21 * R21 * t2;
        tc[c] = T12 * T21 * tau[c] / denom;
        rc[c] = R12 + T12 * T12 * R21 * t2 / denom;
    }
    out.T = Vec3(tc[0], tc[1], tc[2]);
    out.R = Vec3(rc[0], rc[1], rc[2]);
    return out;
}

// ---------------- MC slab tracer ----------------
// Plane pair z = 0 (top) and z = -L (bottom), amber between, air outside.
// Traces one path with the medium stack; tallies transmitted/reflected
// spectral weight. This exercises the same refraction-ordering, TIR and
// absorption code paths as the full renderer.
struct SlabHit { bool transmitted; Vec3 weight; };

inline SlabHit slab_mc_trace(Vec3 dir, double L, Rng& rng) {
    MediumStack ms; ms.reset();
    Vec3 pos(0, 0, 1e-4);          // start just above top plane
    Vec3 tp(1.0);                  // path throughput
    for (int bounce = 0; bounce < 64; ++bounce) {
        int cur = ms.top();
        // distances to the two planes (only forward hits count).
        // In air we are always above the slab: only the top plane exists.
        double t_top = 1e30, t_bot = 1e30;
        if (dir.z < 0) { double t = (0.0 - pos.z) / dir.z; if (t > 1e-7) t_top = t; }
        if (cur != MED_AIR) {
            if (dir.z > 0) { double t = (-L - pos.z) / dir.z; if (t > 1e-7) t_bot = t; }
            if (dir.z > 0) { double t = (0.0 - pos.z) / dir.z; if (t > 1e-7) t_top = t; }
            if (dir.z < 0) { double t = (-L - pos.z) / dir.z; if (t > 1e-7) t_bot = t; }
        }
        double t = std::min(t_top, t_bot);
        if (t > 1e29) break;       // degenerate horizontal ray
        pos += dir * t;
        // absorption in current medium along this segment
        tp *= beer_lambert(MEDIA[cur].sigma_a, t);
        bool hit_top = (t_top < t_bot);
        Vec3 n = hit_top ? Vec3(0, 0, 1) : Vec3(0, 0, -1);
        // which medium lies beyond the interface?
        int beyond = hit_top ? (ms.contains(MED_AMBER) ? MED_AIR : MED_AMBER)
                             : (ms.contains(MED_AMBER) ? MED_AIR : MED_AMBER);
        double n1 = MEDIA[cur].ior, n2 = MEDIA[beyond].ior;
        Vec3 nn = (dir.dot(n) < 0) ? n : n * -1.0;
        double cosi = -dir.dot(nn);
        double Fr = fresnel_reflectance(cosi, n1, n2);
        if (rng.next() < Fr) {
            dir = Vec3::reflect(dir, nn);        // reflect (incl. TIR: Fr=1)
            if (cur == MED_AIR) return {false, tp};  // first-surface reflection
        } else {
            Vec3 rdir;
            Vec3::refract(dir, nn, n1 / n2, rdir);
            dir = rdir;
            if (beyond == MED_AMBER) ms.push(MED_AMBER); else ms.pop();
            if (ms.top() == MED_AIR) return {dir.z < 0, tp};  // left the slab
        }
        pos += dir * 1e-9;
    }
    return {false, Vec3(0.0)};
}

// ---------------- validation & sweep drivers ----------------
static void mc_slab_average(double theta, double L, long samples,
                            Vec3& Tavg, Vec3& Ravg) {
    Vec3 Tsum, Rsum;
    double sin_t = std::sin(theta), cos_t = std::cos(theta);
#pragma omp parallel
    {
        Vec3 Tloc, Rloc;
        Rng rng(0x9e3779b97f4a7c15ULL ^ (uint64_t)(
#ifdef _OPENMP
                  omp_get_thread_num() + 1
#else
                  1
#endif
                  ) * 0xbf58476d1ce4e5b9ULL);
#pragma omp for schedule(static)
        for (long i = 0; i < samples; ++i) {
            SlabHit h = slab_mc_trace(Vec3(sin_t, 0, -cos_t), L, rng);
            if (h.transmitted) Tloc += h.weight; else Rloc += h.weight;
        }
#pragma omp critical
        { Tsum += Tloc; Rsum += Rloc; }
    }
    Tavg = Tsum / (double)samples;
    Ravg = Rsum / (double)samples;
}

static double rel_err(double a, double b) {
    double denom = std::max(std::fabs(b), 1e-6);
    return std::fabs(a - b) / denom;
}

// Numerical acceptance: MC slab vs closed-form parallel-plate solution.
static int run_validate(long samples) {
    std::printf("# parallel-plate acceptance: MC (%ld paths/angle) vs analytic\n",
                samples);
    std::printf("# amber n=%.2f  sigma_a=(%.2f, %.2f, %.2f)  L=1.0\n",
                MEDIA[MED_AMBER].ior, MEDIA[MED_AMBER].sigma_a.x,
                MEDIA[MED_AMBER].sigma_a.y, MEDIA[MED_AMBER].sigma_a.z);
    std::printf("%8s %10s %10s %10s %10s %10s %10s %10s\n",
                "theta", "T_mc", "T_ref", "R_mc", "R_ref",
                "errT%", "errR%", "E_mc");
    double worst = 0.0;
    int failures = 0;
    for (int deg = 0; deg <= 80; deg += 5) {
        double theta = deg * M_PI / 180.0;
        SlabAnalytic a = slab_analytic(theta, MEDIA[MED_AIR].ior,
                                       MEDIA[MED_AMBER].ior,
                                       MEDIA[MED_AMBER].sigma_a, 1.0);
        Vec3 Tmc, Rmc;
        mc_slab_average(theta, 1.0, samples, Tmc, Rmc);
        // luminance-like scalar for the pass/fail metric, per-channel worst
        double eT = 0, eR = 0;
        const double* ta = &a.T.x; const double* tm = &Tmc.x;
        const double* ra = &a.R.x; const double* rm = &Rmc.x;
        for (int c = 0; c < 3; ++c) {
            eT = std::max(eT, rel_err(tm[c], ta[c]));
            eR = std::max(eR, rel_err(rm[c], ra[c]));
        }
        double E = (Tmc.x + Tmc.y + Tmc.z + Rmc.x + Rmc.y + Rmc.z) / 3.0;
        worst = std::max(worst, std::max(eT, eR));
        bool ok = eT < 0.02 && eR < 0.02 && E < 1.02;  // E<1: absorption
        if (!ok) ++failures;
        std::printf("%8d %10.5f %10.5f %10.5f %10.5f %10.3f %10.3f %10.5f %s\n",
                    deg, (Tmc.x+Tmc.y+Tmc.z)/3, (a.T.x+a.T.y+a.T.z)/3,
                    (Rmc.x+Rmc.y+Rmc.z)/3, (a.R.x+a.R.y+a.R.z)/3,
                    100*eT, 100*eR, E, ok ? "" : "  <-- FAIL");
    }
    std::printf("# worst relative error: %.3f%%  (tolerance 2%%)\n", 100*worst);
    std::printf("# %s\n", failures == 0 ? "ACCEPTANCE PASS" : "ACCEPTANCE FAIL");
    return failures == 0 ? 0 : 1;
}

// Angle sweep for thin/thick amber plates: writes CSV with per-channel
// analytic and MC transmittance/reflectance vs incidence angle.
static int run_sweep(long samples, const char* path) {
    FILE* f = std::fopen(path, "w");
    if (!f) { std::perror(path); return 1; }
    std::fprintf(f, "theta_deg,thickness,T_r,T_g,T_b,R_r,R_g,R_b,"
                    "Tmc_r,Tmc_g,Tmc_b,Rmc_r,Rmc_g,Rmc_b\n");
    const double thicknesses[] = {0.25, 2.0};
    for (double L : thicknesses) {
        for (int deg = 0; deg <= 88; deg += 2) {
            double theta = deg * M_PI / 180.0;
            SlabAnalytic a = slab_analytic(theta, MEDIA[MED_AIR].ior,
                                           MEDIA[MED_AMBER].ior,
                                           MEDIA[MED_AMBER].sigma_a, L);
            Vec3 Tmc, Rmc;
            mc_slab_average(theta, L, samples, Tmc, Rmc);
            std::fprintf(f, "%d,%.2f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,"
                            "%.6f,%.6f,%.6f,%.6f,%.6f,%.6f\n",
                         deg, L, a.T.x, a.T.y, a.T.z, a.R.x, a.R.y, a.R.z,
                         Tmc.x, Tmc.y, Tmc.z, Rmc.x, Rmc.y, Rmc.z);
        }
    }
    std::fclose(f);
    std::printf("# sweep written to %s\n", path);
    return 0;
}

// ---------------- scene renderer ----------------
struct Hit {
    double t;
    Vec3 n;          // outward geometric normal
    int medium;      // medium id for dielectric objects, -1 for diffuse
    Vec3 albedo;     // diffuse albedo when medium < 0
};

struct Box { Vec3 bmin, bmax; int medium; };
struct Sphere { Vec3 c; double r; int medium; };

struct Scene {
    std::vector<Box> boxes;
    std::vector<Sphere> spheres;
    Vec3 ground_albedo{0.55, 0.52, 0.48};
    Vec3 sun_dir;             // direction TOWARD the sun
    Vec3 sun_radiance{25.0, 23.0, 19.0};
    double sun_cos = 0.998;   // sun disk cosine
};

static bool intersect(const Scene& sc, const Vec3& ro, const Vec3& rd,
                      Hit& h) {
    h.t = 1e30; h.medium = -2;
    // ground plane y = 0
    if (rd.y < -1e-9) {
        double t = -ro.y / rd.y;
        if (t > 1e-7 && t < h.t) {
            h.t = t; h.n = Vec3(0, 1, 0); h.medium = -1;
            h.albedo = sc.ground_albedo;
        }
    }
    for (const Box& b : sc.boxes) {
        Vec3 inv(1.0/rd.x, 1.0/rd.y, 1.0/rd.z);
        Vec3 t0 = (b.bmin - ro) * inv, t1 = (b.bmax - ro) * inv;
        Vec3 tmin(std::min(t0.x,t1.x), std::min(t0.y,t1.y), std::min(t0.z,t1.z));
        Vec3 tmax(std::max(t0.x,t1.x), std::max(t0.y,t1.y), std::max(t0.z,t1.z));
        double tn = std::max(tmin.x, std::max(tmin.y, tmin.z));
        double tf = std::min(tmax.x, std::min(tmax.y, tmax.z));
        if (tf <= tn) continue;
        double t; Vec3 n;
        if (tn > 1e-7) {          // entering: find entry face
            t = tn;
            if (tmin.x >= tmin.y && tmin.x >= tmin.z) n = Vec3(rd.x>0?-1:1,0,0);
            else if (tmin.y >= tmin.z) n = Vec3(0,rd.y>0?-1:1,0);
            else n = Vec3(0,0,rd.z>0?-1:1);
        } else if (tf > 1e-7) {   // inside: exit face
            t = tf;
            if (tmax.x <= tmax.y && tmax.x <= tmax.z) n = Vec3(rd.x>0?1:-1,0,0);
            else if (tmax.y <= tmax.z) n = Vec3(0,rd.y>0?1:-1,0);
            else n = Vec3(0,0,rd.z>0?1:-1);
        } else continue;
        if (t < h.t) { h.t = t; h.n = n; h.medium = b.medium; }
    }
    for (const Sphere& s : sc.spheres) {
        Vec3 oc = ro - s.c;
        double b = oc.dot(rd), c = oc.dot(oc) - s.r * s.r;
        double disc = b * b - c;
        if (disc < 0) continue;
        double sq = std::sqrt(disc);
        double t = -b - sq;
        if (t < 1e-7) t = -b + sq;   // inside sphere: exit point
        if (t < 1e-7 || t >= h.t) continue;
        h.t = t;
        h.n = ((ro + rd * t) - s.c) / s.r;
        h.medium = s.medium;
    }
    return h.medium != -2;
}

static Vec3 sky_radiance(const Scene& sc, const Vec3& rd) {
    double t = 0.5 * (rd.y + 1.0);
    Vec3 sky = Vec3(0.65, 0.75, 0.9) * (1.0 - t) + Vec3(0.25, 0.45, 0.85) * t;
    sky = sky * 0.9;
    double d = rd.dot(sc.sun_dir);
    if (d > sc.sun_cos) sky += sc.sun_radiance;
    return sky;
}

// Cosine-weighted hemisphere sample.
static Vec3 cosine_sample(const Vec3& n, Rng& rng) {
    double u = rng.next(), v = rng.next();
    double r = std::sqrt(u), phi = 2.0 * M_PI * v;
    Vec3 w = n;
    Vec3 a = std::fabs(w.x) > 0.9 ? Vec3(0,1,0) : Vec3(1,0,0);
    Vec3 uu = w.cross(a).norm(), vv = w.cross(uu);
    return (uu * (r * std::cos(phi)) + vv * (r * std::sin(phi))
            + w * std::sqrt(1.0 - u)).norm();
}

// Path trace one ray. Dielectrics use the medium stack to resolve the
// refraction in/out order; absorption is applied per segment in the
// current medium; TIR falls out of the Fresnel test (Fr == 1).
static Vec3 trace(const Scene& sc, Vec3 ro, Vec3 rd, Rng& rng) {
    Vec3 L(0.0), tp(1.0);
    MediumStack ms; ms.reset();
    Hit h;
    for (int bounce = 0; bounce < 24; ++bounce) {
        if (!intersect(sc, ro, rd, h)) { L += sky_radiance(sc, rd) * tp; break; }
        // Beer-Lambert absorption along the segment in the current medium
        tp *= beer_lambert(MEDIA[ms.top()].sigma_a, h.t);
        Vec3 pos = ro + rd * h.t;
        if (h.medium < 0) {                    // diffuse ground
            tp *= h.albedo;
            rd = cosine_sample(h.n, rng);
            ro = pos + h.n * 1e-6;
        } else {
            bool entering = rd.dot(h.n) < 0.0;
            int cur = ms.top();
            int beyond;
            if (entering) {
                beyond = h.medium;
            } else {
                // exiting h.medium: medium underneath it on the stack
                beyond = MED_AIR;
                for (int i = ms.n - 1; i >= 0; --i)
                    if (ms.st[i] == h.medium) { beyond = ms.st[i-1 >= 0 ? i-1 : 0]; break; }
            }
            double n1 = MEDIA[cur].ior, n2 = MEDIA[beyond].ior;
            Vec3 nn = entering ? h.n : h.n * -1.0;
            double cosi = -rd.dot(nn);
            double Fr = fresnel_reflectance(cosi, n1, n2);
            if (rng.next() < Fr) {
                rd = Vec3::reflect(rd, nn);    // includes TIR (Fr = 1)
                ro = pos + nn * 1e-6;
            } else {
                Vec3 rdir;
                Vec3::refract(rd, nn, n1 / n2, rdir);
                rd = rdir;
                if (entering) ms.push(beyond); else ms.pop();
                ro = pos - nn * 1e-6;
            }
        }
        // Russian roulette
        if (bounce > 3) {
            double q = std::min(0.95, tp.maxc());
            if (rng.next() > q) break;
            tp = tp / q;
        }
    }
    return L;
}

// ---------------- scene construction ----------------
static Scene make_scene() {
    Scene sc;
    // thin plate (L=0.25) on the left, thick block (L=2.0) on the right;
    // both 3 wide (x), 2.2 tall (y), resting on the ground
    sc.boxes.push_back({Vec3(-3.6, 0, -0.125), Vec3(-0.6, 2.2, 0.125), MED_AMBER});
    sc.boxes.push_back({Vec3(0.6, 0, -1.0),   Vec3(3.6, 2.2, 1.0),   MED_AMBER});
    // droplets (watery, n=1.33) + air bubbles (n=1.0) inside each block
    const struct { double x,y,z,r; int m; } drops[] = {
        {-2.9, 0.6,  0.0, 0.16, MED_DROPLET},
        {-2.1, 1.5,  0.0, 0.12, MED_DROPLET},
        {-1.3, 0.9,  0.0, 0.09, MED_BUBBLE},
        { 1.3, 0.7, -0.3, 0.30, MED_DROPLET},
        { 2.4, 1.6,  0.2, 0.22, MED_DROPLET},
        { 2.9, 0.5,  0.5, 0.15, MED_BUBBLE},
        { 1.8, 1.2, -0.6, 0.12, MED_BUBBLE},
    };
    for (auto& d : drops) sc.spheres.push_back({Vec3(d.x,d.y,d.z), d.r, d.m});
    // sun just above the horizon, behind the blocks: strong backlight so
    // the transmitted glow through the amber shows the absorption color
    sc.sun_dir = Vec3(0.05, 0.03, -1.0).norm();
    return sc;
}

// ---------------- camera & render ----------------
static int run_render(int W, int H, int spp, double elev_deg,
                      const char* out_path) {
    Scene sc = make_scene();
    double el = elev_deg * M_PI / 180.0;
    Vec3 target(0, 1.0, 0);
    Vec3 eye = target + Vec3(0, std::sin(el), std::cos(el)) * 7.5;
    Vec3 fwd = (target - eye).norm();
    Vec3 right = fwd.cross(Vec3(0,1,0)).norm();
    Vec3 up = right.cross(fwd);
    double fov = 40.0 * M_PI / 180.0;
    double scale = std::tan(fov / 2.0);
    std::vector<Vec3> img((size_t)W * H);
#pragma omp parallel for schedule(dynamic, 4)
    for (int y = 0; y < H; ++y) {
        Rng rng(0x853c49e6748fea9bULL + (uint64_t)y * 0x9e3779b97f4a7c15ULL);
        for (int x = 0; x < W; ++x) {
            Vec3 sum(0.0);
            for (int s = 0; s < spp; ++s) {
                double u = ((x + rng.next()) / W * 2.0 - 1.0) * scale
                           * (double)W / H;
                double v = (1.0 - (y + rng.next()) / H * 2.0) * scale;
                Vec3 rd = (fwd + right * u + up * v).norm();
                sum += trace(sc, eye, rd, rng);
            }
            img[(size_t)y * W + x] = sum / (double)spp;
        }
    }
    // tone map (Reinhard + gamma) and write binary PPM
    FILE* f = std::fopen(out_path, "wb");
    if (!f) { std::perror(out_path); return 1; }
    std::fprintf(f, "P6\n%d %d\n255\n", W, H);
    for (size_t i = 0; i < img.size(); ++i) {
        const double* c = &img[i].x;
        unsigned char rgb[3];
        for (int k = 0; k < 3; ++k) {
            double v = c[k] / (1.0 + c[k]);
            v = std::pow(std::max(0.0, v), 1.0 / 2.2);
            rgb[k] = (unsigned char)(255.0 * v + 0.5);
        }
        std::fwrite(rgb, 1, 3, f);
    }
    std::fclose(f);
    std::printf("# render %dx%d spp=%d elev=%.1f -> %s\n",
                W, H, spp, elev_deg, out_path);
    return 0;
}

int main(int argc, char** argv) {
    if (argc >= 2 && !std::strcmp(argv[1], "validate")) {
        long samples = argc >= 3 ? std::atol(argv[2]) : 200000;
        return run_validate(samples);
    }
    if (argc >= 2 && !std::strcmp(argv[1], "sweep")) {
        long samples = argc >= 3 ? std::atol(argv[2]) : 50000;
        const char* out = argc >= 4 ? argv[3] : "out/sweep.csv";
        return run_sweep(samples, out);
    }
    if (argc >= 2 && !std::strcmp(argv[1], "render")) {
        int W = argc >= 3 ? std::atoi(argv[2]) : 480;
        int H = argc >= 4 ? std::atoi(argv[3]) : 360;
        int spp = argc >= 5 ? std::atoi(argv[4]) : 256;
        double elev = argc >= 6 ? std::atol(argv[5]) : 25.0;
        const char* out = argc >= 7 ? argv[6] : "out/render.ppm";
        return run_render(W, H, spp, elev, out);
    }
    std::fprintf(stderr, "usage: %s validate [N] | sweep [N] [csv] | "
                         "render ...\n", argv[0]);
    return 2;
}
