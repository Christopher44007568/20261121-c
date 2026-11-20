// depth_viewer: headless Vulkan viewer that renders parallel test plates and
// outputs a linear depth map from which world positions can be reconstructed.
//
// Switchable projections: perspective, ortho, reverse-Z, infinite-far.
// For each mode the tool dumps the raw hardware depth buffer, the linear
// depth map, a plate-id map, and reconstructs world coordinates from the raw
// depth. Conventions are verified automatically:
//   - near/mid/far plates reconstruct to their known world z
//   - shared-edge pixels (two triangles sampling the same edge) follow the
//     top-left fill rule; overlapping plates follow the depth-compare rule
//   - background pixels carry an explicit invalid value (NaN in the linear
//     map, the clear value in the raw depth buffer, id = -1)

#include <vulkan/vulkan.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <limits>
#include <string>
#include <vector>

#define VK_CHECK(x)                                                    \
  do {                                                                 \
    VkResult res_ = (x);                                               \
    if (res_ != VK_SUCCESS) {                                          \
      fprintf(stderr, "VK_CHECK failed (%d) at %s:%d\n", res_,         \
              __FILE__, __LINE__);                                     \
      exit(1);                                                         \
    }                                                                  \
  } while (0)

// ---------------------------------------------------------------- math ----
struct Mat4 {
  float m[16];  // column-major
};

static Mat4 matIdentity() {
  Mat4 r{};
  r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1.0f;
  return r;
}

static Mat4 matMul(const Mat4& a, const Mat4& b) {
  Mat4 r{};
  for (int c = 0; c < 4; ++c)
    for (int row = 0; row < 4; ++row)
      for (int k = 0; k < 4; ++k)
        r.m[c * 4 + row] += a.m[k * 4 + row] * b.m[c * 4 + k];
  return r;
}

static Mat4 matTranslate(float x, float y, float z) {
  Mat4 r = matIdentity();
  r.m[12] = x;
  r.m[13] = y;
  r.m[14] = z;
  return r;
}

// ---------------------------------------------------------- projections ----
enum class ProjMode {
  PERSPECTIVE,          // standard, ndc z in [0,1], clear 1.0, LESS
  PERSPECTIVE_REVERSED, // reverse-Z, ndc z in [1,0], clear 0.0, GREATER
  ORTHO,                // standard ortho
  ORTHO_REVERSED,       // reverse-Z ortho
  INFINITE,             // infinite far plane perspective
  INFINITE_REVERSED,    // infinite far plane + reverse-Z
  COUNT
};

static const char* kModeNames[] = {"perspective", "perspective-reverse",
                                   "ortho",       "ortho-reverse",
                                   "infinite",    "infinite-reverse"};

struct ProjParams {
  ProjMode mode;
  float nearZ = 0.5f;
  float farZ = 50.0f;      // ignored for infinite modes
  float tanHalfFov = 0.5f; // tan(vertical fov/2); exactly 0.5 keeps the E|F
                           // shared-edge projection exact in fp32
  float orthoHalfH = 6.5f; // ortho modes
  float aspect = 1.0f;
};

static bool isReversed(ProjMode m) {
  return m == ProjMode::PERSPECTIVE_REVERSED ||
         m == ProjMode::ORTHO_REVERSED || m == ProjMode::INFINITE_REVERSED;
}
static bool isOrtho(ProjMode m) {
  return m == ProjMode::ORTHO || m == ProjMode::ORTHO_REVERSED;
}
static bool isInfinite(ProjMode m) {
  return m == ProjMode::INFINITE || m == ProjMode::INFINITE_REVERSED;
}

// Vulkan NDC: z in [0,1]; y is flipped via a negative P11.
static Mat4 buildProjection(const ProjParams& p) {
  Mat4 r{};
  const float n = p.nearZ, f = p.farZ;
  if (isOrtho(p.mode)) {
    const float h = p.orthoHalfH, w = h * p.aspect;
    r.m[0] = 1.0f / w;
    r.m[5] = -1.0f / h;
    if (isReversed(p.mode)) {  // ndc = (f - d) / (f - n)
      r.m[10] = 1.0f / (f - n);
      r.m[14] = f / (f - n);
    } else {  // ndc = (d - n) / (f - n)
      r.m[10] = -1.0f / (f - n);
      r.m[14] = -n / (f - n);
    }
    r.m[15] = 1.0f;
    return r;
  }
  const float t = p.tanHalfFov;
  r.m[0] = 1.0f / (p.aspect * t);
  r.m[5] = -1.0f / t;
  switch (p.mode) {
    case ProjMode::PERSPECTIVE:  // ndc = f(d-n) / ((f-n)d)
      r.m[10] = f / (n - f);
      r.m[14] = f * n / (n - f);
      break;
    case ProjMode::PERSPECTIVE_REVERSED:  // ndc = n(f-d) / ((f-n)d)
      r.m[10] = n / (f - n);
      r.m[14] = f * n / (f - n);
      break;
    case ProjMode::INFINITE:  // ndc = 1 - n/d
      r.m[10] = -1.0f;
      r.m[14] = -n;
      break;
    case ProjMode::INFINITE_REVERSED:  // ndc = n/d
      r.m[10] = 0.0f;
      r.m[14] = n;
      break;
    default:
      break;
  }
  r.m[11] = -1.0f;
  return r;
}

// Analytic ndc z for a view-space depth d (double precision reference).
static double ndcFromDepth(const ProjParams& p, double d) {
  const double n = p.nearZ, f = p.farZ;
  switch (p.mode) {
    case ProjMode::PERSPECTIVE: return f * (d - n) / ((f - n) * d);
    case ProjMode::PERSPECTIVE_REVERSED: return n * (f - d) / ((f - n) * d);
    case ProjMode::ORTHO: return (d - n) / (f - n);
    case ProjMode::ORTHO_REVERSED: return (f - d) / (f - n);
    case ProjMode::INFINITE: return 1.0 - n / d;
    case ProjMode::INFINITE_REVERSED: return n / d;
    default: return 0.0;
  }
}

// Inverse: view-space depth from a raw depth-buffer value.
static double depthFromNdc(const ProjParams& p, double ndc) {
  const double n = p.nearZ, f = p.farZ;
  switch (p.mode) {
    case ProjMode::PERSPECTIVE: return f * n / (f - ndc * (f - n));
    case ProjMode::PERSPECTIVE_REVERSED: return n * f / (n + ndc * (f - n));
    case ProjMode::ORTHO: return n + ndc * (f - n);
    case ProjMode::ORTHO_REVERSED: return f - ndc * (f - n);
    case ProjMode::INFINITE: return n / (1.0 - ndc);
    case ProjMode::INFINITE_REVERSED: return n / ndc;
    default: return 0.0;
  }
}

