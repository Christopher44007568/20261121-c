//! 稳定 ID 的实例存储：后端条目批量移动/删除时，只产生局部脏区间上传。
use std::collections::HashMap;

/// 后端下发的稳定标识（生命周期内不变，与槽位无关）。
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub struct PipeId(pub u32);

#[derive(Clone, Copy, Debug)]
pub struct PipeSegment {
    pub id: PipeId,
    pub start: [f32; 3],
    pub end: [f32; 3],
    pub radius: f32,
}

/// GPU 实例布局（32B）：a = (start.xyz, radius)，b = (end.xyz, 拾取ID位模式)。
#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuInstance {
    pub a: [f32; 4],
    pub b: [f32; 4],
}

pub const INSTANCE_SIZE: u64 = std::mem::size_of::<GpuInstance>() as u64;

impl GpuInstance {
    pub fn from_segment(s: &PipeSegment) -> Self {
        GpuInstance {
            a: [s.start[0], s.start[1], s.start[2], s.radius],
            b: [s.end[0], s.end[1], s.end[2], f32::from_bits(s.id.0)],
        }
    }
    pub fn pick_id(&self) -> PipeId {
        PipeId(self.b[3].to_bits())
    }
    pub fn start(&self) -> [f32; 3] {
        [self.a[0], self.a[1], self.a[2]]
    }
    pub fn end(&self) -> [f32; 3] {
        [self.b[0], self.b[1], self.b[2]]
    }
    pub fn radius(&self) -> f32 {
        self.a[3]
    }
}

/// 一批后端更新：upsert（新增或移动）+ 删除。
#[derive(Default)]
pub struct Batch {
    pub upserts: Vec<PipeSegment>,
    pub removes: Vec<PipeId>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UploadStats {
    pub ranges: u32,
    pub bytes: u64,
    pub instances: u32,
}

/// 合并的脏区间集合（槽位下标，闭区间）。
#[derive(Default)]
struct DirtyRanges {
    ranges: Vec<(u32, u32)>, // 有序、互不重叠
}

impl DirtyRanges {
    fn mark(&mut self, idx: u32) {
        // 找到插入点并尝试与相邻区间合并。
        let pos = self.ranges.partition_point(|&(_, hi)| hi < idx);
        if pos < self.ranges.len() {
            let (lo, hi) = self.ranges[pos];
            if idx >= lo && idx <= hi {
                return; // 已覆盖
            }
            if idx + 1 == lo {
                self.ranges[pos].0 = idx;
                self.try_merge(pos);
                return;
            }
        }
        if pos > 0 && self.ranges[pos - 1].1 + 1 == idx {
            self.ranges[pos - 1].1 = idx;
            self.try_merge(pos - 1);
            return;
        }
        self.ranges.insert(pos, (idx, idx));
    }
    fn try_merge(&mut self, i: usize) {
        if i + 1 < self.ranges.len() && self.ranges[i].1 + 1 >= self.ranges[i + 1].0 {
            self.ranges[i].1 = self.ranges[i + 1].1;
            self.ranges.remove(i + 1);
        }
    }
    fn take(&mut self) -> Vec<(u32, u32)> {
        std::mem::take(&mut self.ranges)
    }
}

/// 稠密实例数组 + 稳定ID→槽位映射。删除用 swap-remove 保持稠密，
/// 因此被换入的槽位同样标脏，保证 GPU 缓冲与 CPU 镜像一致。
pub struct InstanceStore {
    instances: Vec<GpuInstance>,
    ids: Vec<PipeId>, // 槽位 → 稳定ID（与 instances 平行）
    slot_of: HashMap<PipeId, u32>,
    dirty: DirtyRanges,
}

impl InstanceStore {
    pub fn new(capacity: usize) -> Self {
        InstanceStore {
            instances: Vec::with_capacity(capacity),
            ids: Vec::with_capacity(capacity),
            slot_of: HashMap::with_capacity(capacity),
            dirty: DirtyRanges::default(),
        }
    }
    pub fn len(&self) -> usize {
        self.instances.len()
    }
    pub fn instances(&self) -> &[GpuInstance] {
        &self.instances
    }
    pub fn id_at(&self, slot: u32) -> PipeId {
        self.ids[slot as usize]
    }
    pub fn slot_of(&self, id: PipeId) -> Option<u32> {
        self.slot_of.get(&id).copied()
    }

