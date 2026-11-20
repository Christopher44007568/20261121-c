use std::sync::mpsc;

use anyhow::{bail, Context, Result};

use crate::gpu::{GpuContext, SHARED_TEXTURE_FORMAT, SHARED_TEXTURE_SIZE};
use crate::view::OrbitView;

pub fn run() -> Result<()> {
    let instance =
        wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
    let gpu = GpuContext::initialize(instance, None).context("headless GPU initialization")?;
    gpu.render_shared(&OrbitView::default(), 0.75)
        .context("headless shared-texture render")?;

    let bytes_per_row = SHARED_TEXTURE_SIZE * 4;
    let byte_size = (bytes_per_row * SHARED_TEXTURE_SIZE) as u64;
    let readback = gpu.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("gpu-smoke-readback"),
        size: byte_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = gpu
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("gpu-smoke-encoder"),
        });
    encoder.copy_texture_to_buffer(
        gpu.shared.texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &readback,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(SHARED_TEXTURE_SIZE),
            },
        },
        wgpu::Extent3d {
            width: SHARED_TEXTURE_SIZE,
            height: SHARED_TEXTURE_SIZE,
            depth_or_array_layers: 1,
        },
    );
    gpu.queue.submit(Some(encoder.finish()));
    gpu.device
        .poll(wgpu::PollType::wait_indefinitely())
        .context("waiting for smoke render")?;

    let slice = readback.slice(..);
    let (sender, receiver) = mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    gpu.device
        .poll(wgpu::PollType::wait_indefinitely())
        .context("waiting for readback mapping")?;
    receiver
        .recv()
        .context("readback callback disappeared")?
        .context("readback mapping failed")?;

    let mapped = slice
        .get_mapped_range()
        .context("could not obtain mapped readback view")?;
    let center =
        ((SHARED_TEXTURE_SIZE / 2 * bytes_per_row) + (SHARED_TEXTURE_SIZE / 2 * 4)) as usize;
    let pixel = [
        mapped[center],
        mapped[center + 1],
        mapped[center + 2],
        mapped[center + 3],
    ];
    let checksum: u64 = mapped.iter().step_by(4096).map(|value| *value as u64).sum();
    if let Some(path) = std::env::var_os("MATERIAL_INSPECTOR_SCREENSHOT") {
        let path = std::path::PathBuf::from(path);
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        write_ppm(&path, &mapped, SHARED_TEXTURE_SIZE)?;
        println!("gpu_smoke_screenshot path={}", path.display());
    }
    drop(mapped);
    readback.unmap();

    let luminance = (pixel[0] as u32 + pixel[1] as u32 + pixel[2] as u32) as f32 / (3.0 * 255.0);
    println!(
        "gpu_smoke_ok adapter=\"{}\" format={:?} size={}x{} center_rgba={:?} luminance={:.4} checksum={}",
        gpu.adapter_summary,
        SHARED_TEXTURE_FORMAT,
        SHARED_TEXTURE_SIZE,
        SHARED_TEXTURE_SIZE,
        pixel,
        luminance,
        checksum
    );
    if checksum == 0 {
        bail!("shared texture readback is entirely zero");
    }
    Ok(())
}

fn write_ppm(path: &std::path::Path, rgba: &[u8], size: u32) -> Result<()> {
    use std::io::Write;

    let mut file = std::fs::File::create(path)?;
    write!(file, "P6\n{size} {size}\n255\n")?;
    let mut rgb = Vec::with_capacity((size * size * 3) as usize);
    for pixel in rgba.chunks_exact(4) {
        rgb.extend_from_slice(&pixel[..3]);
    }
    file.write_all(&rgb)?;
    Ok(())
}
