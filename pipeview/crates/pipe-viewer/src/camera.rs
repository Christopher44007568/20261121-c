//! 轨道相机。
use pipe_core::math::{Mat4, Vec3};

pub struct Camera {
    pub yaw: f32,
    pub pitch: f32,
    pub dist: f32,
    pub target: Vec3,
    pub fov: f32,
}

impl Default for Camera {
    fn default() -> Self {
        Camera {
            yaw: 0.8,
            pitch: 0.6,
            dist: 420.0,
            target: [0.0, 10.0, 0.0],
            fov: 60f32.to_radians(),
        }
    }
}

impl Camera {
    pub fn orbit(&mut self, dyaw: f32, dpitch: f32) {
        self.yaw += dyaw;
        self.pitch = (self.pitch + dpitch).clamp(-1.5, 1.5);
    }
    pub fn zoom(&mut self, delta: f32) {
        self.dist = (self.dist * (1.0 - delta * 0.1)).clamp(20.0, 2000.0);
    }
    pub fn eye(&self) -> Vec3 {
        let (cp, sp) = (self.pitch.cos(), self.pitch.sin());
        [
            self.target[0] + self.dist * cp * self.yaw.cos(),
            self.target[1] + self.dist * sp,
            self.target[2] + self.dist * cp * self.yaw.sin(),
        ]
    }
    /// 返回 (view_proj, eye, forward, right, up, tan_half_fov)。
    pub fn matrices(&self, aspect: f32) -> (Mat4, Vec3, Vec3, Vec3, Vec3, f32) {
        let eye = self.eye();
        let fwd = pipe_core::math::normalize(pipe_core::math::sub(self.target, eye));
        let right = pipe_core::math::normalize(pipe_core::math::cross(fwd, [0.0, 1.0, 0.0]));
        let up = pipe_core::math::cross(right, fwd);
        let view = Mat4::look_at(eye, self.target, [0.0, 1.0, 0.0]);
        let proj = Mat4::perspective(self.fov, aspect, 1.0, 4000.0);
        (proj.mul(&view), eye, fwd, right, up, (self.fov * 0.5).tan())
    }
}
