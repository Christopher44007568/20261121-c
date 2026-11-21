import { ASSEMBLY, ancestorPath, descendantParts } from "./assembly-data.js";
import { createExplosionEngine } from "./explosion.js";
import { createCamera } from "./scene-geometry.js";
import { pickScene } from "./scene.js";
import { layoutConflictGraph } from "./constraints.js";
import { CadRenderer } from "./renderer.js";

const engine = createExplosionEngine(ASSEMBLY);
const camera = createCamera({
  distance: 26,
  pitch: 0.33,
  yaw: -0.6,
  target: { x: -4.7, y: 0, z: 0 },
});
const canvas = document.querySelector("#cadCanvas");
const canvasWrap = document.querySelector("#canvasWrap");
const renderer = new CadRenderer(canvas, engine);
const treeElement = document.querySelector("#assemblyTree");
const conflictGraph = layoutConflictGraph(ASSEMBLY, 306, 166);

let selectedId = "input-gear";
let scopeMode = "assembly";
let playing = false;
let animationFrame = null;
let playFrame = null;
let renderFrame = null;
let hoverFrame = null;
let lastTimestamp = 0;
let toastTimer = null;
const collapsed = new Set();

engine.setAmount(1);

const nodeById = new Map(ASSEMBLY.nodes.map((node) => [node.id, node]));

function selectedNode() {
  return nodeById.get(selectedId) || nodeById.get("root");
}

function representativePart() {
  const node = selectedNode();
  if (node.type === "part") return node;
  return descendantParts(node.id).find((part) => !part.fixed)
    || descendantParts(node.id)[0]
    || engine.parts.find((part) => !part.fixed);
}

function nearestGroup(nodeId) {
  const path = ancestorPath(nodeId);
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (path[index].type === "group") return path[index];
  }
  return nodeById.get("root");
}

function selectedPartIds() {
  const node = selectedNode();
  if (node.type === "part") return [node.id];
  return descendantParts(node.id).map((part) => part.id);
}

function allSelectedLocked() {
  const ids = selectedPartIds().filter((id) => !nodeById.get(id)?.fixed);
  return ids.length > 0 && ids.every((id) => engine.isLocked(id));
}

function inCurrentScope(node) {
  if (engine.state.scopeId === "root") return true;
  return node.id === engine.state.scopeId
    || ancestorPath(node.id).some((item) => item.id === engine.state.scopeId);
}

function treeMatches(node) {
  const query = document.querySelector("#treeSearch").value.trim().toLowerCase();
  if (!query) return true;
  return `${node.name} ${node.code}`.toLowerCase().includes(query);
}

function hasCollapsedAncestor(node) {
  return ancestorPath(node.id).slice(0, -1).some((ancestor) => collapsed.has(ancestor.id));
}

function groupIcon() {
  return `<svg viewBox="0 0 18 18"><path d="m9 2 6 3.3v7.2L9 16l-6-3.5V5.3L9 2Z"/><path d="m3 5.3 6 3.4 6-3.4M9 8.7V16"/></svg>`;
}

function lockIcon() {
  return `<svg viewBox="0 0 12 12"><rect x="2.5" y="5.2" width="7" height="5" rx="1.2"/><path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4"/></svg>`;
}

