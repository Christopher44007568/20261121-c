#define VK_NO_PROTOTYPES
#include <vulkan/vulkan.h>

#include "render_graph/vulkan_runtime.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <dlfcn.h>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifndef RG_SHADER_DIR
#define RG_SHADER_DIR "shaders/spv"
#endif

namespace rg {
namespace vkapi {

#define RG_VK_FUNCTIONS(X)                                                   \
    X(CreateInstance)                                                        \
    X(DestroyInstance)                                                       \
    X(EnumeratePhysicalDevices)                                              \
    X(GetPhysicalDeviceProperties)                                           \
    X(GetPhysicalDeviceQueueFamilyProperties)                                \
    X(GetPhysicalDeviceMemoryProperties)                                     \
    X(GetPhysicalDeviceFormatProperties)                                     \
    X(CreateDevice)                                                          \
    X(DestroyDevice)                                                         \
    X(GetDeviceQueue)                                                        \
    X(DeviceWaitIdle)                                                        \
    X(CreateImage)                                                           \
    X(DestroyImage)                                                          \
    X(GetImageMemoryRequirements)                                            \
    X(CreateImageView)                                                       \
    X(DestroyImageView)                                                      \
    X(CreateBuffer)                                                          \
    X(DestroyBuffer)                                                         \
    X(GetBufferMemoryRequirements)                                           \
    X(AllocateMemory)                                                        \
    X(FreeMemory)                                                            \
    X(BindImageMemory)                                                       \
    X(BindBufferMemory)                                                      \
    X(MapMemory)                                                             \
    X(UnmapMemory)                                                           \
    X(CreateShaderModule)                                                    \
    X(DestroyShaderModule)                                                   \
    X(CreateDescriptorSetLayout)                                             \
    X(DestroyDescriptorSetLayout)                                            \
    X(CreatePipelineLayout)                                                  \
    X(DestroyPipelineLayout)                                                 \
    X(CreateComputePipelines)                                                \
    X(DestroyPipeline)                                                       \
    X(CreateDescriptorPool)                                                  \
    X(DestroyDescriptorPool)                                                 \
    X(AllocateDescriptorSets)                                                \
    X(UpdateDescriptorSets)                                                  \
    X(CreateCommandPool)                                                     \
    X(DestroyCommandPool)                                                    \
    X(AllocateCommandBuffers)                                                \
    X(FreeCommandBuffers)                                                    \
    X(BeginCommandBuffer)                                                    \
    X(EndCommandBuffer)                                                      \
    X(CmdPipelineBarrier)                                                    \
    X(CmdBindPipeline)                                                       \
    X(CmdBindDescriptorSets)                                                 \
    X(CmdPushConstants)                                                      \
    X(CmdDispatch)                                                           \
    X(CmdCopyImageToBuffer)                                                  \
    X(QueueSubmit)                                                           \
    X(QueueWaitIdle)

#define RG_DECLARE_VK(name) PFN_vk##name name = nullptr;
RG_VK_FUNCTIONS(RG_DECLARE_VK)
#undef RG_DECLARE_VK

PFN_vkGetInstanceProcAddr GetInstanceProcAddr = nullptr;
void* loader = nullptr;

bool load_loader(std::string& error) {
    if (loader != nullptr) {
        return true;
    }
    loader = dlopen("libvulkan.so.1", RTLD_NOW | RTLD_LOCAL);
    if (loader == nullptr) {
        loader = dlopen("libvulkan.so", RTLD_NOW | RTLD_LOCAL);
    }
    if (loader == nullptr) {
        error = "cannot load libvulkan: ";
        const char* message = dlerror();
        error += message ? message : "unknown error";
        return false;
    }
    GetInstanceProcAddr = reinterpret_cast<PFN_vkGetInstanceProcAddr>(
        dlsym(loader, "vkGetInstanceProcAddr"));
    if (GetInstanceProcAddr == nullptr) {
        error = "libvulkan has no vkGetInstanceProcAddr";
        return false;
    }
    return true;
}

bool load_functions(VkInstance instance, std::string& error) {
#define RG_LOAD_VK(name)                                                     \
    name = reinterpret_cast<PFN_vk##name>(                                   \
        GetInstanceProcAddr(instance, "vk" #name));                          \
    if (name == nullptr) {                                                   \
        error = "missing Vulkan entry point: vk" #name;                      \
        return false;                                                        \
    }
    RG_VK_FUNCTIONS(RG_LOAD_VK)
#undef RG_LOAD_VK
    return true;
}

}  // namespace vkapi

namespace {

std::string vk_result_name(VkResult result) {
    switch (result) {
        case VK_SUCCESS:
            return "VK_SUCCESS";
        case VK_NOT_READY:
            return "VK_NOT_READY";
        case VK_TIMEOUT:
            return "VK_TIMEOUT";
        case VK_EVENT_SET:
            return "VK_EVENT_SET";
        case VK_EVENT_RESET:
            return "VK_EVENT_RESET";
        case VK_INCOMPLETE:
            return "VK_INCOMPLETE";
        case VK_ERROR_OUT_OF_HOST_MEMORY:
            return "VK_ERROR_OUT_OF_HOST_MEMORY";
        case VK_ERROR_OUT_OF_DEVICE_MEMORY:
            return "VK_ERROR_OUT_OF_DEVICE_MEMORY";
        case VK_ERROR_INITIALIZATION_FAILED:
            return "VK_ERROR_INITIALIZATION_FAILED";
        case VK_ERROR_DEVICE_LOST:
            return "VK_ERROR_DEVICE_LOST";
        case VK_ERROR_MEMORY_MAP_FAILED:
            return "VK_ERROR_MEMORY_MAP_FAILED";
        case VK_ERROR_LAYER_NOT_PRESENT:
            return "VK_ERROR_LAYER_NOT_PRESENT";
        case VK_ERROR_EXTENSION_NOT_PRESENT:
            return "VK_ERROR_EXTENSION_NOT_PRESENT";
        case VK_ERROR_FEATURE_NOT_PRESENT:
            return "VK_ERROR_FEATURE_NOT_PRESENT";
        case VK_ERROR_INCOMPATIBLE_DRIVER:
            return "VK_ERROR_INCOMPATIBLE_DRIVER";
        case VK_ERROR_TOO_MANY_OBJECTS:
            return "VK_ERROR_TOO_MANY_OBJECTS";
        case VK_ERROR_FORMAT_NOT_SUPPORTED:
            return "VK_ERROR_FORMAT_NOT_SUPPORTED";
        default:
            return "VkResult(" + std::to_string(static_cast<int>(result)) + ")";
    }
}

bool checked(VkResult result, const char* operation, std::string& error) {
    if (result == VK_SUCCESS) {
        return true;
    }
    error = std::string(operation) + " failed with " +
            vk_result_name(result);
    return false;
}

VkFormat to_vk_format(Format format) {
    switch (format) {
        case Format::R32Float:
            return VK_FORMAT_R32_SFLOAT;
        case Format::RGBA16Float:
            return VK_FORMAT_R16G16B16A16_SFLOAT;
        case Format::RGBA8Unorm:
            return VK_FORMAT_R8G8B8A8_UNORM;
    }
    return VK_FORMAT_UNDEFINED;
}

VkImageUsageFlags to_vk_usage(ResourceUsage usage) {
    VkImageUsageFlags flags = 0;
    if (has_usage(usage, ResourceUsage::Storage)) {
        flags |= VK_IMAGE_USAGE_STORAGE_BIT;
    }
    if (has_usage(usage, ResourceUsage::Sampled)) {
        flags |= VK_IMAGE_USAGE_SAMPLED_BIT;
    }
    if (has_usage(usage, ResourceUsage::TransferSrc)) {
        flags |= VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
    }
    if (has_usage(usage, ResourceUsage::TransferDst)) {
        flags |= VK_IMAGE_USAGE_TRANSFER_DST_BIT;
    }
    return flags;
}

VkPipelineStageFlags to_vk_stage(AccessStage stage) {
    return stage == AccessStage::Compute ? VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT
                                         : VK_PIPELINE_STAGE_TRANSFER_BIT;
}

VkAccessFlags to_vk_access(AccessKind access) {
    switch (access) {
        case AccessKind::None:
            return 0;
        case AccessKind::ShaderRead:
            return VK_ACCESS_SHADER_READ_BIT;
        case AccessKind::ShaderWrite:
            return VK_ACCESS_SHADER_WRITE_BIT;
        case AccessKind::TransferRead:
            return VK_ACCESS_TRANSFER_READ_BIT;
        case AccessKind::TransferWrite:
            return VK_ACCESS_TRANSFER_WRITE_BIT;
    }
    return 0;
}

VkImageLayout to_vk_layout(Layout layout) {
    switch (layout) {
        case Layout::Undefined:
            return VK_IMAGE_LAYOUT_UNDEFINED;
        case Layout::General:
            return VK_IMAGE_LAYOUT_GENERAL;
        case Layout::TransferSrc:
            return VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        case Layout::TransferDst:
            return VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    }
    return VK_IMAGE_LAYOUT_UNDEFINED;
}

std::vector<char> read_file(const std::string& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw std::runtime_error("cannot open shader: " + path);
    }
    return std::vector<char>(std::istreambuf_iterator<char>(input),
                             std::istreambuf_iterator<char>());
}

struct ImageRecord {
    VkImage image = VK_NULL_HANDLE;
    VkImageView view = VK_NULL_HANDLE;
    ResourceDesc desc;
};

struct BufferRecord {
    VkBuffer buffer = VK_NULL_HANDLE;
    VkDeviceMemory memory = VK_NULL_HANDLE;
    void* mapped = nullptr;
    ResourceDesc desc;
};

struct Context {
    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice physical = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    VkQueue queue = VK_NULL_HANDLE;
    std::uint32_t queue_family = 0;
    VkCommandPool command_pool = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties memory_properties{};
    VkPhysicalDeviceProperties properties{};
    std::string backend;

