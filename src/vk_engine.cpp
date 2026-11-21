#include "vk_engine.hpp"
#include <fstream>
#include <iostream>
#include <cstring>

#ifdef HAVE_GLFW
#define GLFW_INCLUDE_NONE
#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>
#endif

namespace {
std::vector<char> read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) throw std::runtime_error("cannot open " + path);
    size_t n = size_t(f.tellg());
    std::vector<char> buf(n);
    f.seekg(0);
    f.read(buf.data(), n);
    return buf;
}

VkShaderModule make_module(VkDevice dev, const std::vector<char>& code) {
    VkShaderModuleCreateInfo ci{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    ci.codeSize = code.size();
    ci.pCode = reinterpret_cast<const uint32_t*>(code.data());
    VkShaderModule m;
    VK_CHECK(vkCreateShaderModule(dev, &ci, nullptr, &m));
    return m;
}
} // namespace

VulkanEngine::VulkanEngine(bool headless, uint32_t width, uint32_t height)
    : headless_(headless), width_(width), height_(height) {
#ifdef HAVE_GLFW
    if (!headless_) {
        glfwInit();
        glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
        window_ = glfwCreateWindow(int(width_), int(height_),
                                   "Anisotropic GGX Fabric Ball", nullptr, nullptr);
    }
#else
    headless_ = true;
#endif
    create_instance();
    select_physical_device();
    create_device();
    create_swapchain_or_target();
}

VulkanEngine::~VulkanEngine() {
    vkDeviceWaitIdle(device_);
    if (pipeline_) vkDestroyPipeline(device_, pipeline_, nullptr);
    if (pipeLayout_) vkDestroyPipelineLayout(device_, pipeLayout_, nullptr);
    if (dsl_) vkDestroyDescriptorSetLayout(device_, dsl_, nullptr);
    if (descPool_) vkDestroyDescriptorPool(device_, descPool_, nullptr);
    if (sampler_) vkDestroySampler(device_, sampler_, nullptr);
    for (auto* t : {&texAlbedo_, &texNormal_, &texTangent_}) {
        if (t->view) vkDestroyImageView(device_, t->view, nullptr);
        if (t->image) {
            vkDestroyImage(device_, t->image, nullptr);
            vkFreeMemory(device_, t->memory, nullptr);
        }
    }
    for (auto* b : {&vertexBuffer_, &indexBuffer_}) {
        if (b->buffer) {
            vkDestroyBuffer(device_, b->buffer, nullptr);
            vkFreeMemory(device_, b->memory, nullptr);
        }
    }
    if (colorView_) vkDestroyImageView(device_, colorView_, nullptr);
    if (colorImage_) {
        vkDestroyImage(device_, colorImage_, nullptr);
        vkFreeMemory(device_, colorMem_, nullptr);
    }
    if (vertModule_) vkDestroyShaderModule(device_, vertModule_, nullptr);
    if (fragModule_) vkDestroyShaderModule(device_, fragModule_, nullptr);
    if (framebuffer_) vkDestroyFramebuffer(device_, framebuffer_, nullptr);
    if (renderPass_) vkDestroyRenderPass(device_, renderPass_, nullptr);
    if (cmdPool_) vkDestroyCommandPool(device_, cmdPool_, nullptr);
    if (device_) vkDestroyDevice(device_, nullptr);
    if (surface_) vkDestroySurfaceKHR(instance_, surface_, nullptr);
#ifdef HAVE_GLFW
    if (window_) {
        glfwDestroyWindow(window_);
        glfwTerminate();
    }
#endif
    if (instance_) vkDestroyInstance(instance_, nullptr);
}

