// Browser-side interaction layer: runs the exact same boolean engine used by
// the Node tests and renders polygons, holes and degenerate edges on canvas.

import { booleanPolygons } from "../src/index.js";
import { fixtures } from "../test/fixtures.js";

const state = {
  fixture: "crossingSquares",
  operation: "union",
  showDegenerate: true,
  showGrid: true,
};

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const OP_COLORS = {
  union: "#2f7d4f",
  intersection: "#2456a6",
  difference: "#b35418",
  xor: "#7a3fa0",
};

export function init() {
  const fixtureSelect = document.getElementById("fixture");
  for (const name of Object.keys(fixtures)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    fixtureSelect.appendChild(option);
  }
  fixtureSelect.value = state.fixture;
  fixtureSelect.addEventListener("change", () => {
    state.fixture = fixtureSelect.value;
    run();
  });

  document.querySelectorAll("[data-op]").forEach((button) => {
    button.addEventListener("click", () => {
      state.operation = button.dataset.op;
      document.querySelectorAll("[data-op]").forEach((b) => b.classList.toggle("active", b === button));
      run();
    });
  });
  document.getElementById("toggle-degenerate").addEventListener("change", (e) => {
    state.showDegenerate = e.target.checked;
    run();
  });
  document.getElementById("toggle-grid").addEventListener("change", (e) => {
    state.showGrid = e.target.checked;
    run();
  });
  run();
}

function run() {
  const result = booleanPolygons(fixtures[state.fixture], { operation: state.operation });
  render(result);
  renderDiagnostics(result);
  renderMetrics(result);
}

function toNumber(point) {
  return { x: Number(point.x), y: Number(point.y) };
}

function computeBounds(result) {
  const points = [];
  for (const set of result.quantizedInputs) {
    for (const poly of set.polygons) {
      for (const ring of poly.rings) ring.forEach((p) => points.push(toNumber(p)));
    }
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function render(result) {
  const bounds = computeBounds(result);
  const width = canvas.width;
  const height = canvas.height;
  const pad = 28;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const project = (p) => ({
    x: pad + (p.x - bounds.minX) * scale,
    y: height - pad - (p.y - bounds.minY) * scale,
  });

  ctx.clearRect(0, 0, width, height);
  if (state.showGrid) drawGrid(bounds, project, width, height);
  drawInputs(result, project);
  drawResult(result, project);
  if (state.showDegenerate) drawDegenerate(result, project);
}

function drawGrid(bounds, project, width, height) {
  ctx.strokeStyle = "#e6e8ec";
  ctx.lineWidth = 1;
  for (let x = Math.floor(bounds.minX); x <= Math.ceil(bounds.maxX); x++) {
    const from = project({ x, y: bounds.minY });
    const to = project({ x, y: bounds.maxY });
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  for (let y = Math.floor(bounds.minY); y <= Math.ceil(bounds.maxY); y++) {
    const from = project({ x: bounds.minX, y });
    const to = project({ x: bounds.maxX, y });
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

function traceRing(ring, project) {
  ctx.beginPath();
  ring.forEach((point, index) => {
    const p = project(toNumber(point));
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

function drawInputs(result, project) {
  const colors = ["rgba(60,110,200,0.10)", "rgba(210,120,40,0.10)"];
  result.quantizedInputs.forEach((set, setIndex) => {
    ctx.fillStyle = colors[setIndex % colors.length];
    ctx.strokeStyle = setIndex === 0 ? "#3c6ec8" : "#d27828";
    ctx.lineWidth = 1.5;
    for (const poly of set.polygons) {
      for (const ring of poly.rings) {
        traceRing(ring, project);
        ctx.fill();
        ctx.stroke();
      }
    }
  });
}

function drawResult(result, project) {
  ctx.fillStyle = withAlpha(OP_COLORS[result.operation], 0.28);
  ctx.strokeStyle = OP_COLORS[result.operation];
  ctx.lineWidth = 2.5;
  for (const poly of result.polygons) {
    traceRing(poly.outer, project);
    ctx.fill();
    ctx.stroke();
    for (const hole of poly.holes) {
      traceRing(hole, project);
      ctx.strokeStyle = "#c0392b";
      ctx.stroke();
      ctx.strokeStyle = OP_COLORS[result.operation];
    }
  }
}

function drawDegenerate(result, project) {
  for (const edge of result.degenerateEdges) {
    const a = project(toNumber(edge.a));
    const b = project(toNumber(edge.b));
    const color = edge.tags.includes("cancelled") ? "#c0392b" : "#8a6d3b";
    ctx.strokeStyle = color;
    ctx.lineWidth = edge.tags.includes("cancelled") ? 3 : 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function withAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderDiagnostics(result) {
  const panel = document.getElementById("diagnostics");
  if (!result.diagnostics.length) {
    panel.innerHTML = '<li class="ok">无诊断信息</li>';
    return;
  }
  panel.innerHTML = result.diagnostics
    .map((entry) => `<li class="${entry.severity}"><code>${entry.code}</code> ${entry.message}</li>`)
    .join("");
}

function renderMetrics(result) {
  const panel = document.getElementById("metrics");
  const rows = [
    ["多边形数", result.metrics.polygonCount],
    ["原子边", result.metrics.atomicEdges],
    ["边界边", result.metrics.boundaryEdges],
    ["环数", result.metrics.loopCount],
    ["可三角化", result.metrics.triangulable ? "是" : "否"],
  ];
  panel.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join("");
}
