#include "render_graph/render_graph.hpp"

#include <algorithm>
#include <functional>
#include <iomanip>
#include <limits>
#include <map>
#include <queue>
#include <set>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

namespace rg {
namespace {

constexpr std::uint64_t kDefaultTextureAlignment = 256;

std::uint64_t align_up(std::uint64_t value, std::uint64_t alignment) {
    if (alignment <= 1) {
        return value;
    }
    return (value + alignment - 1) / alignment * alignment;
}

std::string join(const std::vector<std::string>& values,
                 const std::string& separator) {
    std::ostringstream out;
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i != 0) {
            out << separator;
        }
        out << values[i];
    }
    return out.str();
}

std::string format_bytes(std::uint64_t bytes) {
    static const char* suffixes[] = {"B", "KiB", "MiB", "GiB"};
    double value = static_cast<double>(bytes);
    std::size_t suffix = 0;
    while (value >= 1024.0 && suffix + 1 < std::size(suffixes)) {
        value /= 1024.0;
        ++suffix;
    }
    std::ostringstream out;
    out << std::fixed << std::setprecision(suffix == 0 ? 0 : 2) << value
        << ' ' << suffixes[suffix];
    return out.str();
}

std::uint64_t resource_size(const ResourceDesc& resource) {
    if (resource.memory.size != 0) {
        return resource.memory.size;
    }
    if (resource.kind == ResourceKind::Buffer) {
        return 0;
    }
    return static_cast<std::uint64_t>(resource.width) * resource.height *
           bytes_per_pixel(resource.format);
}

std::uint64_t resource_alignment(const ResourceDesc& resource) {
    return std::max<std::uint64_t>(1, resource.memory.alignment);
}

std::uint32_t resource_memory_bits(const ResourceDesc& resource) {
    return resource.memory.memory_type_bits == 0
               ? 0xffffffffu
               : resource.memory.memory_type_bits;
}

void add_error(CompileResult& result, DiagnosticCode code,
               const std::string& pass, const std::string& resource,
               const std::string& message,
               std::vector<std::string> related = {}) {
    result.diagnostics.push_back(
        {DiagnosticSeverity::Error, code, pass, resource, std::move(related),
         message});
}

void add_warning(CompileResult& result, DiagnosticCode code,
                 const std::string& pass, const std::string& resource,
                 const std::string& message,
                 std::vector<std::string> related = {}) {
    result.diagnostics.push_back(
        {DiagnosticSeverity::Warning, code, pass, resource, std::move(related),
         message});
}

bool is_imported(const ResourceDesc& resource) {
    return has_flag(resource.flags, ResourceFlags::Imported);
}

bool usage_supports_read(const ResourceDesc& resource,
                         const ResourceAccess& access) {
    if (access.stage == AccessStage::Transfer) {
        return has_usage(resource.usage, ResourceUsage::TransferSrc);
    }
    return has_usage(resource.usage, ResourceUsage::Storage) ||
           has_usage(resource.usage, ResourceUsage::Sampled);
}

bool usage_supports_write(const ResourceDesc& resource,
                          const ResourceAccess& access) {
    if (access.stage == AccessStage::Transfer) {
        return has_usage(resource.usage, ResourceUsage::TransferDst);
    }
    return has_usage(resource.usage, ResourceUsage::Storage);
}

std::string access_name(const ResourceAccess& access) {
    std::ostringstream out;
    out << (access.mode == AccessMode::Read ? "read" : "write") << '/'
        << (access.stage == AccessStage::Compute ? "compute" : "transfer");
    return out.str();
}

struct Edge {
    std::size_t from = 0;
    std::size_t to = 0;
};

void add_edge(std::vector<std::vector<std::size_t>>& adjacency,
              std::vector<Edge>& edges, std::size_t from, std::size_t to) {
    auto& row = adjacency[from];
    if (std::find(row.begin(), row.end(), to) == row.end()) {
        row.push_back(to);
        edges.push_back({from, to});
    }
}

std::vector<std::size_t> find_cycle(
    const std::vector<std::vector<std::size_t>>& adjacency) {
    const std::size_t count = adjacency.size();
    std::vector<int> color(count, 0);
    std::vector<std::size_t> stack;
    std::vector<std::size_t> position(count, 0);

    std::function<std::vector<std::size_t>(std::size_t)> visit =
        [&](std::size_t node) -> std::vector<std::size_t> {
        color[node] = 1;
        position[node] = stack.size();
        stack.push_back(node);
        for (std::size_t next : adjacency[node]) {
            if (color[next] == 0) {
                auto cycle = visit(next);
                if (!cycle.empty()) {
                    return cycle;
                }
            } else if (color[next] == 1) {
                std::vector<std::size_t> cycle;
                for (std::size_t i = position[next]; i < stack.size(); ++i) {
                    cycle.push_back(stack[i]);
                }
                cycle.push_back(next);
                return cycle;
            }
        }
        stack.pop_back();
        color[node] = 2;
        return {};
    };

    for (std::size_t i = 0; i < count; ++i) {
        if (color[i] == 0) {
            auto cycle = visit(i);
            if (!cycle.empty()) {
                return cycle;
            }
        }
    }
    return {};
}

}  // namespace

