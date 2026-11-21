#include "core/SceneGenerator.h"

#include "core/SceneFormat.h"
#include "core/SceneIndex.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <limits>
#include <memory>
#include <numeric>
#include <queue>
#include <random>
#include <vector>

namespace pcloud {
namespace {

struct BuildNode {
    Box3 bounds;
    int depth = 0;
    std::uint32_t childMask = 0;
    std::vector<Point> payload;
    std::vector<std::unique_ptr<BuildNode>> children;
};

std::uint32_t colorForPoint(const Vec3& point, double halfExtent) {
    const double t = std::clamp((point.y + halfExtent) / (2.0 * halfExtent), 0.0, 1.0);
    const double radius = std::sqrt(point.x * point.x + point.z * point.z);
    if (radius > halfExtent * 0.55 && point.y > 1.0) {
        const double glow = std::clamp(radius / halfExtent, 0.0, 1.0);
        return packRgba(
            static_cast<std::uint8_t>(210 + 35 * glow),
            static_cast<std::uint8_t>(95 + 65 * t),
            static_cast<std::uint8_t>(55 + 50 * (1.0 - t)));
    }
    return packRgba(
        static_cast<std::uint8_t>(45 + 145 * t),
        static_cast<std::uint8_t>(120 + 100 * t),
        static_cast<std::uint8_t>(170 - 55 * t));
}

std::vector<Point> makeSyntheticCloud(const SceneGenerationConfig& config) {
    std::mt19937_64 random(config.seed);
    std::uniform_real_distribution<double> unit(0.0, 1.0);
    std::uniform_real_distribution<double> signedUnit(-1.0, 1.0);
    std::vector<Point> points;
    points.reserve(static_cast<std::size_t>(config.pointCount));

    const double extent = config.halfExtent;
    for (std::uint64_t index = 0; index < config.pointCount; ++index) {
        const bool tower = (index % 5) == 0;
        double x = 0.0;
        double y = 0.0;
        double z = 0.0;
        if (tower) {
            const double angle = unit(random) * 2.0 * kPi;
            const double radius = extent * (0.66 + 0.12 * signedUnit(random));
            x = std::cos(angle) * radius;
            z = std::sin(angle) * radius;
            const double height = std::pow(unit(random), 1.6);
            y = -extent * 0.25 + height * extent * 1.45;
        } else {
            x = signedUnit(random) * extent;
            z = signedUnit(random) * extent;
            const double terrain =
                0.42 * std::sin(x * 0.32) +
                0.28 * std::cos(z * 0.27) +
                0.16 * std::sin((x + z) * 0.73);
            y = terrain * extent * 0.22 - extent * 0.45 +
                signedUnit(random) * extent * 0.035;
        }
        const Vec3 position{x, y, z};
        points.push_back(Point{
            static_cast<float>(x),
            static_cast<float>(y),
            static_cast<float>(z),
            colorForPoint(position, extent)});
    }
    return points;
}

std::vector<Point> samplePayload(const std::vector<Point>& points,
                                 const std::vector<std::uint32_t>& indices,
                                 std::uint32_t limit) {
    const std::size_t count = std::min<std::size_t>(indices.size(), limit);
    std::vector<Point> payload;
    payload.reserve(count);
    if (indices.size() <= limit) {
        for (std::uint32_t index : indices) {
            payload.push_back(points[index]);
        }
        return payload;
    }
    for (std::size_t output = 0; output < count; ++output) {
        const std::size_t source =
            static_cast<std::size_t>((static_cast<unsigned long long>(output) * indices.size()) /
                                     count);
        payload.push_back(points[indices[source]]);
    }
    return payload;
}

std::unique_ptr<BuildNode> buildTree(const SceneGenerationConfig& config,
                                     const std::vector<Point>& points,
                                     std::vector<std::uint32_t> indices,
                                     const Box3& bounds,
                                     int depth) {
    auto node = std::make_unique<BuildNode>();
    node->bounds = bounds;
    node->depth = depth;
    node->payload = samplePayload(points, indices, config.nodePointLimit);

    const std::size_t splitThreshold =
        std::max<std::size_t>(8, static_cast<std::size_t>(config.nodePointLimit) / 4);
    if (depth >= config.maxDepth || indices.size() <= splitThreshold) {
        return node;
    }

    const Vec3 center = bounds.center();
    std::array<std::vector<std::uint32_t>, 8> buckets;
    for (std::uint32_t index : indices) {
        const Vec3 point = points[index].asVec3();
        const std::uint32_t octant =
            (point.x >= center.x ? 1u : 0u) |
            (point.y >= center.y ? 2u : 0u) |
            (point.z >= center.z ? 4u : 0u);
        buckets[octant].push_back(index);
    }

    int nonEmpty = 0;
    for (const auto& bucket : buckets) {
        if (!bucket.empty()) {
            ++nonEmpty;
        }
    }
    if (nonEmpty < 2) {
        return node;
    }

    for (std::uint32_t octant = 0; octant < buckets.size(); ++octant) {
        if (buckets[octant].empty()) {
            continue;
        }
        Box3 childBounds;
        childBounds.min = {
            (octant & 1u) ? center.x : bounds.min.x,
            (octant & 2u) ? center.y : bounds.min.y,
            (octant & 4u) ? center.z : bounds.min.z,
        };
        childBounds.max = {
            (octant & 1u) ? bounds.max.x : center.x,
            (octant & 2u) ? bounds.max.y : center.y,
            (octant & 4u) ? bounds.max.z : center.z,
        };
        node->childMask |= (1u << octant);
        node->children.push_back(buildTree(
            config, points, std::move(buckets[octant]), childBounds, depth + 1));
    }
    return node;
}

}  // namespace

bool SceneGenerator::generate(const SceneGenerationConfig& config,
                              const std::string& outputPath,
                              SceneGenerationResult* result,
                              std::string* error) {
    if (config.pointCount < 32 || config.maxDepth < 0 || config.maxDepth > 16 ||
        config.nodePointLimit == 0 || config.halfExtent <= 0.0) {
        if (error) {
            *error = "invalid scene generation parameters";
        }
        return false;
    }

    const std::vector<Point> points = makeSyntheticCloud(config);
    std::vector<std::uint32_t> indices(points.size());
    std::iota(indices.begin(), indices.end(), 0u);
    const Box3 rootBounds{
        {-config.halfExtent, -config.halfExtent, -config.halfExtent},
        {config.halfExtent, config.halfExtent, config.halfExtent},
    };
    std::unique_ptr<BuildNode> root =
        buildTree(config, points, std::move(indices), rootBounds, 0);

    std::vector<DiskNode> diskNodes;
    diskNodes.reserve(256);
    std::queue<std::pair<const BuildNode*, std::uint32_t>> pending;
    diskNodes.push_back(DiskNode{});
    pending.push({root.get(), 0});

    while (!pending.empty()) {
        const auto [source, id] = pending.front();
        pending.pop();
        DiskNode& target = diskNodes[id];
        target.id = id;
        target.parent = id == 0 ? kInvalidNode : target.parent;
        target.depth = static_cast<std::uint8_t>(source->depth);
        target.childMask = source->childMask;
        target.pointCount = static_cast<std::uint32_t>(source->payload.size());
        target.payloadBytes = source->payload.size() * sizeof(Point);
        target.bounds = source->bounds;
        target.geometricError = source->children.empty()
                                    ? 0.0f
                                    : static_cast<float>(source->bounds.diagonal());

        if (!source->children.empty()) {
            target.firstChild = static_cast<std::uint32_t>(diskNodes.size());
            target.childCount = static_cast<std::uint8_t>(source->children.size());
            for (const auto& child : source->children) {
                const std::uint32_t childId = static_cast<std::uint32_t>(diskNodes.size());
                DiskNode placeholder{};
                placeholder.id = childId;
                placeholder.parent = id;
                diskNodes.push_back(placeholder);
                pending.push({child.get(), childId});
            }
        } else {
            target.firstChild = kInvalidNode;
            target.childCount = 0;
        }
    }

    SceneHeader header;
    header.nodeCount = diskNodes.size();
    header.indexOffset = kHeaderSize;
    header.dataOffset = kHeaderSize + diskNodes.size() * kNodeEntrySize;
    header.bounds = rootBounds;
    std::uint64_t payloadCursor = header.dataOffset;
    for (DiskNode& node : diskNodes) {
        node.payloadOffset = payloadCursor;
        payloadCursor += node.payloadBytes;
        header.maxGeometricError =
            std::max(header.maxGeometricError, static_cast<double>(node.geometricError));
    }
    header.fileSize = payloadCursor;

    std::ofstream output(outputPath, std::ios::binary | std::ios::trunc);
    if (!output) {
        if (error) {
            *error = "cannot create output scene";
        }
        return false;
    }
    if (!writeHeader(output, header)) {
        if (error) {
            *error = "failed to write scene header";
        }
        return false;
    }
    for (const DiskNode& node : diskNodes) {
        if (!writeNodeEntry(output, node)) {
            if (error) {
                *error = "failed to write scene index";
            }
            return false;
        }
    }

    std::queue<std::pair<const BuildNode*, std::uint32_t>> payloadQueue;
    payloadQueue.push({root.get(), 0});
    while (!payloadQueue.empty()) {
        const auto [source, id] = payloadQueue.front();
        payloadQueue.pop();
        output.write(reinterpret_cast<const char*>(source->payload.data()),
                     static_cast<std::streamsize>(source->payload.size() * sizeof(Point)));
        if (!output) {
            if (error) {
                *error = "failed while writing point payload";
            }
            return false;
        }
        // Resolve child ids from the existing breadth-first queue layout.
        const DiskNode& diskNode = diskNodes[id];
        for (std::uint32_t childIndex = 0; childIndex < diskNode.childCount; ++childIndex) {
            payloadQueue.push(
                {source->children[childIndex].get(), diskNode.firstChild + childIndex});
        }
    }
    output.flush();
    if (!output) {
        if (error) {
            *error = "failed to flush scene";
        }
        return false;
    }

    if (result) {
        result->nodeCount = header.nodeCount;
        result->fileBytes = header.fileSize;
        result->maxDepth = 0;
        result->storedPointCount = 0;
        for (const DiskNode& node : diskNodes) {
            result->storedPointCount += node.pointCount;
            result->maxDepth = std::max(result->maxDepth, static_cast<int>(node.depth));
        }
    }
    return true;
}

}  // namespace pcloud
