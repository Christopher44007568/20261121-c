#pragma once
#include "common.hpp"

class VulkanEngine {
public:
    VulkanEngine(bool headless, uint32_t width, uint32_t height);
    ~VulkanEngine();

    void load_mesh(const std::vector<Vertex>& vertices,
                   const std::vector<uint32_t>& indices);
    void load_textures(const FabricTextures& tex);
    void load_spirv(const std::string& vert_path, const std::string& frag_path);

    // Render one frame with the given push constants; returns tone-mapped RGBA.
    ImageData render_frame(const PushConstants& pc);

    bool has_window() const { return window_ != nullptr; }
    bool should_close() const;
    void poll_events();

private:
    struct Buffer {
        VkBuffer buffer = VK_NULL_HANDLE;
        VkDeviceMemory memory = VK_NULL_HANDLE;
        VkDeviceSize size = 0;
    };
    struct Texture {
        VkImage image = VK_NULL_HANDLE;
        VkDeviceMemory memory = VK_NULL_HANDLE;
        VkImageView view = VK_NULL_HANDLE;
    };

    void create_instance();
    void select_physical_device();
    void create_device();
    void create_swapchain_or_target();
    uint32_t find_memory_type(uint32_t typeBits, VkMemoryPropertyFlags props);
    Buffer create_buffer(VkDeviceSize size, VkBufferUsageFlags usage,
                         VkMemoryPropertyFlags props);
    void upload_buffer(Buffer& dst, const void* data, VkDeviceSize size);
    Texture create_texture(const ImageData& img, VkFormat format);
    void create_descriptors();
    void create_pipeline();
    ImageData readback();
    void begin_classic(VkCommandBuffer cmd);

    bool headless_;
    uint32_t width_, height_;

    VkInstance instance_ = VK_NULL_HANDLE;
    VkPhysicalDevice physical_ = VK_NULL_HANDLE;
    VkDevice device_ = VK_NULL_HANDLE;
    VkQueue queue_ = VK_NULL_HANDLE;
    uint32_t queueFamily_ = 0;
    VkCommandPool cmdPool_ = VK_NULL_HANDLE;
    VkSurfaceKHR surface_ = VK_NULL_HANDLE;

    VkImage colorImage_ = VK_NULL_HANDLE;
    VkDeviceMemory colorMem_ = VK_NULL_HANDLE;
    VkImageView colorView_ = VK_NULL_HANDLE;
    VkDeviceSize alignedPitch_ = 0;

    Buffer vertexBuffer_, indexBuffer_;
    uint32_t indexCount_ = 0;
    Texture texAlbedo_, texNormal_, texTangent_;
    VkSampler sampler_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout dsl_ = VK_NULL_HANDLE;
    VkPipelineLayout pipeLayout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet descSet_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;

    VkShaderModule vertModule_ = VK_NULL_HANDLE;
    VkShaderModule fragModule_ = VK_NULL_HANDLE;
    VkRenderPass renderPass_ = VK_NULL_HANDLE;
    VkFramebuffer framebuffer_ = VK_NULL_HANDLE;

    struct GLFWwindow* window_ = nullptr;
};