std::uint32_t bytes_per_pixel(Format format) {
    switch (format) {
        case Format::R32Float:
            return 4;
        case Format::RGBA16Float:
            return 8;
        case Format::RGBA8Unorm:
            return 4;
    }
    return 0;
}

std::size_t element_size(const ResourceDesc& resource) {
    return static_cast<std::size_t>(resource_size(resource));
}

ResourceDesc& Graph::add_resource(ResourceDesc desc) {
    resources.push_back(std::move(desc));
    return resources.back();
}

PassDesc& Graph::add_pass(PassDesc desc) {
    passes.push_back(std::move(desc));
    return passes.back();
}

ResourceDesc& Graph::add_texture(std::string name, Format format,
                                 std::uint32_t width, std::uint32_t height,
                                 ResourceUsage usage, ResourceFlags flags) {
    ResourceDesc desc;
    desc.name = std::move(name);
    desc.kind = ResourceKind::Texture2D;
    desc.format = format;
    desc.width = width;
    desc.height = height;
    desc.usage = usage;
    desc.flags = flags;
    desc.memory.alignment = kDefaultTextureAlignment;
    desc.memory.size =
        static_cast<std::uint64_t>(width) * height * bytes_per_pixel(format);
    return add_resource(std::move(desc));
}

ResourceDesc& Graph::add_buffer(std::string name, std::uint64_t size,
                                ResourceUsage usage, ResourceFlags flags) {
    ResourceDesc desc;
    desc.name = std::move(name);
    desc.kind = ResourceKind::Buffer;
    desc.usage = usage;
    desc.flags = flags;
    desc.memory.size = size;
    desc.memory.alignment = 256;
    return add_resource(std::move(desc));
}

const ResourceDesc* Graph::find_resource(const std::string& name) const {
    for (const auto& resource : resources) {
        if (resource.name == name) {
            return &resource;
        }
    }
    return nullptr;
}

const PassDesc* Graph::find_pass(const std::string& name) const {
    for (const auto& pass : passes) {
        if (pass.name == name) {
            return &pass;
        }
    }
    return nullptr;
}

bool ResourceLifetime::live_at(int pass_index) const {
    return transient && first_pass >= 0 && pass_index >= first_pass &&
           pass_index <= last_pass;
}

const Placement* AllocationPlan::find(const std::string& resource) const {
    for (const auto& placement : placements) {
        if (placement.resource == resource) {
            return &placement;
        }
    }
    return nullptr;
}

bool CompileResult::ok() const {
    return std::none_of(diagnostics.begin(), diagnostics.end(),
                        [](const Diagnostic& diagnostic) {
                            return diagnostic.severity ==
                                   DiagnosticSeverity::Error;
                        });
}

std::vector<const Diagnostic*> CompileResult::errors() const {
    std::vector<const Diagnostic*> out;
    for (const auto& diagnostic : diagnostics) {
        if (diagnostic.severity == DiagnosticSeverity::Error) {
            out.push_back(&diagnostic);
        }
    }
    return out;
}

const ResourceLifetime* CompileResult::find_lifetime(
    const std::string& resource) const {
    for (const auto& lifetime : lifetimes) {
        if (lifetime.resource == resource) {
            return &lifetime;
        }
    }
    return nullptr;
}