function renderTree() {
  const query = document.querySelector("#treeSearch").value.trim().toLowerCase();
  const matched = new Set(
    ASSEMBLY.nodes
      .filter((node) => treeMatches(node))
      .flatMap((node) => ancestorPath(node.id).map((item) => item.id)),
  );
  const rows = [];
  for (const node of ASSEMBLY.nodes) {
    if (query && !matched.has(node.id)) continue;
    if (!query && hasCollapsedAncestor(node)) continue;
    const path = ancestorPath(node.id);
    const depth = Math.max(0, path.length - 1);
    const children = ASSEMBLY.nodes.filter((child) => child.parentId === node.id);
    const isCollapsed = collapsed.has(node.id);
    const locked = node.type === "part" && engine.isLocked(node.id);
    const classes = [
      "tree-row",
      node.type === "group" || node.type === "assembly" ? "is-group" : "is-part",
      node.id === selectedId ? "selected" : "",
      isCollapsed ? "collapsed" : "",
      inCurrentScope(node) && engine.state.scopeId !== "root" ? "in-scope" : "",
      locked ? "locked" : "",
    ].filter(Boolean).join(" ");
    let symbol;
    if (node.type === "part") {
      symbol = `<span class="tree-symbol part" style="--part-color:${node.color}"></span>`;
    } else {
      symbol = `<span class="tree-symbol">${groupIcon()}</span>`;
    }
    const count = node.type === "part" ? "" : `<span class="tree-count">${descendantParts(node.id).length}</span>`;
    const lock = node.type === "part" && locked ? `<span class="tree-lock">${lockIcon()}</span>` : "";
    const chevron = children.length
      ? `<button class="tree-chevron" data-action="toggle" aria-label="${isCollapsed ? "展开" : "折叠"} ${node.name}"><svg viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3"/></svg></button>`
      : `<span class="tree-spacer"></span>`;
    rows.push(`
      <div class="${classes}" data-id="${node.id}" role="treeitem" tabindex="0" style="--depth:${depth}">
        ${chevron}
        ${symbol}
        <span class="tree-code">${node.code}</span>
        <span class="tree-name">${node.name}</span>
        ${lock}
        ${count}
      </div>
    `);
  }
  treeElement.innerHTML = rows.length
    ? rows.join("")
    : `<div class="tree-empty">没有匹配的零件</div>`;
}

treeElement.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-action='toggle']");
  const row = event.target.closest(".tree-row");
  if (!row) return;
  if (toggle) {
    const id = row.dataset.id;
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    renderTree();
    return;
  }
  selectNode(row.dataset.id);
});

treeElement.addEventListener("keydown", (event) => {
  const row = event.target.closest(".tree-row");
  if (!row) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectNode(row.dataset.id);
  }
});

document.querySelector("#treeSearch").addEventListener("input", renderTree);

function selectNode(id) {
  const node = nodeById.get(id);
  if (!node) return;
  selectedId = id;
  if (scopeMode === "local") {
    if (node.type === "part") engine.setScope(nearestGroup(id).id);
    else engine.setScope(id);
  }
  renderTree();
  requestRender();
}

function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return "—";
  const clean = Math.abs(value) < 0.0005 ? 0 : value;
  return clean.toFixed(digits);
}

function pathLabel(node) {
  const path = ancestorPath(node.id).slice(1).map((item) => item.name);
  return path.length ? path.join(" / ") : "总装";
}

function updateMatrix(part, amount) {
  const matrix = engine.matrixAt(part.id, amount);
  const values = [
    matrix[0], matrix[4], matrix[8], matrix[12],
    matrix[1], matrix[5], matrix[9], matrix[13],
    matrix[2], matrix[6], matrix[10], matrix[14],
    matrix[3], matrix[7], matrix[11], matrix[15],
  ];
  const grid = document.querySelector("#matrixGrid");
  grid.innerHTML = values.map((value, index) => {
    const translation = [3, 7, 11, 15].includes(index) ? " translation" : "";
    return `<span class="matrix-cell${translation}">${formatNumber(value)}</span>`;
  }).join("");
}

