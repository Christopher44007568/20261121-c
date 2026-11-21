import { bakeMSDF } from '../src/baker.js';
import { parsePathData, parseOutlineJson } from '../src/path-parser.js';
import { WINDING } from '../src/geometry.js';
import { GLViewer, attachOrbit } from './gl-viewer.js';
import {
  paintTexturePreview,
  renderDiffCase,
  sweepScales,
} from './diff-panel.js';
import { SAMPLE_GLYPHS, JSON_EXAMPLE } from './sample-glyphs.js';

const $ = (id) => document.getElementById(id);

const state = {
  shape: null,
  bake: null,
  customShapes: new Map(),
  windingRule: WINDING.NONZERO,
};

const camera = { yaw: 0.5, pitch: 0.25, dist: 16, fovy: Math.PI / 4 };

function initGlyphSelect() {
  const sel = $('glyphSelect');
  sel.innerHTML = '';
  for (const g of SAMPLE_GLYPHS) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.label;
    sel.appendChild(opt);
  }
  $('jsonExample').textContent = JSON_EXAMPLE;
}

function currentGlyph() {
  const id = $('glyphSelect').value;
  if (state.customShapes.has(id)) return state.customShapes.get(id);
  return SAMPLE_GLYPHS.find((g) => g.id === id);
}

function loadShape() {
  const glyph = currentGlyph();
  state.shape = parsePathData(glyph.path, 0.03);
  state.shape.name = glyph.id;
  state.windingRule = $('windingRule').value;
}

function bake() {
  const size = Number($('texSize').value);
  const distanceRangePx = Number($('pxRange').value);
  state.bake = bakeMSDF(state.shape, {
    size,
    distanceRangePx,
    paddingEm: 4,
    windingRule: state.windingRule,
  });
  viewer.uploadTexture('glyph', state.bake, $('filterMode').value);
  paintTexturePreview($('msdfTex'), state.bake, 'msdf');
  paintTexturePreview($('sdfTex'), state.bake, 'sdf');
}

// Two rows of cards: MSDF on top, monochrome SDF below, each at a different
// tilt so grazing-angle behavior is directly visible.
function buildCards() {
  const tilts = [
    { tiltX: 0.15, tiltY: -0.85, tiltZ: 0.05 },
    { tiltX: -0.35, tiltY: 0.2, tiltZ: -0.08 },
    { tiltX: 0.5, tiltY: 0.7, tiltZ: 0.12 },
    { tiltX: -0.1, tiltY: -0.35, tiltZ: 0.2 },
  ];
  const cards = [];
  tilts.forEach((t, i) => {
    const x = (i - 1.5) * 4.4;
    cards.push({
      ...t,
      x,
      y: 2.3,
      z: 0,
      textureId: 'glyph',
      mode: 0,
      pxRange: state.bake.distanceRangePx,
      color: [0.5, 0.82, 1, 1],
      plate: [0.16, 0.2, 0.28, 0.85],
      phase: i,
      drift: true,
    });
    cards.push({
      ...t,
      x,
      y: -2.3,
      z: 0,
      textureId: 'glyph',
      mode: 1,
      pxRange: state.bake.distanceRangePx,
      color: [1, 0.72, 0.42, 1],
      plate: [0.22, 0.17, 0.14, 0.85],
      phase: i + 2,
      drift: true,
    });
  });
  return cards;
}

let cards = [];

function runDiff() {
  const opts = {
    scale: Number($('diffScale').value),
    skewX: Number($('skewX').value),
    skewY: Number($('skewY').value),
    viewport: 200,
  };
  const result = renderDiffCase(
    state.shape,
    state.bake,
    opts,
    {
      gt: $('gtCanvas'),
      msdf: $('msdfCanvas'),
      sdf: $('sdfCanvas'),
      heat: $('heatCanvas'),
    },
    state.windingRule
  );
  paintMetrics(result);
  paintSweep();
}

function paintMetrics(result) {
  const m = result.metrics;
  const b = result.boundary;
  const row = (name, mm) => `
    <tr><td>${name}</td>
      <td class="${mm.hardErrors === 0 ? 'ok' : 'bad'}">${mm.hardErrors}</td>
      <td>${mm.filledHole}</td>
      <td>${mm.clippedSolid}</td>
      <td>${mm.meanAbs.toFixed(4)}</td>
      <td>${mm.maxAbs.toFixed(3)}</td>
    </tr>`;
  $('metricsTable').innerHTML = `
    <tr><th>模式</th><th>硬误差</th><th>填洞</th><th>削实体</th><th>平均误差</th><th>最大误差</th></tr>
    ${row('MSDF', m.msdf)}
    ${row('SDF', m.sdf)}`;
  const boundary = document.getElementById('boundaryTable');
  boundary.innerHTML = `
    <tr><th>边界精度 (屏幕 px)</th><th>RMS 误差</th><th>最大误差</th></tr>
    <tr><td>MSDF</td>
      <td class="ok">${b.msdfRms.toFixed(3)}</td>
      <td>${b.msdfMax.toFixed(3)}</td></tr>
    <tr><td>单通道 SDF</td>
      <td class="${b.sdfRms > b.msdfRms ? 'bad' : 'ok'}">${b.sdfRms.toFixed(3)}</td>
      <td>${b.sdfMax.toFixed(3)}</td></tr>
    <tr><td>SDF / MSDF 倍数</td>
      <td colspan="2" class="bad">${(b.sdfRms / Math.max(1e-6, b.msdfRms)).toFixed(2)}×</td></tr>`;
}

