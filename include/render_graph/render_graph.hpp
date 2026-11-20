#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace rg {

enum class ResourceKind {
    Texture2D,
    Buffer,
};

enum class Format {
    R32Float,
    RGBA16Float,
    RGBA8Unorm,
};

enum class ResourceUsage : std::uint32_t {
    None = 0,
    Storage = 1u << 0,
    Sampled = 1u << 1,
    TransferSrc = 1u << 2,
    TransferDst = 1u << 3,
};

enum class ResourceFlags : std::uint32_t {
    None = 0,
    Imported = 1u << 0,
};

enum class AccessMode {
    Read,
    Write,
};

enum class AccessStage {
    Compute,
    Transfer,
};

enum class PassKind {
    Compute,
    TransferImageToBuffer,
};

enum class Layout {
    Undefined,
    General,
    TransferSrc,
    TransferDst,
};

enum class AccessKind {
    None,
    ShaderRead,
    ShaderWrite,
    TransferRead,
    TransferWrite,
};

enum class DiagnosticSeverity {
    Error,
    Warning,
};

enum class DiagnosticCode {
    UnknownResource,
    UnknownPass,
    DuplicateResource,
    DuplicatePass,
    InvalidDependency,
    UninitializedRead,
    MultipleWriters,
    ReadWriteConflict,
    MissingUsage,
    Cycle,
    UnusedResource,
    EmptyGraph,
};

constexpr ResourceUsage operator|(ResourceUsage a, ResourceUsage b) {
    return static_cast<ResourceUsage>(
        static_cast<std::uint32_t>(a) | static_cast<std::uint32_t>(b));
}

constexpr ResourceUsage operator&(ResourceUsage a, ResourceUsage b) {
    return static_cast<ResourceUsage>(
        static_cast<std::uint32_t>(a) & static_cast<std::uint32_t>(b));
}

constexpr bool has_usage(ResourceUsage value, ResourceUsage flag) {
    return (value & flag) != ResourceUsage::None;
}

constexpr ResourceFlags operator|(ResourceFlags a, ResourceFlags b) {
    return static_cast<ResourceFlags>(
        static_cast<std::uint32_t>(a) | static_cast<std::uint32_t>(b));
}

constexpr bool has_flag(ResourceFlags value, ResourceFlags flag) {
    return (static_cast<std::uint32_t>(value) &
            static_cast<std::uint32_t>(flag)) != 0;
}

struct MemoryRequirement {
    std::uint64_t size = 0;
    std::uint64_t alignment = 1;
    std::uint32_t memory_type_bits = 0xffffffffu;
};

struct ResourceDesc {
    std::string name;
    ResourceKind kind = ResourceKind::Texture2D;
    Format format = Format::RGBA8Unorm;
    std::uint32_t width = 1;
    std::uint32_t height = 1;
    ResourceUsage usage = ResourceUsage::None;
    ResourceFlags flags = ResourceFlags::None;
    Layout initial_layout = Layout::Undefined;
    MemoryRequirement memory;
};

struct ResourceAccess {
    std::string resource;
    AccessMode mode = AccessMode::Read;
    AccessStage stage = AccessStage::Compute;
};

struct PassDesc {
    std::string name;
    PassKind kind = PassKind::Compute;
    std::string shader;
    std::vector<ResourceAccess> reads;
    std::vector<ResourceAccess> writes;
    std::vector<std::string> depends_on;
};

struct Graph {
    std::string name;
    std::vector<ResourceDesc> resources;
    std::vector<PassDesc> passes;

    ResourceDesc& add_resource(ResourceDesc desc);
    PassDesc& add_pass(PassDesc desc);
    ResourceDesc& add_texture(std::string name, Format format,
                              std::uint32_t width, std::uint32_t height,
                              ResourceUsage usage,
                              ResourceFlags flags = ResourceFlags::None);
    ResourceDesc& add_buffer(std::string name, std::uint64_t size,
                             ResourceUsage usage,
                             ResourceFlags flags = ResourceFlags::None);

    const ResourceDesc* find_resource(const std::string& name) const;
    const PassDesc* find_pass(const std::string& name) const;
};

std::uint32_t bytes_per_pixel(Format format);
std::size_t element_size(const ResourceDesc& resource);

struct Diagnostic {
    DiagnosticSeverity severity = DiagnosticSeverity::Error;
    DiagnosticCode code = DiagnosticCode::EmptyGraph;
    std::string pass;
    std::string resource;
    std::vector<std::string> related_passes;
    std::string message;
};

struct ResourceLifetime {
    std::string resource;
    int first_pass = -1;
    int last_pass = -1;
    bool transient = false;
    std::uint64_t size = 0;
    std::uint64_t alignment = 1;
    bool live_at(int pass_index) const;
};

struct Transition {
    std::string pass;
    std::string resource;
    Layout from = Layout::Undefined;
    Layout to = Layout::Undefined;
    AccessStage src_stage = AccessStage::Compute;
    AccessKind src_access = AccessKind::None;
    AccessStage dst_stage = AccessStage::Compute;
    AccessKind dst_access = AccessKind::None;
};

struct Placement {
    std::string resource;
    std::size_t block = 0;
    std::uint64_t offset = 0;
    std::uint64_t size = 0;
    std::uint64_t alignment = 1;
    std::vector<std::string> aliases;
};

struct MemoryBlock {
    std::size_t id = 0;
    std::uint64_t size = 0;
    std::uint32_t memory_type_bits = 0;
    std::vector<std::string> resources;
};

struct AllocationPlan {
    std::vector<MemoryBlock> blocks;
    std::vector<Placement> placements;
    std::uint64_t peak_bytes = 0;
    std::uint64_t transient_bytes = 0;
    std::uint64_t reused_bytes = 0;

    const Placement* find(const std::string& resource) const;
};

struct CompileOptions {
    std::uint64_t allocation_alignment = 256;
    bool warn_unused_resources = true;
};

struct CompileResult {
    Graph graph;
    std::vector<std::size_t> schedule;
    std::vector<ResourceLifetime> lifetimes;
    std::vector<Transition> transitions;
    AllocationPlan allocation;
    std::vector<Diagnostic> diagnostics;

    bool ok() const;
    std::vector<const Diagnostic*> errors() const;
    const ResourceLifetime* find_lifetime(const std::string& resource) const;
};

CompileResult compile(const Graph& graph, const CompileOptions& options = {});

std::string render_text(const CompileResult& result);
std::string render_mermaid(const CompileResult& result);
std::string render_dot(const CompileResult& result);
std::string to_string(DiagnosticCode code);
std::string to_string(Format format);
std::string to_string(Layout layout);
std::string to_string(AccessKind access);

}  // namespace rg
