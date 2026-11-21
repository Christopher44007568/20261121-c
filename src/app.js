import { lookAt, multiply, perspective, clamp } from "./math.js";
import { buildTrees, cameraPose, meshTriangleCount, PROXY_TRIANGLES, terrainHeight } from "./scene.js";
import { evaluateFrame, LOD_BAND, MODE } from "./lod.js";
import { Renderer } from "./renderer.js";
import { runReverseCheck } from "./verify.js";

const canvas = document.getElementById("gl");
const FOVY = Math.PI / 3.6;
const WALK = { zStart: -110, zEnd: 120, speed: 4.2 };

const state = {
  mode: MODE.AUTO,
  z: WALK.zStart,
  dir: 1,
  running: true,
  frame: 0,
  trees: buildTrees(),
  lastResult: null,
};

const renderer = new Renderer(canvas);
renderer.buildTerrain(terrainHeight);
renderer.buildTreeMesh();
renderer.buildProxy();

const meshTris = meshTriangleCount();

function viewport() {
  const [w, h] = renderer.resize();
  const proj = perspective(FOVY, w / h, 0.5, 600);
  const { eye, look } = cameraPose(state.z);
  const view = lookAt(eye, look, [0, 1, 0]);
  const vp = multiply(proj, view);
  return { vp, eye, w, h };
}

function trianglesOf(records, trees, mode) {
  let tris = 0;
  for (const rec of records) {
    // In the fade band both streams contribute; weight-accounted triangle load.
    if (rec.weight > 0.001) tris += meshTris;
    if (rec.weight < 0.999) tris += PROXY_TRIANGLES;
  }
  return tris;
}

function tick(dt) {
  if (state.running) {
    state.z += state.dir * WALK.speed * dt;
    if (state.z >= WALK.zEnd) { state.z = WALK.zEnd; state.dir = -1; }
    if (state.z <= WALK.zStart) { state.z = WALK.zStart; state.dir = 1; }
  }
  state.frame++;

  const { vp, eye, w, h } = viewport();
  const ev = evaluateFrame(state.trees, vp, h, state.mode, eye);
  const coverage = renderer.measureCoverage(ev.records, state.trees, vp, eye, state.mode);
  const tris = trianglesOf(ev.records, state.trees, state.mode);
  renderer.frame(ev.records, state.trees, vp, eye, state.mode);

  state.lastResult = { ev, coverage, tris, vp, eye, viewportH: h };
  updateHud();
}

const $ = (id) => document.getElementById(id);

function fmtTris(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function updateHud() {
  const { ev, coverage, tris, viewportH } = state.lastResult;
  $("frameNo").textContent = "#" + String(state.frame).padStart(5, "0");
  $("coverageVal").textContent = (coverage.total * 100).toFixed(1);
  $("meshCoverage").textContent = (coverage.mesh * 100).toFixed(1) + "%";
  $("proxyCoverage").textContent = (coverage.proxy * 100).toFixed(1) + "%";
  const totalFrac = Math.max(coverage.total, 1e-6);
  $("barMesh").style.width = (coverage.mesh / totalFrac) * 100 + "%";
  $("barProxy").style.width = (coverage.proxy / totalFrac) * 100 + "%";
  $("triCount").textContent = fmtTris(tris);
  $("fadeCount").textContent = ev.fadeCount;
  $("meshInstances").textContent = ev.meshCount + ev.fadeCount;
  $("proxyInstances").textContent = ev.proxyCount + ev.fadeCount;

  // Band track: zone spans 98–162 px over a 0–220 px display range.
  const displayMax = 220;
  $("bandRange").textContent = `${LOD_BAND.low} – ${LOD_BAND.high} px`;
  $("bandZone").style.left = (LOD_BAND.low / displayMax * 100) + "%";
  $("bandZone").style.width = ((LOD_BAND.high - LOD_BAND.low) / displayMax * 100) + "%";
  const tracked = ev.records.reduce((a, b) => (b.px > a.px ? b : a), ev.records[0]);
  $("bandCursor").style.left = clamp(tracked.px / displayMax, 0, 1) * 100 + "%";

  const hold = $("holdBtn");
  hold.classList.toggle("paused", !state.running);
  hold.querySelector(".hold-label").textContent = state.running ? "自动 / RUN" : "暂停 / HOLD";
}

// ---- controls -------------------------------------------------------------
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.mode = btn.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

$("holdBtn").addEventListener("click", () => { state.running = !state.running; });
$("playBtn").addEventListener("click", () => {
  state.running = true;
  $("playBtn").textContent = "继续";
});
$("fwdBtn").addEventListener("click", () => { state.dir = 1; state.running = true; });
$("revBtn").addEventListener("click", () => { state.dir = -1; state.running = true; });

async function runVerify() {
  const badge = $("verifyBadge");
  badge.textContent = "RUN";
  badge.className = "badge";
  const report = runReverseCheck({
    trees: state.trees,
    viewportH: state.lastResult.viewportH,
    fovy: FOVY,
    aspect: canvas.width / canvas.height,
    meshTris,
  });
  badge.textContent = report.pass ? "PASS" : "FAIL";
  badge.className = "badge " + (report.pass ? "pass" : "fail");
  $("verifyZ").textContent = report.z.toFixed(1);
  $("vWeightErr").textContent = report.weightErr.toExponential(1);
  $("vTriDrift").textContent = report.triDrift + " tri";
  $("vRepMismatch").textContent = `${report.repMismatch} / ${report.stationTotal}`;
  $("vFlips").textContent = report.flips;
  $("vStations").textContent = report.stations + " × 2";
  $("verifyNote").textContent =
    `同一位置双向重合；站权重 ${report.meanWeight.toFixed(4)}，无 0→1 硬切换。`;
}
$("rerunVerify").addEventListener("click", runVerify);

// ---- main loop ------------------------------------------------------------
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  tick(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Run the reverse check once the first frame has produced a viewport.
setTimeout(runVerify, 400);

// Expose for headless verification scripts.
window.__forest = { state, runVerify, WALK, meshTris };