namespace {

AllocationPlan build_allocation(const Graph& graph,
                                const std::vector<ResourceLifetime>& lifetimes,
                                const CompileOptions& options) {
    struct ActiveRange {
        std::uint64_t offset = 0;
        std::uint64_t end = 0;
        int last_pass = -1;
        std::string resource;
    };
    struct BlockState {
        std::uint64_t size = 0;
        std::uint32_t memory_type_bits = 0xffffffffu;
        std::vector<ActiveRange> active;
    };

    AllocationPlan plan;
    std::vector<std::size_t> order;
    for (std::size_t r = 0; r < graph.resources.size(); ++r) {
        if (lifetimes[r].transient) {
            order.push_back(r);
        }
    }
    std::sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
        if (lifetimes[a].first_pass != lifetimes[b].first_pass) {
            return lifetimes[a].first_pass < lifetimes[b].first_pass;
        }
        return graph.resources[a].name < graph.resources[b].name;
    });

    std::vector<BlockState> blocks;
    for (std::size_t r : order) {
        const auto& resource = graph.resources[r];
        const auto& lifetime = lifetimes[r];
        const std::uint64_t size = std::max<std::uint64_t>(1, lifetime.size);
        const std::uint64_t alignment =
            std::max({lifetime.alignment, options.allocation_alignment,
                      std::uint64_t{1}});
        const std::uint32_t memory_bits = resource_memory_bits(resource);

        for (auto& block : blocks) {
            block.active.erase(
                std::remove_if(block.active.begin(), block.active.end(),
                               [&](const ActiveRange& range) {
                                   return range.last_pass < lifetime.first_pass;
                               }),
                block.active.end());
        }

        auto find_offset = [&](const BlockState& block,
                               std::optional<std::uint64_t>& offset) {
            std::vector<const ActiveRange*> ranges;
            ranges.reserve(block.active.size());
            for (const auto& range : block.active) {
                ranges.push_back(&range);
            }
            std::sort(ranges.begin(), ranges.end(),
                      [](const ActiveRange* a, const ActiveRange* b) {
                          return a->offset < b->offset;
                      });
            std::uint64_t cursor = 0;
            for (const ActiveRange* range : ranges) {
                cursor = align_up(cursor, alignment);
                if (cursor + size <= range->offset) {
                    offset = cursor;
                    return;
                }
                cursor = std::max(cursor, range->end);
            }
            cursor = align_up(cursor, alignment);
            offset = cursor;
        };

        std::optional<std::size_t> chosen;
        std::uint64_t chosen_growth = std::numeric_limits<std::uint64_t>::max();
        std::uint64_t chosen_offset = 0;
        for (std::size_t b = 0; b < blocks.size(); ++b) {
            auto& block = blocks[b];
            if ((block.memory_type_bits & memory_bits) == 0) {
                continue;
            }
            std::optional<std::uint64_t> offset;
            find_offset(block, offset);
            const std::uint64_t growth =
                offset.value() + size > block.size
                    ? offset.value() + size - block.size
                    : 0;
            if (growth < chosen_growth ||
                (growth == chosen_growth &&
                 (!chosen || b < chosen.value()))) {
                chosen = b;
                chosen_growth = growth;
                chosen_offset = offset.value();
            }
        }

        if (!chosen) {
            blocks.push_back({0, memory_bits, {}});
            chosen = blocks.size() - 1;
            chosen_offset = 0;
        }

        auto& block = blocks[chosen.value()];
        block.memory_type_bits &= memory_bits;
        block.size = std::max(block.size, chosen_offset + size);
        block.active.push_back(
            {chosen_offset, chosen_offset + size, lifetime.last_pass,
             resource.name});

        plan.placements.push_back({resource.name, chosen.value(), chosen_offset,
                                   size, alignment, {}});
        plan.transient_bytes += align_up(size, alignment);
    }

    for (std::size_t block_index = 0; block_index < blocks.size();
         ++block_index) {
        MemoryBlock block;
        block.id = block_index;
        block.size = blocks[block_index].size;
        block.memory_type_bits = blocks[block_index].memory_type_bits;
        for (const auto& placement : plan.placements) {
            if (placement.block == block_index) {
                block.resources.push_back(placement.resource);
            }
        }
        plan.peak_bytes += block.size;
        plan.blocks.push_back(std::move(block));
    }

    for (auto& placement : plan.placements) {
        const auto* lifetime = [&]() -> const ResourceLifetime* {
            for (const auto& candidate : lifetimes) {
                if (candidate.resource == placement.resource) {
                    return &candidate;
                }
            }
            return nullptr;
        }();
        if (!lifetime) {
            continue;
        }
        for (const auto& other : plan.placements) {
            if (&other == &placement || other.block != placement.block) {
                continue;
            }
            const auto* other_lifetime = [&]() -> const ResourceLifetime* {
                for (const auto& candidate : lifetimes) {
                    if (candidate.resource == other.resource) {
                        return &candidate;
                    }
                }
                return nullptr;
            }();
            if (!other_lifetime) {
                continue;
            }
            const bool ranges_overlap =
                placement.offset < other.offset + other.size &&
                other.offset < placement.offset + placement.size;
            const bool lifetimes_overlap =
                lifetime->first_pass <= other_lifetime->last_pass &&
                other_lifetime->first_pass <= lifetime->last_pass;
            if (ranges_overlap && !lifetimes_overlap) {
                placement.aliases.push_back(other.resource);
            }
        }
    }

    plan.reused_bytes =
        plan.transient_bytes > plan.peak_bytes
            ? plan.transient_bytes - plan.peak_bytes
            : 0;
    return plan;
}

