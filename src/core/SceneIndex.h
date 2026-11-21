#pragma once

#include "core/SceneFormat.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace pcloud {

class SceneIndex {
public:
    static std::shared_ptr<SceneIndex> open(const std::string& path, std::string* error);

    const std::string& path() const { return path_; }
    const SceneHeader& header() const { return header_; }
    const std::vector<DiskNode>& nodes() const { return nodes_; }

    const DiskNode& node(std::uint32_t id) const { return nodes_.at(id); }
    std::size_t nodeCount() const { return nodes_.size(); }

    const std::vector<std::uint32_t>& children(std::uint32_t id) const {
        return children_.at(id);
    }

    bool hasChildren(std::uint32_t id) const {
        return id < children_.size() && !children_[id].empty();
    }

    bool isAncestor(std::uint32_t possibleAncestor, std::uint32_t nodeId) const;

private:
    bool validate(std::string* error);

    std::string path_;
    SceneHeader header_;
    std::vector<DiskNode> nodes_;
    std::vector<std::vector<std::uint32_t>> children_;
};

}  // namespace pcloud