    ~Context() {
        if (device != VK_NULL_HANDLE && command_pool != VK_NULL_HANDLE) {
            vkapi::DestroyCommandPool(device, command_pool, nullptr);
        }
        if (device != VK_NULL_HANDLE) {
            vkapi::DestroyDevice(device, nullptr);
        }
        if (instance != VK_NULL_HANDLE) {
            vkapi::DestroyInstance(instance, nullptr);
        }
    }
};

bool supports_required_formats(VkPhysicalDevice physical) {
    const VkFormat formats[] = {
        VK_FORMAT_R32_SFLOAT,
        VK_FORMAT_R16G16B16A16_SFLOAT,
        VK_FORMAT_R8G8B8A8_UNORM,
    };
    for (VkFormat format : formats) {
        VkFormatProperties properties{};
        vkapi::GetPhysicalDeviceFormatProperties(physical, format, &properties);
        if ((properties.optimalTilingFeatures &
             VK_FORMAT_FEATURE_STORAGE_IMAGE_BIT) == 0) {
            return false;
        }
    }
    return true;
}

bool initialize_context(Context& context, std::string& error) {
    if (!vkapi::load_loader(error)) {
        return false;
    }
    vkapi::CreateInstance = reinterpret_cast<PFN_vkCreateInstance>(
        vkapi::GetInstanceProcAddr(nullptr, "vkCreateInstance"));
    if (vkapi::CreateInstance == nullptr) {
        error = "loader does not expose vkCreateInstance";
        return false;
    }

    VkApplicationInfo app{};
    app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    app.pApplicationName = "render-graph-demo";
    app.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
    app.pEngineName = "render-graph";
    app.engineVersion = VK_MAKE_VERSION(1, 0, 0);
    app.apiVersion = VK_API_VERSION_1_0;

    VkInstanceCreateInfo instance_info{};
    instance_info.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    instance_info.pApplicationInfo = &app;
    if (!checked(vkapi::CreateInstance(&instance_info, nullptr, &context.instance),
                 "vkCreateInstance", error)) {
        return false;
    }
    if (!vkapi::load_functions(context.instance, error)) {
        return false;
    }

    std::uint32_t device_count = 0;
    if (!checked(vkapi::EnumeratePhysicalDevices(context.instance, &device_count,
                                                  nullptr),
                 "vkEnumeratePhysicalDevices", error)) {
        return false;
    }
    std::vector<VkPhysicalDevice> devices(device_count);
    if (device_count == 0 ||
        !checked(vkapi::EnumeratePhysicalDevices(context.instance, &device_count,
                                                  devices.data()),
                 "vkEnumeratePhysicalDevices", error)) {
        if (error.empty()) {
            error = "no Vulkan physical device found";
        }
        return false;
    }
    devices.resize(device_count);

    for (VkPhysicalDevice candidate : devices) {
        if (!supports_required_formats(candidate)) {
            continue;
        }
        std::uint32_t family_count = 0;
        vkapi::GetPhysicalDeviceQueueFamilyProperties(candidate, &family_count,
                                                       nullptr);
        std::vector<VkQueueFamilyProperties> families(family_count);
        vkapi::GetPhysicalDeviceQueueFamilyProperties(candidate, &family_count,
                                                       families.data());
        for (std::uint32_t i = 0; i < family_count; ++i) {
            if ((families[i].queueFlags & VK_QUEUE_COMPUTE_BIT) != 0) {
                context.physical = candidate;
                context.queue_family = i;
                break;
            }
        }
        if (context.physical != VK_NULL_HANDLE) {
            break;
        }
    }
    if (context.physical == VK_NULL_HANDLE) {
        error = "no Vulkan device supports the required storage formats";
        return false;
    }

    const float priority = 1.0f;
    VkDeviceQueueCreateInfo queue_info{};
    queue_info.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    queue_info.queueFamilyIndex = context.queue_family;
    queue_info.queueCount = 1;
    queue_info.pQueuePriorities = &priority;
    VkDeviceCreateInfo device_info{};
    device_info.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    device_info.queueCreateInfoCount = 1;
    device_info.pQueueCreateInfos = &queue_info;
    if (!checked(vkapi::CreateDevice(context.physical, &device_info, nullptr,
                                     &context.device),
                 "vkCreateDevice", error)) {
        return false;
    }
    vkapi::GetDeviceQueue(context.device, context.queue_family, 0,
                          &context.queue);
    vkapi::GetPhysicalDeviceMemoryProperties(context.physical,
                                             &context.memory_properties);
    vkapi::GetPhysicalDeviceProperties(context.physical, &context.properties);

    VkCommandPoolCreateInfo pool_info{};
    pool_info.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pool_info.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pool_info.queueFamilyIndex = context.queue_family;
    if (!checked(vkapi::CreateCommandPool(context.device, &pool_info, nullptr,
                                          &context.command_pool),
                 "vkCreateCommandPool", error)) {
        return false;
    }

    std::ostringstream backend;
    backend << context.properties.deviceName << " (Vulkan "
            << VK_VERSION_MAJOR(context.properties.apiVersion) << "."
            << VK_VERSION_MINOR(context.properties.apiVersion) << "."
            << VK_VERSION_PATCH(context.properties.apiVersion) << ")";
    context.backend = backend.str();
    return true;
}

bool find_memory_type(const Context& context, std::uint32_t type_bits,
                      VkMemoryPropertyFlags required, std::uint32_t& index) {
    for (std::uint32_t i = 0; i < context.memory_properties.memoryTypeCount;
         ++i) {
        if ((type_bits & (1u << i)) == 0) {
            continue;
        }
        const auto& type = context.memory_properties.memoryTypes[i];
        if ((type.propertyFlags & required) == required) {
            index = i;
            return true;
        }
    }
    return false;
}

struct ExecutionObjects {
    VkDevice device = VK_NULL_HANDLE;
    std::map<std::string, ImageRecord> images;
    std::map<std::string, BufferRecord> buffers;
    std::vector<VkDeviceMemory> block_memories;
    VkDescriptorSetLayout descriptor_set_layout = VK_NULL_HANDLE;
    VkPipelineLayout pipeline_layout = VK_NULL_HANDLE;
    VkDescriptorPool descriptor_pool = VK_NULL_HANDLE;
    std::map<std::string, VkPipeline> pipelines;
    std::map<std::string, VkDescriptorSet> descriptor_sets;

