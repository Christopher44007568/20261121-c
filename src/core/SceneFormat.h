#pragma once

#include "core/Geometry.h"

#include <array>
#include <cstdint>
#include <cstring>
#include <istream>
#include <ostream>
#include <string>

namespace pcloud {

constexpr char kSceneMagic[8] = {'P', 'C', 'L', 'O', 'U', 'D', '0', '1'};
constexpr std::uint32_t kSceneVersion = 1;
constexpr std::uint64_t kHeaderSize = 104;
constexpr std::uint64_t kNodeEntrySize = 72;
constexpr std::uint32_t kInvalidNode = 0xffffffffu;

struct SceneHeader {
    std::uint64_t fileSize = 0;
    std::uint64_t nodeCount = 0;
    std::uint64_t indexOffset = kHeaderSize;
    std::uint64_t dataOffset = 0;
    Box3 bounds;
    double maxGeometricError = 0.0;
};

struct DiskNode {
    std::uint32_t id = kInvalidNode;
    std::uint32_t parent = kInvalidNode;
    std::uint32_t firstChild = kInvalidNode;
    std::uint8_t childCount = 0;
    std::uint8_t depth = 0;
    std::uint16_t flags = 0;
    std::uint32_t pointCount = 0;
    std::uint32_t reserved = 0;
    std::uint64_t payloadOffset = 0;
    std::uint64_t payloadBytes = 0;
    Box3 bounds;
    float geometricError = 0.0f;
    std::uint32_t childMask = 0;
};

namespace detail {

template <typename T>
bool readPod(std::istream& input, T& value) {
    input.read(reinterpret_cast<char*>(&value), static_cast<std::streamsize>(sizeof(T)));
    return input.good();
}

template <typename T>
void writePod(std::ostream& output, const T& value) {
    output.write(reinterpret_cast<const char*>(&value), static_cast<std::streamsize>(sizeof(T)));
}

inline bool writeDouble(std::ostream& output, double value) {
    writePod(output, value);
    return output.good();
}

inline bool readDouble(std::istream& input, double& value) {
    return readPod(input, value);
}

}  // namespace detail

bool writeHeader(std::ostream& output, const SceneHeader& header);
bool readHeader(std::istream& input, SceneHeader& header);
bool writeNodeEntry(std::ostream& output, const DiskNode& node);
bool readNodeEntry(std::istream& input, DiskNode& node);

}  // namespace pcloud
