use std::collections::HashMap;

use anyhow::{Context, Result};
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::view::OrbitView;

pub const SHARED_TEXTURE_SIZE: u32 = 1024;
pub const SHARED_TEXTURE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct PreviewUniforms {
    viewport: [f32; 4],
    camera: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct WindowUniforms {
    pub viewport: [f32; 4],
    pub frame: [f32; 4],
}

pub struct SharedTexture {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub size: u32,
    pub generation: u64,
}

pub struct GpuContext {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub adapter_summary: String,
    pub shared: SharedTexture,
    pub sampler: wgpu::Sampler,
    pub present_bind_group_layout: wgpu::BindGroupLayout,
    preview_pipeline: wgpu::RenderPipeline,
    preview_uniform_buffer: wgpu::Buffer,
    preview_bind_group: wgpu::BindGroup,
    present_pipelines: HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>,
}

impl GpuContext {
    pub fn initialize(
        instance: wgpu::Instance,
        compatible_surface: Option<&wgpu::Surface<'_>>,
    ) -> Result<Self> {
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface,
            apply_limit_buckets: false,
        }))
        .context("no compatible wgpu adapter")?;

        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("material-inspector-device"),
            ..Default::default()
        }))
        .context("could not create wgpu device")?;

        device.on_uncaptured_error(std::sync::Arc::new(|error| {
            log::error!("gpu_uncaptured_error error={error}");
        }));

        let adapter_info = adapter.get_info();
        let adapter_summary = format!(
            "{} ({:?}, {:?})",
            adapter_info.name, adapter_info.backend, adapter_info.device_type
        );

        let shader = device.create_shader_module(wgpu::include_wgsl!("shader.wgsl"));
        let shared = create_shared_texture(&device, 1);

        let preview_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("shared-preview-uniforms"),
            size: std::mem::size_of::<PreviewUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let preview_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("shared-preview-layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let preview_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("shared-preview-bind-group"),
            layout: &preview_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: preview_uniform_buffer.as_entire_binding(),
            }],
        });
        let preview_pipeline =
            create_preview_pipeline(&device, &shader, &preview_bind_group_layout);

        let present_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("shared-present-layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                ],
            });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("shared-texture-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });

        log::info!(
            "gpu_ready adapter={} shared_texture={}x{} format={:?}",
            adapter_summary,
            SHARED_TEXTURE_SIZE,
            SHARED_TEXTURE_SIZE,
            SHARED_TEXTURE_FORMAT
        );

        Ok(Self {
            instance,
            adapter,
            device,
            queue,
            adapter_summary,
            shared,
            sampler,
            present_bind_group_layout,
            preview_pipeline,
            preview_uniform_buffer,
            preview_bind_group,
            present_pipelines: HashMap::new(),
        })
    }

    pub fn render_shared(&self, view: &OrbitView, time_seconds: f32) -> Result<()> {
        let uniforms = PreviewUniforms {
            viewport: [
                self.shared.size as f32,
                self.shared.size as f32,
                time_seconds,
                view.exposure,
            ],
            camera: [view.yaw, view.pitch, view.distance, view.material as f32],
        };
        self.queue.write_buffer(
            &self.preview_uniform_buffer,
            0,
            bytemuck::bytes_of(&uniforms),
        );

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("shared-material-encoder"),
            });
        {
            let attachment = Some(wgpu::RenderPassColorAttachment {
                view: &self.shared.view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: 0.004,
                        g: 0.008,
                        b: 0.014,
                        a: 1.0,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            });
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("shared-material-pass"),
                color_attachments: &[attachment],
                ..Default::default()
            });
            pass.set_pipeline(&self.preview_pipeline);
            pass.set_bind_group(0, &self.preview_bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit(Some(encoder.finish()));
        Ok(())
    }

    pub fn present_pipeline(&mut self, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        if let Some(pipeline) = self.present_pipelines.get(&format) {
            return pipeline.clone();
        }
        let shader = self
            .device
            .create_shader_module(wgpu::include_wgsl!("shader.wgsl"));
        let pipeline = create_present_pipeline(
            &self.device,
            &shader,
            &self.present_bind_group_layout,
            format,
        );
        log::info!("gpu_pipeline_created kind=present format={format:?}");
        self.present_pipelines.insert(format, pipeline.clone());
        pipeline
    }

    pub fn create_window_bind_group(&self, label: &str, buffer: &wgpu::Buffer) -> wgpu::BindGroup {
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(label),
            layout: &self.present_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&self.shared.view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: buffer.as_entire_binding(),
                },
            ],
        })
    }

    pub fn create_present_uniform_buffer(&self, label: &str) -> wgpu::Buffer {
        self.device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytemuck::bytes_of(&WindowUniforms {
                    viewport: [1.0, 1.0, 0.0, 0.0],
                    frame: [0.0, 0.0, 0.0, 0.0],
                }),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            })
    }
}

fn create_shared_texture(device: &wgpu::Device, generation: u64) -> SharedTexture {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("shared-material-texture"),
        size: wgpu::Extent3d {
            width: SHARED_TEXTURE_SIZE,
            height: SHARED_TEXTURE_SIZE,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: SHARED_TEXTURE_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    log::info!(
        "gpu_resource event=shared_texture_create generation={} size={}x{} format={:?} usage=render_attachment|texture_binding|copy_src",
        generation,
        SHARED_TEXTURE_SIZE,
        SHARED_TEXTURE_SIZE,
        SHARED_TEXTURE_FORMAT
    );
    SharedTexture {
        texture,
        view,
        size: SHARED_TEXTURE_SIZE,
        generation,
    }
}

fn create_preview_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    bind_group_layout: &wgpu::BindGroupLayout,
) -> wgpu::RenderPipeline {
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("shared-preview-pipeline-layout"),
        bind_group_layouts: &[Some(bind_group_layout)],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("shared-preview-pipeline"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("fullscreen_vertex"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("preview_fragment"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: SHARED_TEXTURE_FORMAT,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

fn create_present_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    bind_group_layout: &wgpu::BindGroupLayout,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("shared-present-pipeline-layout"),
        bind_group_layouts: &[Some(bind_group_layout)],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("shared-present-pipeline"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("fullscreen_vertex"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("present_fragment"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}