function updateSelection() {
  const node = selectedNode();
  const part = representativePart();
  const trajectory = engine.trajectory(part.id);
  const locked = engine.isLocked(part.id) || part.fixed;
  const amount = engine.state.amount;
  const axis = engine.state.axis;
  const axisDelta = trajectory.delta[axis];
  const sign = Math.abs(axisDelta) < 0.0005 ? "—" : axisDelta < 0 ? "−" : "+";
  const transformStatus = document.querySelector("#transformStatus");
  const partLockButton = document.querySelector("#partLockButton");

  document.querySelector("#selectionIndex").textContent = node.code;
  document.querySelector("#selectionName").textContent = node.name;
  document.querySelector("#selectionPath").textContent = pathLabel(node);
  document.querySelector("#travelDistance").textContent = formatNumber(trajectory.distance);
  document.querySelector("#lockState").textContent = locked ? "YES" : "NO";
  document.querySelector("#vectorLabel").textContent =
    `${sign}${axis.toUpperCase()} / ${formatNumber(Math.abs(axisDelta), 3)}`;
  transformStatus.textContent = amount === 0
    ? "RESET"
    : amount >= 0.999 ? "EXPLODED" : locked ? "LOCKED" : "MOVING";
  transformStatus.classList.toggle("locked", locked || amount === 0);

  const ids = selectedPartIds().filter((id) => !nodeById.get(id)?.fixed);
  const allLocked = allSelectedLocked();
  const targetLabel = node.type === "part" ? "当前零件" : "组内零件";
  partLockButton.querySelector("span").textContent =
    allLocked ? `解除${targetLabel}锁定` : `锁定${targetLabel}`;
  partLockButton.classList.toggle("active", allLocked);
  partLockButton.disabled = ids.length === 0;
  updateMatrix(part, amount);
}

function updateClearance() {
  const amount = engine.state.amount;
  const report = engine.clearanceReport(amount);
  const label = Number.isFinite(report.distance)
    ? `${formatNumber(report.distance, 3)} mm`
    : "— mm";
  document.querySelector("#timelineGap").textContent = label;
}

function syncUI() {
  const amount = engine.state.amount;
  const axis = engine.state.axis;
  const percentage = Math.round(amount * 100);
  const scopeNode = nodeById.get(engine.state.scopeId) || nodeById.get("root");
  const ranges = document.querySelectorAll("#explodeRange");
  ranges.forEach((range) => { range.value = String(percentage); });
  document.querySelector("#amountValue").textContent = `${percentage}%`;
  document.querySelector("#amountFill").style.width = `${percentage}%`;
  document.querySelector("#timelineValue").textContent = amount.toFixed(2);
  document.querySelector("#axisState").innerHTML = `AXIS <b>${axis.toUpperCase()}</b>`;
  document.querySelector("#axisDescription").textContent = {
    x: "主轴 / 水平",
    y: "装配 / 竖直",
    z: "装配 / 纵深",
  }[axis];
  document.querySelector("#scopeLabel").textContent =
    scopeNode.id === "root" ? "整个总装" : scopeNode.name;
  document.querySelector("#matrixState").innerHTML =
    `<i></i> ${amount === 0 ? "RESET" : "LIVE"}`;
  document.querySelector("#axialLock").checked = engine.state.axialLock;
  document.querySelector("#labelsToggle").classList.toggle("active", renderer.showLabels);
  document.querySelectorAll(".axis-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.axis === axis);
  });
  document.querySelector("#scopeAssembly").classList.toggle("active", scopeMode === "assembly");
  document.querySelector("#scopeLocal").classList.toggle("active", scopeMode === "local");
  document.documentElement.style.setProperty(
    "--axis-color",
    `var(--axis-${axis})`,
  );
  document.querySelector("#partCount").textContent =
    `${ASSEMBLY.nodes.filter((node) => node.type === "part").length} COMPONENTS`;
  updateSelection();
  updateClearance();
}

function drawScene() {
  renderer.selectedId = selectedId;
  renderer.draw(camera);
  syncUI();
}

function requestRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    drawScene();
  });
}

function shortNodeName(name) {
  return name.replace(/\s+\d+[A-Z]*$/, "").replace(/[A-Za-z0-9]+$/, "").slice(0, 6);
}

