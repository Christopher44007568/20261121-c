import { render } from './raster-core.mjs';
import { scene, CHECK_POINTS, W, H, triangles } from './scene.mjs';

const $ = (id) => document.getElementById(id);
const fbCanvas = $('fb-canvas');
const ovCanvas = $('overlay-canvas');
const fbCtx = fbCanvas.getContext('2d');
const ovCtx = ovCanvas.getContext('2d');

const t0 = performance.now();
const result = render(scene, []);
const renderMs = performance.now() - t0;

// 绘制帧缓冲
const img = new ImageData(new Uint8ClampedArray(result.color), W, H);
fbCtx.putImageData(img, 0, 0);
$('perf').textContent = `CPU ${renderMs.toFixed(1)} ms · ${result.stats.triangles} tris · ${result.stats.shaded.toLocaleString()} shaded`;

// 图元配色（用于线框/图例）
const TRI_COLOR = { T0: '#f0a94e', T1: '#6aa6ff', T2: '#f0629b', T3: '#3fd6c4', T4: '#5fd38a', T5: '#7fb8e8' };
let selected = null;
let wireOn = true;

function drawOverlay() {
  ovCtx.clearRect(0, 0, W, H);
  if (wireOn) {
    ovCtx.lineWidth = 1;
    for (const tri of triangles) {
      ovCtx.strokeStyle = TRI_COLOR[tri.id] + 'aa';
      ovCtx.beginPath();
      tri.vertices.forEach((v, i) => {
        const x = i === 0 ? 'moveTo' : 'lineTo';
        ovCtx[x](v.window[0], v.window[1]);
      });
      ovCtx.closePath();
      ovCtx.stroke();
    }
  }
  if (selected) {
    const [x, y] = selected;
    ovCtx.strokeStyle = '#ffffff';
    ovCtx.lineWidth = 1;
    ovCtx.strokeRect(x - 7, y - 7, 15, 15);
    ovCtx.strokeStyle = '#3fd6c4';
    ovCtx.strokeRect(x - 0.5, y - 0.5, 1, 1);
  }
}

