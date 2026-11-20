use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde::Serialize;
use winit::application::ApplicationHandler;
use winit::dpi::{PhysicalPosition, PhysicalSize};
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowId};

use crate::auto::{AutoAction, AutoSequence, AutoStep, WindowSlot};
use crate::gpu::{GpuContext, WindowUniforms};
use crate::persist::{Persistence, UserView};
use crate::resource_log::{default_gpu_log_path, default_report_path, GpuResourceLog};

const AUTO_FRAME_INTERVAL: Duration = Duration::from_millis(16);
const SAVE_DEBOUNCE: Duration = Duration::from_millis(350);

#[derive(Debug, Clone)]
pub struct AppOptions {
    pub auto_sequence: bool,
    pub exit_after_sequence: bool,
    pub config_path: Option<PathBuf>,
    pub report_path: Option<PathBuf>,
    pub gpu_log_path: Option<PathBuf>,
}

struct WindowState {
    slot: WindowSlot,
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    size: PhysicalSize<u32>,
    minimized: bool,
    occluded: bool,
    config_dirty: bool,
    injected_loss: bool,
    frames_presented: u64,
    recoveries: u64,
    configure_generation: u64,
    skips_since_log: u32,
}

impl WindowState {
    fn new(
        slot: WindowSlot,
        window: Arc<Window>,
        surface: wgpu::Surface<'static>,
        gpu: &mut GpuContext,
        size: PhysicalSize<u32>,
        log: &mut GpuResourceLog,
    ) -> Result<Self> {
        let size = safe_size(size);
        let config = surface_config(gpu, &surface, size.width, size.height)?;
        let pipeline = gpu.present_pipeline(config.format);
        let uniform_buffer =
            gpu.create_present_uniform_buffer(&format!("{}-window-uniforms", slot.label()));
        let bind_group = gpu.create_window_bind_group(
            &format!("{}-present-bind-group", slot.label()),
            &uniform_buffer,
        );
        let mut state = Self {
            slot,
            window,
            surface,
            config,
            pipeline,
            uniform_buffer,
            bind_group,
            size,
            minimized: false,
            occluded: false,
            config_dirty: false,
            injected_loss: false,
            frames_presented: 0,
            recoveries: 0,
            configure_generation: 0,
            skips_since_log: 0,
        };
        state.configure(gpu, log, "initial");
        Ok(state)
    }

    fn configure(&mut self, gpu: &mut GpuContext, log: &mut GpuResourceLog, reason: &str) {
        let size = safe_size(self.size);
        match surface_config(gpu, &self.surface, size.width, size.height) {
            Ok(config) => {
                self.pipeline = gpu.present_pipeline(config.format);
                self.surface.configure(&gpu.device, &config);
                self.config = config;
                self.config_dirty = false;
                self.configure_generation += 1;
                log.info(format!(
                    "gpu_resource event=surface_configure window={} reason={} generation={} size={}x{} format={:?} present_mode={:?}",
                    self.slot.label(),
                    reason,
                    self.configure_generation,
                    self.config.width,
                    self.config.height,
                    self.config.format,
                    self.config.present_mode
                ));
            }
            Err(error) => log.error(format!(
                "gpu_resource event=surface_configure_failed window={} reason={} error={error:#}",
                self.slot.label(),
                reason
            )),
        }
    }

    fn recreate_surface(&mut self, gpu: &mut GpuContext, log: &mut GpuResourceLog, reason: &str) {
        log.warn(format!(
            "gpu_resource event=surface_recreate window={} reason={} old_generation={} frames={}",
            self.slot.label(),
            reason,
            self.configure_generation,
            self.frames_presented
        ));
        match gpu.instance.create_surface(self.window.clone()) {
            Ok(surface) => {
                self.surface = surface;
                self.recoveries += 1;
                self.configure(gpu, log, reason);
            }
            Err(error) => log.error(format!(
                "gpu_resource event=surface_recreate_failed window={} error={error}",
                self.slot.label()
            )),
        }
    }

