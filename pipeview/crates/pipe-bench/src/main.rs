//! 更新回放基准：全量加载 / 少量变动 / 大批删除。
//! 测量上传字节数与耗时，并校验视锥裁剪下拾取 ID 的一致性。
mod scenario;
mod verify;

use pipe_core::store::INSTANCE_SIZE;
use std::time::Instant;

fn main() {
    let gpu = std::env::args().any(|a| a == "--gpu");
    println!("=== 工业管网实例缓冲 · 更新回放基准 ===");
    println!("实例布局: {} B/段 (start.xyz+radius, end.xyz+pick_id)\n", INSTANCE_SIZE);

    let mut report = scenario::run_all();

    if gpu {
        match pollster::block_on(verify::gpu_upload_audit(&report)) {
            Ok(s) => report.push_str(&s),
            Err(e) => report.push_str(&format!("\n## GPU 上传审计\n跳过: {e}\n")),
        }
    } else {
        report.push_str("\n(GPU 上传审计未启用，加 `--gpu` 运行)\n");
    }

    print!("{report}");
    let t0 = Instant::now();
    std::fs::create_dir_all("../artifacts").ok();
    std::fs::write("../artifacts/replay_report.md", &report).expect("write report");
    eprintln!("报告写入 artifacts/replay_report.md ({}ms)", t0.elapsed().as_millis());
}