function rgbaText(c) { return c.join(' '); }
function hex(c) { return '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(); }
function f4(v) { return Number(v).toFixed(4); }

function edgeSummary(ev) {
  return ev.edgeStates.map((e) => `${e.edge.split('→')[1]}:${f4(e.value)}${e.topLeft ? '◆' : ''}`).join('  ');
}

function renderEvent(ev) {
  const pass = ev.depth.pass;
  const badge = ev.blended ? '<span class="badge blend">BLEND</span>'
    : pass ? '<span class="badge pass">DEPTH PASS</span>'
    : '<span class="badge fail">DEPTH FAIL</span>';
  const srcColor = ev.interpolatedColor.map((v) => Math.round(v));
  const weights = ev.perspectiveWeights.map((w) => f4(w)).join(' / ');
  const bary = ev.screenBarycentric.map((w) => f4(w)).join(' / ');
  let steps = '';
  if (pass) {
    steps = `
    <div class="step"><span class="tag">• COVER</span><div class="body">
      裁剪多边形 ${ev.clipPolygon}v · ${ev.planesHit.length ? '平面命中 ' + ev.planesHit.join(',') : '无平面命中'}
      <div class="bar"></div>${bary}</div></div>
    <div class="step"><span class="tag">• INTERP</span><div class="body">
      1/w ${f4(ev.inverseW)} · p ${weights}
      <span class="chip" style="background:rgb(${srcColor.join(',')})"></span>${rgbaText(srcColor)} α ${f4(ev.alpha)}</div></div>
    <div class="step"><span class="tag">• DEPTH</span><div class="body">
      NDC z ${f4(ev.depth.ndc)} · 窗口 ${f4(ev.depth.window)} · 缓冲 ${f4(ev.depth.previous)} · z &lt; z₀ = <b style="color:var(--green)">true</b></div></div>
    <div class="step"><span class="tag">• BLEND</span><div class="body">
      <span class="chip" style="background:rgb(${ev.previousColor.slice(0,3).join(',')})"></span>${rgbaText(ev.previousColor)}
      → src·α + dst·(1−α) →
      <span class="chip" style="background:rgb(${ev.result.slice(0,3).join(',')})"></span>${rgbaText(ev.result)}</div></div>`;
  } else {
    steps = `<div class="reject">深度 ${f4(ev.depth.window)} ≥ 缓冲 ${f4(ev.depth.previous)}，LESS 拒绝写回（无混合）</div>`;
  }
  return `<div class="event">
    <div class="event-head">
      <span class="event-order">${String(ev.order).padStart(2, '0')}</span>
      <span class="event-title"><b>${ev.triangleId}</b> ${ev.label}<small>${edgeSummary(ev)}</small></span>
      ${badge}
    </div>
    <div class="steps">${steps}</div>
  </div>`;
}

function renderProbe(attempts) {
  return attempts.map((a) => {
    const cls = a.covered ? 'hit' : a.reason === 'edge' ? 'edge' : 'miss';
    const st = a.covered ? 'HIT' : a.reason === 'edge' ? 'EDGE' : 'OUTSIDE';
    const sub = a.planesHit.length ? a.planesHit.join('+') : `${a.clipPolygon}v`;
    return `<div class="probe-cell ${cls}"><span class="tid">${a.triangleId}</span>
      <span class="st">${st}</span><small>${sub}</small></div>`;
  }).join('');
}

function selectPixel(x, y) {
  selected = [x, y];
  const tr = render(scene, [[x, y]]).traces[0];
  $('pixel-title').textContent = `# ${x}, ${y}`;
  $('m-rgba').textContent = rgbaText(tr.final);
  $('m-depth').textContent = f4(tr.depth);
  $('m-cover').textContent = `${tr.events.length} / ${tr.attempts.length}`;
  $('m-exact').textContent = '参考一致';
  $('m-delta').textContent = `采样 ${tr.sample.join(', ')}`;
  $('final-swatch').style.background = `rgb(${tr.final.slice(0, 3).join(',')})`;
  $('final-swatch').title = hex(tr.final);
  $('events').innerHTML = tr.events.length ? tr.events.map(renderEvent).join('')
    : '<div class="reject">该像素未被任何图元覆盖，保持清屏色</div>';
  $('probe-grid').innerHTML = renderProbe(tr.attempts);
  $('click-hint').textContent = `# ${x}, ${y} · ${hex(tr.final)}`;
  drawOverlay();
}

// 画布点击 -> 像素坐标
ovCanvas.addEventListener('click', (e) => {
  const rect = ovCanvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * (W / rect.width));
  const y = Math.floor((e.clientY - rect.top) * (H / rect.height));
  if (x >= 0 && x < W && y >= 0 && y < H) {
    selectPixel(x, y);
    document.querySelectorAll('.case-btn').forEach((b) => b.classList.remove('active'));
  }
});

// 边界用例按钮
const caseRow = $('case-row');
CHECK_POINTS.forEach((cp, i) => {
  const btn = document.createElement('button');
  btn.className = 'case-btn';
  btn.innerHTML = `<span class="idx">${String(i + 1).padStart(2, '0')}</span>${cp.name}<span style="font-family:var(--mono);color:var(--muted)">${cp.pixel.join(',')}</span>`;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.case-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectPixel(cp.pixel[0], cp.pixel[1]);
  });
  caseRow.appendChild(btn);
});

// 图例
$('legend').innerHTML = triangles.map((t) =>
  `<span><i style="background:${TRI_COLOR[t.id]}"></i>${t.id} ${t.label}</span>`).join('');

// 线框开关与重置
$('wire-toggle').addEventListener('change', (e) => { wireOn = e.target.checked; drawOverlay(); });
$('reset-view').addEventListener('click', () => {
  selected = null;
  document.querySelectorAll('.case-btn').forEach((b) => b.classList.remove('active'));
  $('pixel-title').textContent = '# —';
  $('m-rgba').textContent = '—'; $('m-depth').textContent = '—'; $('m-cover').textContent = '—';
  $('m-exact').textContent = '—'; $('m-delta').textContent = '—';
  $('events').innerHTML = ''; $('probe-grid').innerHTML = '';
  $('final-swatch').style.background = '#000';
  $('click-hint').textContent = '点选任意像素，按绘制顺序复核';
  drawOverlay();
});

// 初始选中透明混合用例，展示完整的覆盖→插值→深度→混合链路
selectPixel(CHECK_POINTS[3].pixel[0], CHECK_POINTS[3].pixel[1]);
document.querySelector('.case-btn:last-child').classList.add('active');
drawOverlay();