std::vector<Transition> build_transitions(
    const Graph& graph, const std::vector<std::size_t>& schedule,
    const std::unordered_map<std::string, std::size_t>& resource_indices) {
    struct LastUse {
        Layout layout = Layout::Undefined;
        AccessStage stage = AccessStage::Compute;
        AccessKind access = AccessKind::None;
        bool seen = false;
    };

    std::vector<Transition> transitions;
    std::vector<LastUse> last(graph.resources.size());
    for (std::size_t pass_index : schedule) {
        const auto& pass = graph.passes[pass_index];
        auto process = [&](const ResourceAccess& access) {
            auto it = resource_indices.find(access.resource);
            if (it == resource_indices.end()) {
                return;
            }
            const auto& resource = graph.resources[it->second];
            if (resource.kind == ResourceKind::Buffer) {
                return;
            }
            Layout desired = Layout::General;
            AccessKind kind = AccessKind::ShaderRead;
            if (access.mode == AccessMode::Read) {
                desired = access.stage == AccessStage::Transfer
                              ? Layout::TransferSrc
                              : Layout::General;
                kind = access.stage == AccessStage::Transfer
                           ? AccessKind::TransferRead
                           : AccessKind::ShaderRead;
            } else {
                desired = access.stage == AccessStage::Transfer
                              ? Layout::TransferDst
                              : Layout::General;
                kind = access.stage == AccessStage::Transfer
                           ? AccessKind::TransferWrite
                           : AccessKind::ShaderWrite;
            }

            auto& previous = last[it->second];
            const Layout from =
                previous.seen ? previous.layout : resource.initial_layout;
            const AccessStage src_stage =
                previous.seen ? previous.stage : AccessStage::Compute;
            const AccessKind src_access =
                previous.seen ? previous.access : AccessKind::None;
            const bool first_transition = !previous.seen;
            const bool hazard =
                previous.seen &&
                (previous.layout != desired || previous.stage != access.stage ||
                 previous.access != kind);
            if (first_transition || hazard) {
                transitions.push_back({pass.name, resource.name, from, desired,
                                       src_stage, src_access, access.stage,
                                       kind});
            }
            previous.layout = desired;
            previous.stage = access.stage;
            previous.access = kind;
            previous.seen = true;
        };
        for (const auto& access : pass.reads) {
            process(access);
        }
        for (const auto& access : pass.writes) {
            process(access);
        }
    }
    return transitions;
}

}  // namespace

