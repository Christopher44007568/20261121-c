use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::view::OrbitView;

pub const VIEW_FILE_VERSION: u32 = 1;
pub const DEFAULT_MAIN_SIZE: (u32, u32) = (1120, 760);
pub const DEFAULT_THUMB_SIZE: (u32, u32) = (360, 300);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Default for WindowGeometry {
    fn default() -> Self {
        Self {
            x: 80,
            y: 80,
            width: DEFAULT_MAIN_SIZE.0,
            height: DEFAULT_MAIN_SIZE.1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct UserView {
    pub version: u32,
    pub orbit: OrbitView,
    pub main: WindowGeometry,
    pub thumbnail: WindowGeometry,
}

impl Default for UserView {
    fn default() -> Self {
        Self {
            version: VIEW_FILE_VERSION,
            orbit: OrbitView::default(),
            main: WindowGeometry::default(),
            thumbnail: WindowGeometry {
                x: 820,
                y: 160,
                width: DEFAULT_THUMB_SIZE.0,
                height: DEFAULT_THUMB_SIZE.1,
            },
        }
    }
}

impl UserView {
    pub fn sanitize(&mut self) {
        self.version = VIEW_FILE_VERSION;
        self.orbit.clamp();
        self.main.width = self.main.width.max(320).min(8192);
        self.main.height = self.main.height.max(240).min(8192);
        self.thumbnail.width = self.thumbnail.width.max(180).min(4096);
        self.thumbnail.height = self.thumbnail.height.max(140).min(4096);
    }
}

#[derive(Debug, Clone)]
pub struct Persistence {
    path: PathBuf,
}

impl Persistence {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn from_environment() -> Self {
        Self::new(default_view_path())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> UserView {
        match fs::read_to_string(&self.path) {
            Ok(text) => match serde_json::from_str::<UserView>(&text) {
                Ok(mut view) => {
                    view.sanitize();
                    log::info!(
                        "view_loaded path={} camera=({:.3},{:.3},{:.3}) material={}",
                        self.path.display(),
                        view.orbit.yaw,
                        view.orbit.pitch,
                        view.orbit.distance,
                        view.orbit.material
                    );
                    view
                }
                Err(error) => {
                    log::warn!(
                        "view_load_rejected path={} error={} action=use_default",
                        self.path.display(),
                        error
                    );
                    UserView::default()
                }
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                log::info!("view_default path={} reason=first_run", self.path.display());
                UserView::default()
            }
            Err(error) => {
                log::warn!(
                    "view_load_failed path={} error={} action=use_default",
                    self.path.display(),
                    error
                );
                UserView::default()
            }
        }
    }

    pub fn save(&self, view: &mut UserView) -> io::Result<()> {
        view.sanitize();
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }

        let json = serde_json::to_string_pretty(view)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, json)?;
        if let Err(error) = fs::rename(&temporary, &self.path) {
            let _ = fs::remove_file(&self.path);
            fs::rename(&temporary, &self.path).map_err(|_| error)?;
        }
        log::info!(
            "view_saved path={} yaw={:.3} pitch={:.3} distance={:.3} material={}",
            self.path.display(),
            view.orbit.yaw,
            view.orbit.pitch,
            view.orbit.distance,
            view.orbit.material
        );
        Ok(())
    }
}

pub fn default_view_path() -> PathBuf {
    if let Some(path) = std::env::var_os("MATERIAL_INSPECTOR_CONFIG") {
        return PathBuf::from(path);
    }
    if let Some(root) = std::env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(root)
            .join("wgpu-material-inspector")
            .join("view.json");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".config")
            .join("wgpu-material-inspector")
            .join("view.json");
    }
    PathBuf::from(".wgpu-material-inspector-view.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "wgpu-material-inspector-{name}-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn user_view_round_trips() {
        let path = temporary_path("roundtrip");
        let persistence = Persistence::new(&path);
        let mut expected = UserView::default();
        expected.orbit.yaw = 2.25;
        expected.orbit.material = 2;
        expected.thumbnail.width = 288;
        persistence.save(&mut expected).unwrap();

        let actual = persistence.load();
        assert_eq!(actual, expected);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn corrupt_view_falls_back_without_panicking() {
        let path = temporary_path("corrupt");
        fs::write(&path, "{ definitely not json").unwrap();
        let view = Persistence::new(&path).load();
        assert_eq!(view.version, VIEW_FILE_VERSION);
        assert!(view.orbit.distance.is_finite());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn saved_geometry_is_clamped_to_safe_dimensions() {
        let path = temporary_path("geometry");
        let persistence = Persistence::new(&path);
        let mut view = UserView::default();
        view.main.width = 0;
        view.thumbnail.height = u32::MAX;
        persistence.save(&mut view).unwrap();
        let loaded = persistence.load();
        assert!(loaded.main.width >= 320);
        assert!(loaded.thumbnail.height <= 4096);
        let _ = fs::remove_file(path);
    }
}
