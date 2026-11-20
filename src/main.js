import "./style.css";
import { measurePose } from "./metrics.js";
import { appTemplate } from "./template.js";
import { runValidation } from "./validation.js";
import { SkinViewer } from "./viewer.js";

const app = document.querySelector("#app");
app.innerHTML = appTemplate();

const animationInfo = {
  wrist: {
    title: "腕部大扭转",
    subtitle: "WRIST TWIST 240° · SAME POSE, TWO DEFORMERS",
    joint: "WRIST / HAND BONE",
    slice: "WRIST · X 2.08",
    angleKey: "wrist",
    anglePrefix: "TWIST",
  },
  elbow: {
    title: "肘部弯曲",
    subtitle: "ELBOW BEND 110° · SAME POSE, TWO DEFORMERS",
    joint: "ELBOW / FOREARM BONE",
    slice: "ELBOW · X 1.12",
    angleKey: "elbow",
    anglePrefix: "BEND",
  },
};

const elements = {
  renderStatus: document.querySelector("#render-status"),
  metricState: document.querySelector("#metric-state"),
  stageTitle: document.querySelector("#stage-title"),
  stageSubtitle: document.querySelector("#stage-subtitle"),
  poseReadout: document.querySelector("#pose-readout"),
  jointLabel: document.querySelector("#joint-label"),
  angleReadout: document.querySelector("#angle-readout"),
  timeReadout: document.querySelector("#time-readout"),
  timecode: document.querySelector("#timecode"),
  timeline: document.querySelector("#timeline"),
  playToggle: document.querySelector("#play-toggle"),
  playIcon: document.querySelector("#play-icon"),
  sliceName: document.querySelector("#slice-name"),
  areaHero: document.querySelector("#area-hero"),
  areaSub: document.querySelector("#area-sub"),
  lbsArea: document.querySelector("#lbs-area"),
  dqArea: document.querySelector("#dq-area"),
  lbsAreaDelta: document.querySelector("#lbs-area-delta"),
  dqAreaDelta: document.querySelector("#dq-area-delta"),
  lbsContinuity: document.querySelector("#lbs-continuity"),
  dqContinuity: document.querySelector("#dq-continuity"),
  lbsOver: document.querySelector("#lbs-over"),
  dqOver: document.querySelector("#dq-over"),
  chart: document.querySelector("#area-chart"),
  chartBind: document.querySelector("#chart-bind"),
  testList: document.querySelector("#test-list"),
  testSummary: document.querySelector("#test-summary"),
  assetMeta: document.querySelector("#asset-meta"),
};

function renderValidation() {
  const tests = runValidation();
  elements.testList.innerHTML = tests
    .map(
      (test) => `
        <div class="test-row" data-test="${test.id}">
          <button class="test-summary" aria-expanded="false">
            <span>
              <span class="test-title">${test.title}</span>
              <span class="test-sub">${test.subtitle}</span>
              <span class="test-sub test-value">${test.value}</span>
            </span>
            <span class="test-state ${test.pass ? "" : "fail"}">
              <i class="dot ${test.pass ? "" : "coral"}"></i>${test.pass ? "PASS" : "FAIL"}
            </span>
          </button>
          <div class="test-detail">${test.detail}</div>
        </div>
      `,
    )
    .join("");
  const passed = tests.filter((test) => test.pass).length;
  elements.testSummary.textContent = `${passed} / ${tests.length} PASS`;
  elements.testSummary.style.color =
    passed === tests.length ? "var(--mint)" : "var(--coral)";

  elements.testList.querySelectorAll(".test-summary").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".test-row");
      const open = row.classList.toggle("open");
      button.setAttribute("aria-expanded", String(open));
    });
  });
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatArea(value) {
  return `${value.toFixed(2)} cm²`;
}

function renderChart(measurements, animation) {
  if (elements.chart.dataset.animation !== animation) {
    elements.chart.dataset.animation = animation;
    elements.chart.innerHTML = measurements.rings
      .map(
        (ring) => `
          <div class="ring-row" data-ring="${ring.ring}">
            <span>X${ring.x.toFixed(2)}</span>
            <span class="ring-bars">
              <i class="ring-bar lbs"></i>
              <i class="ring-bar dq"></i>
            </span>
            <span class="ring-value">—</span>
          </div>
        `,
      )
      .join("");
  }
  elements.chartBind.textContent = `BIND ${measurements.bindMean.toFixed(2)}`;
  measurements.rings.forEach((ring) => {
    const row = elements.chart.querySelector(`[data-ring="${ring.ring}"]`);
    if (!row) return;
    const lbsRatio = ring.bind ? ring.lbs / ring.bind : 0;
    const dqRatio = ring.bind ? ring.dq / ring.bind : 0;
    const scale = Math.max(1.15, lbsRatio, dqRatio);
    row.querySelector(".ring-bar.lbs").style.width = `${(lbsRatio / scale) * 100}%`;
    row.querySelector(".ring-bar.dq").style.width = `${(dqRatio / scale) * 100}%`;
    row.querySelector(".ring-value").textContent =
      `${Math.round(lbsRatio * 100)}/${Math.round(dqRatio * 100)}`;
  });
}

