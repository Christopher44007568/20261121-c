use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub struct GpuResourceLog {
    path: PathBuf,
    file: Option<File>,
    started: Instant,
}

impl GpuResourceLog {
    pub fn create(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)?;
        Ok(Self {
            path,
            file: Some(file),
            started: Instant::now(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn record(&mut self, level: &str, message: impl AsRef<str>) {
        let elapsed = self.started.elapsed().as_secs_f64() * 1000.0;
        let message = message.as_ref();
        let line = format!("{elapsed:010.3}ms {level:<5} {message}");
        match level {
            "ERROR" => log::error!("{message}"),
            "WARN" => log::warn!("{message}"),
            "DEBUG" => log::debug!("{message}"),
            _ => log::info!("{message}"),
        }
        if let Some(file) = &mut self.file {
            let _ = writeln!(file, "{line}");
            let _ = file.flush();
        }
    }

    pub fn info(&mut self, message: impl AsRef<str>) {
        self.record("INFO", message);
    }

    pub fn warn(&mut self, message: impl AsRef<str>) {
        self.record("WARN", message);
    }

    pub fn error(&mut self, message: impl AsRef<str>) {
        self.record("ERROR", message);
    }
}

pub fn default_gpu_log_path() -> PathBuf {
    std::env::var_os("MATERIAL_INSPECTOR_GPU_LOG")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("gpu-resources.log"))
}

pub fn default_report_path() -> PathBuf {
    std::env::var_os("MATERIAL_INSPECTOR_REPORT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("artifacts/auto-sequence-report.json"))
}
