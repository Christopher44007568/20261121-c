export function appTemplate() {
  return `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <div>
            <div class="brand-name">SKIN / LAB</div>
            <div class="brand-sub">GLTF DEFORMATION COMPARATOR</div>
          </div>
        </div>
        <div class="top-status">
          <span><i class="dot"></i>SAME SKELETON DATA</span>
          <span><i class="dot amber"></i>LBS / FULL MATRIX</span>
          <span><i class="dot"></i>DQ / RIGID + SCALE</span>
        </div>
        <div class="top-meta">
          <span>GLTF 2.0 · 4 JOINTS</span>
          <strong id="render-status">WEBGL INIT</strong>
        </div>
      </header>

      <div class="workspace">
        <aside class="rail rail-left">
          <section class="rail-section">
            <div class="section-head">
              <h2 class="section-title">动画样本</h2>
              <span class="eyebrow">MOTION BANK</span>
            </div>
            <div class="anim-options" role="tablist" aria-label="动画选择">
              <button class="anim-option active" data-animation="wrist" role="tab" aria-selected="true">
                <span class="anim-index">01</span>
                <span class="anim-copy">
                  <strong>腕部大扭转</strong>
                  <span>WRIST TWIST · 240°</span>
                </span>
                <span class="anim-arrow">→</span>
              </button>
              <button class="anim-option" data-animation="elbow" role="tab" aria-selected="false">
                <span class="anim-index">02</span>
                <span class="anim-copy">
                  <strong>肘部弯曲</strong>
                  <span>ELBOW BEND · 110°</span>
                </span>
                <span class="anim-arrow">→</span>
              </button>
            </div>
            <div class="transport">
              <button class="play-button" id="play-toggle" aria-label="暂停动画" title="播放 / 暂停">
                <svg id="play-icon" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 1h3v10H2zm5 0h3v10H7z" />
                </svg>
              </button>
              <input
                class="timeline"
                id="timeline"
                type="range"
                min="0"
                max="4"
                step="0.01"
                value="2"
                aria-label="动画时间"
              />
              <span class="timecode" id="timecode">2.00 / 4.00s</span>
            </div>
          </section>

          <section class="rail-section tight">
            <div class="section-head">
              <h2 class="section-title">显示</h2>
              <span class="eyebrow">OVERLAYS</span>
            </div>
            <div class="toggle-list">
              <label class="toggle-row">
                <span>骨骼与关节</span>
                <span class="switch"><input id="toggle-skeleton" type="checkbox" checked /><i></i></span>
              </label>
              <label class="toggle-row">
                <span>测量截面</span>
                <span class="switch"><input id="toggle-rings" type="checkbox" checked /><i></i></span>
              </label>
              <label class="toggle-row">
                <span>网格线框</span>
                <span class="switch"><input id="toggle-wire" type="checkbox" /><i></i></span>
              </label>
            </div>
          </section>

          <section class="rail-section">
            <div class="section-head">
              <h2 class="section-title">非均匀缩放策略</h2>
              <span class="eyebrow">SCALE</span>
            </div>
            <div class="scale-card">
              <div class="scale-card-head">
                <strong>DQ CANNOT ENCODE S</strong>
                <span class="micro">polar</span>
              </div>
              <p>
                DQ 只混合刚体 <code>R, t</code>。先将每个蒙皮矩阵做极分解
                <code>M = T·R·P</code>，<code>P</code>（缩放/剪切）按权重线性混合，
                再在 DQ 刚体变换前施加。LBS 则混合完整矩阵。
              </p>
              <div class="scale-scale">
                <span>X <b>1.00</b></span>
                <span>Y <b>1.38</b></span>
                <span>Z <b>0.72</b></span>
              </div>
            </div>
            <div class="toggle-list" style="margin-top: 12px">
              <label class="toggle-row">
                <span>施加缩放压力测试</span>
                <span class="switch"><input id="toggle-scale" type="checkbox" /><i></i></span>
              </label>
            </div>
          </section>

          <section class="rail-section tight">
            <div class="section-head">
              <h2 class="section-title">视角</h2>
              <span class="eyebrow">CAMERA</span>
            </div>
            <div class="view-actions">
              <button class="view-action active" data-view="perspective">3/4</button>
              <button class="view-action" data-view="side">侧视</button>
              <button class="view-action" data-view="axis">轴向</button>
            </div>
            <div class="legend">
              <div class="legend-row"><span class="legend-swatch amber"></span>LBS 轮廓</div>
              <div class="legend-row"><span class="legend-swatch mint"></span>DQ 轮廓</div>
              <div class="legend-row"><span class="legend-swatch blue"></span>测量环 / 骨骼</div>
            </div>
          </section>
        </aside>

        <main class="stage-wrap" id="stage">
          <canvas id="viewport" aria-label="LBS 与双四元数蒙皮对比视图"></canvas>
          <div class="stage-head">
            <div>
              <h1 class="stage-title" id="stage-title">腕部大扭转</h1>
              <p class="stage-subtitle" id="stage-subtitle">WRIST TWIST 240° · SAME POSE, TWO DEFORMERS</p>
            </div>
            <div class="stage-chip"><i class="dot"></i><span id="pose-readout">TWIST +240.0°</span></div>
          </div>
          <div class="view-label lbs">
            <strong>LINEAR BLEND</strong>
            <span>FULL SKIN MATRIX · 4 INFLUENCES</span>
          </div>
          <div class="view-label dq">
            <strong>DUAL QUATERNION</strong>
            <span>SHORT-ARC DQ · SCALE COMPENSATED</span>
          </div>
          <div class="view-divider"></div>
          <div class="stage-foot">
            <div class="animation-readout">
              <span id="joint-label">WRIST / HAND BONE</span><br />
              <strong id="angle-readout">240.0°</strong>
              <span id="time-readout"> · t 2.00s</span>
            </div>
            <div class="view-hint">DRAG TO ORBIT · SCROLL TO ZOOM</div>
          </div>
        </main>

        <aside class="rail rail-right">
          <section class="rail-section">
            <div class="section-head">
              <h2 class="section-title">实时比较</h2>
              <span class="eyebrow" id="metric-state"><i class="dot"></i> LIVE</span>
            </div>
            <div class="metric-hero">
              <div class="metric-hero-label">
                <span>主截面面积</span>
                <span id="slice-name">WRIST · X 2.08</span>
              </div>
              <div class="metric-hero-value" id="area-hero">0.00 <small>cm²</small></div>
              <div class="metric-hero-sub" id="area-sub">DQ 保持率 100.0% · BIND 3.89 cm²</div>
            </div>
            <div class="metric-grid">
              <div class="metric-cell">
                <div class="metric-cell-label">LBS AREA RATIO</div>
                <div class="metric-cell-value amber" id="lbs-area">100.0%</div>
                <div class="metric-cell-delta" id="lbs-area-delta">Δ 0.00 cm²</div>
              </div>
              <div class="metric-cell">
                <div class="metric-cell-label">DQ AREA RATIO</div>
                <div class="metric-cell-value mint" id="dq-area">100.0%</div>
                <div class="metric-cell-delta" id="dq-area-delta">Δ 0.00 cm²</div>
              </div>
              <div class="metric-cell">
                <div class="metric-cell-label">LBS P95 EDGE</div>
                <div class="metric-cell-value amber" id="lbs-continuity">0.00%</div>
                <div class="metric-cell-delta" id="lbs-over">0 edges &gt; 5%</div>
              </div>
              <div class="metric-cell">
                <div class="metric-cell-label">DQ P95 EDGE</div>
                <div class="metric-cell-value mint" id="dq-continuity">0.00%</div>
                <div class="metric-cell-delta" id="dq-over">0 edges &gt; 5%</div>
              </div>
            </div>
            <div class="chart">
              <div class="chart-head">
                <span>各测量环面积 / cm²</span>
                <span id="chart-bind">BIND</span>
              </div>
              <div id="area-chart"></div>
            </div>
            <p class="warning-note">
              截面面积取环形顶点在最佳拟合平面上的投影面积；连续性取网格边长相对
              绑定姿势的 P95 畸变。面积越接近 <b>BIND</b>、边长畸变越低越好。
            </p>
          </section>

          <section class="rail-section">
            <div class="section-head">
              <h2 class="section-title">数值验证</h2>
              <span class="eyebrow" id="test-summary">4 / 4 PASS</span>
            </div>
            <div class="test-list" id="test-list"></div>
            <div class="evidence">
              <strong>负点积规则：</strong>以每顶点首个非零骨骼 DQ 为基准，
              <code>dot(r_i, r_pivot) &lt; 0</code> 时翻转该 DQ，再归一化双四元数；
              避免 300° 四元数沿长弧插值。
            </div>
            <div class="source-line">
              <span>ASSET</span>
              <span id="asset-meta">arm.gltf · loading</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  `;
}