static float clearDepth(const ProjParams& p) {
  return isReversed(p.mode) ? 0.0f : 1.0f;
}

// --------------------------------------------------------------- scene ----
// Camera sits on the +z axis looking down -z; all test plates are parallel
// to the XY plane ("parallel test plates"), so each plate has a constant
// view-space depth d = camZ - plateZ.
static const float kCamX = 0.25f, kCamY = -0.25f, kCamZ = 1.5f;

struct Plate {
  const char* name;
  int id;
  float cx, cy, z, hx, hy;  // world-space rect parallel to XY plane
};

// Perspective reference (tan(fov/2) = 0.5) used to lay plates out on screen.
// 0.5 is exact in binary fp, so the E|F shared edge projects exactly onto
// pixel column 48 centers both on the GPU (fp32) and in the analytic model.
static const double kTanHalf = 0.5;
static double wxFromNdc(double ndc, double d) {
  return kCamX + ndc * d * kTanHalf;
}
static double wyFromNdc(double ndc, double d) {
  return kCamY - ndc * d * kTanHalf;
}

static std::vector<Plate> buildPlates() {
  std::vector<Plate> v;
  auto add = [&](const char* n, int id, double ndcX, double ndcY, double d,
                 double hx, double hy) {
    Plate p;
    p.name = n;
    p.id = id;
    p.cx = (float)wxFromNdc(ndcX, d);
    p.cy = (float)wyFromNdc(ndcY, d);
    p.z = kCamZ - (float)d;
    p.hx = (float)hx;
    p.hy = (float)hy;
    v.push_back(p);
  };
  add("A-near", 0, -0.45, 0.45, 2.0, 0.3, 0.3);    // near
  add("B-mid", 1, 0.45, -0.45, 5.5, 0.9, 0.9);     // mid (diagonal edge)
  add("C-far", 2, -0.45, -0.45, 19.5, 2.2, 2.2);   // far
  add("D-occl", 3, -0.30, 0.30, 4.0, 0.5, 0.5);    // overlaps A, farther
  // E and F share a vertical world-space edge; the edge projects exactly
  // onto pixel column 48 centers (ndc 0.515625) for the perspective modes.
  const double dEF = 2.5;
  const double xL = wxFromNdc(0.27, dEF);
  const double xE = wxFromNdc(0.515625, dEF);
  const double xR = wxFromNdc(0.76, dEF);
  const double yC = wyFromNdc(0.45, dEF);
  const double hY = 0.25 * dEF * kTanHalf;
  Plate e{"E-left", 4, (float)((xL + xE) / 2), (float)yC,
          kCamZ - (float)dEF, (float)((xE - xL) / 2), (float)hY};
  Plate f{"F-right", 5, (float)((xE + xR) / 2), (float)yC,
          kCamZ - (float)dEF, (float)((xR - xE) / 2), (float)hY};
  v.push_back(e);
  v.push_back(f);
  return v;
}

static float plateDepth(const Plate& p) { return kCamZ - p.z; }

// --------------------------------------------------- analytic reference ----
// Minimal software rasterizer implementing the Vulkan top-left fill rule and
// the per-mode depth-compare convention. Produces the expected plate-id map.
struct AnalyticImage {
  int w, h;
  std::vector<int> id;        // -1 = background
  std::vector<double> ndc;    // winning raw depth
  std::vector<double> edge;   // min |edge function| in pixels (for ambiguity)
};

static void projectPoint(const ProjParams& pp, const Mat4& proj, double wx,
                         double wy, double wz, double& sx, double& sy,
                         double& ndcZ, int W, int H) {
  const double vx = wx - kCamX, vy = wy - kCamY, vz = wz - kCamZ;
  const float* m = proj.m;
  const double cx = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
  const double cy = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
  const double cz = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
  const double cw = m[3] * vx + m[7] * vy + m[11] * vz + m[15];
  const double nx = cx / cw, ny = cy / cw;
  ndcZ = cz / cw;
  sx = (nx + 1.0) * 0.5 * W;
  sy = (ny + 1.0) * 0.5 * H;  // Vulkan: ndc y=-1 maps to framebuffer row 0
}

static AnalyticImage analyticRender(const ProjParams& pp,
                                    const std::vector<Plate>& plates, int W,
                                    int H) {
  const Mat4 proj = buildProjection(pp);
  AnalyticImage img;
  img.w = W;
  img.h = H;
  img.id.assign(W * H, -1);
  img.ndc.assign(W * H, isReversed(pp.mode) ? -1.0 : 2.0);
  img.edge.assign(W * H, 1e30);

  const bool rev = isReversed(pp.mode);
  for (const Plate& pl : plates) {
    // Four corners, two triangles with a shared diagonal (c0-c2).
    const double cx[4] = {pl.cx - pl.hx, pl.cx + pl.hx, pl.cx + pl.hx,
                          pl.cx - pl.hx};
    const double cy[4] = {pl.cy - pl.hy, pl.cy - pl.hy, pl.cy + pl.hy,
                          pl.cy + pl.hy};
    double sx[4], sy[4], sz[4];
    for (int i = 0; i < 4; ++i)
      projectPoint(pp, proj, cx[i], cy[i], pl.z, sx[i], sy[i], sz[i], W, H);
    const int tris[2][3] = {{0, 1, 2}, {0, 2, 3}};
    for (auto& t : tris) {
      double x[3] = {sx[t[0]], sx[t[1]], sx[t[2]]};
      double y[3] = {sy[t[0]], sy[t[1]], sy[t[2]]};
      double area = (x[1] - x[0]) * (y[2] - y[0]) -
                    (x[2] - x[0]) * (y[1] - y[0]);
      if (area == 0.0) continue;
      if (area < 0.0) {  // normalize winding so interior has e >= 0
        std::swap(x[1], x[2]);
        std::swap(y[1], y[2]);
      }
      const double zndc = sz[t[0]];  // planar: constant ndc z
      int x0 = std::max(0, (int)floor(std::min({x[0], x[1], x[2]})));
      int x1 = std::min(W - 1, (int)ceil(std::max({x[0], x[1], x[2]})));
      int y0 = std::max(0, (int)floor(std::min({y[0], y[1], y[2]})));
      int y1 = std::min(H - 1, (int)ceil(std::max({y[0], y[1], y[2]})));
      for (int py = y0; py <= y1; ++py) {
        for (int px = x0; px <= x1; ++px) {
          const double fx = px + 0.5, fy = py + 0.5;
          bool inside = true;
          double minEdge = 1e30;
          for (int e = 0; e < 3 && inside; ++e) {
            const int a = e, b = (e + 1) % 3;
            const double dx = x[b] - x[a], dy = y[b] - y[a];
            const double ef = dx * (fy - y[a]) - dy * (fx - x[a]);
            minEdge = std::min(minEdge, fabs(ef) /
                                            std::max(1e-30, hypot(dx, dy)));
            if (ef > 0.0) continue;
            // Top-left rule (framebuffer y down): an exactly-on-edge pixel
            // is filled iff the edge goes up (dy<0) or is horizontal going
            // right (dy==0 && dx>0).
            const bool topLeft = (dy < 0.0) || (dy == 0.0 && dx > 0.0);
            if (ef < 0.0 || !topLeft) inside = false;
          }
          if (!inside) continue;
          const int idx = py * W + px;
          img.edge[idx] = std::min(img.edge[idx], minEdge);
          const bool better = rev ? (zndc > img.ndc[idx]) : (zndc < img.ndc[idx]);
          if (better) {
            img.ndc[idx] = zndc;
            img.id[idx] = pl.id;
          }
        }
      }
    }
  }
  return img;
}
// -------------------------------------------------------- Vulkan viewer ----
struct Vertex {
  float pos[3];
  float plateId;
};

