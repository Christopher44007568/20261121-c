#include "core/SceneIndex.h"

#include <cmath>
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>

namespace pcloud {
namespace {

bool writeSceneHeader(std::ostream& output, const SceneHeader& header) {
    output.write(kSceneMagic, sizeof(kSceneMagic));
    detail::writePod(output, kSceneVersion);
    detail::writePod(output, static_cast<std::uint32_t>(kHeaderSize));
    detail::writePod(output, header.fileSize);
    detail::writePod(output, header.nodeCount);
    detail::writePod(output, header.indexOffset);
    detail::writePod(output, header.dataOffset);
    detail::writeDouble(output, header.bounds.min.x);
    detail::writeDouble(output, header.bounds.min.y);
    detail::writeDouble(output, header.bounds.min.z);
    detail::writeDouble(output, header.bounds.max.x);
    detail::writeDouble(output, header.bounds.max.y);
    detail::writeDouble(output, header.bounds.max.z);
    detail::writeDouble(output, header.maxGeometricError);
    return output.good();
}

bool readSceneHeader(std::istream& input, SceneHeader& header) {
    char magic[sizeof(kSceneMagic)]{};
    input.read(magic, sizeof(magic));
    if (!input.good() || std::memcmp(magic, kSceneMagic, sizeof(magic)) != 0) {
        return false;
    }
    std::uint32_t version = 0;
    std::uint32_t headerBytes = 0;
    if (!detail::readPod(input, version) || !detail::readPod(input, headerBytes)) {
        return false;
    }
    if (version != kSceneVersion || headerBytes != kHeaderSize) {
        return false;
    }
    if (!detail::readPod(input, header.fileSize) ||
        !detail::readPod(input, header.nodeCount) ||
        !detail::readPod(input, header.indexOffset) ||
        !detail::readPod(input, header.dataOffset)) {
        return false;
    }
    return detail::readDouble(input, header.bounds.min.x) &&
           detail::readDouble(input, header.bounds.min.y) &&
           detail::readDouble(input, header.bounds.min.z) &&
           detail::readDouble(input, header.bounds.max.x) &&
           detail::readDouble(input, header.bounds.max.y) &&
           detail::readDouble(input, header.bounds.max.z) &&
           detail::readDouble(input, header.maxGeometricError);
}

bool writeSceneNode(std::ostream& output, const DiskNode& node) {
    detail::writePod(output, node.id);
    detail::writePod(output, node.parent);
    detail::writePod(output, node.firstChild);
    detail::writePod(output, node.childCount);
    detail::writePod(output, node.depth);
    detail::writePod(output, node.flags);
    detail::writePod(output, node.pointCount);
    detail::writePod(output, node.reserved);
    detail::writePod(output, node.payloadOffset);
    detail::writePod(output, node.payloadBytes);
    detail::writePod(output, static_cast<float>(node.bounds.min.x));
    detail::writePod(output, static_cast<float>(node.bounds.min.y));
    detail::writePod(output, static_cast<float>(node.bounds.min.z));
    detail::writePod(output, static_cast<float>(node.bounds.max.x));
    detail::writePod(output, static_cast<float>(node.bounds.max.y));
    detail::writePod(output, static_cast<float>(node.bounds.max.z));
    detail::writePod(output, node.geometricError);
    detail::writePod(output, node.childMask);
    return output.good();
}

bool readSceneNode(std::istream& input, DiskNode& node) {
    float minX = 0.0f;
    float minY = 0.0f;
    float minZ = 0.0f;
    float maxX = 0.0f;
    float maxY = 0.0f;
    float maxZ = 0.0f;
    if (!detail::readPod(input, node.id) ||
        !detail::readPod(input, node.parent) ||
        !detail::readPod(input, node.firstChild) ||
        !detail::readPod(input, node.childCount) ||
        !detail::readPod(input, node.depth) ||
        !detail::readPod(input, node.flags) ||
        !detail::readPod(input, node.pointCount) ||
        !detail::readPod(input, node.reserved) ||
        !detail::readPod(input, node.payloadOffset) ||
        !detail::readPod(input, node.payloadBytes) ||
        !detail::readPod(input, minX) ||
        !detail::readPod(input, minY) ||
        !detail::readPod(input, minZ) ||
        !detail::readPod(input, maxX) ||
        !detail::readPod(input, maxY) ||
        !detail::readPod(input, maxZ) ||
        !detail::readPod(input, node.geometricError) ||
        !detail::readPod(input, node.childMask)) {
        return false;
    }
    node.bounds.min = {minX, minY, minZ};
    node.bounds.max = {maxX, maxY, maxZ};
    return true;
}

bool finiteBox(const Box3& box) {
    const double values[] = {
        box.min.x, box.min.y, box.min.z,
        box.max.x, box.max.y, box.max.z,
    };
    for (double value : values) {
        if (!std::isfinite(value)) {
            return false;
        }
    }
    return box.min.x <= box.max.x && box.min.y <= box.max.y && box.min.z <= box.max.z;
}

std::string failure(std::size_t index, const std::string& reason) {
    std::ostringstream stream;
    stream << "node " << index << ": " << reason;
    return stream.str();
}

}  // namespace

bool writeHeader(std::ostream& output, const SceneHeader& header) {
    return writeSceneHeader(output, header);
}

bool readHeader(std::istream& input, SceneHeader& header) {
    return readSceneHeader(input, header);
}

bool writeNodeEntry(std::ostream& output, const DiskNode& node) {
    return writeSceneNode(output, node);
}

bool readNodeEntry(std::istream& input, DiskNode& node) {
    return readSceneNode(input, node);
}

std::shared_ptr<SceneIndex> SceneIndex::open(const std::string& path, std::string* error) {
    auto scene = std::shared_ptr<SceneIndex>(new SceneIndex());
    scene->path_ = path;

    std::error_code fileError;
    const auto actualSize = std::filesystem::file_size(path, fileError);
    if (fileError) {
        if (error) {
            *error = "cannot stat scene: " + fileError.message();
        }
        return {};
    }

    std::ifstream input(path, std::ios::binary);
    if (!input) {
        if (error) {
            *error = "cannot open scene file";
        }
        return {};
    }
    if (!readSceneHeader(input, scene->header_)) {
        if (error) {
            *error = "invalid scene header";
        }
        return {};
    }
    if (scene->header_.fileSize > actualSize) {
        if (error) {
            *error = "scene is truncated";
        }
        return {};
    }
    if (scene->header_.nodeCount == 0 || scene->header_.nodeCount > 10'000'000) {
        if (error) {
            *error = "invalid node count";
        }
        return {};
    }
    const std::uint64_t indexBytes = scene->header_.nodeCount * kNodeEntrySize;
    if (scene->header_.indexOffset != kHeaderSize ||
        scene->header_.dataOffset < scene->header_.indexOffset + indexBytes) {
        if (error) {
            *error = "invalid index layout";
        }
        return {};
    }

    input.seekg(static_cast<std::streamoff>(scene->header_.indexOffset), std::ios::beg);
    if (!input) {
        if (error) {
            *error = "cannot seek to index";
        }
        return {};
    }
    scene->nodes_.resize(static_cast<std::size_t>(scene->header_.nodeCount));
    for (auto& node : scene->nodes_) {
        if (!readSceneNode(input, node)) {
            if (error) {
                *error = "truncated node index";
            }
            return {};
        }
    }
    if (!scene->validate(error)) {
        return {};
    }
    return scene;
}

bool SceneIndex::isAncestor(std::uint32_t possibleAncestor, std::uint32_t nodeId) const {
    if (possibleAncestor == nodeId || nodeId >= nodes_.size()) {
        return false;
    }
    std::uint32_t current = nodes_[nodeId].parent;
    while (current != kInvalidNode) {
        if (current == possibleAncestor) {
            return true;
        }
        if (current >= nodes_.size()) {
            return false;
        }
        current = nodes_[current].parent;
    }
    return false;
}

bool SceneIndex::validate(std::string* error) {
    const auto& nodes = nodes_;
    if (nodes.empty()) {
        if (error) {
            *error = "empty node index";
        }
        return false;
    }
    children_.assign(nodes.size(), {});

    for (std::size_t index = 0; index < nodes.size(); ++index) {
        const DiskNode& node = nodes[index];
        if (node.id != index) {
            if (error) {
                *error = failure(index, "id does not match index position");
            }
            return false;
        }
        if (!finiteBox(node.bounds)) {
            if (error) {
                *error = failure(index, "invalid bounds");
            }
            return false;
        }
        if (node.childCount > 8) {
            if (error) {
                *error = failure(index, "more than eight octree children");
            }
            return false;
        }
        if (node.pointCount == 0 || node.payloadBytes != node.pointCount * sizeof(Point)) {
            if (error) {
                *error = failure(index, "invalid payload size");
            }
            return false;
        }
        if (node.payloadOffset < header_.dataOffset ||
            node.payloadOffset > header_.fileSize ||
            node.payloadBytes > header_.fileSize - node.payloadOffset) {
            if (error) {
                *error = failure(index, "payload outside file");
            }
            return false;
        }
        if (index == 0) {
            if (node.parent != kInvalidNode) {
                if (error) {
                    *error = "root must not have a parent";
                }
                return false;
            }
        } else if (node.parent == kInvalidNode || node.parent >= index) {
            if (error) {
                *error = failure(index, "parent must refer to an earlier node");
            }
            return false;
        }
        if (node.childCount == 0) {
            if (node.firstChild != kInvalidNode) {
                if (error) {
                    *error = failure(index, "leaf has a child offset");
                }
                return false;
            }
            continue;
        }
        const std::uint64_t childEnd =
            static_cast<std::uint64_t>(node.firstChild) + node.childCount;
        if (node.firstChild == kInvalidNode || childEnd > nodes.size()) {
            if (error) {
                *error = failure(index, "child range outside index");
            }
            return false;
        }
        for (std::uint32_t child = node.firstChild;
             child < node.firstChild + node.childCount;
             ++child) {
            if (nodes[child].parent != node.id) {
                if (error) {
                    *error = failure(child, "parent link does not match child range");
                }
                return false;
            }
            children_[node.id].push_back(child);
        }
    }
    return true;
}

}  // namespace pcloud