function paintSweep() {
  const scales = [8, 12, 18, 26, 36, 50];
  const rows = sweepScales(
    state.shape,
    state.bake,
    scales,
    state.windingRule,
    Number($('skewX').value)
  );
  $('sweepTable').innerHTML = `
    <tr><th>倍率</th>${scales.map((s) => `<th>${s}px</th>`).join('')}</tr>
    <tr><td>MSDF 硬误差</td>${rows
      .map((r) => `<td class="${r.msdfErrors === 0 ? 'ok' : ''}">${r.msdfErrors}</td>`)
      .join('')}</tr>
    <tr><td>SDF 硬误差</td>${rows
      .map((r) => `<td class="${r.sdfErrors > 0 ? 'bad' : 'ok'}">${r.sdfErrors}</td>`)
      .join('')}</tr>
    <tr><td>SDF 填洞 / 削实体</td>${rows
      .map((r) => `<td>${r.sdfFilledHole}/${r.sdfClipped}</td>`)
      .join('')}</tr>`;
}

function rebuildAll() {
  loadShape();
  bake();
  cards = buildCards();
  runDiff();
}

async function importFile(file) {
  const text = await file.text();
  let shape;
  if (file.name.endsWith('.json')) {
    shape = parseOutlineJson(text);
  } else {
    // Accept raw SVG files as well as bare path data.
    const pathMatch = text.match(/d\s*=\s*"([^"]+)"/);
    const d = pathMatch ? pathMatch[1] : text;
    shape = parsePathData(d, 0.03);
    shape.name = file.name;
  }
  if (!shape.contours.length) throw new Error('未解析到任何轮廓');
  const id = `custom-${Date.now()}`;
  state.customShapes.set(id, { id, label: `导入: ${file.name}`, path: contoursToPath(shape) });
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = `导入: ${file.name}`;
  $('glyphSelect').appendChild(opt);
  $('glyphSelect').value = id;
  rebuildAll();
}

// Re-serialize an imported polyline shape back into path data so the rest of
// the pipeline stays path-based.
function contoursToPath(shape) {
  return shape.contours
    .map((c) => {
      const head = c.points[0];
      const rest = c.points
        .slice(1)
        .map((p) => `L${p.x.toFixed(3)},${p.y.toFixed(3)}`)
        .join(' ');
      return `M${head.x.toFixed(3)},${head.y.toFixed(3)} ${rest} Z`;
    })
    .join(' ');
}

function bindRange(id, outId, fraction = 2) {
  $(id).addEventListener('input', () => {
    $(outId).textContent = Number($(id).value).toFixed(fraction);
  });
}

function bindControls() {
  $('glyphSelect').addEventListener('change', rebuildAll);
  $('windingRule').addEventListener('change', rebuildAll);
  $('texSize').addEventListener('input', () => {
    $('sizeVal').textContent = $('texSize').value;
  });
  $('texSize').addEventListener('change', rebuildAll);
  $('pxRange').addEventListener('input', () => {
    $('rangeVal').textContent = $('pxRange').value;
  });
  $('pxRange').addEventListener('change', rebuildAll);
  $('filterMode').addEventListener('change', rebuildAll);
  bindRange('diffScale', 'scaleVal', 0);
  bindRange('skewX', 'skewXVal');
  bindRange('skewY', 'skewYVal');
  $('rerun').addEventListener('click', runDiff);
  $('fileInput').addEventListener('change', async (e) => {
    try {
      if (e.target.files[0]) await importFile(e.target.files[0]);
    } catch (err) {
      alert(`导入失败: ${err.message}`);
    }
  });
}

let viewer;

function frame() {
  viewer.render(cards, camera);
  requestAnimationFrame(frame);
}

function boot() {
  initGlyphSelect();
  bindControls();
  viewer = new GLViewer($('glCanvas'));
  attachOrbit($('glCanvas'), camera);
  rebuildAll();
  requestAnimationFrame(frame);
}

boot();