    ~ExecutionObjects() {
        if (device == VK_NULL_HANDLE) {
            return;
        }
        std::set<VkPipeline> unique_pipelines;
        for (const auto& [name, pipeline] : pipelines) {
            (void)name;
            unique_pipelines.insert(pipeline);
        }
        for (VkPipeline pipeline : unique_pipelines) {
            vkapi::DestroyPipeline(device, pipeline, nullptr);
        }
        if (descriptor_pool != VK_NULL_HANDLE) {
            vkapi::DestroyDescriptorPool(device, descriptor_pool, nullptr);
        }
        if (pipeline_layout != VK_NULL_HANDLE) {
            vkapi::DestroyPipelineLayout(device, pipeline_layout, nullptr);
        }
        if (descriptor_set_layout != VK_NULL_HANDLE) {
            vkapi::DestroyDescriptorSetLayout(device, descriptor_set_layout,
                                              nullptr);
        }
        for (auto& [name, buffer] : buffers) {
            (void)name;
            if (buffer.mapped != nullptr) {
                vkapi::UnmapMemory(device, buffer.memory);
            }
            if (buffer.buffer != VK_NULL_HANDLE) {
                vkapi::DestroyBuffer(device, buffer.buffer, nullptr);
            }
            if (buffer.memory != VK_NULL_HANDLE) {
                vkapi::FreeMemory(device, buffer.memory, nullptr);
            }
        }
        for (auto& [name, image] : images) {
            (void)name;
            if (image.view != VK_NULL_HANDLE) {
                vkapi::DestroyImageView(device, image.view, nullptr);
            }
            if (image.image != VK_NULL_HANDLE) {
                vkapi::DestroyImage(device, image.image, nullptr);
            }
        }
        for (VkDeviceMemory memory : block_memories) {
            vkapi::FreeMemory(device, memory, nullptr);
        }
    }
};

bool create_images(Context& context, Graph& graph, ExecutionObjects& objects,
                   std::string& error) {
    objects.device = context.device;
    for (auto& resource : graph.resources) {
        if (resource.kind != ResourceKind::Texture2D) {
            continue;
        }
        if (has_flag(resource.flags, ResourceFlags::Imported)) {
            error = "imported texture '" + resource.name +
                    "' is not supported by the headless backend";
            return false;
        }
        VkImageCreateInfo image_info{};
        image_info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
        image_info.flags = VK_IMAGE_CREATE_ALIAS_BIT;
        image_info.imageType = VK_IMAGE_TYPE_2D;
        image_info.format = to_vk_format(resource.format);
        image_info.extent = {resource.width, resource.height, 1};
        image_info.mipLevels = 1;
        image_info.arrayLayers = 1;
        image_info.samples = VK_SAMPLE_COUNT_1_BIT;
        image_info.tiling = VK_IMAGE_TILING_OPTIMAL;
        image_info.usage = to_vk_usage(resource.usage);
        image_info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        image_info.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        if (image_info.usage == 0) {
            error = "resource '" + resource.name + "' has no Vulkan usage";
            return false;
        }

        ImageRecord record;
        record.desc = resource;
        if (!checked(vkapi::CreateImage(context.device, &image_info, nullptr,
                                        &record.image),
                     "vkCreateImage", error)) {
            return false;
        }
        VkMemoryRequirements requirements{};
        vkapi::GetImageMemoryRequirements(context.device, record.image,
                                          &requirements);
        resource.memory.size = requirements.size;
        resource.memory.alignment = requirements.alignment;
        resource.memory.memory_type_bits = requirements.memoryTypeBits;

        objects.images.emplace(resource.name, record);
    }
    return true;
}

bool allocate_blocks(Context& context, const CompileResult& compiled,
                     ExecutionObjects& objects, std::string& error) {
    std::vector<VkDeviceMemory> memories(compiled.allocation.blocks.size(),
                                         VK_NULL_HANDLE);
    for (const auto& block : compiled.allocation.blocks) {
        std::uint32_t type_index = 0;
        if (!find_memory_type(context, block.memory_type_bits,
                              VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT,
                              type_index)) {
            if (!find_memory_type(context, block.memory_type_bits, 0,
                                  type_index)) {
                error = "no compatible memory type for allocation block " +
                        std::to_string(block.id);
                return false;
            }
        }
        VkMemoryAllocateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
        info.allocationSize = std::max<std::uint64_t>(1, block.size);
        info.memoryTypeIndex = type_index;
        if (!checked(vkapi::AllocateMemory(context.device, &info, nullptr,
                                           &memories[block.id]),
                     "vkAllocateMemory", error)) {
            return false;
        }
        objects.block_memories.push_back(memories[block.id]);
    }

    for (const auto& placement : compiled.allocation.placements) {
        auto image_it = objects.images.find(placement.resource);
        if (image_it == objects.images.end()) {
            error = "allocation placement references missing image '" +
                    placement.resource + "'";
            return false;
        }
        if (!checked(vkapi::BindImageMemory(context.device,
                                            image_it->second.image,
                                            memories[placement.block],
                                            placement.offset),
                     "vkBindImageMemory", error)) {
            return false;
        }
    }

    return true;
}

bool create_image_views(Context& context, ExecutionObjects& objects,
                        std::string& error) {
    for (auto& [name, record] : objects.images) {
        (void)name;
        VkImageViewCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        info.image = record.image;
        info.viewType = VK_IMAGE_VIEW_TYPE_2D;
        info.format = to_vk_format(record.desc.format);
        info.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        if (!checked(vkapi::CreateImageView(context.device, &info, nullptr,
                                            &record.view),
                     "vkCreateImageView", error)) {
            return false;
        }
    }
    return true;
}

bool create_imported_buffers(Context& context, Graph& graph,
                             ExecutionObjects& objects, std::string& error) {
    for (auto& resource : graph.resources) {
        if (resource.kind != ResourceKind::Buffer ||
            !has_flag(resource.flags, ResourceFlags::Imported)) {
            continue;
        }
        VkBufferCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
        info.size = std::max<std::uint64_t>(1, resource.memory.size);
        info.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
        info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

        auto inserted = objects.buffers.emplace(resource.name, BufferRecord{});
        BufferRecord& record = inserted.first->second;
        record.desc = resource;
        if (!checked(vkapi::CreateBuffer(context.device, &info, nullptr,
                                         &record.buffer),
                     "vkCreateBuffer", error)) {
            return false;
        }
        VkMemoryRequirements requirements{};
        vkapi::GetBufferMemoryRequirements(context.device, record.buffer,
                                           &requirements);
        std::uint32_t type_index = 0;
        if (!find_memory_type(context, requirements.memoryTypeBits,
                              VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                  VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                              type_index)) {
            error = "no host-visible memory for buffer '" + resource.name + "'";
            return false;
        }
        VkMemoryAllocateInfo memory_info{};
        memory_info.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
        memory_info.allocationSize = requirements.size;
        memory_info.memoryTypeIndex = type_index;
        if (!checked(vkapi::AllocateMemory(context.device, &memory_info,
                                           nullptr, &record.memory),
                     "vkAllocateMemory", error)) {
            return false;
        }
        if (!checked(vkapi::BindBufferMemory(context.device, record.buffer,
                                             record.memory, 0),
                     "vkBindBufferMemory", error)) {
            return false;
        }
        if (!checked(vkapi::MapMemory(context.device, record.memory, 0,
                                      resource.memory.size, 0,
                                      &record.mapped),
                     "vkMapMemory", error)) {
            return false;
        }
    }
    return true;
}

bool create_descriptors(Context& context, const CompileResult& compiled,
                        ExecutionObjects& objects, std::string& error) {
    VkDescriptorSetLayoutBinding bindings[3]{};
    for (std::uint32_t i = 0; i < 3; ++i) {
        bindings[i].binding = i;
        bindings[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
        bindings[i].descriptorCount = 1;
        bindings[i].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    }
    VkDescriptorSetLayoutCreateInfo layout_info{};
    layout_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    layout_info.bindingCount = 3;
    layout_info.pBindings = bindings;
    if (!checked(vkapi::CreateDescriptorSetLayout(
                     context.device, &layout_info, nullptr,
                     &objects.descriptor_set_layout),
                 "vkCreateDescriptorSetLayout", error)) {
        return false;
    }

    VkPushConstantRange push_range{};
    push_range.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    push_range.offset = 0;
    push_range.size = 16;
    VkPipelineLayoutCreateInfo pipeline_layout_info{};
    pipeline_layout_info.sType =
        VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    pipeline_layout_info.setLayoutCount = 1;
    pipeline_layout_info.pSetLayouts = &objects.descriptor_set_layout;
    pipeline_layout_info.pushConstantRangeCount = 1;
    pipeline_layout_info.pPushConstantRanges = &push_range;
    if (!checked(vkapi::CreatePipelineLayout(
                     context.device, &pipeline_layout_info, nullptr,
                     &objects.pipeline_layout),
                 "vkCreatePipelineLayout", error)) {
        return false;
    }

    const std::uint32_t set_count =
        static_cast<std::uint32_t>(compiled.graph.passes.size());
    VkDescriptorPoolSize pool_size{};
    pool_size.type = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
    pool_size.descriptorCount = std::max(1u, set_count * 3);
    VkDescriptorPoolCreateInfo pool_info{};
    pool_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pool_info.maxSets = set_count;
    pool_info.poolSizeCount = 1;
    pool_info.pPoolSizes = &pool_size;
    if (!checked(vkapi::CreateDescriptorPool(context.device, &pool_info,
                                             nullptr,
                                             &objects.descriptor_pool),
                 "vkCreateDescriptorPool", error)) {
        return false;
    }

    std::vector<VkDescriptorSetLayout> layouts(set_count,
                                               objects.descriptor_set_layout);
    std::vector<VkDescriptorSet> sets(set_count, VK_NULL_HANDLE);
    VkDescriptorSetAllocateInfo allocate_info{};
    allocate_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    allocate_info.descriptorPool = objects.descriptor_pool;
    allocate_info.descriptorSetCount = set_count;
    allocate_info.pSetLayouts = layouts.data();
    if (!checked(vkapi::AllocateDescriptorSets(context.device, &allocate_info,
                                               sets.data()),
                 "vkAllocateDescriptorSets", error)) {
        return false;
    }

    std::vector<VkDescriptorImageInfo> image_infos;
    image_infos.reserve(static_cast<std::size_t>(set_count) * 3);
    std::vector<VkWriteDescriptorSet> writes;
    writes.reserve(static_cast<std::size_t>(set_count) * 3);
    for (std::size_t p = 0; p < compiled.graph.passes.size(); ++p) {
        const auto& pass = compiled.graph.passes[p];
        objects.descriptor_sets.emplace(pass.name, sets[p]);
        if (pass.kind != PassKind::Compute) {
            continue;
        }
        if (pass.writes.size() != 1) {
            error = "compute pass '" + pass.name +
                    "' must declare exactly one write";
            return false;
        }
        if (pass.reads.size() > 2) {
            error = "compute pass '" + pass.name +
                    "' exceeds the two-input demo pipeline";
            return false;
        }
        for (std::size_t i = 0; i < pass.reads.size(); ++i) {
            auto image = objects.images.find(pass.reads[i].resource);
            if (image == objects.images.end()) {
                error = "pass '" + pass.name + "' reads non-image resource '" +
                        pass.reads[i].resource + "'";
                return false;
            }
            image_infos.push_back({VK_NULL_HANDLE, image->second.view,
                                   VK_IMAGE_LAYOUT_GENERAL});
            VkWriteDescriptorSet write{};
            write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            write.dstSet = sets[p];
            write.dstBinding = static_cast<std::uint32_t>(i);
            write.descriptorCount = 1;
            write.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
            write.pImageInfo = &image_infos.back();
            writes.push_back(write);
        }
        auto output = objects.images.find(pass.writes[0].resource);
        if (output == objects.images.end()) {
            error = "pass '" + pass.name + "' writes non-image resource '" +
                    pass.writes[0].resource + "'";
            return false;
        }
        image_infos.push_back({VK_NULL_HANDLE, output->second.view,
                               VK_IMAGE_LAYOUT_GENERAL});
        VkWriteDescriptorSet write{};
        write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        write.dstSet = sets[p];
        write.dstBinding = 2;
        write.descriptorCount = 1;
        write.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
        write.pImageInfo = &image_infos.back();
        writes.push_back(write);
    }

    if (!writes.empty()) {
        vkapi::UpdateDescriptorSets(context.device,
                                    static_cast<std::uint32_t>(writes.size()),
                                    writes.data(), 0, nullptr);
    }
    return true;
}

std::vector<char> load_shader(const std::string& filename) {
    std::vector<std::string> candidates = {
        std::string(RG_SHADER_DIR) + "/" + filename,
        "shaders/spv/" + filename,
    };
    std::string last_error;
    for (const auto& path : candidates) {
        try {
            return read_file(path);
        } catch (const std::exception& error) {
            last_error = error.what();
        }
    }
    throw std::runtime_error(last_error);
}

bool create_pipelines(Context& context, const CompileResult& compiled,
                      ExecutionObjects& objects, std::string& error) {
    std::map<std::string, VkPipeline> shader_pipelines;
    for (const auto& pass : compiled.graph.passes) {
        if (pass.kind != PassKind::Compute) {
            continue;
        }
        auto existing = shader_pipelines.find(pass.shader);
        if (existing != shader_pipelines.end()) {
            objects.pipelines.emplace(pass.name, existing->second);
            continue;
        }

        std::vector<char> code;
        try {
            code = load_shader(pass.shader);
        } catch (const std::exception& exception) {
            error = exception.what();
            return false;
        }
        VkShaderModule module = VK_NULL_HANDLE;
        VkShaderModuleCreateInfo module_info{};
        module_info.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
        module_info.codeSize = code.size();
        module_info.pCode =
            reinterpret_cast<const std::uint32_t*>(code.data());
        if (!checked(vkapi::CreateShaderModule(context.device, &module_info,
                                               nullptr, &module),
                     "vkCreateShaderModule", error)) {
            return false;
        }

        VkComputePipelineCreateInfo pipeline_info{};
        pipeline_info.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pipeline_info.stage.sType =
            VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pipeline_info.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        pipeline_info.stage.module = module;
        pipeline_info.stage.pName = "main";
        pipeline_info.layout = objects.pipeline_layout;
        VkPipeline pipeline = VK_NULL_HANDLE;
        const VkResult result = vkapi::CreateComputePipelines(
            context.device, VK_NULL_HANDLE, 1, &pipeline_info, nullptr,
            &pipeline);
        vkapi::DestroyShaderModule(context.device, module, nullptr);
        if (!checked(result, "vkCreateComputePipelines", error)) {
            return false;
        }
        shader_pipelines.emplace(pass.shader, pipeline);
        objects.pipelines.emplace(pass.name, pipeline);
    }
    return true;
}

bool image_is_aliased(const CompileResult& compiled,
                      const std::string& resource) {
    const auto* placement = compiled.allocation.find(resource);
    return placement != nullptr && !placement->aliases.empty();
}

bool record_graph(Context& context, const CompileResult& compiled,
                  ExecutionObjects& objects, VkCommandBuffer command,
                  std::map<std::string, Layout>& layouts, std::string& error) {
    (void)context;
    for (const auto& resource : compiled.graph.resources) {
        if (resource.kind == ResourceKind::Texture2D) {
            layouts.emplace(resource.name, resource.initial_layout);
        }
    }

    for (std::size_t pass_index : compiled.schedule) {
        const auto& pass = compiled.graph.passes[pass_index];
        std::vector<VkImageMemoryBarrier> barriers;
        bool alias_transition = false;
        for (const auto& transition : compiled.transitions) {
            if (transition.pass != pass.name) {
                continue;
            }
            auto image = objects.images.find(transition.resource);
            if (image == objects.images.end()) {
                continue;
            }
            VkImageMemoryBarrier barrier{};
            barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
            barrier.oldLayout = to_vk_layout(transition.from);
            barrier.newLayout = to_vk_layout(transition.to);
            barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            barrier.image = image->second.image;
            barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
            barrier.srcAccessMask = to_vk_access(transition.src_access);
            barrier.dstAccessMask = to_vk_access(transition.dst_access);
            barriers.push_back(barrier);
            layouts[transition.resource] = transition.to;
            if (transition.from == Layout::Undefined &&
                image_is_aliased(compiled, transition.resource)) {
                alias_transition = true;
            }
        }

        if (alias_transition) {
            VkMemoryBarrier alias_barrier{};
            alias_barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
            alias_barrier.srcAccessMask = VK_ACCESS_MEMORY_WRITE_BIT;
            alias_barrier.dstAccessMask =
                VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT;
            vkapi::CmdPipelineBarrier(
                command, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT |
                    VK_PIPELINE_STAGE_TRANSFER_BIT,
                0, 1, &alias_barrier, 0, nullptr, 0, nullptr);
        }

        if (!barriers.empty()) {
            VkPipelineStageFlags src_stage = 0;
            VkPipelineStageFlags dst_stage = 0;
            for (const auto& transition : compiled.transitions) {
                if (transition.pass != pass.name) {
                    continue;
                }
                if (transition.src_access == AccessKind::None) {
                    src_stage |= VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT;
                } else {
                    src_stage |= to_vk_stage(transition.src_stage);
                }
                dst_stage |= to_vk_stage(transition.dst_stage);
            }
            vkapi::CmdPipelineBarrier(command, src_stage, dst_stage, 0, 0,
                                      nullptr, 0, nullptr,
                                      static_cast<std::uint32_t>(barriers.size()),
                                      barriers.data());
        }

        if (pass.kind == PassKind::TransferImageToBuffer) {
            if (pass.reads.empty() || pass.writes.empty()) {
                error = "transfer pass '" + pass.name + "' is incomplete";
                return false;
            }
            auto image = objects.images.find(pass.reads[0].resource);
            auto buffer = objects.buffers.find(pass.writes[0].resource);
            if (image == objects.images.end() ||
                buffer == objects.buffers.end()) {
                error = "transfer pass '" + pass.name +
                        "' references missing image or buffer";
                return false;
            }
            VkBufferImageCopy region{};
            region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
            region.imageExtent = {image->second.desc.width,
                                  image->second.desc.height, 1};
            vkapi::CmdCopyImageToBuffer(command, image->second.image,
                                        VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                                        buffer->second.buffer, 1, &region);
            continue;
        }

        auto pipeline = objects.pipelines.find(pass.name);
        auto descriptor = objects.descriptor_sets.find(pass.name);
        if (pipeline == objects.pipelines.end() ||
            descriptor == objects.descriptor_sets.end()) {
            error = "pass '" + pass.name + "' has no pipeline or descriptor set";
            return false;
        }
        if (pass.writes.empty()) {
            error = "compute pass '" + pass.name + "' has no output";
            return false;
        }
        const auto* output =
            compiled.graph.find_resource(pass.writes[0].resource);
        if (output == nullptr) {
            error = "compute pass '" + pass.name + "' has unknown output";
            return false;
        }
        std::uint32_t dimensions[4] = {output->width, output->height, 0, 0};
        if (pass.shader == "bloom.comp.spv" && !pass.reads.empty()) {
            const auto* source =
                compiled.graph.find_resource(pass.reads[0].resource);
            if (source) {
                dimensions[2] = source->width;
                dimensions[3] = source->height;
            }
        } else if (pass.shader == "tonemap.comp.spv" && pass.reads.size() >= 2) {
            const auto* bloom =
                compiled.graph.find_resource(pass.reads[1].resource);
            if (bloom) {
                dimensions[2] = bloom->width;
                dimensions[3] = bloom->height;
            }
        }

        vkapi::CmdBindPipeline(command, VK_PIPELINE_BIND_POINT_COMPUTE,
                               pipeline->second);
        vkapi::CmdBindDescriptorSets(
            command, VK_PIPELINE_BIND_POINT_COMPUTE,
            objects.pipeline_layout, 0, 1, &descriptor->second, 0, nullptr);
        vkapi::CmdPushConstants(command, objects.pipeline_layout,
                                VK_SHADER_STAGE_COMPUTE_BIT, 0,
                                sizeof(dimensions), dimensions);
        vkapi::CmdDispatch(command, (output->width + 7) / 8,
                           (output->height + 7) / 8, 1);
    }
    return true;
}

bool read_image_to_host(Context& context, ExecutionObjects& objects,
                        const ResourceDesc& resource, Layout old_layout,
                        std::vector<std::uint8_t>& bytes,
                        std::string& error) {
    const std::uint64_t size =
        static_cast<std::uint64_t>(resource.width) * resource.height *
        bytes_per_pixel(resource.format);
    VkBufferCreateInfo buffer_info{};
    buffer_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    buffer_info.size = size;
    buffer_info.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    buffer_info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VkBuffer buffer = VK_NULL_HANDLE;
    if (!checked(vkapi::CreateBuffer(context.device, &buffer_info, nullptr,
                                     &buffer),
                 "vkCreateBuffer(readback)", error)) {
        return false;
    }
    VkMemoryRequirements requirements{};
    vkapi::GetBufferMemoryRequirements(context.device, buffer, &requirements);
    std::uint32_t type_index = 0;
    if (!find_memory_type(context, requirements.memoryTypeBits,
                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                              VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                          type_index)) {
        vkapi::DestroyBuffer(context.device, buffer, nullptr);
        error = "no host-visible type for readback buffer";
        return false;
    }
    VkMemoryAllocateInfo memory_info{};
    memory_info.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    memory_info.allocationSize = requirements.size;
    memory_info.memoryTypeIndex = type_index;
    VkDeviceMemory memory = VK_NULL_HANDLE;
    if (!checked(vkapi::AllocateMemory(context.device, &memory_info, nullptr,
                                       &memory),
                 "vkAllocateMemory(readback)", error)) {
        vkapi::DestroyBuffer(context.device, buffer, nullptr);
        return false;
    }
    if (!checked(vkapi::BindBufferMemory(context.device, buffer, memory, 0),
                 "vkBindBufferMemory(readback)", error)) {
        vkapi::FreeMemory(context.device, memory, nullptr);
        vkapi::DestroyBuffer(context.device, buffer, nullptr);
        return false;
    }

    VkCommandBufferAllocateInfo allocate_info{};
    allocate_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    allocate_info.commandPool = context.command_pool;
    allocate_info.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    allocate_info.commandBufferCount = 1;
    VkCommandBuffer command = VK_NULL_HANDLE;
    if (!checked(vkapi::AllocateCommandBuffers(context.device, &allocate_info,
                                               &command),
                 "vkAllocateCommandBuffers(readback)", error)) {
        vkapi::FreeMemory(context.device, memory, nullptr);
        vkapi::DestroyBuffer(context.device, buffer, nullptr);
        return false;
    }
    VkCommandBufferBeginInfo begin_info{};
    begin_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    begin_info.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkapi::BeginCommandBuffer(command, &begin_info);

    VkImageMemoryBarrier barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    barrier.oldLayout = to_vk_layout(old_layout);
    barrier.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
    barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    auto image = objects.images.find(resource.name);
    if (image == objects.images.end()) {
        error = "readback image not found: " + resource.name;
        vkapi::FreeCommandBuffers(context.device, context.command_pool, 1,
                                  &command);
        vkapi::FreeMemory(context.device, memory, nullptr);
        vkapi::DestroyBuffer(context.device, buffer, nullptr);
        return false;
    }
    barrier.image = image->second.image;
    barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    barrier.srcAccessMask = VK_ACCESS_MEMORY_WRITE_BIT;
    barrier.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    vkapi::CmdPipelineBarrier(command, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                              VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0,
                              nullptr, 1, &barrier);

    VkBufferImageCopy region{};
    region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    region.imageExtent = {resource.width, resource.height, 1};
    vkapi::CmdCopyImageToBuffer(command, image->second.image,
                                VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, buffer, 1,
                                &region);
    vkapi::EndCommandBuffer(command);
    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &command;
    if (!checked(vkapi::QueueSubmit(context.queue, 1, &submit,
                                    VK_NULL_HANDLE),
                 "vkQueueSubmit(readback)", error) ||
        !checked(vkapi::QueueWaitIdle(context.queue), "vkQueueWaitIdle", error)) {
        vkapi::FreeCommandBuffers(context.device, context.command_pool, 1,
                                  &command);
        vkapi::FreeMemory(context.device, memory, nullptr);
        vkapi::DestroyBuffer(context.device, buffer, nullptr);
        return false;
    }

    void* mapped = nullptr;
    if (!checked(vkapi::MapMemory(context.device, memory, 0, size, 0,
                                  &mapped),
                 "vkMapMemory(readback)", error)) {
        vkapi::FreeCommandBuffers(context.device, context.command_pool, 1,
                                  &command);
        vkapi::FreeMemory(context.device, memory, nullptr);
        vkapi::DestroyBuffer(context.device, buffer, nullptr);
        return false;
    }
    bytes.resize(static_cast<std::size_t>(size));
    std::memcpy(bytes.data(), mapped, static_cast<std::size_t>(size));
    vkapi::UnmapMemory(context.device, memory);
    vkapi::FreeCommandBuffers(context.device, context.command_pool, 1,
                              &command);
    vkapi::FreeMemory(context.device, memory, nullptr);
    vkapi::DestroyBuffer(context.device, buffer, nullptr);
    return true;
}

float half_to_float(std::uint16_t value) {
    const std::uint32_t sign = static_cast<std::uint32_t>(value >> 15) << 31;
    const std::uint32_t exponent = (value >> 10) & 0x1f;
    const std::uint32_t mantissa = value & 0x3ff;
    std::uint32_t bits = 0;
    if (exponent == 0) {
        if (mantissa == 0) {
            bits = sign;
        } else {
            std::uint32_t normalized = mantissa;
            int shift = 0;
            while ((normalized & 0x400) == 0) {
                normalized <<= 1;
                ++shift;
            }
            normalized &= 0x3ff;
            bits = sign | (static_cast<std::uint32_t>(127 - 15 - shift) << 23) |
                   (normalized << 13);
        }
    } else if (exponent == 0x1f) {
        bits = sign | 0x7f800000u | (mantissa << 13);
    } else {
        bits = sign | ((exponent + 127 - 15) << 23) | (mantissa << 13);
    }
    float out = 0.0f;
    std::memcpy(&out, &bits, sizeof(out));
    return out;
}

std::uint8_t to_unorm8(float value, bool encode_srgb) {
    value = std::clamp(value, 0.0f, 1.0f);
    if (encode_srgb) {
        value = std::pow(value, 1.0f / 2.2f);
    }
    return static_cast<std::uint8_t>(std::lround(value * 255.0f));
}

std::vector<std::uint8_t> convert_rgba8(
    const ResourceDesc& resource, const std::vector<std::uint8_t>& source) {
    const std::size_t pixels =
        static_cast<std::size_t>(resource.width) * resource.height;
    std::vector<std::uint8_t> output(pixels * 4, 255);
    if (resource.format == Format::RGBA8Unorm) {
        const std::size_t copy_size = std::min(source.size(), output.size());
        std::memcpy(output.data(), source.data(), copy_size);
        return output;
    }
    if (resource.format == Format::RGBA16Float) {
        const auto* values =
            reinterpret_cast<const std::uint16_t*>(source.data());
        const std::size_t count = std::min(pixels * 4, source.size() / 2);
        for (std::size_t i = 0; i < count; ++i) {
            output[i] = to_unorm8(half_to_float(values[i]), true);
        }
        return output;
    }
    if (resource.format == Format::R32Float) {
        const auto* values = reinterpret_cast<const float*>(source.data());
        const std::size_t count = std::min(pixels, source.size() / 4);
        for (std::size_t i = 0; i < count; ++i) {
            const auto gray = to_unorm8(values[i], true);
            output[i * 4 + 0] = gray;
            output[i * 4 + 1] = gray;
            output[i * 4 + 2] = gray;
            output[i * 4 + 3] = 255;
        }
    }
    return output;
}

bool write_ppm(const std::string& path, std::uint32_t width,
               std::uint32_t height,
               const std::vector<std::uint8_t>& rgba8) {
    if (path.empty()) {
        return true;
    }
    std::error_code error_code;
    const auto parent = std::filesystem::path(path).parent_path();
    if (!parent.empty()) {
        std::filesystem::create_directories(parent, error_code);
    }
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        return false;
    }
    output << "P6\n" << width << ' ' << height << "\n255\n";
    for (std::size_t i = 0; i + 3 < rgba8.size(); i += 4) {
        output.put(static_cast<char>(rgba8[i + 0]));
        output.put(static_cast<char>(rgba8[i + 1]));
        output.put(static_cast<char>(rgba8[i + 2]));
    }
    return static_cast<bool>(output);
}

}  // namespace

VulkanRunResult run_vulkan(const Graph& graph, const CompileResult& compiled,
                           const VulkanRunOptions& options) {
    VulkanRunResult result;
    result.compiled = compiled;
    if (!compiled.ok()) {
        result.error = "render graph did not compile";
        return result;
    }

    Context context;
    std::string error;
    if (!initialize_context(context, error)) {
        result.error = error;
        return result;
    }
    result.backend = context.backend;

    Graph actual_graph = graph;
    ExecutionObjects objects;
    if (!create_images(context, actual_graph, objects, error)) {
        result.error = error;
        return result;
    }

    CompileResult actual = compile(actual_graph);
    result.compiled = actual;
    if (!actual.ok()) {
        result.error = "graph failed to compile after querying Vulkan memory";
        return result;
    }
    if (!allocate_blocks(context, actual, objects, error) ||
        !create_image_views(context, objects, error) ||
        !create_imported_buffers(context, actual_graph, objects, error) ||
        !create_descriptors(context, actual, objects, error) ||
        !create_pipelines(context, actual, objects, error)) {
        result.error = error;
        return result;
    }

    VkCommandBufferAllocateInfo allocate_info{};
    allocate_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    allocate_info.commandPool = context.command_pool;
    allocate_info.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    allocate_info.commandBufferCount = 1;
    VkCommandBuffer command = VK_NULL_HANDLE;
    if (!checked(vkapi::AllocateCommandBuffers(context.device, &allocate_info,
                                               &command),
                 "vkAllocateCommandBuffers", error)) {
        result.error = error;
        return result;
    }
    VkCommandBufferBeginInfo begin_info{};
    begin_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    begin_info.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    if (!checked(vkapi::BeginCommandBuffer(command, &begin_info),
                 "vkBeginCommandBuffer", error)) {
        result.error = error;
        return result;
    }

    std::map<std::string, Layout> layouts;
    if (!record_graph(context, actual, objects, command, layouts, error)) {
        result.error = error;
        return result;
    }
    if (!checked(vkapi::EndCommandBuffer(command), "vkEndCommandBuffer",
                 error)) {
        result.error = error;
        return result;
    }

    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &command;
    if (!checked(vkapi::QueueSubmit(context.queue, 1, &submit,
                                    VK_NULL_HANDLE),
                 "vkQueueSubmit", error) ||
        !checked(vkapi::QueueWaitIdle(context.queue), "vkQueueWaitIdle",
                 error)) {
        result.error = error;
        return result;
    }
    vkapi::FreeCommandBuffers(context.device, context.command_pool, 1,
                              &command);

    const ResourceDesc* final_resource = nullptr;
    std::string final_name = options.final_image;
    if (final_name.empty()) {
        for (auto it = actual.schedule.rbegin(); it != actual.schedule.rend();
             ++it) {
            const auto& pass = actual.graph.passes[*it];
            for (const auto& write : pass.writes) {
                const auto* candidate = actual.graph.find_resource(write.resource);
                if (candidate && candidate->kind == ResourceKind::Texture2D) {
                    final_name = write.resource;
                    break;
                }
            }
            if (!final_name.empty()) {
                break;
            }
        }
    }
    final_resource = actual.graph.find_resource(final_name);
    if (final_resource == nullptr ||
        final_resource->kind != ResourceKind::Texture2D) {
        result.error = "cannot determine final screenshot image";
        return result;
    }
    result.width = final_resource->width;
    result.height = final_resource->height;

    std::vector<std::uint8_t> raw;
    BufferRecord* capture = nullptr;
    for (const auto& pass : actual.graph.passes) {
        if (pass.kind != PassKind::TransferImageToBuffer) {
            continue;
        }
        for (const auto& write : pass.writes) {
            auto candidate = objects.buffers.find(write.resource);
            if (candidate != objects.buffers.end()) {
                capture = &candidate->second;
            }
        }
    }
    if (capture != nullptr && capture->mapped != nullptr) {
        const std::size_t size =
            static_cast<std::size_t>(result.width) * result.height * 4;
        const auto* begin = static_cast<const std::uint8_t*>(capture->mapped);
        raw.assign(begin, begin + size);
        result.rgba8 = raw;
    } else {
        if (!read_image_to_host(context, objects, *final_resource,
                                layouts[final_name], raw, error)) {
            result.error = error;
            return result;
        }
        result.rgba8 = convert_rgba8(*final_resource, raw);
    }

    if (!write_ppm(options.ppm_path, result.width, result.height,
                   result.rgba8)) {
        result.error = "failed to write PPM: " + options.ppm_path;
        return result;
    }
    result.success = true;
    return result;
}

}  // namespace rg