CompileResult compile(const Graph& graph, const CompileOptions& options) {
    CompileResult result;
    result.graph = graph;
    if (graph.passes.empty()) {
        add_error(result, DiagnosticCode::EmptyGraph, "", "",
                  "render graph '" + graph.name + "' has no passes");
        return result;
    }

    std::unordered_map<std::string, std::size_t> resource_indices;
    std::unordered_map<std::string, std::size_t> pass_indices;
    for (std::size_t i = 0; i < graph.resources.size(); ++i) {
        const auto& resource = graph.resources[i];
        if (resource_indices.count(resource.name) != 0) {
            add_error(result, DiagnosticCode::DuplicateResource, "",
                      resource.name,
                      "resource '" + resource.name + "' is declared more than once",
                      {graph.resources[resource_indices[resource.name]].name});
            continue;
        }
        resource_indices.emplace(resource.name, i);
    }
    for (std::size_t i = 0; i < graph.passes.size(); ++i) {
        const auto& pass = graph.passes[i];
        if (pass_indices.count(pass.name) != 0) {
            add_error(result, DiagnosticCode::DuplicatePass, pass.name, "",
                      "pass '" + pass.name + "' is declared more than once");
            continue;
        }
        pass_indices.emplace(pass.name, i);
    }

    const std::size_t pass_count = graph.passes.size();
    std::vector<std::vector<std::size_t>> adjacency(pass_count);
    std::vector<Edge> edges;
    std::vector<std::vector<std::size_t>> writers(graph.resources.size());
    std::vector<bool> resource_used(graph.resources.size(), false);

    for (const auto& pass : graph.passes) {
        auto validate_access = [&](const ResourceAccess& access) {
            auto it = resource_indices.find(access.resource);
            if (it == resource_indices.end()) {
                add_error(result, DiagnosticCode::UnknownResource, pass.name,
                          access.resource,
                          "pass '" + pass.name + "' " + access_name(access) +
                              " unknown resource '" + access.resource + "'");
                return;
            }
            resource_used[it->second] = true;
            const auto& resource = graph.resources[it->second];
            const bool supported =
                access.mode == AccessMode::Read
                    ? usage_supports_read(resource, access)
                    : usage_supports_write(resource, access);
            if (!supported) {
                add_error(result, DiagnosticCode::MissingUsage, pass.name,
                          access.resource,
                          "pass '" + pass.name + "' " + access_name(access) +
                              " resource '" + access.resource +
                              "' but its usage flags do not allow that access");
            }
        };
        for (const auto& access : pass.reads) {
            validate_access(access);
        }
        for (const auto& access : pass.writes) {
            validate_access(access);
        }
    }

    for (std::size_t p = 0; p < pass_count; ++p) {
        const auto& pass = graph.passes[p];
        std::unordered_set<std::string> pass_reads;
        std::unordered_set<std::string> pass_writes;
        for (const auto& access : pass.reads) {
            pass_reads.insert(access.resource);
        }
        for (const auto& access : pass.writes) {
            pass_writes.insert(access.resource);
            auto resource_it = resource_indices.find(access.resource);
            if (resource_it != resource_indices.end()) {
                writers[resource_it->second].push_back(p);
            }
        }
        for (const auto& name : pass_reads) {
            if (pass_writes.count(name) == 0) {
                continue;
            }
            add_error(result, DiagnosticCode::ReadWriteConflict, pass.name,
                      name,
                      "pass '" + pass.name + "' both reads and writes '" + name +
                          "'; split the pass or use a read-modify-write feature "
                          "that declares the hazard explicitly");
        }
        for (const auto& dependency : pass.depends_on) {
            auto dependency_it = pass_indices.find(dependency);
            if (dependency_it == pass_indices.end()) {
                add_error(result, DiagnosticCode::InvalidDependency, pass.name,
                          "",
                          "pass '" + pass.name + "' depends on unknown pass '" +
                              dependency + "'");
                continue;
            }
            add_edge(adjacency, edges, dependency_it->second, p);
        }
    }

    for (std::size_t r = 0; r < graph.resources.size(); ++r) {
        const auto& resource = graph.resources[r];
        const auto& producers = writers[r];
        if (producers.empty()) {
            continue;
        }
        for (std::size_t i = 1; i < producers.size(); ++i) {
            add_error(
                result, DiagnosticCode::MultipleWriters,
                graph.passes[producers[i]].name, resource.name,
                "write/write conflict: pass '" +
                    graph.passes[producers[i]].name + "' and pass '" +
                    graph.passes[producers[0]].name + "' both write '" +
                    resource.name +
                    "'; render graph resources are single-assignment",
                {graph.passes[producers[0]].name});
        }
    }

    for (std::size_t p = 0; p < pass_count; ++p) {
        const auto& pass = graph.passes[p];
        for (const auto& access : pass.reads) {
            auto resource_it = resource_indices.find(access.resource);
            if (resource_it == resource_indices.end()) {
                continue;
            }
            const auto& resource = graph.resources[resource_it->second];
            const auto& producers = writers[resource_it->second];
            if (producers.empty()) {
                if (!is_imported(resource)) {
                    add_error(
                        result, DiagnosticCode::UninitializedRead, pass.name,
                        resource.name,
                        "uninitialized read: pass '" + pass.name +
                            "' reads '" + resource.name +
                            "' before any pass produces it (missing prerequisite)");
                }
                continue;
            }
            for (std::size_t producer : producers) {
                if (producer != p) {
                    add_edge(adjacency, edges, producer, p);
                }
            }
        }
    }

    auto cycle = find_cycle(adjacency);
    if (!cycle.empty()) {
        std::vector<std::string> names;
        names.reserve(cycle.size());
        for (std::size_t node : cycle) {
            names.push_back(graph.passes[node].name);
        }
        add_error(result, DiagnosticCode::Cycle, names.front(), "",
                  "dependency cycle cannot be scheduled: " + join(names, " -> "),
                  names);
    }

    if (!result.ok()) {
        return result;
    }

    std::vector<std::size_t> indegree(pass_count, 0);
    for (const auto& edge : edges) {
        ++indegree[edge.to];
    }
    std::priority_queue<std::size_t, std::vector<std::size_t>,
                        std::greater<std::size_t>>
        ready;
    for (std::size_t p = 0; p < pass_count; ++p) {
        if (indegree[p] == 0) {
            ready.push(p);
        }
    }
    while (!ready.empty()) {
        const std::size_t pass = ready.top();
        ready.pop();
        result.schedule.push_back(pass);
        for (std::size_t next : adjacency[pass]) {
            if (--indegree[next] == 0) {
                ready.push(next);
            }
        }
    }

    if (result.schedule.size() != pass_count) {
        add_error(result, DiagnosticCode::Cycle, "", "",
                  "internal scheduler failure: not all passes could be ordered");
        return result;
    }

    result.lifetimes.resize(graph.resources.size());
    for (std::size_t r = 0; r < graph.resources.size(); ++r) {
        const auto& resource = graph.resources[r];
        auto& lifetime = result.lifetimes[r];
        lifetime.resource = resource.name;
        lifetime.size = resource_size(resource);
        lifetime.alignment = resource_alignment(resource);
        lifetime.transient = !is_imported(resource);
    }

    std::unordered_map<std::string, std::size_t> lifetime_indices;
    for (std::size_t r = 0; r < result.lifetimes.size(); ++r) {
        lifetime_indices.emplace(result.lifetimes[r].resource, r);
    }
    for (std::size_t position = 0; position < result.schedule.size();
         ++position) {
        const auto& pass = graph.passes[result.schedule[position]];
        auto touch = [&](const ResourceAccess& access) {
            auto it = lifetime_indices.find(access.resource);
            if (it == lifetime_indices.end()) {
                return;
            }
            auto& lifetime = result.lifetimes[it->second];
            if (lifetime.first_pass < 0) {
                lifetime.first_pass = static_cast<int>(position);
            }
            lifetime.last_pass = static_cast<int>(position);
        };
        for (const auto& access : pass.reads) {
            touch(access);
        }
        for (const auto& access : pass.writes) {
            touch(access);
        }
    }

    for (std::size_t r = 0; r < graph.resources.size(); ++r) {
        if (!resource_used[r] && options.warn_unused_resources) {
            add_warning(result, DiagnosticCode::UnusedResource, "",
                        graph.resources[r].name,
                        "resource '" + graph.resources[r].name +
                            "' is declared but never used");
        }
        if (is_imported(graph.resources[r])) {
            result.lifetimes[r].transient = false;
        }
    }

    result.transitions =
        build_transitions(graph, result.schedule, resource_indices);
    result.allocation =
        build_allocation(graph, result.lifetimes, options);
    return result;
}