void VulkanEngine::create_instance() {
    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "fabric-ball";
    app.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
    app.pEngineName = "none";
    app.apiVersion = VK_API_VERSION_1_2;

    std::vector<const char*> exts;
#ifdef HAVE_GLFW
    if (window_) {
        uint32_t n = 0;
        const char** e = glfwGetRequiredInstanceExtensions(&n);
        exts.assign(e, e + n);
    }
#endif
    VkInstanceCreateInfo ci{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    ci.pApplicationInfo = &app;
    ci.enabledExtensionCount = uint32_t(exts.size());
    ci.ppEnabledExtensionNames = exts.data();
    VK_CHECK(vkCreateInstance(&ci, nullptr, &instance_));

#ifdef HAVE_GLFW
    if (window_)
        VK_CHECK(glfwCreateWindowSurface(instance_, window_, nullptr, &surface_));
#endif
}

void VulkanEngine::select_physical_device() {
    uint32_t n = 0;
    vkEnumeratePhysicalDevices(instance_, &n, nullptr);
    if (!n) throw std::runtime_error("no Vulkan physical device");
    std::vector<VkPhysicalDevice> devs(n);
    vkEnumeratePhysicalDevices(instance_, &n, devs.data());
    physical_ = devs[0];
    VkPhysicalDeviceProperties p;
    vkGetPhysicalDeviceProperties(physical_, &p);
    std::cout << "GPU: " << p.deviceName
              << " (Vulkan " << VK_VERSION_MAJOR(p.apiVersion) << "."
              << VK_VERSION_MINOR(p.apiVersion) << ")\n";
    uint32_t qn = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(physical_, &qn, nullptr);
    std::vector<VkQueueFamilyProperties> qf(qn);
    vkGetPhysicalDeviceQueueFamilyProperties(physical_, &qn, qf.data());
    queueFamily_ = uint32_t(-1);
    for (uint32_t i = 0; i < qn; ++i) {
        if (qf[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) {
            queueFamily_ = i;
            break;
        }
    }
    if (queueFamily_ == uint32_t(-1))
        throw std::runtime_error("no graphics queue family");
}

void VulkanEngine::create_device() {
    float prio = 1.f;
    VkDeviceQueueCreateInfo q{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    q.queueFamilyIndex = queueFamily_;
    q.queueCount = 1;
    q.pQueuePriorities = &prio;

    VkPhysicalDeviceDynamicRenderingFeatures dyn{
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_DYNAMIC_RENDERING_FEATURES};
    dyn.dynamicRendering = VK_TRUE;
    VkPhysicalDeviceFeatures2 feats2{
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};
    feats2.pNext = &dyn;
    feats2.features.samplerAnisotropy = VK_TRUE;

    std::vector<const char*> devExts;
#ifdef HAVE_GLFW
    if (surface_) {
        uint32_t n = 0;
        vkEnumerateDeviceExtensionProperties(physical_, nullptr, &n, nullptr);
        std::vector<VkExtensionProperties> props(n);
        vkEnumerateDeviceExtensionProperties(physical_, nullptr, &n, props.data());
        for (auto& pr : props)
            if (!strcmp(pr.extensionName, VK_KHR_SWAPCHAIN_EXTENSION_NAME))
                devExts.push_back(VK_KHR_SWAPCHAIN_EXTENSION_NAME);
    }
#endif
    VkDeviceCreateInfo ci{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    ci.pNext = &feats2;
    ci.queueCreateInfoCount = 1;
    ci.pQueueCreateInfos = &q;
    ci.enabledExtensionCount = uint32_t(devExts.size());
    ci.ppEnabledExtensionNames = devExts.data();
    VK_CHECK(vkCreateDevice(physical_, &ci, nullptr, &device_));
    vkGetDeviceQueue(device_, queueFamily_, 0, &queue_);

    VkCommandPoolCreateInfo pci{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    pci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pci.queueFamilyIndex = queueFamily_;
    VK_CHECK(vkCreateCommandPool(device_, &pci, nullptr, &cmdPool_));
}

uint32_t VulkanEngine::find_memory_type(uint32_t typeBits,
                                        VkMemoryPropertyFlags props) {
    VkPhysicalDeviceMemoryProperties mp;
    vkGetPhysicalDeviceMemoryProperties(physical_, &mp);
    for (uint32_t i = 0; i < mp.memoryTypeCount; ++i)
        if ((typeBits & (1u << i)) &&
            (mp.memoryTypes[i].propertyFlags & props) == props)
            return i;
    throw std::runtime_error("no suitable memory type");
}

void VulkanEngine::create_swapchain_or_target() {
    // Headless single-image colour target; a windowed build still renders into
    // this target and blits to the swapchain-less present path is skipped, so
    // window mode currently uses the same offscreen image (screenshot ready).
    VkImageCreateInfo ii{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    ii.imageType = VK_IMAGE_TYPE_2D;
    ii.format = VK_FORMAT_R8G8B8A8_UNORM;
    ii.extent = {width_, height_, 1};
    ii.mipLevels = 1;
    ii.arrayLayers = 1;
    ii.samples = VK_SAMPLE_COUNT_1_BIT;
    ii.tiling = VK_IMAGE_TILING_LINEAR;
    ii.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT |
               VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
    ii.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    VK_CHECK(vkCreateImage(device_, &ii, nullptr, &colorImage_));
    VkMemoryRequirements mr;
    vkGetImageMemoryRequirements(device_, colorImage_, &mr);
    VkMemoryAllocateInfo mai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex =
        find_memory_type(mr.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                               VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    VK_CHECK(vkAllocateMemory(device_, &mai, nullptr, &colorMem_));
    VK_CHECK(vkBindImageMemory(device_, colorImage_, colorMem_, 0));
    VkImageViewCreateInfo vi{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    vi.image = colorImage_;
    vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vi.format = VK_FORMAT_R8G8B8A8_UNORM;
    vi.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    VK_CHECK(vkCreateImageView(device_, &vi, nullptr, &colorView_));

    VkImageSubresource sub{VK_IMAGE_ASPECT_COLOR_BIT, 0, 0};
    VkSubresourceLayout layout;
    vkGetImageSubresourceLayout(device_, colorImage_, &sub, &layout);
    alignedPitch_ = layout.rowPitch;

    VkAttachmentDescription att{};
    att.format = VK_FORMAT_R8G8B8A8_UNORM;
    att.samples = VK_SAMPLE_COUNT_1_BIT;
    att.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    att.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    att.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    att.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    att.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    att.finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    VkAttachmentReference ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkSubpassDescription subpass{};
    subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    subpass.colorAttachmentCount = 1;
    subpass.pColorAttachments = &ref;
    VkRenderPassCreateInfo rpci{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
    rpci.attachmentCount = 1;
    rpci.pAttachments = &att;
    rpci.subpassCount = 1;
    rpci.pSubpasses = &subpass;
    VK_CHECK(vkCreateRenderPass(device_, &rpci, nullptr, &renderPass_));

    VkFramebufferCreateInfo fbci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
    fbci.renderPass = renderPass_;
    fbci.attachmentCount = 1;
    fbci.pAttachments = &colorView_;
    fbci.width = width_;
    fbci.height = height_;
    fbci.layers = 1;
    VK_CHECK(vkCreateFramebuffer(device_, &fbci, nullptr, &framebuffer_));
}

VulkanEngine::Buffer VulkanEngine::create_buffer(
    VkDeviceSize size, VkBufferUsageFlags usage, VkMemoryPropertyFlags props) {
    Buffer b;
    b.size = size;
    VkBufferCreateInfo bi{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bi.size = size;
    bi.usage = usage;
    bi.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VK_CHECK(vkCreateBuffer(device_, &bi, nullptr, &b.buffer));
    VkMemoryRequirements mr;
    vkGetBufferMemoryRequirements(device_, b.buffer, &mr);
    VkMemoryAllocateInfo mai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex = find_memory_type(mr.memoryTypeBits, props);
    VK_CHECK(vkAllocateMemory(device_, &mai, nullptr, &b.memory));
    VK_CHECK(vkBindBufferMemory(device_, b.buffer, b.memory, 0));
    return b;
}

void VulkanEngine::upload_buffer(Buffer& dst, const void* data,
                                 VkDeviceSize size) {
    void* mapped;
    VK_CHECK(vkMapMemory(device_, dst.memory, 0, size, 0, &mapped));
    std::memcpy(mapped, data, size);
    vkUnmapMemory(device_, dst.memory);
}

VulkanEngine::Texture VulkanEngine::create_texture(const ImageData& img,
                                                   VkFormat format) {
    Texture t;
    VkImageCreateInfo ii{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    ii.imageType = VK_IMAGE_TYPE_2D;
    ii.format = format;
    ii.extent = {img.width, img.height, 1};
    ii.mipLevels = 1;
    ii.arrayLayers = 1;
    ii.samples = VK_SAMPLE_COUNT_1_BIT;
    ii.tiling = VK_IMAGE_TILING_OPTIMAL;
    ii.usage = VK_IMAGE_USAGE_SAMPLED_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;
    VK_CHECK(vkCreateImage(device_, &ii, nullptr, &t.image));
    VkMemoryRequirements mr;
    vkGetImageMemoryRequirements(device_, t.image, &mr);
    VkMemoryAllocateInfo mai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex =
        find_memory_type(mr.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    VK_CHECK(vkAllocateMemory(device_, &mai, nullptr, &t.memory));
    VK_CHECK(vkBindImageMemory(device_, t.image, t.memory, 0));

    VkDeviceSize size = VkDeviceSize(img.width) * img.height * 4;
    Buffer staging = create_buffer(size, VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                                   VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                       VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    upload_buffer(staging, img.rgba.data(), size);

    VkCommandBufferAllocateInfo ai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    ai.commandPool = cmdPool_;
    ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    ai.commandBufferCount = 1;
    VkCommandBuffer cmd;
    vkAllocateCommandBuffers(device_, &ai, &cmd);
    VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(cmd, &bi);
    VkImageMemoryBarrier bar{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    bar.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    bar.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    bar.srcQueueFamilyIndex = bar.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    bar.image = t.image;
    bar.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    bar.srcAccessMask = 0;
    bar.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                         VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0,
                         nullptr, 1, &bar);
    VkBufferImageCopy region{};
    region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    region.imageExtent = {img.width, img.height, 1};
    vkCmdCopyBufferToImage(cmd, staging.buffer, t.image,
                           VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &region);
    bar.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    bar.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    bar.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    bar.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                         VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 0, 0, nullptr,
                         0, nullptr, 1, &bar);
    vkEndCommandBuffer(cmd);
    VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    si.commandBufferCount = 1;
    si.pCommandBuffers = &cmd;
    vkQueueSubmit(queue_, 1, &si, VK_NULL_HANDLE);
    vkQueueWaitIdle(queue_);
    vkFreeCommandBuffers(device_, cmdPool_, 1, &cmd);
    vkDestroyBuffer(device_, staging.buffer, nullptr);
    vkFreeMemory(device_, staging.memory, nullptr);

    VkImageViewCreateInfo vi{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    vi.image = t.image;
    vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vi.format = format;
    vi.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    VK_CHECK(vkCreateImageView(device_, &vi, nullptr, &t.view));
    return t;
}

void VulkanEngine::load_mesh(const std::vector<Vertex>& vertices,
                             const std::vector<uint32_t>& indices) {
    vertexBuffer_ = create_buffer(
        vertices.size() * sizeof(Vertex),
        VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
            VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    upload_buffer(vertexBuffer_, vertices.data(),
                  vertices.size() * sizeof(Vertex));
    indexBuffer_ = create_buffer(
        indices.size() * sizeof(uint32_t), VK_BUFFER_USAGE_INDEX_BUFFER_BIT,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
            VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    upload_buffer(indexBuffer_, indices.data(),
                  indices.size() * sizeof(uint32_t));
    indexCount_ = uint32_t(indices.size());
}

void VulkanEngine::load_textures(const FabricTextures& tex) {
    texAlbedo_ = create_texture(tex.albedo, VK_FORMAT_R8G8B8A8_UNORM);
    texNormal_ = create_texture(tex.normal, VK_FORMAT_R8G8B8A8_UNORM);
    texTangent_ = create_texture(tex.tangent, VK_FORMAT_R8G8B8A8_UNORM);

    VkSamplerCreateInfo s{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
    s.magFilter = s.minFilter = VK_FILTER_LINEAR;
    s.addressModeU = s.addressModeV = s.addressModeW =
        VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    s.anisotropyEnable = VK_TRUE;
    s.maxAnisotropy = 8.f;
    s.borderColor = VK_BORDER_COLOR_INT_OPAQUE_BLACK;
    VK_CHECK(vkCreateSampler(device_, &s, nullptr, &sampler_));
    create_descriptors();
}

void VulkanEngine::create_descriptors() {
    VkDescriptorSetLayoutBinding b[3]{};
    for (uint32_t i = 0; i < 3; ++i) {
        b[i].binding = i;
        b[i].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        b[i].descriptorCount = 1;
        b[i].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    }
    VkDescriptorSetLayoutCreateInfo dsl{
        VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    dsl.bindingCount = 3;
    dsl.pBindings = b;
    VK_CHECK(vkCreateDescriptorSetLayout(device_, &dsl, nullptr, &dsl_));

    VkDescriptorPoolSize ps{VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 3};
    VkDescriptorPoolCreateInfo dp{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    dp.maxSets = 1;
    dp.poolSizeCount = 1;
    dp.pPoolSizes = &ps;
    VK_CHECK(vkCreateDescriptorPool(device_, &dp, nullptr, &descPool_));
    VkDescriptorSetAllocateInfo ai{
        VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    ai.descriptorPool = descPool_;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &dsl_;
    VK_CHECK(vkAllocateDescriptorSets(device_, &ai, &descSet_));

    VkDescriptorImageInfo ii[3] = {
        {sampler_, texAlbedo_.view, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL},
        {sampler_, texNormal_.view, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL},
        {sampler_, texTangent_.view, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL}};
    VkWriteDescriptorSet w[3]{};
    for (uint32_t i = 0; i < 3; ++i) {
        w[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        w[i].dstSet = descSet_;
        w[i].dstBinding = i;
        w[i].descriptorCount = 1;
        w[i].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        w[i].pImageInfo = &ii[i];
    }
    vkUpdateDescriptorSets(device_, 3, w, 0, nullptr);
}

void VulkanEngine::load_spirv(const std::string& vert_path,
                              const std::string& frag_path) {
    vertModule_ = make_module(device_, read_file(vert_path));
    fragModule_ = make_module(device_, read_file(frag_path));

    VkPushConstantRange range{VK_SHADER_STAGE_VERTEX_BIT |
                                  VK_SHADER_STAGE_FRAGMENT_BIT,
                              0, sizeof(PushConstants)};
    VkPipelineLayoutCreateInfo pli{
        VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    pli.setLayoutCount = 1;
    pli.pSetLayouts = &dsl_;
    pli.pushConstantRangeCount = 1;
    pli.pPushConstantRanges = &range;
    VK_CHECK(vkCreatePipelineLayout(device_, &pli, nullptr, &pipeLayout_));

    VkPipelineShaderStageCreateInfo stages[2]{
        {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,
         .stage = VK_SHADER_STAGE_VERTEX_BIT,
         .module = vertModule_,
         .pName = "main"},
        {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,
         .stage = VK_SHADER_STAGE_FRAGMENT_BIT,
         .module = fragModule_,
         .pName = "main"}};
    VkVertexInputBindingDescription bind{0, sizeof(Vertex),
                                         VK_VERTEX_INPUT_RATE_VERTEX};
    VkVertexInputAttributeDescription attr[4]{
        {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(Vertex, pos)},
        {1, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(Vertex, normal)},
        {2, 0, VK_FORMAT_R32G32_SFLOAT, offsetof(Vertex, uv)},
        {3, 0, VK_FORMAT_R32G32B32A32_SFLOAT, offsetof(Vertex, tangent)}};
    VkPipelineVertexInputStateCreateInfo vi{
        VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
    vi.vertexBindingDescriptionCount = 1;
    vi.pVertexBindingDescriptions = &bind;
    vi.vertexAttributeDescriptionCount = 4;
    vi.pVertexAttributeDescriptions = attr;
    VkPipelineInputAssemblyStateCreateInfo ia{
        VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
    ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
    VkViewport viewport{0, 0, float(width_), float(height_), 0, 1};
    VkRect2D scissor{{0, 0}, {width_, height_}};
    VkPipelineViewportStateCreateInfo vp{
        VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
    vp.viewportCount = 1;
    vp.pViewports = &viewport;
    vp.scissorCount = 1;
    vp.pScissors = &scissor;
    VkPipelineRasterizationStateCreateInfo rs{
        VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode = VK_CULL_MODE_NONE;
    rs.lineWidth = 1.f;
    VkPipelineMultisampleStateCreateInfo ms{
        VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
    ms.sampleShadingEnable = VK_FALSE;
    ms.minSampleShading = 1.f;
    VkPipelineColorBlendAttachmentState cb{};
    cb.blendEnable = VK_FALSE;
    cb.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                        VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    VkPipelineColorBlendStateCreateInfo cbs{
        VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
    cbs.attachmentCount = 1;
    cbs.pAttachments = &cb;
    VkDynamicState dyn[2]{VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo ds{
        VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO};
    ds.dynamicStateCount = 2;
    ds.pDynamicStates = dyn;
    VkGraphicsPipelineCreateInfo pci{
        VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
    pci.stageCount = 2;
    pci.pStages = stages;
    pci.pVertexInputState = &vi;
    pci.pInputAssemblyState = &ia;
    pci.pViewportState = &vp;
    pci.pRasterizationState = &rs;
    pci.pMultisampleState = &ms;
    pci.pColorBlendState = &cbs;
    pci.pDynamicState = &ds;
    pci.layout = pipeLayout_;
    pci.renderPass = renderPass_;
    VK_CHECK(vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &pci,
                                       nullptr, &pipeline_));
}

void VulkanEngine::begin_classic(VkCommandBuffer cmd) {
    VkClearValue clear{{{0.05f, 0.05f, 0.07f, 1.f}}};
    VkRenderPassBeginInfo bi{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    bi.renderPass = renderPass_;
    bi.framebuffer = framebuffer_;
    bi.renderArea = {{0, 0}, {width_, height_}};
    bi.clearValueCount = 1;
    bi.pClearValues = &clear;
    vkCmdBeginRenderPass(cmd, &bi, VK_SUBPASS_CONTENTS_INLINE);
}

ImageData VulkanEngine::readback() {
    void* mapped;
    VK_CHECK(vkMapMemory(device_, colorMem_, 0, VK_WHOLE_SIZE, 0, &mapped));
    ImageData out;
    out.width = width_;
    out.height = height_;
    out.rgba.resize(size_t(width_) * height_ * 4);
    auto* src = static_cast<const uint8_t*>(mapped);
    for (uint32_t y = 0; y < height_; ++y)
        std::memcpy(out.rgba.data() + size_t(y) * width_ * 4,
                    src + y * alignedPitch_, width_ * 4);
    vkUnmapMemory(device_, colorMem_);
    return out;
}

ImageData VulkanEngine::render_frame(const PushConstants& pc) {
    VkCommandBufferAllocateInfo ai{
        VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    ai.commandPool = cmdPool_;
    ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    ai.commandBufferCount = 1;
    VkCommandBuffer cmd;
    vkAllocateCommandBuffers(device_, &ai, &cmd);
    VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(cmd, &bi);

    begin_classic(cmd);
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);
    VkDeviceSize off = 0;
    vkCmdBindVertexBuffers(cmd, 0, 1, &vertexBuffer_.buffer, &off);
    vkCmdBindIndexBuffer(cmd, indexBuffer_.buffer, 0, VK_INDEX_TYPE_UINT32);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                            pipeLayout_, 0, 1, &descSet_, 0, nullptr);
    vkCmdPushConstants(cmd, pipeLayout_,
                       VK_SHADER_STAGE_VERTEX_BIT |
                           VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(PushConstants), &pc);
    VkViewport vp{0, 0, float(width_), float(height_), 0, 1};
    VkRect2D sc{{0, 0}, {width_, height_}};
    vkCmdSetViewport(cmd, 0, 1, &vp);
    vkCmdSetScissor(cmd, 0, 1, &sc);
    vkCmdDrawIndexed(cmd, indexCount_, 1, 0, 0, 0);
    vkCmdEndRenderPass(cmd);

    VkImageMemoryBarrier toGeneral{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    toGeneral.image = colorImage_;
    toGeneral.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    toGeneral.srcQueueFamilyIndex = toGeneral.dstQueueFamilyIndex =
        VK_QUEUE_FAMILY_IGNORED;
    toGeneral.oldLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    toGeneral.newLayout = VK_IMAGE_LAYOUT_GENERAL;
    toGeneral.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    toGeneral.dstAccessMask = VK_ACCESS_MEMORY_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
                         VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0,
                         nullptr, 1, &toGeneral);
    vkEndCommandBuffer(cmd);
    VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    si.commandBufferCount = 1;
    si.pCommandBuffers = &cmd;
    vkQueueSubmit(queue_, 1, &si, VK_NULL_HANDLE);
    vkQueueWaitIdle(queue_);
    vkFreeCommandBuffers(device_, cmdPool_, 1, &cmd);
    return readback();
}

bool VulkanEngine::should_close() const {
#ifdef HAVE_GLFW
    return window_ && glfwWindowShouldClose(window_);
#else
    return false;
#endif
}

void VulkanEngine::poll_events() {
#ifdef HAVE_GLFW
    if (window_) glfwPollEvents();
#endif
}
