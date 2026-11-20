//! wgpu 工业管网视图：10 万段管道实例化渲染。
//! - 数据更新走稳定 ID 的局部脏区间上传（见 pipe-core）
//! - 每帧 CPU 视锥裁剪 → 可见实例流式上传 → 拾取共享同一可见集
//! - 左键拖拽旋转 / 滚轮缩放 / 点击拾取高亮
mod camera;
mod mesh;
mod sim;

use pipe_core::cull::cull;
use pipe_core::pick::{pick_visible, ray_from_camera};
use pipe_core::store::{GpuInstance, InstanceStore, PipeId, INSTANCE_SIZE};
use std::sync::Arc;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::{Window, WindowId};

use camera::Camera;

const MAX_INSTANCES: u64 = 120_000;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniform {
    vp: [[f32; 4]; 4],
    eye: [f32; 4],
    highlight: u32,
    pad: [u32; 3],
}

struct Gfx {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    mesh_vb: wgpu::Buffer,
    mesh_ib: wgpu::Buffer,
    mesh_index_count: u32,
    inst_buf: wgpu::Buffer, // 每帧可见实例的流式缓冲
    uniform_buf: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    depth: wgpu::TextureView,
}

struct App {
    window: Option<Arc<Window>>,
    gfx: Option<Gfx>,
    store: InstanceStore,
    camera: Camera,
    visible: Vec<u32>,
    highlight: Option<PipeId>,
    cursor: (f64, f64),
    drag_from: Option<(f64, f64)>,
    frame: u64,
}

impl App {
    fn new() -> Self {
        let pipes = sim::gen_pipes(100_000);
        let mut store = InstanceStore::new(MAX_INSTANCES as usize);
        store.apply(&pipe_core::store::Batch {
            upserts: pipes,
            removes: vec![],
        });
        let (stats, _) = store.flush_dirty(); // 初始全量上传在 GPU 侧重建
        log::info!("初始加载: {} 段, 上传 {} B", stats.instances, stats.bytes);
        App {
            window: None,
            gfx: None,
            store,
            camera: Camera::default(),
            visible: Vec::new(),
            highlight: None,
            cursor: (0.0, 0.0),
            drag_from: None,
            frame: 0,
        }
    }