std::string to_string(DiagnosticCode code) {
    switch (code) {
        case DiagnosticCode::UnknownResource:
            return "unknown-resource";
        case DiagnosticCode::UnknownPass:
            return "unknown-pass";
        case DiagnosticCode::DuplicateResource:
            return "duplicate-resource";
        case DiagnosticCode::DuplicatePass:
            return "duplicate-pass";
        case DiagnosticCode::InvalidDependency:
            return "invalid-dependency";
        case DiagnosticCode::UninitializedRead:
            return "uninitialized-read";
        case DiagnosticCode::MultipleWriters:
            return "multiple-writers";
        case DiagnosticCode::ReadWriteConflict:
            return "read-write-conflict";
        case DiagnosticCode::MissingUsage:
            return "missing-usage";
        case DiagnosticCode::Cycle:
            return "cycle";
        case DiagnosticCode::UnusedResource:
            return "unused-resource";
        case DiagnosticCode::EmptyGraph:
            return "empty-graph";
    }
    return "unknown";
}

std::string to_string(Format format) {
    switch (format) {
        case Format::R32Float:
            return "R32_SFLOAT";
        case Format::RGBA16Float:
            return "RGBA16_SFLOAT";
        case Format::RGBA8Unorm:
            return "RGBA8_UNORM";
    }
    return "unknown";
}

std::string to_string(Layout layout) {
    switch (layout) {
        case Layout::Undefined:
            return "UNDEFINED";
        case Layout::General:
            return "GENERAL";
        case Layout::TransferSrc:
            return "TRANSFER_SRC";
        case Layout::TransferDst:
            return "TRANSFER_DST";
    }
    return "unknown";
}

std::string to_string(AccessKind access) {
    switch (access) {
        case AccessKind::None:
            return "none";
        case AccessKind::ShaderRead:
            return "shader-read";
        case AccessKind::ShaderWrite:
            return "shader-write";
        case AccessKind::TransferRead:
            return "transfer-read";
        case AccessKind::TransferWrite:
            return "transfer-write";
    }
    return "unknown";
}

namespace {

std::string stage_name(AccessStage stage) {
    return stage == AccessStage::Compute ? "compute" : "transfer";
}

std::string severity_name(DiagnosticSeverity severity) {
    return severity == DiagnosticSeverity::Error ? "ERROR" : "WARNING";
}

std::string access_summary(const PassDesc& pass) {
    std::vector<std::string> parts;
    for (const auto& access : pass.reads) {
        parts.push_back("R:" + access.resource);
    }
    for (const auto& access : pass.writes) {
        parts.push_back("W:" + access.resource);
    }
    return join(parts, " ");
}

std::string escape_label(std::string value) {
    std::replace(value.begin(), value.end(), '"', '\'');
    std::string out;
    out.reserve(value.size());
    for (char ch : value) {
        if (ch == '\n') {
            out += "<br/>";
        } else {
            out.push_back(ch);
        }
    }
    return out;
}

std::string schedule_label(const CompileResult& result,
                           std::size_t graph_pass_index) {
    for (std::size_t i = 0; i < result.schedule.size(); ++i) {
        if (result.schedule[i] == graph_pass_index) {
            return std::to_string(i);
        }
    }
    return "?";
}

}  // namespace

