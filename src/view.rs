use serde::{Deserialize, Serialize};

pub const MIN_DISTANCE: f32 = 1.6;
pub const MAX_DISTANCE: f32 = 8.0;
pub const MIN_PITCH: f32 = -1.35;
pub const MAX_PITCH: f32 = 1.35;
pub const MATERIAL_COUNT: u8 = 3;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OrbitView {
    pub yaw: f32,
    pub pitch: f32,
    pub distance: f32,
    pub exposure: f32,
    pub material: u8,
}

impl Default for OrbitView {
    fn default() -> Self {
        Self {
            yaw: 0.62,
            pitch: 0.18,
            distance: 3.55,
            exposure: 1.05,
            material: 0,
        }
    }
}

impl OrbitView {
    pub fn orbit(&mut self, dx: f32, dy: f32) {
        self.yaw = (self.yaw - dx * 0.009).rem_euclid(std::f32::consts::TAU);
        self.pitch = (self.pitch + dy * 0.008).clamp(MIN_PITCH, MAX_PITCH);
    }

    pub fn zoom(&mut self, wheel_delta: f32) {
        let scale = (-wheel_delta * 0.0018).exp();
        self.distance = (self.distance * scale).clamp(MIN_DISTANCE, MAX_DISTANCE);
    }

    pub fn adjust_exposure(&mut self, delta: f32) {
        self.exposure = (self.exposure + delta).clamp(0.35, 2.4);
    }

    pub fn select_material(&mut self, index: u8) {
        self.material = index.min(MATERIAL_COUNT - 1);
    }

    pub fn next_material(&mut self) {
        self.material = (self.material + 1) % MATERIAL_COUNT;
    }

    pub fn material_name(&self) -> &'static str {
        match self.material {
            0 => "Cobalt glass",
            1 => "Copper patina",
            _ => "Ivory ceramic",
        }
    }

    pub fn clamp(&mut self) {
        if !self.yaw.is_finite() {
            self.yaw = OrbitView::default().yaw;
        }
        if !self.pitch.is_finite() {
            self.pitch = OrbitView::default().pitch;
        }
        if !self.distance.is_finite() {
            self.distance = OrbitView::default().distance;
        }
        if !self.exposure.is_finite() {
            self.exposure = OrbitView::default().exposure;
        }
        self.yaw = self.yaw.rem_euclid(std::f32::consts::TAU);
        self.pitch = self.pitch.clamp(MIN_PITCH, MAX_PITCH);
        self.distance = self.distance.clamp(MIN_DISTANCE, MAX_DISTANCE);
        self.exposure = self.exposure.clamp(0.35, 2.4);
        self.material = self.material.min(MATERIAL_COUNT - 1);
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orbit_and_zoom_are_bounded() {
        let mut view = OrbitView::default();
        view.orbit(10_000.0, 10_000.0);
        assert!(view.pitch <= MAX_PITCH);
        assert!(view.yaw.is_finite());

        view.zoom(-100_000.0);
        assert_eq!(view.distance, MAX_DISTANCE);
        view.zoom(100_000.0);
        assert_eq!(view.distance, MIN_DISTANCE);
    }

    #[test]
    fn invalid_loaded_values_are_repaired() {
        let mut view = OrbitView {
            yaw: f32::NAN,
            pitch: 99.0,
            distance: 0.0,
            exposure: f32::INFINITY,
            material: 250,
        };
        view.clamp();
        assert!(view.yaw.is_finite());
        assert!(view.pitch <= MAX_PITCH);
        assert!(view.distance >= MIN_DISTANCE);
        assert!(view.exposure <= 2.4);
        assert_eq!(view.material, MATERIAL_COUNT - 1);
    }

    #[test]
    fn material_selection_wraps() {
        let mut view = OrbitView::default();
        view.select_material(2);
        view.next_material();
        assert_eq!(view.material, 0);
    }
}