    fn resize(&mut self, size: PhysicalSize<u32>, log: &mut GpuResourceLog) {
        let size = safe_size(size);
        if size == self.size {
            return;
        }
        log.info(format!(
            "gpu_resource event=surface_resize window={} old={}x{} new={}x{} action=defer_until_render",
            self.slot.label(),
            self.size.width,
            self.size.height,
            size.width,
            size.height
        ));
        self.size = size;
        self.config_dirty = true;
    }

    fn render(
        &mut self,
        gpu: &GpuContext,
        frame_index: u64,
        material_name: &str,
        log: &mut GpuResourceLog,
    ) -> WindowFrame {
        if self.minimized {
            self.note_skip(log, "minimized");
            return WindowFrame::Skipped;
        }
        if self.occluded {
            self.note_skip(log, "occluded");
            return WindowFrame::Skipped;
        }
        self.skips_since_log = 0;

        let uniforms = WindowUniforms {
            viewport: [
                self.config.width as f32,
                self.config.height as f32,
                0.0,
                0.0,
            ],
            frame: [
                if self.slot == WindowSlot::Main {
                    1.0
                } else {
                    0.0
                },
                0.0,
                0.0,
                0.0,
            ],
        };
        gpu.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

        let acquired = self.surface.get_current_texture();
        let surface_texture = match acquired {
            wgpu::CurrentSurfaceTexture::Success(texture) => texture,
            wgpu::CurrentSurfaceTexture::Suboptimal(texture) => {
                log.warn(format!(
                    "gpu_resource event=surface_suboptimal window={} size={}x{} action=present_then_reconfigure",
                    self.slot.label(),
                    self.config.width,
                    self.config.height
                ));
                self.config_dirty = true;
                texture
            }
            wgpu::CurrentSurfaceTexture::Timeout => {
                self.note_skip(log, "acquire_timeout");
                return WindowFrame::Skipped;
            }
            wgpu::CurrentSurfaceTexture::Occluded => {
                self.occluded = true;
                self.note_skip(log, "surface_occluded");
                return WindowFrame::Skipped;
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                log.warn(format!(
                    "gpu_resource event=surface_lost window={} kind=outdated recovery=survives",
                    self.slot.label()
                ));
                return WindowFrame::Issue(SurfaceIssue::Outdated);
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                log.warn(format!(
                    "gpu_resource event=surface_lost window={} kind=lost recovery=recreate_surface",
                    self.slot.label()
                ));
                return WindowFrame::Issue(SurfaceIssue::Lost);
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                log.error(format!(
                    "gpu_resource event=surface_validation_error window={} recovery=recreate_surface",
                    self.slot.label()
                ));
                return WindowFrame::Issue(SurfaceIssue::Validation);
            }
        };

        let view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("present-encoder"),
            });
        {
            let attachment = Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            });
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("present-shared-texture-pass"),
                color_attachments: &[attachment],
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        gpu.queue.submit(Some(encoder.finish()));
        gpu.queue.present(surface_texture);

        self.frames_presented += 1;
        self.window.set_title(&window_title(
            self.slot,
            material_name,
            self.frames_presented,
            self.config.width,
            self.config.height,
            frame_index,
        ));
        WindowFrame::Presented
    }

    fn note_skip(&mut self, log: &mut GpuResourceLog, reason: &str) {
        self.skips_since_log += 1;
        if self.skips_since_log == 1 || self.skips_since_log % 60 == 0 {
            log.info(format!(
                "gpu_resource event=frame_skip window={} reason={} frames={}",
                self.slot.label(),
                reason,
                self.frames_presented
            ));
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SurfaceIssue {
    Injected,
    Outdated,
    Lost,
    Validation,
}

enum WindowFrame {
    Presented,
    Skipped,
    Issue(SurfaceIssue),
}

#[derive(Debug, Clone, Serialize)]
struct InvalidationEvidence {
    window: WindowSlot,
    other_window: WindowSlot,
    reason: String,
    frame_at_fault: u64,
    other_frames_at_fault: u64,
    other_frames_at_probe: u64,
    other_frames_advanced: u64,
    recovered: bool,
    other_continued_rendering: bool,
}

#[derive(Debug, Clone)]
struct PendingFault {
    window: WindowSlot,
    reason: String,
    frame_at_fault: u64,
    other_frames_at_fault: u64,
    recoveries_at_fault: u64,
}

#[derive(Debug, Serialize)]
struct AutoReport {
    sequence: &'static str,
    status: &'static str,
    adapter: String,
    shared_texture_size: u32,
    shared_texture_generation: u64,
    main_frames: u64,
    thumbnail_frames: u64,
    main_recoveries: u64,
    thumbnail_recoveries: u64,
    minimized_and_restored: bool,
    invalidations: Vec<InvalidationEvidence>,
    view_path: String,
    gpu_log_path: String,
}

struct DragState {
    window_id: WindowId,
    last: Option<PhysicalPosition<f64>>,
}

pub struct InspectorApp {
    options: AppOptions,
    persistence: Persistence,
    view: UserView,
    windows: Vec<WindowState>,
    gpu: Option<GpuContext>,
    log: GpuResourceLog,
    auto: AutoSequence,
    auto_live: bool,
    auto_start_pending: bool,
    frame_index: u64,
    drag: Option<DragState>,
    save_due: Option<Instant>,
    minimized_and_restored: bool,
    pending_fault: Option<PendingFault>,
    evidence: Vec<InvalidationEvidence>,
    report_written: bool,
    report_path: PathBuf,
    last_status_frame: u64,
}

impl InspectorApp {
    pub fn new(options: AppOptions) -> Result<Self> {
        let config_path = options
            .config_path
            .clone()
            .unwrap_or_else(crate::persist::default_view_path);
        let persistence = Persistence::new(config_path);
        let view = persistence.load();
        let log_path = options
            .gpu_log_path
            .clone()
            .unwrap_or_else(default_gpu_log_path);
        let report_path = options
            .report_path
            .clone()
            .unwrap_or_else(default_report_path);
        let mut log = GpuResourceLog::create(&log_path)
            .with_context(|| format!("could not create GPU log {}", log_path.display()))?;
        log.info(format!(
            "session_start sequence={} report={}",
            crate::auto::AUTO_SEQUENCE_VERSION,
            report_path.display()
        ));
        Ok(Self {
            auto_start_pending: options.auto_sequence,
            options,
            persistence,
            view,
            windows: Vec::new(),
            gpu: None,
            log,
            auto: AutoSequence::new(),
            auto_live: false,
            frame_index: 0,
            drag: None,
            save_due: None,
            minimized_and_restored: false,
            pending_fault: None,
            evidence: Vec::new(),
            report_written: false,
            report_path,
            last_status_frame: 0,
        })
    }

    fn initialize_windows(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        let main = &self.view.main;
        let thumbnail = &self.view.thumbnail;
        let main_attributes = Window::default_attributes()
            .with_title("Material Inspector")
            .with_inner_size(PhysicalSize::new(main.width, main.height))
            .with_position(PhysicalPosition::new(main.x, main.y))
            .with_min_inner_size(PhysicalSize::new(320, 240));
        let thumbnail_attributes = Window::default_attributes()
            .with_title("Material Inspector - Shared Thumbnail")
            .with_inner_size(PhysicalSize::new(thumbnail.width, thumbnail.height))
            .with_position(PhysicalPosition::new(thumbnail.x, thumbnail.y))
            .with_min_inner_size(PhysicalSize::new(180, 140));

        let main_window = Arc::new(
            event_loop
                .create_window(main_attributes)
                .context("could not create main window")?,
        );
        let thumbnail_window = Arc::new(
            event_loop
                .create_window(thumbnail_attributes)
                .context("could not create thumbnail window")?,
        );

        let instance =
            wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let main_surface = instance
            .create_surface(main_window.clone())
            .context("could not create main surface")?;
        let thumbnail_surface = instance
            .create_surface(thumbnail_window.clone())
            .context("could not create thumbnail surface")?;
        let mut gpu =
            GpuContext::initialize(instance, Some(&main_surface)).context("GPU initialization")?;

        let main_size = main_window.inner_size();
        let thumbnail_size = thumbnail_window.inner_size();
        let main_state = WindowState::new(
            WindowSlot::Main,
            main_window,
            main_surface,
            &mut gpu,
            main_size,
            &mut self.log,
        )?;
        let thumbnail_state = WindowState::new(
            WindowSlot::Thumbnail,
            thumbnail_window,
            thumbnail_surface,
            &mut gpu,
            thumbnail_size,
            &mut self.log,
        )?;

        gpu.render_shared(&self.view.orbit, 0.0)
            .context("initial shared texture render")?;
        main_state.window.set_title(&window_title(
            WindowSlot::Main,
            self.view.orbit.material_name(),
            0,
            main_size.width,
            main_size.height,
            0,
        ));
        self.log.info(format!(
            "shared_texture_consumers main_surface=ok thumbnail_surface=ok texture_generation={}",
            gpu.shared.generation
        ));
        self.gpu = Some(gpu);
        self.windows = vec![main_state, thumbnail_state];
        self.auto_start_pending = self.options.auto_sequence;
        Ok(())
    }

    fn window_index(&self, slot: WindowSlot) -> Option<usize> {
        self.windows.iter().position(|window| window.slot == slot)
    }

    fn request_all_redraws(&self) {
        for window in &self.windows {
            window.window.request_redraw();
        }
    }

    fn schedule_save(&mut self) {
        self.save_due = Some(Instant::now() + SAVE_DEBOUNCE);
    }

    fn sync_window_geometry(&mut self) {
        for window in &self.windows {
            let geometry = match window.slot {
                WindowSlot::Main => &mut self.view.main,
                WindowSlot::Thumbnail => &mut self.view.thumbnail,
            };
            geometry.width = window.size.width;
            geometry.height = window.size.height;
            if let Ok(position) = window.window.outer_position() {
                geometry.x = position.x;
                geometry.y = position.y;
            }
        }
    }

    fn save_view(&mut self, reason: &str) {
        self.sync_window_geometry();
        match self.persistence.save(&mut self.view) {
            Ok(()) => self.log.info(format!(
                "gpu_resource event=view_save reason={} path={}",
                reason,
                self.persistence.path().display()
            )),
            Err(error) => self.log.error(format!(
                "gpu_resource event=view_save_failed reason={} path={} error={error}",
                reason,
                self.persistence.path().display()
            )),
        }
    }

    fn start_auto_sequence(&mut self) {
        if self.gpu.is_none() {
            return;
        }
        self.auto.restart(Instant::now());
        self.auto_live = true;
        self.minimized_and_restored = false;
        self.pending_fault = None;
        self.evidence.clear();
        self.report_written = false;
        self.log.info(format!(
            "auto_sequence_start version={} steps={}",
            crate::auto::AUTO_SEQUENCE_VERSION,
            self.auto.total_steps()
        ));
        self.request_all_redraws();
    }

    fn draw(&mut self) {
        if self.gpu.is_none() || self.windows.is_empty() {
            return;
        }

        let elapsed = self
            .auto
            .started()
            .map(|started| started.elapsed().as_secs_f32())
            .unwrap_or(self.frame_index as f32 / 60.0);
        {
            let gpu = self.gpu.as_ref().expect("GPU checked above");
            if let Err(error) = gpu.render_shared(&self.view.orbit, elapsed) {
                self.log.error(format!(
                    "gpu_resource event=shared_render_failed error={error:#}"
                ));
            }
        }

        let mut issues = Vec::new();
        for index in 0..self.windows.len() {
            if self.windows[index].config_dirty && !self.windows[index].minimized {
                let reason = if self.windows[index].minimized {
                    "minimized"
                } else {
                    "resize"
                };
                if let Some(gpu) = self.gpu.as_mut() {
                    self.windows[index].configure(gpu, &mut self.log, reason);
                }
            }
            if self.windows[index].injected_loss {
                self.windows[index].injected_loss = false;
                let slot = self.windows[index].slot;
                self.log.warn(format!(
                    "gpu_resource event=surface_invalidated window={} source=automation injection=lost",
                    slot.label()
                ));
                issues.push((index, SurfaceIssue::Injected));
                continue;
            }
            let Some(gpu) = self.gpu.as_ref() else {
                return;
            };
            let material_name = self.view.orbit.material_name();
            match self.windows[index].render(gpu, self.frame_index, material_name, &mut self.log) {
                WindowFrame::Presented | WindowFrame::Skipped => {}
                WindowFrame::Issue(issue) => issues.push((index, issue)),
            }
        }

        for (index, issue) in issues {
            let slot = self.windows[index].slot;
            self.record_fault(
                slot,
                match issue {
                    SurfaceIssue::Injected => "automation_injected",
                    SurfaceIssue::Outdated => "outdated",
                    SurfaceIssue::Lost => "lost",
                    SurfaceIssue::Validation => "validation",
                },
            );
            if issue == SurfaceIssue::Outdated {
                let Some(gpu) = self.gpu.as_mut() else {
                    return;
                };
                self.windows[index].configure(gpu, &mut self.log, "outdated_recovery");
            } else {
                let Some(gpu) = self.gpu.as_mut() else {
                    return;
                };
                self.windows[index].recreate_surface(gpu, &mut self.log, "surface_recovery");
            }
        }

        if self.frame_index % 30 == 0 {
            let (main_frames, thumbnail_frames) = self.frame_counts();
            let shared_generation = self
                .gpu
                .as_ref()
                .map(|gpu| gpu.shared.generation)
                .unwrap_or(0);
            self.log.info(format!(
                "gpu_resource event=frame_batch frame={} main_frames={} thumbnail_frames={} shared_generation={}",
                self.frame_index,
                main_frames,
                thumbnail_frames,
                shared_generation
            ));
        }
        self.frame_index += 1;
        self.last_status_frame = self.frame_index;
    }

    fn frame_counts(&self) -> (u64, u64) {
        let main = self
            .window_index(WindowSlot::Main)
            .map(|index| self.windows[index].frames_presented)
            .unwrap_or(0);
        let thumbnail = self
            .window_index(WindowSlot::Thumbnail)
            .map(|index| self.windows[index].frames_presented)
            .unwrap_or(0);
        (main, thumbnail)
    }

    fn record_fault(&mut self, slot: WindowSlot, reason: &str) {
        let Some(index) = self.window_index(slot) else {
            return;
        };
        let Some(other_index) = self.window_index(slot.other()) else {
            return;
        };
        let fault = PendingFault {
            window: slot,
            reason: reason.to_owned(),
            frame_at_fault: self.windows[index].frames_presented,
            other_frames_at_fault: self.windows[other_index].frames_presented,
            recoveries_at_fault: self.windows[index].recoveries,
        };
        self.log.info(format!(
            "surface_isolation_begin window={} other={} frames_at_fault={} other_frames_at_fault={}",
            slot.label(),
            slot.other().label(),
            fault.frame_at_fault,
            fault.other_frames_at_fault
        ));
        self.pending_fault = Some(fault);
    }

    fn probe(&mut self, name: &str) {
        let Some(fault) = self.pending_fault.take() else {
            let (main_frames, thumbnail_frames) = self.frame_counts();
            self.log.info(format!(
                "auto_probe name={} main_frames={} thumbnail_frames={}",
                name, main_frames, thumbnail_frames
            ));
            return;
        };
        let Some(fault_index) = self.window_index(fault.window) else {
            return;
        };
        let Some(other_index) = self.window_index(fault.window.other()) else {
            return;
        };
        let other_frames = self.windows[other_index].frames_presented;
        let advanced = other_frames.saturating_sub(fault.other_frames_at_fault);
        let recovered = self.windows[fault_index].recoveries > fault.recoveries_at_fault;
        let evidence = InvalidationEvidence {
            window: fault.window,
            other_window: fault.window.other(),
            reason: fault.reason,
            frame_at_fault: fault.frame_at_fault,
            other_frames_at_fault: fault.other_frames_at_fault,
            other_frames_at_probe: other_frames,
            other_frames_advanced: advanced,
            recovered,
            other_continued_rendering: advanced > 0,
        };
        self.log.info(format!(
            "surface_isolation_probe name={} invalid_window={} other={} other_frames_delta={} recovered={} other_continued_rendering={}",
            name,
            evidence.window.label(),
            evidence.other_window.label(),
            evidence.other_frames_advanced,
            evidence.recovered,
            evidence.other_continued_rendering
        ));
        self.evidence.push(evidence);
    }

    fn finalize_report(&mut self, status: &'static str) {
        if self.report_written {
            return;
        }
        let (main_frames, thumbnail_frames) = self.frame_counts();
        let main_recoveries = self
            .window_index(WindowSlot::Main)
            .map(|index| self.windows[index].recoveries)
            .unwrap_or(0);
        let thumbnail_recoveries = self
            .window_index(WindowSlot::Thumbnail)
            .map(|index| self.windows[index].recoveries)
            .unwrap_or(0);
        let report = AutoReport {
            sequence: crate::auto::AUTO_SEQUENCE_VERSION,
            status,
            adapter: self
                .gpu
                .as_ref()
                .map(|gpu| gpu.adapter_summary.clone())
                .unwrap_or_else(|| "unavailable".to_owned()),
            shared_texture_size: self.gpu.as_ref().map(|gpu| gpu.shared.size).unwrap_or(0),
            shared_texture_generation: self
                .gpu
                .as_ref()
                .map(|gpu| gpu.shared.generation)
                .unwrap_or(0),
            main_frames,
            thumbnail_frames,
            main_recoveries,
            thumbnail_recoveries,
            minimized_and_restored: self.minimized_and_restored,
            invalidations: self.evidence.clone(),
            view_path: self.persistence.path().display().to_string(),
            gpu_log_path: self.log.path().display().to_string(),
        };
        if let Some(parent) = self.report_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match serde_json::to_string_pretty(&report)
            .map_err(std::io::Error::other)
            .and_then(|json| std::fs::write(&self.report_path, json))
        {
            Ok(()) => {
                self.log.info(format!(
                    "auto_report_written status={} path={}",
                    status,
                    self.report_path.display()
                ));
                self.report_written = true;
            }
            Err(error) => self.log.error(format!(
                "auto_report_failed path={} error={error}",
                self.report_path.display()
            )),
        }
    }

    fn apply_auto_step(&mut self, event_loop: &ActiveEventLoop, step: AutoStep) {
        match step.action {
            AutoAction::Resize {
                window,
                width,
                height,
            } => {
                let Some(index) = self.window_index(window) else {
                    return;
                };
                let size = PhysicalSize::new(width.max(1), height.max(1));
                self.log.info(format!(
                    "auto_action action=resize window={} target={}x{}",
                    window.label(),
                    size.width,
                    size.height
                ));
                let _ = self.windows[index].window.request_inner_size(size);
                self.windows[index].resize(size, &mut self.log);
            }
            AutoAction::Minimize { window } => {
                let Some(index) = self.window_index(window) else {
                    return;
                };
                self.log.info(format!(
                    "auto_action action=minimize window={}",
                    window.label()
                ));
                self.windows[index].window.set_minimized(true);
                self.windows[index].minimized = true;
            }
            AutoAction::Restore { window } => {
                let Some(index) = self.window_index(window) else {
                    return;
                };
                self.log.info(format!(
                    "auto_action action=restore window={}",
                    window.label()
                ));
                self.windows[index].window.set_minimized(false);
                self.windows[index].minimized = false;
                self.windows[index].occluded = false;
                self.windows[index].config_dirty = true;
                self.minimized_and_restored = true;
            }
            AutoAction::InvalidateSurface { window } => {
                let Some(index) = self.window_index(window) else {
                    return;
                };
                self.log.info(format!(
                    "auto_action action=invalidate_surface window={} mode=drop_and_recreate",
                    window.label()
                ));
                self.windows[index].injected_loss = true;
            }
            AutoAction::Probe { name } => self.probe(&name),
            AutoAction::Finish => {
                self.save_view("auto_sequence");
                let passed = self.evidence.len() >= 2
                    && self
                        .evidence
                        .iter()
                        .all(|item| item.other_continued_rendering)
                    && self.evidence.iter().all(|item| item.recovered)
                    && self.minimized_and_restored;
                let status = if passed { "passed" } else { "failed" };
                self.log.info(format!(
                    "auto_sequence_finish status={} invalidations={} minimized_restored={}",
                    status,
                    self.evidence.len(),
                    self.minimized_and_restored
                ));
                self.finalize_report(status);
                self.auto_live = false;
                if self.options.exit_after_sequence {
                    event_loop.exit();
                }
            }
        }
    }

    fn redraw(&mut self) {
        self.draw();
        if let Some(index) = self.window_index(WindowSlot::Thumbnail) {
            self.windows[index].window.set_title(&window_title(
                WindowSlot::Thumbnail,
                self.view.orbit.material_name(),
                self.windows[index].frames_presented,
                self.windows[index].config.width,
                self.windows[index].config.height,
                self.frame_index,
            ));
        }
    }
}

impl ApplicationHandler for InspectorApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gpu.is_some() {
            self.request_all_redraws();
            return;
        }
        if let Err(error) = self.initialize_windows(event_loop) {
            self.log
                .error(format!("window_initialization_failed error={error:#}"));
            event_loop.exit();
            return;
        }
        self.request_all_redraws();
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => {
                self.save_view("close_requested");
                if !self.report_written {
                    self.finalize_report(if self.auto_live {
                        "interrupted"
                    } else {
                        "closed"
                    });
                }
                event_loop.exit();
            }
            WindowEvent::Resized(size) => {
                if let Some(index) = self
                    .windows
                    .iter()
                    .position(|window| window.window.id() == window_id)
                {
                    self.windows[index].resize(size, &mut self.log);
                    self.windows[index].window.request_redraw();
                    self.schedule_save();
                }
            }
            WindowEvent::Occluded(occluded) => {
                if let Some(index) = self
                    .windows
                    .iter()
                    .position(|window| window.window.id() == window_id)
                {
                    self.windows[index].occluded = occluded;
                    self.log.info(format!(
                        "gpu_resource event=window_occluded window={} occluded={}",
                        self.windows[index].slot.label(),
                        occluded
                    ));
                    if !occluded {
                        self.windows[index].config_dirty = true;
                        self.windows[index].window.request_redraw();
                    }
                }
            }
            WindowEvent::RedrawRequested => self.redraw(),
            WindowEvent::CursorMoved { position, .. } => {
                let Some(drag) = &mut self.drag else {
                    return;
                };
                if drag.window_id != window_id {
                    return;
                }
                let Some(previous) = drag.last.replace(position) else {
                    return;
                };
                let dx = position.x - previous.x;
                let dy = position.y - previous.y;
                self.view.orbit.orbit(dx as f32, dy as f32);
                self.schedule_save();
                self.request_all_redraws();
            }
            WindowEvent::MouseInput {
                state,
                button: MouseButton::Left,
                ..
            } => match state {
                ElementState::Pressed => {
                    self.drag = Some(DragState {
                        window_id,
                        last: None,
                    });
                }
                ElementState::Released => {
                    self.drag = None;
                    self.save_view("orbit_released");
                }
            },
            WindowEvent::MouseWheel { delta, .. } => {
                let amount = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y * 28.0,
                    MouseScrollDelta::PixelDelta(position) => position.y as f32,
                };
                self.view.orbit.zoom(amount);
                self.schedule_save();
                self.request_all_redraws();
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if event.state != ElementState::Pressed || event.repeat {
                    return;
                }
                let PhysicalKey::Code(code) = event.physical_key else {
                    return;
                };
                let mut changed = true;
                match code {
                    KeyCode::Escape => {
                        self.save_view("escape");
                        self.finalize_report(if self.auto_live {
                            "interrupted"
                        } else {
                            "closed"
                        });
                        event_loop.exit();
                    }
                    KeyCode::F5 => {
                        self.start_auto_sequence();
                        changed = false;
                    }
                    KeyCode::KeyS => {
                        self.save_view("manual_save");
                        changed = false;
                    }
                    KeyCode::KeyR => self.view.orbit.reset(),
                    KeyCode::Space => self.view.orbit.next_material(),
                    KeyCode::Digit1 => self.view.orbit.select_material(0),
                    KeyCode::Digit2 => self.view.orbit.select_material(1),
                    KeyCode::Digit3 => self.view.orbit.select_material(2),
                    KeyCode::Minus => self.view.orbit.adjust_exposure(-0.08),
                    KeyCode::Equal => self.view.orbit.adjust_exposure(0.08),
                    _ => changed = false,
                }
                if changed {
                    self.schedule_save();
                    self.request_all_redraws();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.auto_start_pending {
            self.auto_start_pending = false;
            self.start_auto_sequence();
        }

        let now = Instant::now();
        if self.save_due.is_some_and(|deadline| deadline <= now) {
            self.save_due = None;
            self.save_view("debounced");
        }

        if self.auto_live {
            let due = self.auto.take_due(now);
            for step in due {
                self.apply_auto_step(event_loop, step);
            }
            if self.auto_live {
                self.request_all_redraws();
                event_loop.set_control_flow(ControlFlow::WaitUntil(now + AUTO_FRAME_INTERVAL));
                return;
            }
        }

        if let Some(deadline) = self.save_due {
            event_loop.set_control_flow(ControlFlow::WaitUntil(deadline));
        } else {
            event_loop.set_control_flow(ControlFlow::Wait);
        }
    }

    fn exiting(&mut self, _event_loop: &ActiveEventLoop) {
        if !self.report_written {
            self.finalize_report(if self.auto_live {
                "interrupted"
            } else {
                "closed"
            });
        }
        self.save_view("app_exit");
        self.log.info(format!(
            "session_end main_frames={} thumbnail_frames={} shared_generation={}",
            self.frame_counts().0,
            self.frame_counts().1,
            self.gpu
                .as_ref()
                .map(|gpu| gpu.shared.generation)
                .unwrap_or(0)
        ));
    }
}

fn safe_size(size: PhysicalSize<u32>) -> PhysicalSize<u32> {
    PhysicalSize::new(size.width.max(1), size.height.max(1))
}

fn surface_config(
    gpu: &GpuContext,
    surface: &wgpu::Surface<'_>,
    width: u32,
    height: u32,
) -> Result<wgpu::SurfaceConfiguration> {
    let capabilities = surface.get_capabilities(&gpu.adapter);
    let format = capabilities
        .formats
        .iter()
        .copied()
        .find(wgpu::TextureFormat::is_srgb)
        .or_else(|| capabilities.formats.first().copied())
        .context("surface reports no supported formats")?;
    let mut config = surface
        .get_default_config(&gpu.adapter, width.max(1), height.max(1))
        .context("surface cannot be configured with this adapter")?;
    config.format = format;
    config.usage = wgpu::TextureUsages::RENDER_ATTACHMENT;
    config.present_mode = if capabilities
        .present_modes
        .contains(&wgpu::PresentMode::Fifo)
    {
        wgpu::PresentMode::Fifo
    } else {
        *capabilities
            .present_modes
            .first()
            .context("surface reports no present modes")?
    };
    config.desired_maximum_frame_latency = 2;
    config.width = width.max(1);
    config.height = height.max(1);
    Ok(config)
}

fn window_title(
    slot: WindowSlot,
    material_name: &str,
    frames: u64,
    width: u32,
    height: u32,
    frame_index: u64,
) -> String {
    match slot {
        WindowSlot::Main => format!(
            "Material Inspector | {material_name} | shared 1024² | {}x{} | frame {frame_index} | {} presented",
            width, height, frames
        ),
        WindowSlot::Thumbnail => format!(
            "Thumbnail | {material_name} | shared texture | {}x{} | {frames} presented",
            width, height
        ),
    }
}