std::string render_text(const CompileResult& result) {
    std::ostringstream out;
    out << "# Render graph: " << result.graph.name << "\n\n";
    out << "Status: " << (result.ok() ? "OK" : "FAILED") << "\n";

    if (!result.diagnostics.empty()) {
        out << "\n## Diagnostics\n\n";
        for (const auto& diagnostic : result.diagnostics) {
            out << "- **" << severity_name(diagnostic.severity) << " "
                << to_string(diagnostic.code) << "**";
            if (!diagnostic.pass.empty()) {
                out << " pass=`" << diagnostic.pass << "`";
            }
            if (!diagnostic.resource.empty()) {
                out << " resource=`" << diagnostic.resource << "`";
            }
            out << ": " << diagnostic.message << "\n";
        }
    }

    out << "\n## Topological schedule\n\n";
    if (result.schedule.empty()) {
        out << "_No schedule produced._\n";
    } else {
        for (std::size_t i = 0; i < result.schedule.size(); ++i) {
            const auto& pass = result.graph.passes[result.schedule[i]];
            out << i << ". `" << pass.name << "` (" << access_summary(pass)
                << ")\n";
        }
    }

    out << "\n## Resource lifetimes\n\n";
    out << "| resource | format/extent | bytes | first | last | allocation |\n";
    out << "|---|---|---:|---:|---:|---|\n";
    for (const auto& lifetime : result.lifetimes) {
        const ResourceDesc* resource = result.graph.find_resource(lifetime.resource);
        std::string shape = "buffer";
        if (resource && resource->kind == ResourceKind::Texture2D) {
            shape = to_string(resource->format) + " " +
                    std::to_string(resource->width) + "x" +
                    std::to_string(resource->height);
        }
        std::string allocation = "imported";
        if (lifetime.transient) {
            const auto* placement = result.allocation.find(lifetime.resource);
            if (placement) {
                std::ostringstream placement_text;
                placement_text << "block " << placement->block << " +0x"
                               << std::hex << placement->offset;
                if (!placement->aliases.empty()) {
                    placement_text << " alias " << join(placement->aliases, ",");
                }
                allocation = placement_text.str();
            }
        }
        out << "| `" << lifetime.resource << "` | " << shape << " | "
            << format_bytes(lifetime.size) << " | " << lifetime.first_pass
            << " | " << lifetime.last_pass << " | " << allocation << " |\n";
    }

    out << "\n## Transitions\n\n";
    if (result.transitions.empty()) {
        out << "_None._\n";
    } else {
        for (const auto& transition : result.transitions) {
            out << "- pass `" << transition.pass << "` `"
                << transition.resource << "`: "
                << to_string(transition.from) << " -> "
                << to_string(transition.to) << " ("
                << stage_name(transition.src_stage) << "/"
                << to_string(transition.src_access) << " -> "
                << stage_name(transition.dst_stage) << "/"
                << to_string(transition.dst_access) << ")\n";
        }
    }

    out << "\n## Allocation plan\n\n";
    if (result.allocation.blocks.empty()) {
        out << "_No transient allocations._\n";
    } else {
        for (const auto& block : result.allocation.blocks) {
            out << "- memory block " << block.id << ": "
                << format_bytes(block.size) << " ["
                << join(block.resources, ", ") << "]\n";
        }
    }
    out << "\n- transient request total: "
        << format_bytes(result.allocation.transient_bytes) << "\n";
    out << "- peak allocation: " << format_bytes(result.allocation.peak_bytes)
        << "\n";
    out << "- reused through aliasing: "
        << format_bytes(result.allocation.reused_bytes) << "\n";
    return out.str();
}