function graphSvg(graph, prefix) {
  const marker = `arrow-${prefix}`;
  const edges = graph.graphEdges.map((edge) => {
    const { source, target } = edge;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    let start;
    let end;
    let controlA;
    let controlB;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const direction = Math.sign(dx) || 1;
      start = { x: source.x + direction * 36, y: source.y };
      end = { x: target.x - direction * 36, y: target.y };
      const middle = (start.x + end.x) / 2;
      controlA = { x: middle, y: start.y };
      controlB = { x: middle, y: end.y };
    } else {
      const direction = Math.sign(dy) || 1;
      start = { x: source.x, y: source.y + direction * 17 };
      end = { x: target.x, y: target.y - direction * 17 };
      const bend = edge.conflict
        ? (edge.from.localeCompare(edge.to) < 0 ? 34 : -34)
        : 0;
      controlA = { x: start.x + bend, y: start.y };
      controlB = { x: end.x + bend, y: end.y };
    }
    const markerEnd = edge.conflict ? `${marker}-danger` : marker;
    return `<path class="graph-edge${edge.conflict ? " conflict" : ""}" d="M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}" marker-end="url(#${markerEnd})"><title>${edge.reason}</title></path>`;
  }).join("");
  const nodes = graph.graphNodes.map((node) => `
    <g class="graph-node${node.conflict ? " conflict" : ""}" transform="translate(${node.x} ${node.y})">
      <title>${node.label}</title>
      <rect x="-36" y="-16" width="72" height="32" rx="5" />
      <text y="-2">${node.code}</text>
      <text class="node-name" y="9">${shortNodeName(node.label)}</text>
    </g>
  `).join("");
  return `
    <svg viewBox="0 0 ${graph.width} ${graph.height}" role="img" aria-label="拆卸先后关系图">
      <defs>
        <marker id="${marker}" viewBox="0 0 7 7" refX="6" refY="3.5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="rgba(138,166,186,0.55)"></path>
        </marker>
        <marker id="${marker}-danger" viewBox="0 0 7 7" refX="6" refY="3.5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="rgba(255,111,101,0.8)"></path>
        </marker>
      </defs>
      ${edges}
      ${nodes}
    </svg>
  `;
}

function renderConstraintGraphs() {
  document.querySelector("#constraintGraph").innerHTML = graphSvg(conflictGraph, "panel");
  const dialogGraph = layoutConflictGraph(ASSEMBLY, 620, 220);
  document.querySelector("#dialogGraph").innerHTML = graphSvg(dialogGraph, "dialog");
}

renderConstraintGraphs();

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1900);
}

function stopPlayback() {
  playing = false;
  if (playFrame) cancelAnimationFrame(playFrame);
  playFrame = null;
  const icon = document.querySelector("#playIcon");
  icon.innerHTML = `<path d="m7 4 9 6-9 6V4Z" />`;
}

function setPlayingIcon() {
  document.querySelector("#playIcon").innerHTML = playing
    ? `<path d="M6.5 4.5v11M13.5 4.5v11" stroke-width="2.1" />`
    : `<path d="m7 4 9 6-9 6V4Z" />`;
}

function togglePlayback() {
  if (playing) {
    stopPlayback();
    return;
  }
  const startAmount = engine.state.amount >= 0.995 ? 0 : engine.state.amount;
  if (startAmount === 0) engine.setAmount(0);
  playing = true;
  setPlayingIcon();
  const startedAt = performance.now();
  const duration = Math.max(650, (1 - startAmount) * 1650);
  const tick = (now) => {
    if (!playing) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    engine.setAmount(startAmount + (1 - startAmount) * eased);
    requestRender();
    if (progress < 1) {
      playFrame = requestAnimationFrame(tick);
    } else {
      playing = false;
      playFrame = null;
      setPlayingIcon();
      requestRender();
    }
  };
  playFrame = requestAnimationFrame(tick);
}

function resetCamera() {
  camera.yaw = -0.6;
  camera.pitch = 0.33;
  camera.distance = 26;
  camera.target = { x: -4.7, y: 0, z: 0 };
  requestRender();
}

function setScopeMode(mode) {
  scopeMode = mode;
  if (mode === "assembly") {
    engine.setScope("root");
  } else {
    const node = selectedNode();
    engine.setScope(node.type === "part" ? nearestGroup(node.id).id : node.id);
  }
  renderTree();
  requestRender();
}