struct RenderResult {
  std::vector<float> rawDepth;    // D32_SFLOAT depth attachment
  std::vector<float> linearDepth; // R32_SFLOAT color attachment 0 (NaN = bg)
  std::vector<float> plateId;     // R32_SFLOAT color attachment 1 (-1 = bg)
};

struct VkCtx {
  VkInstance instance;
  VkPhysicalDevice phys;
  VkDevice device;
  uint32_t queueFamily;
  VkQueue queue;
  VkCommandPool cmdPool;
};

static uint32_t findMemory(VkPhysicalDevice phys, uint32_t bits,
                           VkMemoryPropertyFlags flags) {
  VkPhysicalDeviceMemoryProperties mp;
  vkGetPhysicalDeviceMemoryProperties(phys, &mp);
  for (uint32_t i = 0; i < mp.memoryTypeCount; ++i)
    if ((bits & (1u << i)) &&
        (mp.memoryTypes[i].propertyFlags & flags) == flags)
      return i;
  fprintf(stderr, "no suitable memory type\n");
  exit(1);
}

static VkCtx createContext() {
  VkCtx c{};
  VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
  app.pApplicationName = "depth_viewer";
  app.apiVersion = VK_API_VERSION_1_1;
  VkInstanceCreateInfo ici{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
  ici.pApplicationInfo = &app;
  VK_CHECK(vkCreateInstance(&ici, nullptr, &c.instance));

  uint32_t n = 0;
  VK_CHECK(vkEnumeratePhysicalDevices(c.instance, &n, nullptr));
  if (n == 0) {
    fprintf(stderr, "no Vulkan physical devices\n");
    exit(1);
  }
  std::vector<VkPhysicalDevice> devs(n);
  VK_CHECK(vkEnumeratePhysicalDevices(c.instance, &n, devs.data()));
  c.phys = VK_NULL_HANDLE;
  for (auto d : devs) {  // prefer a CPU (lavapipe) device for determinism
    VkPhysicalDeviceProperties pr;
    vkGetPhysicalDeviceProperties(d, &pr);
    if (pr.deviceType == VK_PHYSICAL_DEVICE_TYPE_CPU) {
      c.phys = d;
      break;
    }
  }
  if (c.phys == VK_NULL_HANDLE) c.phys = devs[0];
  VkPhysicalDeviceProperties props;
  vkGetPhysicalDeviceProperties(c.phys, &props);
  printf("device: %s\n", props.deviceName);
  if (props.limits.maxPushConstantsSize < 128) {
    fprintf(stderr, "need 128 bytes of push constants\n");
    exit(1);
  }

  uint32_t qn = 0;
  vkGetPhysicalDeviceQueueFamilyProperties(c.phys, &qn, nullptr);
  std::vector<VkQueueFamilyProperties> qp(qn);
  vkGetPhysicalDeviceQueueFamilyProperties(c.phys, &qn, qp.data());
  c.queueFamily = UINT32_MAX;
  for (uint32_t i = 0; i < qn; ++i)
    if (qp[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) {
      c.queueFamily = i;
      break;
    }
  if (c.queueFamily == UINT32_MAX) {
    fprintf(stderr, "no graphics queue\n");
    exit(1);
  }

  const float prio = 1.0f;
  VkDeviceQueueCreateInfo qci{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
  qci.queueFamilyIndex = c.queueFamily;
  qci.queueCount = 1;
  qci.pQueuePriorities = &prio;
  VkDeviceCreateInfo dci{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
  dci.queueCreateInfoCount = 1;
  dci.pQueueCreateInfos = &qci;
  VK_CHECK(vkCreateDevice(c.phys, &dci, nullptr, &c.device));
  vkGetDeviceQueue(c.device, c.queueFamily, 0, &c.queue);

  VkCommandPoolCreateInfo cpi{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
  cpi.queueFamilyIndex = c.queueFamily;
  cpi.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
  VK_CHECK(vkCreateCommandPool(c.device, &cpi, nullptr, &c.cmdPool));
  return c;
}

static std::vector<uint32_t> loadSpv(const char* path) {
  std::ifstream f(path, std::ios::binary);
  if (!f) {
    fprintf(stderr, "cannot open %s\n", path);
    exit(1);
  }
  const std::vector<char> bytes((std::istreambuf_iterator<char>(f)),
                                std::istreambuf_iterator<char>());
  std::vector<uint32_t> words(bytes.size() / 4);
  memcpy(words.data(), bytes.data(), words.size() * 4);
  return words;
}

struct GpuImage {
  VkImage image;
  VkDeviceMemory mem;
  VkImageView view;
};

static GpuImage createImage(const VkCtx& c, VkFormat fmt, VkImageUsageFlags usage,
                            uint32_t w, uint32_t h) {
  GpuImage g{};
  VkImageCreateInfo ii{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
  ii.imageType = VK_IMAGE_TYPE_2D;
  ii.format = fmt;
  ii.extent = {w, h, 1};
  ii.mipLevels = 1;
  ii.arrayLayers = 1;
  ii.samples = VK_SAMPLE_COUNT_1_BIT;
  ii.tiling = VK_IMAGE_TILING_OPTIMAL;
  ii.usage = usage;
  ii.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  VK_CHECK(vkCreateImage(c.device, &ii, nullptr, &g.image));
  VkMemoryRequirements mr;
  vkGetImageMemoryRequirements(c.device, g.image, &mr);
  VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
  ai.allocationSize = mr.size;
  ai.memoryTypeIndex = findMemory(c.phys, mr.memoryTypeBits,
                                  VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
  VK_CHECK(vkAllocateMemory(c.device, &ai, nullptr, &g.mem));
  VK_CHECK(vkBindImageMemory(c.device, g.image, g.mem, 0));
  VkImageViewCreateInfo vi{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
  vi.image = g.image;
  vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
  vi.format = fmt;
  vi.subresourceRange.aspectMask =
      (usage & VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT)
          ? VK_IMAGE_ASPECT_DEPTH_BIT
          : VK_IMAGE_ASPECT_COLOR_BIT;
  vi.subresourceRange.levelCount = 1;
  vi.subresourceRange.layerCount = 1;
  VK_CHECK(vkCreateImageView(c.device, &vi, nullptr, &g.view));
  return g;
}

static RenderResult renderPlates(const VkCtx& c, const ProjParams& pp,
                                 const std::vector<Vertex>& verts, int W,
                                 int H) {
  // --- attachments: linear depth (R32F), plate id (R32F), depth (D32F)
  GpuImage imgLinear = createImage(
      c, VK_FORMAT_R32_SFLOAT,
      VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
      W, H);
  GpuImage imgId = createImage(
      c, VK_FORMAT_R32_SFLOAT,
      VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
      W, H);
  GpuImage imgDepth = createImage(
      c, VK_FORMAT_D32_SFLOAT,
      VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT |
          VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
      W, H);

  VkAttachmentDescription att[3] = {};
  for (int i = 0; i < 3; ++i) {
    att[i].samples = VK_SAMPLE_COUNT_1_BIT;
    att[i].loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    att[i].storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    att[i].stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    att[i].stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    att[i].initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    att[i].finalLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
  }
  att[0].format = VK_FORMAT_R32_SFLOAT;
  att[1].format = VK_FORMAT_R32_SFLOAT;
  att[2].format = VK_FORMAT_D32_SFLOAT;

  VkAttachmentReference colRef[2] = {
      {0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL},
      {1, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL}};
  VkAttachmentReference depRef = {2, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
  VkSubpassDescription sub{};
  sub.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
  sub.colorAttachmentCount = 2;
  sub.pColorAttachments = colRef;
  sub.pDepthStencilAttachment = &depRef;

  VkSubpassDependency deps[2] = {};
  deps[0].srcSubpass = VK_SUBPASS_EXTERNAL;
  deps[0].dstSubpass = 0;
  deps[0].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT |
                         VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
  deps[0].dstStageMask = deps[0].srcStageMask;
  deps[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT |
                          VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
  deps[1].srcSubpass = 0;
  deps[1].dstSubpass = VK_SUBPASS_EXTERNAL;
  deps[1].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT |
                         VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT;
  deps[1].srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT |
                          VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
  deps[1].dstStageMask = VK_PIPELINE_STAGE_TRANSFER_BIT;
  deps[1].dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;

  VkRenderPassCreateInfo rpi{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
  rpi.attachmentCount = 3;
  rpi.pAttachments = att;
  rpi.subpassCount = 1;
  rpi.pSubpasses = &sub;
  rpi.dependencyCount = 2;
  rpi.pDependencies = deps;
  VkRenderPass renderPass;
  VK_CHECK(vkCreateRenderPass(c.device, &rpi, nullptr, &renderPass));

  VkFramebufferCreateInfo fbi{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
  VkImageView views[3] = {imgLinear.view, imgId.view, imgDepth.view};
  fbi.renderPass = renderPass;
  fbi.attachmentCount = 3;
  fbi.pAttachments = views;
  fbi.width = W;
  fbi.height = H;
  fbi.layers = 1;
  VkFramebuffer fb;
  VK_CHECK(vkCreateFramebuffer(c.device, &fbi, nullptr, &fb));

  // --- pipeline
  VkShaderModule vs, fs;
  {
    std::vector<uint32_t> code = loadSpv(SPV_DIR "/depth.vert.spv");
    VkShaderModuleCreateInfo si{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    si.codeSize = code.size() * 4;
    si.pCode = code.data();
    VK_CHECK(vkCreateShaderModule(c.device, &si, nullptr, &vs));
    code = loadSpv(SPV_DIR "/depth.frag.spv");
    si.codeSize = code.size() * 4;
    si.pCode = code.data();
    VK_CHECK(vkCreateShaderModule(c.device, &si, nullptr, &fs));
  }
  VkPipelineShaderStageCreateInfo stages[2] = {};
  stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
  stages[0].module = vs;
  stages[0].pName = "main";
  stages[1] = stages[0];
  stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
  stages[1].module = fs;

  VkVertexInputBindingDescription bind{0, sizeof(Vertex), VK_VERTEX_INPUT_RATE_VERTEX};
  VkVertexInputAttributeDescription attrs[2] = {
      {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(Vertex, pos)},
      {1, 0, VK_FORMAT_R32_SFLOAT, offsetof(Vertex, plateId)}};
  VkPipelineVertexInputStateCreateInfo vin{
      VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
  vin.vertexBindingDescriptionCount = 1;
  vin.pVertexBindingDescriptions = &bind;
  vin.vertexAttributeDescriptionCount = 2;
  vin.pVertexAttributeDescriptions = attrs;

  VkPipelineInputAssemblyStateCreateInfo ia{
      VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
  ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

  VkViewport vp{0, 0, (float)W, (float)H, 0.0f, 1.0f};
  VkRect2D sc{{0, 0}, {(uint32_t)W, (uint32_t)H}};
  VkPipelineViewportStateCreateInfo vps{
      VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
  vps.viewportCount = 1;
  vps.pViewports = &vp;
  vps.scissorCount = 1;
  vps.pScissors = &sc;

  VkPipelineRasterizationStateCreateInfo rs{
      VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
  rs.polygonMode = VK_POLYGON_MODE_FILL;
  rs.cullMode = VK_CULL_MODE_NONE;
  rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
  rs.lineWidth = 1.0f;

  VkPipelineMultisampleStateCreateInfo ms{
      VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
  ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

  VkPipelineDepthStencilStateCreateInfo ds{
      VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
  ds.depthTestEnable = VK_TRUE;
  ds.depthWriteEnable = VK_TRUE;
  ds.depthCompareOp =
      isReversed(pp.mode) ? VK_COMPARE_OP_GREATER : VK_COMPARE_OP_LESS;
  ds.depthBoundsTestEnable = VK_FALSE;
  ds.stencilTestEnable = VK_FALSE;

  VkPipelineColorBlendAttachmentState blendAtt[2] = {};
  blendAtt[0].colorWriteMask = VK_COLOR_COMPONENT_R_BIT;
  blendAtt[1].colorWriteMask = VK_COLOR_COMPONENT_R_BIT;
  VkPipelineColorBlendStateCreateInfo blend{
      VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
  blend.attachmentCount = 2;
  blend.pAttachments = blendAtt;

  VkPushConstantRange pcRange{VK_SHADER_STAGE_VERTEX_BIT, 0, 2 * 64};
  VkPipelineLayoutCreateInfo pli{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  pli.pushConstantRangeCount = 1;
  pli.pPushConstantRanges = &pcRange;
  VkPipelineLayout pipeLayout;
  VK_CHECK(vkCreatePipelineLayout(c.device, &pli, nullptr, &pipeLayout));

  VkGraphicsPipelineCreateInfo gpi{
      VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
  gpi.stageCount = 2;
  gpi.pStages = stages;
  gpi.pVertexInputState = &vin;
  gpi.pInputAssemblyState = &ia;
  gpi.pViewportState = &vps;
  gpi.pRasterizationState = &rs;
  gpi.pMultisampleState = &ms;
  gpi.pDepthStencilState = &ds;
  gpi.pColorBlendState = &blend;
  gpi.layout = pipeLayout;
  gpi.renderPass = renderPass;
  VkPipeline pipeline;
  VK_CHECK(
      vkCreateGraphicsPipelines(c.device, VK_NULL_HANDLE, 1, &gpi, nullptr, &pipeline));

  // --- vertex buffer (host visible, coherent)
  VkBuffer vb;
  VkDeviceMemory vbMem;
  const VkDeviceSize vbSize = verts.size() * sizeof(Vertex);
  VkBufferCreateInfo bci{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
  bci.size = vbSize;
  bci.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
  VK_CHECK(vkCreateBuffer(c.device, &bci, nullptr, &vb));
  VkMemoryRequirements mr;
  vkGetBufferMemoryRequirements(c.device, vb, &mr);
  VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
  ai.allocationSize = mr.size;
  ai.memoryTypeIndex =
      findMemory(c.phys, mr.memoryTypeBits,
                 VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                     VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
  VK_CHECK(vkAllocateMemory(c.device, &ai, nullptr, &vbMem));
  VK_CHECK(vkBindBufferMemory(c.device, vb, vbMem, 0));
  void* mapped;
  VK_CHECK(vkMapMemory(c.device, vbMem, 0, vbSize, 0, &mapped));
  memcpy(mapped, verts.data(), vbSize);
  vkUnmapMemory(c.device, vbMem);

  // --- readback buffers
  const VkDeviceSize imgBytes = (VkDeviceSize)W * H * 4;
  VkBuffer rbBuf[3];
  VkDeviceMemory rbMem[3];
  for (int i = 0; i < 3; ++i) {
    bci.size = imgBytes;
    bci.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    VK_CHECK(vkCreateBuffer(c.device, &bci, nullptr, &rbBuf[i]));
    vkGetBufferMemoryRequirements(c.device, rbBuf[i], &mr);
    ai.allocationSize = mr.size;
    ai.memoryTypeIndex =
        findMemory(c.phys, mr.memoryTypeBits,
                   VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                       VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    VK_CHECK(vkAllocateMemory(c.device, &ai, nullptr, &rbMem[i]));
    VK_CHECK(vkBindBufferMemory(c.device, rbBuf[i], rbMem[i], 0));
  }

  // --- record & submit
  VkCommandBuffer cmd;
  VkCommandBufferAllocateInfo cai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
  cai.commandPool = c.cmdPool;
  cai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
  cai.commandBufferCount = 1;
  VK_CHECK(vkAllocateCommandBuffers(c.device, &cai, &cmd));
  VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
  bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
  VK_CHECK(vkBeginCommandBuffer(cmd, &bi));

  VkClearValue clear[3];
  clear[0].color.float32[0] = std::numeric_limits<float>::quiet_NaN();
  clear[1].color.float32[0] = -1.0f;
  clear[2].depthStencil = {clearDepth(pp), 0};
  VkRenderPassBeginInfo rpb{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
  rpb.renderPass = renderPass;
  rpb.framebuffer = fb;
  rpb.renderArea = sc;
  rpb.clearValueCount = 3;
  rpb.pClearValues = clear;
  vkCmdBeginRenderPass(cmd, &rpb, VK_SUBPASS_CONTENTS_INLINE);
  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline);

  const Mat4 view = matTranslate(-kCamX, -kCamY, -kCamZ);
  const Mat4 proj = buildProjection(pp);
  const Mat4 mvp = matMul(proj, view);  // model = identity
  struct {
    Mat4 mvp;
    Mat4 modelView;
  } push{mvp, view};
  vkCmdPushConstants(cmd, pipeLayout, VK_SHADER_STAGE_VERTEX_BIT, 0,
                     sizeof(push), &push);
  VkDeviceSize off = 0;
  vkCmdBindVertexBuffers(cmd, 0, 1, &vb, &off);
  vkCmdDraw(cmd, (uint32_t)verts.size(), 1, 0, 0);
  vkCmdEndRenderPass(cmd);

  VkBufferImageCopy copies[3] = {};
  VkImage imgs[3] = {imgLinear.image, imgId.image, imgDepth.image};
  for (int i = 0; i < 3; ++i) {
    copies[i].bufferOffset = 0;
    copies[i].imageSubresource.aspectMask =
        (i == 2) ? VK_IMAGE_ASPECT_DEPTH_BIT : VK_IMAGE_ASPECT_COLOR_BIT;
    copies[i].imageSubresource.layerCount = 1;
    copies[i].imageExtent = {(uint32_t)W, (uint32_t)H, 1};
    vkCmdCopyImageToBuffer(cmd, imgs[i], VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                           rbBuf[i], 1, &copies[i]);
  }
  VK_CHECK(vkEndCommandBuffer(cmd));

  VkFence fence;
  VkFenceCreateInfo fi{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
  VK_CHECK(vkCreateFence(c.device, &fi, nullptr, &fence));
  VkSubmitInfo subm{VK_STRUCTURE_TYPE_SUBMIT_INFO};
  subm.commandBufferCount = 1;
  subm.pCommandBuffers = &cmd;
  VK_CHECK(vkQueueSubmit(c.queue, 1, &subm, fence));
  VK_CHECK(vkWaitForFences(c.device, 1, &fence, VK_TRUE, UINT64_MAX));

  RenderResult out;
  out.linearDepth.resize((size_t)W * H);
  out.plateId.resize((size_t)W * H);
  out.rawDepth.resize((size_t)W * H);
  float* dst[3] = {out.linearDepth.data(), out.plateId.data(),
                   out.rawDepth.data()};
  for (int i = 0; i < 3; ++i) {
    VK_CHECK(vkMapMemory(c.device, rbMem[i], 0, imgBytes, 0, &mapped));
    memcpy(dst[i], mapped, imgBytes);
    vkUnmapMemory(c.device, rbMem[i]);
  }

  vkDestroyFence(c.device, fence, nullptr);
  for (int i = 0; i < 3; ++i) {
    vkDestroyBuffer(c.device, rbBuf[i], nullptr);
    vkFreeMemory(c.device, rbMem[i], nullptr);
  }
  vkFreeMemory(c.device, vbMem, nullptr);
  vkDestroyBuffer(c.device, vb, nullptr);
  vkDestroyPipeline(c.device, pipeline, nullptr);
  vkDestroyPipelineLayout(c.device, pipeLayout, nullptr);
  vkDestroyShaderModule(c.device, vs, nullptr);
  vkDestroyShaderModule(c.device, fs, nullptr);
  vkDestroyFramebuffer(c.device, fb, nullptr);
  vkDestroyRenderPass(c.device, renderPass, nullptr);
  for (GpuImage* g : {&imgLinear, &imgId, &imgDepth}) {
    vkDestroyImageView(c.device, g->view, nullptr);
    vkDestroyImage(c.device, g->image, nullptr);
    vkFreeMemory(c.device, g->mem, nullptr);
  }
  return out;
}

// ------------------------------------------------------------ verify ------
struct CheckLog {
  int failures = 0;
  std::string text;
  void fail(const std::string& s) {
    ++failures;
    text += "FAIL: " + s + "\n";
  }
  void pass(const std::string& s) { text += "ok:   " + s + "\n"; }
  void info(const std::string& s) { text += "info: " + s + "\n"; }
};

// Reconstruct world position from a raw depth value at pixel (px,py).
// Returns false for background pixels (explicit invalid convention).
static bool reconstructWorld(const ProjParams& pp, const Mat4& proj, float raw,
                             int px, int py, int W, int H, double out[3]) {
  if (raw == clearDepth(pp)) return false;  // background: invalid
  const double d = depthFromNdc(pp, raw);
  const double ndcX = ((px + 0.5) / W) * 2.0 - 1.0;
  const double ndcY = ((py + 0.5) / H) * 2.0 - 1.0;
  double vx, vy;
  if (isOrtho(pp.mode)) {
    vx = ndcX / proj.m[0];
    vy = ndcY / proj.m[5];
  } else {
    vx = ndcX * d / proj.m[0];
    vy = ndcY * d / proj.m[5];
  }
  out[0] = vx + kCamX;
  out[1] = vy + kCamY;
  out[2] = kCamZ - d;
  return true;
}

struct SampleRow {
  std::string label;
  int px, py;
};

static void writeF32(const std::string& path, const std::vector<float>& v) {
  std::ofstream f(path, std::ios::binary);
  f.write((const char*)v.data(), v.size() * sizeof(float));
}

static void writePgm(const std::string& path, const std::vector<float>& lin,
                     int W, int H, float maxD) {
  std::ofstream f(path, std::ios::binary);
  f << "P5\n" << W << " " << H << "\n255\n";
  for (int i = 0; i < W * H; ++i) {
    const float v = lin[i];
    int g = 0;  // background (NaN) stays black: explicitly invalid
    if (!std::isnan(v)) g = (int)lroundf(255.0f * std::min(1.0f, v / maxD));
    f.put((char)g);
  }
}

struct ModeResult {
  ProjMode mode;
  bool ok;
  double farPlateZError = 0.0;  // for cross-mode precision comparison
};

static void pixelOfPlateCenter(const ProjParams& pp, const Plate& pl, int W,
                               int H, int& px, int& py) {
  const Mat4 proj = buildProjection(pp);
  double sx, sy, sz;
  projectPoint(pp, proj, pl.cx, pl.cy, pl.z, sx, sy, sz, W, H);
  px = std::min(W - 1, std::max(0, (int)floor(sx)));
  py = std::min(H - 1, std::max(0, (int)floor(sy)));
}

static ModeResult runMode(const VkCtx& c, ProjMode mode,
                          const std::vector<Plate>& plates,
                          const std::vector<Vertex>& verts, int W, int H,
                          const std::string& outDir) {
  ProjParams pp;
  pp.mode = mode;
  pp.aspect = (float)W / H;
  CheckLog log;
  char buf[256];

  RenderResult r = renderPlates(c, pp, verts, W, H);
  AnalyticImage ref = analyticRender(pp, plates, W, H);
  const Mat4 proj = buildProjection(pp);
  const float clear = clearDepth(pp);

  // -- 1. full-image convention check: plate-id map must match the analytic
  //       top-left-rule rasterizer, except at sub-pixel-ambiguous edges.
  int ambiguous = 0, hardMismatch = 0;
  for (int i = 0; i < W * H; ++i) {
    const int gpuId = (r.plateId[i] < 0.0f) ? -1 : (int)lroundf(r.plateId[i]);
    if (gpuId == ref.id[i]) continue;
    if (ref.edge[i] < 1e-3 && gpuId >= 0) {
      ++ambiguous;  // fp-rounding at an exact edge: either neighbour is valid
      continue;
    }
    if (++hardMismatch <= 5) {
      snprintf(buf, sizeof(buf), "id mismatch at (%d,%d): gpu=%d ref=%d",
               i % W, i / W, gpuId, ref.id[i]);
      log.fail(buf);
    }
  }
  snprintf(buf, sizeof(buf),
           "plate-id map matches analytic top-left rasterizer "
           "(%d ambiguous edge px, %d hard mismatches)",
           ambiguous, hardMismatch);
  if (hardMismatch == 0) log.pass(buf); else log.fail(buf);

  // -- 2. per-pixel depth / reconstruction checks
  int bgCount = 0, checked = 0;
  double maxRawErr = 0, maxLinErr = 0, maxZErr = 0;
  for (int i = 0; i < W * H; ++i) {
    const int px = i % W, py = i / W;
    if (ref.id[i] < 0) {  // background: explicit invalid values required
      ++bgCount;
      if (r.rawDepth[i] != clear)
        log.fail("background raw depth != clear value");
      if (!std::isnan(r.linearDepth[i]))
        log.fail("background linear depth is not NaN");
      if (r.plateId[i] != -1.0f) log.fail("background plate id != -1");
      double wpos[3];
      if (reconstructWorld(pp, proj, r.rawDepth[i], px, py, W, H, wpos))
        log.fail("background reconstruction must be invalid");
      continue;
    }
    if (ref.edge[i] < 1e-3) continue;  // ambiguous edge pixel, checked above
    ++checked;
    const Plate& pl = plates[ref.id[i]];
    const double d = plateDepth(pl);
    maxRawErr = std::max(maxRawErr, fabs(r.rawDepth[i] - ref.ndc[i]));
    maxLinErr = std::max(maxLinErr, fabs(r.linearDepth[i] - d));
    double wpos[3];
    if (!reconstructWorld(pp, proj, r.rawDepth[i], px, py, W, H, wpos)) {
      log.fail("valid pixel reconstructed as invalid");
      continue;
    }
    maxZErr = std::max(maxZErr, fabs(wpos[2] - pl.z));
    if (wpos[0] < pl.cx - pl.hx - 1e-3 || wpos[0] > pl.cx + pl.hx + 1e-3 ||
        wpos[1] < pl.cy - pl.hy - 1e-3 || wpos[1] > pl.cy + pl.hy + 1e-3)
      log.fail("reconstructed xy outside plate bounds");
    if (log.failures > 30) break;
  }
  snprintf(buf, sizeof(buf), "raw depth vs analytic ndc: max err %.3g (%d px)",
           maxRawErr, checked);
  (maxRawErr < 5e-6) ? log.pass(buf) : log.fail(buf);
  snprintf(buf, sizeof(buf), "linear depth vs view depth: max err %.3g",
           maxLinErr);
  (maxLinErr < 1e-4) ? log.pass(buf) : log.fail(buf);
  snprintf(buf, sizeof(buf), "reconstructed world z: max err %.3g", maxZErr);
  (maxZErr < 5e-3) ? log.pass(buf) : log.fail(buf);
  snprintf(buf, sizeof(buf),
           "background: %d px, raw=clear(%g), linear=NaN, id=-1, recon=invalid",
           bgCount, clear);
  log.pass(buf);

  // -- 3. named checks: near/mid/far plate centers
  ModeResult res{mode, false, 0.0};
  std::vector<SampleRow> samples;
  for (int pi = 0; pi < 3; ++pi) {  // A, B, C
    int px, py;
    pixelOfPlateCenter(pp, plates[pi], W, H, px, py);
    const int i = py * W + px;
    double wpos[3];
    const bool ok = reconstructWorld(pp, proj, r.rawDepth[i], px, py, W, H, wpos);
    const double zErr = ok ? fabs(wpos[2] - plates[pi].z) : 1e30;
    snprintf(buf, sizeof(buf),
             "%s center (%d,%d): raw=%.8f linear=%.6f recon z=%.6f "
             "(expect %.2f, err %.3g)",
             plates[pi].name, px, py, r.rawDepth[i], r.linearDepth[i],
             ok ? wpos[2] : NAN, (double)plates[pi].z, zErr);
    (ok && zErr < 5e-3) ? log.pass(buf) : log.fail(buf);
    if (pi == 2) res.farPlateZError = zErr;
    samples.push_back({plates[pi].name, px, py});
  }

  // -- 4. shared-edge pixels (E|F): boundary must be sharp, deterministic,
  //       and follow the top-left rule (pixel exactly on the edge -> F).
  {
    const Plate& E = plates[4];
    double sx, sy, sz;
    projectPoint(pp, proj, E.cx + E.hx, E.cy, E.z, sx, sy, sz, W, H);
    const int row = std::min(H - 1, std::max(0, (int)floor(sy)));
    // First column owned by F: pixel centers < edge -> E, on/after -> F.
    const int expectCol = (int)ceil(sx - 0.5);
    bool sharp = true, ownerOk = true;
    int edgeRows = 0;
    for (int y = 0; y < H; ++y) {
      const int refL = ref.id[y * W + expectCol - 1];
      const int refR = ref.id[y * W + expectCol];
      if (refL != 4 && refR != 5) continue;  // outside E/F y-extent
      ++edgeRows;
      const int iL = y * W + expectCol - 1, iR = y * W + expectCol;
      if ((int)lroundf(r.plateId[iL]) != 4) sharp = false;
      if ((int)lroundf(r.plateId[iR]) != 5) ownerOk = false;
    }
    snprintf(buf, sizeof(buf),
             "shared edge E|F at col %d (edge x=%.4f px, %d rows): left=E "
             "right=F, top-left rule %s",
             expectCol, sx, edgeRows, (sharp && ownerOk) ? "holds" : "violated");
    (edgeRows > 0 && sharp && ownerOk) ? log.pass(buf) : log.fail(buf);
    samples.push_back({"edge-left", expectCol - 1, row});
    samples.push_back({"edge-right", expectCol, row});
  }

  // -- 5. overlap region A x D: nearer plate A must win (compare op)
  {
    auto screenRect = [&](const Plate& pl, double& rx0, double& ry0,
                          double& rx1, double& ry1) {
      double sx, sy, sz;
      projectPoint(pp, proj, pl.cx - pl.hx, pl.cy - pl.hy, pl.z, sx, sy, sz,
                   W, H);
      rx0 = sx;
      ry0 = sy;
      projectPoint(pp, proj, pl.cx + pl.hx, pl.cy + pl.hy, pl.z, sx, sy, sz,
                   W, H);
      rx1 = sx;
      ry1 = sy;
      if (rx0 > rx1) std::swap(rx0, rx1);
      if (ry0 > ry1) std::swap(ry0, ry1);
    };
    double ax0, ay0, ax1, ay1, dx0, dy0, dx1, dy1;
    screenRect(plates[0], ax0, ay0, ax1, ay1);
    screenRect(plates[3], dx0, dy0, dx1, dy1);
    const double ix0 = std::max(ax0, dx0), ix1 = std::min(ax1, dx1);
    const double iy0 = std::max(ay0, dy0), iy1 = std::min(ay1, dy1);
    int overlapPx = 0, overlapOk = 0;
    int sampleX = -1, sampleY = -1;
    for (int y = 0; y < H; ++y)
      for (int x = 0; x < W; ++x) {
        // pixel center strictly inside both projected rects
        if (x + 0.5 <= ix0 || x + 0.5 >= ix1 || y + 0.5 <= iy0 ||
            y + 0.5 >= iy1)
          continue;
        ++overlapPx;
        sampleX = x;
        sampleY = y;
        if ((int)lroundf(r.plateId[y * W + x]) == 0) ++overlapOk;
      }
    snprintf(buf, sizeof(buf),
             "depth compare (%s): nearer plate A wins overlap %d/%d px",
             isReversed(mode) ? "GREATER" : "LESS", overlapOk, overlapPx);
    (overlapPx > 0 && overlapOk == overlapPx) ? log.pass(buf) : log.fail(buf);
    if (overlapPx > 0)
      samples.push_back({"overlap-A-over-D", sampleX, sampleY});
  }

  // -- 6. diagonal of plate B (two triangles): no cracks along shared edge
  {
    int x0, y0, x1, y1;
    pixelOfPlateCenter(pp, plates[1], W, H, x0, y0);
    int bx0 = std::max(0, x0 - 12), bx1 = std::min(W - 1, x0 + 12);
    int by0 = std::max(0, y0 - 12), by1 = std::min(H - 1, y0 + 12);
    int holes = 0;
    for (int y = by0; y <= by1; ++y)
      for (int x = bx0; x <= bx1; ++x)
        if (ref.id[y * W + x] == 1 && r.plateId[y * W + x] < 0.0f) ++holes;
    snprintf(buf, sizeof(buf), "plate B diagonal: %d crack pixels", holes);
    (holes == 0) ? log.pass(buf) : log.fail(buf);
  }

  // -- dumps: raw depth, linear depth, plate id, visualization, samples
  const std::string dir = outDir + "/" + kModeNames[(int)mode];
  snprintf(buf, sizeof(buf), "mkdir -p %s", dir.c_str());
  if (system(buf) != 0) log.fail("cannot create output dir");
  writeF32(dir + "/raw_depth.f32", r.rawDepth);
  writeF32(dir + "/linear_depth.f32", r.linearDepth);
  writeF32(dir + "/plate_id.f32", r.plateId);
  writePgm(dir + "/linear_depth.pgm", r.linearDepth, W, H, pp.farZ);

  samples.push_back({"background", 0, 0});
  {
    std::ofstream csv(dir + "/samples.csv");
    csv << "label,px,py,plate_id,raw_depth,linear_depth,recon_x,recon_y,"
           "recon_z,expected_z,valid\n";
    for (const SampleRow& s : samples) {
      const int i = s.py * W + s.px;
      double wpos[3] = {NAN, NAN, NAN};
      const bool ok =
          reconstructWorld(pp, proj, r.rawDepth[i], s.px, s.py, W, H, wpos);
      const int id = (int)lroundf(r.plateId[i]);
      const double ez = (id >= 0) ? (double)plates[id].z : NAN;
      csv << s.label << "," << s.px << "," << s.py << "," << id << ",";
      csv.precision(9);
      csv << r.rawDepth[i] << "," << r.linearDepth[i] << "," << wpos[0] << ","
          << wpos[1] << "," << wpos[2] << "," << ez << ","
          << (ok ? 1 : 0) << "\n";
    }
  }
  {
    std::ofstream rep(dir + "/report.txt");
    rep << "mode: " << kModeNames[(int)mode] << "\n"
        << "compare: " << (isReversed(mode) ? "GREATER" : "LESS")
        << ", clear depth: " << clear << "\n"
        << "background convention: raw=clear, linear=NaN, id=-1, "
           "reconstruction invalid\n\n"
        << log.text;
  }

  res.ok = (log.failures == 0);
  printf("[%s] %s (%d failures)\n", kModeNames[(int)mode],
         res.ok ? "PASS" : "FAIL", log.failures);
  return res;
}

// ---------------------------------------------------------------- main ----
static std::vector<Vertex> buildVertices(const std::vector<Plate>& plates) {
  std::vector<Vertex> v;
  for (const Plate& p : plates) {
    const float x[4] = {p.cx - p.hx, p.cx + p.hx, p.cx + p.hx, p.cx - p.hx};
    const float y[4] = {p.cy - p.hy, p.cy - p.hy, p.cy + p.hy, p.cy + p.hy};
    const int idx[6] = {0, 1, 2, 0, 2, 3};
    for (int k = 0; k < 6; ++k) {
      Vertex vtx{{x[idx[k]], y[idx[k]], p.z}, (float)p.id};
      v.push_back(vtx);
    }
  }
  return v;
}

int main(int argc, char** argv) {
  // Headless fallback: this environment ships broken GPU ICDs that crash the
  // loader during enumeration. If the user has not chosen a driver, prefer
  // lavapipe (CPU) when available. Override with VK_LOADER_DRIVERS_SELECT or
  // VK_ICD_FILENAMES to use a real GPU.
  if (!getenv("VK_LOADER_DRIVERS_SELECT") && !getenv("VK_ICD_FILENAMES") &&
      !getenv("VK_LOADER_DRIVERS_DISABLE")) {
    std::ifstream f("/usr/share/vulkan/icd.d/lvp_icd.json");
    if (f.good()) {
      setenv("VK_LOADER_DRIVERS_SELECT", "lvp_icd.json", 0);
      printf("VK_LOADER_DRIVERS_SELECT unset; defaulting to lavapipe "
             "(lvp_icd.json)\n");
    }
  }

  std::string outDir = "artifacts";
  std::string modeArg = "all";
  int W = 64, H = 64;
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "--proj" && i + 1 < argc) modeArg = argv[++i];
    else if (a == "--out" && i + 1 < argc) outDir = argv[++i];
    else if (a == "--size" && i + 1 < argc) W = H = atoi(argv[++i]);
    else {
      fprintf(stderr,
              "usage: %s [--proj perspective|perspective-reverse|ortho|"
              "ortho-reverse|infinite|infinite-reverse|all] [--out DIR] "
              "[--size N]\n",
              argv[0]);
      return 2;
    }
  }

  const std::vector<Plate> plates = buildPlates();
  const std::vector<Vertex> verts = buildVertices(plates);
  const VkCtx c = createContext();

  std::vector<ModeResult> results;
  for (int m = 0; m < (int)ProjMode::COUNT; ++m) {
    if (modeArg != "all" && modeArg != kModeNames[m]) continue;
    results.push_back(runMode(c, (ProjMode)m, plates, verts, W, H, outDir));
  }
  if (results.empty()) {
    fprintf(stderr, "unknown --proj mode '%s'\n", modeArg.c_str());
    return 2;
  }

  // Cross-mode convention: reverse-Z must reconstruct the far plate at
  // least as accurately as forward-Z (float depth precision distribution).
  auto find = [&](ProjMode m) -> const ModeResult* {
    for (const auto& r : results)
      if (r.mode == m) return &r;
    return nullptr;
  };
  bool precisionOk = true;
  for (auto pair : {std::make_pair(ProjMode::PERSPECTIVE,
                                   ProjMode::PERSPECTIVE_REVERSED),
                    std::make_pair(ProjMode::INFINITE,
                                   ProjMode::INFINITE_REVERSED)}) {
    const ModeResult* fwd = find(pair.first);
    const ModeResult* rev = find(pair.second);
    if (!fwd || !rev) continue;
    printf("far-plate z error: %s %.3g vs %s %.3g\n", kModeNames[(int)pair.first],
           fwd->farPlateZError, kModeNames[(int)pair.second],
           rev->farPlateZError);
    if (rev->farPlateZError > fwd->farPlateZError) precisionOk = false;
  }
  if (!precisionOk) printf("FAIL: reverse-Z precision convention violated\n");

  int failed = precisionOk ? 0 : 1;
  for (const auto& r : results) failed += r.ok ? 0 : 1;
  printf("summary: %zu mode(s), %s\n", results.size(),
         failed == 0 ? "ALL PASS" : "FAILURES");
  vkDestroyCommandPool(c.device, c.cmdPool, nullptr);
  vkDestroyDevice(c.device, nullptr);
  vkDestroyInstance(c.instance, nullptr);
  return failed == 0 ? 0 : 1;
}