function updateMetrics(result, state) {
  const info = animationInfo[state.animation];
  const measurements = measurePose({
    bindPositions: result.bindPositions,
    lbsPositions: result.lbs,
    dqPositions: result.dq,
    meta: state.meta,
    animation: state.animation,
    edges: state.viewer.edges,
  });
  const primary = measurements.primary;
  const bindArea = Math.max(primary.bind, 1e-9);
  const lbsRatio = primary.lbs / bindArea;
  const dqRatio = primary.dq / bindArea;
  const lbsDelta = primary.lbs - primary.bind;
  const dqDelta = primary.dq - primary.bind;

  elements.areaHero.innerHTML = `${primary.dq.toFixed(2)} <small>cm²</small>`;
  elements.areaSub.textContent =
    `DQ 保持率 ${formatPercent(dqRatio)} · BIND ${formatArea(primary.bind)}`;
  elements.lbsArea.textContent = formatPercent(lbsRatio);
  elements.dqArea.textContent = formatPercent(dqRatio);
  elements.lbsAreaDelta.textContent = `Δ ${lbsDelta >= 0 ? "+" : ""}${lbsDelta.toFixed(2)} cm²`;
  elements.dqAreaDelta.textContent = `Δ ${dqDelta >= 0 ? "+" : ""}${dqDelta.toFixed(2)} cm²`;
  elements.lbsContinuity.textContent = formatPercent(measurements.lbsContinuity.p95);
  elements.dqContinuity.textContent = formatPercent(measurements.dqContinuity.p95);
  elements.lbsOver.textContent =
    `${measurements.lbsContinuity.overFivePercent} edges > 5%`;
  elements.dqOver.textContent =
    `${measurements.dqContinuity.overFivePercent} edges > 5%`;
  elements.sliceName.textContent = info.slice;
  renderChart(measurements, state.animation);

  const angle = result.angles[info.angleKey];
  elements.poseReadout.textContent = `${info.anglePrefix} +${angle.toFixed(1)}°`;
  elements.angleReadout.textContent = `${angle.toFixed(1)}°`;
  elements.jointLabel.textContent = info.joint;
  elements.timeReadout.textContent = ` · t ${result.time.toFixed(2)}s`;
  elements.timeline.value = result.time.toFixed(2);
  elements.timeline.style.setProperty(
    "--progress",
    `${(result.time / 4) * 100}%`,
  );
  elements.timecode.textContent = `${result.time.toFixed(2)} / 4.00s`;
}

async function start() {
  renderValidation();
  let meta;
  try {
    meta = await fetch("/arm-meta.json").then((response) => {
      if (!response.ok) throw new Error(`meta ${response.status}`);
      return response.json();
    });
    const viewer = new SkinViewer(document.querySelector("#viewport"), meta);
    viewer.setStatus((text) => {
      elements.renderStatus.textContent = text;
    });
    await viewer.load("/arm.gltf");
    elements.renderStatus.textContent = "WEBGL · READY";
    elements.assetMeta.textContent =
      `arm.gltf · ${viewer.positions.length / 3} v · ${viewer.indices.length / 3} tri · ${viewer.gltf.animations.length} clips`;

    const state = {
      animation: "wrist",
      playing: true,
      meta,
      viewer,
    };
    applyAnimation(state, "wrist");

    document.querySelectorAll("[data-animation]").forEach((button) => {
      button.addEventListener("click", () => {
        const animation = button.dataset.animation;
        if (animation === state.animation) return;
        applyAnimation(state, animation);
      });
    });

    elements.playToggle.addEventListener("click", () => {
      state.playing = !state.playing;
      viewer.setPlaying(state.playing);
      elements.playIcon.innerHTML = state.playing
        ? '<path d="M2 1h3v10H2zm5 0h3v10H7z" />'
        : '<path d="M2 1l9 5-9 5z" />';
      elements.playToggle.setAttribute(
        "aria-label",
        state.playing ? "暂停动画" : "播放动画",
      );
    });

    elements.timeline.addEventListener("input", () => {
      viewer.setTime(Number(elements.timeline.value));
    });
    document.querySelector("#toggle-skeleton").addEventListener("change", (event) => {
      viewer.setSkeletonVisible(event.target.checked);
    });
    document.querySelector("#toggle-rings").addEventListener("change", (event) => {
      viewer.setRingsVisible(event.target.checked);
    });
    document.querySelector("#toggle-wire").addEventListener("change", (event) => {
      viewer.setWireVisible(event.target.checked);
    });
    document.querySelector("#toggle-scale").addEventListener("change", (event) => {
      viewer.setScaleStress(event.target.checked);
    });
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-view]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
        viewer.setView(button.dataset.view);
      });
    });

    let lastTime = performance.now();
    let lastUi = 0;
    function frame(now) {
      const delta = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const result = viewer.update(delta);
      if (now - lastUi > 55) {
        updateMetrics(result, state);
        lastUi = now;
      }
      viewer.render();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    elements.renderStatus.textContent = "LOAD ERROR";
    elements.assetMeta.textContent = error.message;
    elements.metricState.innerHTML = '<i class="dot coral"></i> ERROR';
    const stage = document.querySelector("#stage");
    stage.insertAdjacentHTML(
      "beforeend",
      `<div class="load-error">无法加载 glTF 资产：${error.message}</div>`,
    );
  }
}

function applyAnimation(state, animation) {
  state.animation = animation;
  state.viewer.setAnimation(animation);
  const info = animationInfo[animation];
  document.querySelectorAll("[data-animation]").forEach((button) => {
    const active = button.dataset.animation === animation;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.stageTitle.textContent = info.title;
  elements.stageSubtitle.textContent = info.subtitle;
}

start();