std::string render_mermaid(const CompileResult& result) {
    std::ostringstream out;
    out << "flowchart LR\n";
    out << "  classDef pass fill:#dbeafe,stroke:#1d4ed8,color:#111827\n";
    out << "  classDef resource fill:#fef3c7,stroke:#b45309,color:#111827\n";
    out << "  classDef imported fill:#dcfce7,stroke:#15803d,color:#111827\n";
    out << "  classDef error fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d\n";

    for (std::size_t p = 0; p < result.graph.passes.size(); ++p) {
        const auto& pass = result.graph.passes[p];
        const std::string label =
            "#" + schedule_label(result, p) + " " + pass.name + "<br/>" +
            access_summary(pass);
        out << "  P" << p << "[\"" << escape_label(label)
            << "\"]:::pass\n";
    }
    for (std::size_t r = 0; r < result.graph.resources.size(); ++r) {
        const auto& resource = result.graph.resources[r];
        std::string shape = "buffer";
        if (resource.kind == ResourceKind::Texture2D) {
            shape = to_string(resource.format) + " " +
                    std::to_string(resource.width) + "x" +
                    std::to_string(resource.height);
        }
        const std::string label = resource.name + "<br/>" + shape;
        const char* style =
            is_imported(resource) ? ":::imported" : ":::resource";
        out << "  R" << r << "([\"" << escape_label(label) << "\"])" << style
            << "\n";
    }

    for (std::size_t p = 0; p < result.graph.passes.size(); ++p) {
        const auto& pass = result.graph.passes[p];
        for (const auto& access : pass.writes) {
            for (std::size_t r = 0; r < result.graph.resources.size(); ++r) {
                if (result.graph.resources[r].name == access.resource) {
                    out << "  P" << p << " -->|write| R" << r << "\n";
                }
            }
        }
        for (const auto& access : pass.reads) {
            for (std::size_t r = 0; r < result.graph.resources.size(); ++r) {
                if (result.graph.resources[r].name == access.resource) {
                    out << "  R" << r << " -->|read| P" << p << "\n";
                }
            }
        }
        for (const auto& dependency : pass.depends_on) {
            for (std::size_t q = 0; q < result.graph.passes.size(); ++q) {
                if (result.graph.passes[q].name == dependency) {
                    out << "  P" << q << " -.->|after| P" << p << "\n";
                }
            }
        }
    }

    std::size_t error_index = 0;
    for (const auto& diagnostic : result.diagnostics) {
        if (diagnostic.severity != DiagnosticSeverity::Error) {
            continue;
        }
        const std::string label =
            to_string(diagnostic.code) + "<br/>" + diagnostic.message;
        out << "  E" << error_index << "[\"" << escape_label(label)
            << "\"]:::error\n";
        bool attached = false;
        for (std::size_t p = 0; p < result.graph.passes.size(); ++p) {
            if (result.graph.passes[p].name == diagnostic.pass) {
                out << "  E" << error_index << " -.-> P" << p << "\n";
                attached = true;
            }
        }
        if (!attached) {
            out << "  E" << error_index << "\n";
        }
        ++error_index;
    }
    return out.str();
}

std::string render_dot(const CompileResult& result) {
    std::ostringstream out;
    out << "digraph \"" << escape_label(result.graph.name) << "\" {\n";
    out << "  rankdir=LR;\n";
    out << "  node [fontname=\"monospace\"];\n";
    for (std::size_t p = 0; p < result.graph.passes.size(); ++p) {
        const auto& pass = result.graph.passes[p];
        const std::string label =
            "#" + schedule_label(result, p) + " " + pass.name + "\\n" +
            access_summary(pass);
        out << "  p" << p << " [label=\"" << label
            << "\",shape=box,style=\"filled\",fillcolor=\"#dbeafe\"];\n";
    }
    for (std::size_t r = 0; r < result.graph.resources.size(); ++r) {
        const auto& resource = result.graph.resources[r];
        const std::string label = resource.name + "\\n" +
                                  (resource.kind == ResourceKind::Texture2D
                                       ? to_string(resource.format)
                                       : "buffer");
        out << "  r" << r << " [label=\"" << escape_label(label)
            << "\",shape=ellipse,style=\"filled\",fillcolor=\""
            << (is_imported(resource) ? "#dcfce7" : "#fef3c7") << "\"];\n";
    }
    for (std::size_t p = 0; p < result.graph.passes.size(); ++p) {
        const auto& pass = result.graph.passes[p];
        for (const auto& access : pass.writes) {
            for (std::size_t r = 0; r < result.graph.resources.size(); ++r) {
                if (result.graph.resources[r].name == access.resource) {
                    out << "  p" << p << " -> r" << r
                        << " [label=\"write\"];\n";
                }
            }
        }
        for (const auto& access : pass.reads) {
            for (std::size_t r = 0; r < result.graph.resources.size(); ++r) {
                if (result.graph.resources[r].name == access.resource) {
                    out << "  r" << r << " -> p" << p
                        << " [label=\"read\"];\n";
                }
            }
        }
        for (const auto& dependency : pass.depends_on) {
            for (std::size_t q = 0; q < result.graph.passes.size(); ++q) {
                if (result.graph.passes[q].name == dependency) {
                    out << "  p" << q << " -> p" << p
                        << " [style=dashed,label=\"after\"];\n";
                }
            }
        }
    }
    std::size_t error_index = 0;
    for (const auto& diagnostic : result.diagnostics) {
        if (diagnostic.severity != DiagnosticSeverity::Error) {
            continue;
        }
        out << "  e" << error_index << " [label=\""
            << escape_label(to_string(diagnostic.code)) << "\\n"
            << escape_label(diagnostic.message)
            << "\",shape=note,style=\"filled\",fillcolor=\"#fee2e2\","
               "color=\"#b91c1c\"];\n";
        for (std::size_t p = 0; p < result.graph.passes.size(); ++p) {
            if (result.graph.passes[p].name == diagnostic.pass) {
                out << "  p" << p << " -> e" << error_index
                    << " [style=dotted,color=\"#b91c1c\",label=\"error\"];\n";
            }
        }
        ++error_index;
    }
    out << "}\n";
    return out.str();
}

}  // namespace rg
