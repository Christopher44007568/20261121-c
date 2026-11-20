use std::path::PathBuf;

use anyhow::{bail, Result};
use wgpu_material_inspector::app::{AppOptions, InspectorApp};

#[derive(Debug, Default)]
struct Cli {
    auto_sequence: bool,
    exit_after_sequence: bool,
    gpu_smoke: bool,
    config_path: Option<PathBuf>,
    report_path: Option<PathBuf>,
    gpu_log_path: Option<PathBuf>,
}

fn main() -> Result<()> {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info,wgpu_core=warn,wgpu_hal=warn"),
    )
    .format_timestamp_millis()
    .init();

    let cli = parse_args()?;
    if cli.gpu_smoke {
        return wgpu_material_inspector::smoke::run();
    }

    let options = AppOptions {
        auto_sequence: cli.auto_sequence,
        exit_after_sequence: cli.exit_after_sequence,
        config_path: cli.config_path,
        report_path: cli.report_path,
        gpu_log_path: cli.gpu_log_path,
    };
    let event_loop = winit::event_loop::EventLoop::new()?;
    event_loop.set_control_flow(winit::event_loop::ControlFlow::Wait);
    let mut app = InspectorApp::new(options)?;
    event_loop.run_app(&mut app)?;
    Ok(())
}

fn parse_args() -> Result<Cli> {
    let mut cli = Cli::default();
    let mut args = std::env::args().skip(1);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--auto-sequence" | "--auto" => cli.auto_sequence = true,
            "--exit-after-sequence" => cli.exit_after_sequence = true,
            "--gpu-smoke" => cli.gpu_smoke = true,
            "--config" => {
                cli.config_path = Some(PathBuf::from(
                    args.next()
                        .ok_or_else(|| anyhow::anyhow!("--config needs a path"))?,
                ));
            }
            "--report" => {
                cli.report_path = Some(PathBuf::from(
                    args.next()
                        .ok_or_else(|| anyhow::anyhow!("--report needs a path"))?,
                ));
            }
            "--gpu-log" => {
                cli.gpu_log_path = Some(PathBuf::from(
                    args.next()
                        .ok_or_else(|| anyhow::anyhow!("--gpu-log needs a path"))?,
                ));
            }
            "--help" | "-h" => {
                println!(
                    "wgpu-material-inspector\n\
                     \n\
                     Controls: drag=orbit  wheel=zoom  1/2/3=material  Space=next material\n\
                     R=reset  -/+=exposure  S=save  F5=run automated sequence  Esc=exit\n\
                     \n\
                     Flags:\n\
                       --auto-sequence       run resize/minimize/surface-loss sequence on launch\n\
                       --exit-after-sequence exit when the sequence has written its report\n\
                       --gpu-smoke           render the shared texture headlessly and exit\n\
                       --config PATH         override the saved view path\n\
                       --report PATH         override the auto-sequence report path\n\
                       --gpu-log PATH        override the resource log path"
                );
                std::process::exit(0);
            }
            other => bail!("unknown argument {other:?}; use --help"),
        }
    }
    if cli.exit_after_sequence {
        cli.auto_sequence = true;
    }
    Ok(cli)
}