    fn init_gfx(&mut self, window: Arc<Window>) {
        let size = window.inner_size();
        let instance = wgpu::Instance::default();
        let surface = instance.create_surface(window.clone()).unwrap();
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            compatible_surface: Some(&surface),
            ..Default::default()
        }))
        .expect("no adapter");
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default()))
            .expect("no device");
        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats.iter().find(|f| f.is_srgb()).copied().unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("pipe"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let uniform_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniform"),
            size: std::mem::size_of::<Uniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buf.as_entire_binding(),
            }],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&bgl],
            push_constant_ranges: &[],
        });
        let mesh_buffers = [
            wgpu::VertexBufferLayout {
                array_stride: 24,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
            },
            wgpu::VertexBufferLayout {
                array_stride: INSTANCE_SIZE,
                step_mode: wgpu::VertexStepMode::Instance,
                attributes: &wgpu::vertex_attr_array![2 => Float32x4, 3 => Float32x4],
            },
        ];
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("pipe"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &mesh_buffers,
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });

        let (verts, indices) = mesh::cylinder(12);
        let mesh_vb = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("mesh_vb"),
            size: (verts.len() * 4) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&mesh_vb, 0, bytemuck::cast_slice(&verts));
        let mesh_ib = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("mesh_ib"),
            size: (indices.len() * 4) as u64,
            usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&mesh_ib, 0, bytemuck::cast_slice(&indices));
        let inst_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("instances"),
            size: MAX_INSTANCES * INSTANCE_SIZE,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let depth = make_depth(&device, config.width, config.height);
        self.gfx = Some(Gfx {
            surface, device, queue, config, pipeline,
            mesh_vb, mesh_ib,
            mesh_index_count: indices.len() as u32,
            inst_buf, uniform_buf, bind_group, depth,
        });
    }

    fn render(&mut self) {
        self.frame += 1;
        // 模拟后端推送：每 150 帧一批小更新（移动 100 / 删除 50 / 新增 50）。
        if self.frame % 150 == 0 {
            let batch = sim::random_batch(&self.store, self.frame);
            self.store.apply(&batch);
            let (stats, ranges) = self.store.flush_dirty();
            log::info!(
                "后端批次: +{}/-{} → {} 区间 {} B ({} 段)",
                batch.upserts.len(), batch.removes.len(),
                stats.ranges, stats.bytes, stats.instances
            );
            let _ = ranges; // 持久缓冲已省略：可见集每帧重建（见下）
        }

        let Some(gfx) = &self.gfx else { return };
        let aspect = gfx.config.width as f32 / gfx.config.height.max(1) as f32;
        let (vp, eye, ..) = self.camera.matrices(aspect);

        // 视锥裁剪 → 可见槽位；拾取与渲染共享这一集合。
        let frustum = pipe_core::Frustum::from_view_proj(&vp);
        self.visible = cull(&self.store, &frustum);

        // 流式上传可见实例（渲染侧每帧只写可见子集）。
        let gathered: Vec<GpuInstance> = self
            .visible
            .iter()
            .map(|&s| self.store.instances()[s as usize])
            .collect();
        gfx.queue
            .write_buffer(&gfx.inst_buf, 0, bytemuck::cast_slice(&gathered));

        let uniform = Uniform {
            vp: vp.0,
            eye: [eye[0], eye[1], eye[2], 1.0],
            highlight: self.highlight.map(|p| p.0).unwrap_or(u32::MAX),
            pad: [0; 3],
        };
        gfx.queue
            .write_buffer(&gfx.uniform_buf, 0, bytemuck::bytes_of(&uniform));

        let frame = match gfx.surface.get_current_texture() {
            Ok(f) => f,
            Err(_) => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let mut enc = gfx.device.create_command_encoder(&Default::default());
        {
            let mut rp = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("main"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.07, g: 0.08, b: 0.1, a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &gfx.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            rp.set_pipeline(&gfx.pipeline);
            rp.set_bind_group(0, &gfx.bind_group, &[]);
            rp.set_vertex_buffer(0, gfx.mesh_vb.slice(..));
            rp.set_vertex_buffer(1, gfx.inst_buf.slice(..));
            rp.set_index_buffer(gfx.mesh_ib.slice(..), wgpu::IndexFormat::Uint32);
            rp.draw_indexed(0..gfx.mesh_index_count, 0, 0..gathered.len() as u32);
        }
        gfx.queue.submit([enc.finish()]);
        frame.present();

        if self.frame % 300 == 0 {
            log::info!(
                "帧 {}: 可见 {}/{} 段",
                self.frame,
                self.visible.len(),
                self.store.len()
            );
        }
    }

    fn pick_at(&mut self, x: f64, y: f64) {
        let Some(gfx) = &self.gfx else { return };
        let (w, h) = (gfx.config.width as f64, gfx.config.height as f64);
        let aspect = gfx.config.width as f32 / gfx.config.height.max(1) as f32;
        let (_, eye, fwd, right, up, tan_h) = self.camera.matrices(aspect);
        let ndc_x = (x / w * 2.0 - 1.0) as f32;
        let ndc_y = (1.0 - y / h * 2.0) as f32;
        let ray = ray_from_camera(eye, fwd, right, up, tan_h, aspect, ndc_x, ndc_y);
        // 关键：只在当前帧的可见集上拾取，裁掉的管道不会被误中。
        self.highlight = pick_visible(&self.store, &self.visible, &ray).map(|h| h.id);
        if let Some(id) = self.highlight {
            log::info!("拾取: PipeId({}) 槽位 {:?}", id.0, self.store.slot_of(id));
        }
    }
}

fn make_depth(device: &wgpu::Device, w: u32, h: u32) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("depth"),
            size: wgpu::Extent3d {
                width: w.max(1),
                height: h.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth24Plus,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
        .create_view(&Default::default())
}

impl ApplicationHandler for App {
    fn resumed(&mut self, el: &ActiveEventLoop) {
        if self.window.is_none() {
            let win = Arc::new(
                el.create_window(
                    Window::default_attributes()
                        .with_title("工业管网 · 10万段实例化渲染")
                        .with_inner_size(winit::dpi::LogicalSize::new(1280, 720)),
                )
                .unwrap(),
            );
            self.init_gfx(win.clone());
            self.window = Some(win);
        }
    }

    fn window_event(&mut self, el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => el.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gfx) = &mut self.gfx {
                    gfx.config.width = size.width.max(1);
                    gfx.config.height = size.height.max(1);
                    gfx.surface.configure(&gfx.device, &gfx.config);
                    gfx.depth = make_depth(&gfx.device, size.width, size.height);
                }
            }
            WindowEvent::RedrawRequested => self.render(),
            WindowEvent::MouseInput { state, button, .. } => {
                if button == MouseButton::Left {
                    match state {
                        ElementState::Pressed => self.drag_from = Some(self.cursor),
                        ElementState::Released => {
                            if let Some((px, py)) = self.drag_from.take() {
                                let (x, y) = self.cursor;
                                if (x - px).abs() < 4.0 && (y - py).abs() < 4.0 {
                                    self.pick_at(x, y);
                                }
                            }
                        }
                    }
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                if self.drag_from.is_some() {
                    let (px, py) = self.cursor;
                    self.camera.orbit(
                        (position.x - px) as f32 * 0.005,
                        (position.y - py) as f32 * 0.005,
                    );
                }
                self.cursor = (position.x, position.y);
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let d = match delta {
                    winit::event::MouseScrollDelta::LineDelta(_, y) => y,
                    winit::event::MouseScrollDelta::PixelDelta(p) => p.y as f32 * 0.05,
                };
                self.camera.zoom(d);
            }
            _ => {}
        }
        if let Some(w) = &self.window {
            w.request_redraw();
        }
    }
}

fn main() {
    env_logger::init();
    let el = EventLoop::new().unwrap();
    el.set_control_flow(ControlFlow::Poll);
    el.run_app(&mut App::new()).unwrap();
}