function toggleSelectedPartLock() {
  const ids = selectedPartIds().filter((id) => !nodeById.get(id)?.fixed);
  if (!ids.length) {
    showToast("固定件不可解除锁定");
    return;
  }
  const shouldLock = !allSelectedLocked();
  ids.forEach((id) => engine.setLocked(id, shouldLock));
  renderTree();
  requestRender();
  showToast(shouldLock ? "已锁定所选零件的轴向位移" : "已解除所选零件锁定");
}

function exportView() {
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = canvas.height;
  const context = output.getContext("2d");
  context.fillStyle = "#070c12";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(canvas, 0, 0);
  const link = document.createElement("a");
  link.download = `RG-204-explode-${Math.round(engine.state.amount * 100)}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
  showToast("视图已导出为 PNG");
}

document.querySelector("#explodeRange").addEventListener("input", (event) => {
  stopPlayback();
  engine.setAmount(Number(event.target.value) / 100);
  requestRender();
});

document.querySelectorAll(".axis-button").forEach((button) => {
  button.addEventListener("click", () => {
    engine.setAxis(button.dataset.axis);
    showToast(`装配轴切换为 ${button.dataset.axis.toUpperCase()}，位移保持可逆`);
    requestRender();
  });
});

document.querySelector("#scopeAssembly").addEventListener("click", () => setScopeMode("assembly"));
document.querySelector("#scopeLocal").addEventListener("click", () => setScopeMode("local"));

document.querySelector("#axialLock").addEventListener("change", (event) => {
  engine.setAxialLock(event.target.checked);
  showToast(event.target.checked
    ? "轴向锁定开启：仅保留装配轴分量"
    : "轴向锁定关闭：显示侧向漂移分量");
  requestRender();
});

document.querySelector("#partLockButton").addEventListener("click", toggleSelectedPartLock);
document.querySelector("#playButton").addEventListener("click", togglePlayback);
document.querySelector("#resetCameraButton").addEventListener("click", resetCamera);

document.querySelector("#resetButton").addEventListener("click", () => {
  stopPlayback();
  const matrices = engine.reset();
  renderTree();
  requestRender();
  showToast(`已复位 ${matrices.size} 个变换矩阵`);
});

document.querySelector("#labelsToggle").addEventListener("click", () => {
  renderer.showLabels = !renderer.showLabels;
  requestRender();
});

document.querySelector("#focusButton").addEventListener("click", () => {
  const part = representativePart();
  camera.target = engine.positionAt(part.id);
  camera.distance = 13.5;
  requestRender();
  showToast(`已聚焦 ${part.code} ${part.name}`);
});

document.querySelector("#copyMatrix").addEventListener("click", async () => {
  const part = representativePart();
  const matrix = engine.matrixAt(part.id);
  const text = [
    matrix[0], matrix[4], matrix[8], matrix[12],
    matrix[1], matrix[5], matrix[9], matrix[13],
    matrix[2], matrix[6], matrix[10], matrix[14],
    matrix[3], matrix[7], matrix[11], matrix[15],
  ].map((value) => formatNumber(value, 6)).join(" ");
  try {
    await navigator.clipboard.writeText(text);
    showToast("世界矩阵已复制");
  } catch {
    showToast("浏览器未授权剪贴板");
  }
});

document.querySelector("#collapseButton").addEventListener("click", () => {
  const groups = ASSEMBLY.nodes.filter((node) => node.type === "group");
  const allCollapsed = groups.every((group) => collapsed.has(group.id));
  groups.forEach((group) => {
    if (allCollapsed) collapsed.delete(group.id);
    else collapsed.add(group.id);
  });
  renderTree();
});

const pointer = {
  active: false,
  dragging: false,
  id: null,
  startX: 0,
  startY: 0,
  yaw: 0,
  pitch: 0,
};

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function updateHover(event) {
  if (pointer.active || !renderer.layout) return;
  const point = canvasPoint(event);
  const hit = pickScene(renderer.layout, point);
  const nextId = hit?.id || null;
  if (renderer.hoveredId !== nextId) {
    renderer.hoveredId = nextId;
    requestRender();
  }
  const tooltip = document.querySelector("#hoverTooltip");
  if (!hit) {
    tooltip.style.display = "none";
    canvas.style.cursor = "grab";
    return;
  }
  const item = hit.item;
  tooltip.innerHTML =
    `<strong>${item.part.code} · ${item.part.name}</strong><small>${item.trajectory.locked ? "LOCKED" : `${formatNumber(item.trajectory.distance)} mm TRAVEL`} · 点击选中</small>`;
  tooltip.style.display = "block";
  const wrapRect = canvasWrap.getBoundingClientRect();
  tooltip.style.left = `${Math.min(wrapRect.width - 220, Math.max(8, point.x + 15))}px`;
  tooltip.style.top = `${Math.min(wrapRect.height - 55, Math.max(8, point.y + 15))}px`;
  canvas.style.cursor = "pointer";
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pointer.active = true;
  pointer.dragging = false;
  pointer.id = event.pointerId;
  pointer.startX = event.clientX;
  pointer.startY = event.clientY;
  pointer.yaw = camera.yaw;
  pointer.pitch = camera.pitch;
  canvas.setPointerCapture(event.pointerId);
  document.querySelector("#hoverTooltip").style.display = "none";
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointer.active) {
    updateHover(event);
    return;
  }
  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;
  if (!pointer.dragging && Math.hypot(dx, dy) > 3) {
    pointer.dragging = true;
    canvas.classList.add("dragging");
    document.querySelector("#hoverTooltip").style.display = "none";
  }
  if (!pointer.dragging) return;
  camera.yaw = pointer.yaw - dx * 0.0072;
  camera.pitch = Math.max(0.06, Math.min(1.18, pointer.pitch + dy * 0.006));
  requestRender();
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointer.active) return;
  const wasDragging = pointer.dragging;
  pointer.active = false;
  pointer.dragging = false;
  pointer.id = null;
  canvas.classList.remove("dragging");
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  if (!wasDragging && renderer.layout) {
    const hit = pickScene(renderer.layout, canvasPoint(event));
    if (hit) selectNode(hit.id);
  }
});

canvas.addEventListener("pointercancel", () => {
  pointer.active = false;
  pointer.dragging = false;
  pointer.id = null;
  canvas.classList.remove("dragging");
});

canvas.addEventListener("pointerleave", () => {
  if (pointer.active) return;
  renderer.hoveredId = null;
  document.querySelector("#hoverTooltip").style.display = "none";
  canvas.style.cursor = "grab";
  requestRender();
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  camera.distance = Math.max(9.5, Math.min(44, camera.distance + event.deltaY * 0.012));
  requestRender();
}, { passive: false });

canvas.addEventListener("dblclick", resetCamera);

const dialog = document.querySelector("#conflictDialog");
document.querySelector("#conflictButton").addEventListener("click", () => {
  dialog.showModal();
});
document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
document.querySelector("#dialogDismiss").addEventListener("click", () => dialog.close());
document.querySelector("#highlightConflict").addEventListener("click", () => {
  selectedId = "input-bearing";
  if (scopeMode === "local") engine.setScope("input-group");
  dialog.close();
  renderTree();
  requestRender();
  requestAnimationFrame(() => {
    const row = treeElement.querySelector("[data-id='input-bearing']");
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.classList.add("flash");
    setTimeout(() => row?.classList.remove("flash"), 1500);
  });
  showToast("已定位冲突环中的输入轴承 B2");
});

dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outside) dialog.close();
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if (typing) return;
  if (event.key === "l" || event.key === "L") {
    event.preventDefault();
    toggleSelectedPartLock();
  } else if (event.key === "/") {
    event.preventDefault();
    document.querySelector("#treeSearch").focus();
  } else if (["x", "X", "y", "Y", "z", "Z"].includes(event.key)) {
    engine.setAxis(event.key.toLowerCase());
    requestRender();
  } else if (event.key === " " && !dialog.open) {
    event.preventDefault();
    togglePlayback();
  }
});

window.addEventListener("resize", requestRender);

renderTree();
requestAnimationFrame(() => {
  drawScene();
  if (document.fonts?.ready) {
    document.fonts.ready.then(requestRender);
  }
});