    /// 应用一批后端更新，返回本批产生的上传统计（不清脏，需 flush 确认）。
    pub fn apply(&mut self, batch: &Batch) -> UploadStats {
        let before = self.pending_stats();
        // 先删后增，避免同批 delete+reinsert 的歧义。
        for id in &batch.removes {
            self.remove_one(*id);
        }
        for seg in &batch.upserts {
            self.upsert_one(seg);
        }
        let after = self.pending_stats();
        UploadStats {
            ranges: after.ranges - before.ranges,
            bytes: after.bytes - before.bytes,
            instances: self.instances.len() as u32,
        }
    }

    fn upsert_one(&mut self, seg: &PipeSegment) {
        let inst = GpuInstance::from_segment(seg);
        match self.slot_of.get(&seg.id) {
            Some(&slot) => {
                self.instances[slot as usize] = inst;
                self.dirty.mark(slot);
            }
            None => {
                let slot = self.instances.len() as u32;
                self.instances.push(inst);
                self.ids.push(seg.id);
                self.slot_of.insert(seg.id, slot);
                self.dirty.mark(slot);
            }
        }
    }

    fn remove_one(&mut self, id: PipeId) {
        let Some(slot) = self.slot_of.remove(&id) else { return };
        let last = self.instances.len() as u32 - 1;
        self.instances.swap_remove(slot as usize);
        self.ids.swap_remove(slot as usize);
        if slot != last {
            let moved = self.ids[slot as usize];
            self.slot_of.insert(moved, slot);
        }
        // 被换入的实例需要重写到该槽位；末尾截断由 instance_count 体现，
        // 删除的本来就是末尾槽位时无需上传（越界槽位不能标脏）。
        if slot < self.instances.len() as u32 {
            self.dirty.mark(slot);
        }
    }

    fn pending_stats(&self) -> UploadStats {
        UploadStats {
            ranges: self.dirty.ranges.len() as u32,
            bytes: self
                .dirty
                .ranges
                .iter()
                .map(|&(lo, hi)| (hi as u64 - lo as u64 + 1) * INSTANCE_SIZE)
                .sum(),
            instances: self.instances.len() as u32,
        }
    }

    /// 取出并清除脏区间，返回 (字节偏移, 槽位区间) 列表供 queue.write_buffer 使用。
    pub fn flush_dirty(&mut self) -> (UploadStats, Vec<(u64, u32, u32)>) {
        // 批量删除后数组可能已缩短：截断到当前长度，越界槽位无需上传
        //（GPU 侧按 instance_count 截断尾部）。
        let len = self.instances.len() as u32;
        let ranges: Vec<(u32, u32)> = self
            .dirty
            .take()
            .into_iter()
            .filter_map(|(lo, hi)| (lo < len).then(|| (lo, hi.min(len - 1))))
            .collect();
        let stats = UploadStats {
            ranges: ranges.len() as u32,
            bytes: ranges
                .iter()
                .map(|&(lo, hi)| (hi as u64 - lo as u64 + 1) * INSTANCE_SIZE)
                .sum(),
            instances: self.instances.len() as u32,
        };
        let out = ranges
            .iter()
            .map(|&(lo, hi)| (lo as u64 * INSTANCE_SIZE, lo, hi))
            .collect();
        (stats, out)
    }

    /// 某个 (lo..=hi) 槽位区间的字节切片（配合 flush_dirty 的返回值上传）。
    pub fn slice_bytes(&self, lo: u32, hi: u32) -> &[u8] {
        bytemuck::cast_slice(&self.instances[lo as usize..=hi as usize])
    }
}
