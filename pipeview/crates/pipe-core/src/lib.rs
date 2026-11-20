//! 工业管网实例化渲染的核心数据层：
//! 稳定 ID 的实例存储、局部缓冲更新（脏区间）、视锥裁剪与拾取。
pub mod math;
pub mod store;
pub mod cull;
pub mod pick;

pub use store::{Batch, InstanceStore, PipeId, PipeSegment, GpuInstance, UploadStats};
pub use cull::{cull, Frustum};
pub use pick::{pick_visible, Ray};
