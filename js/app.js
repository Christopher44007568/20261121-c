import {
  applyHomography,
  edgeFeather,
  fitHomography,
  invertMat3,
  matrixFromQuad,
  srgbToLinear,
} from "./geometry.js";

const STAGE_WIDTH = 1600;
const STAGE_HEIGHT = 900;
const GRID_COLS = 6;
const GRID_ROWS = 4;
const STORAGE_KEY = "triple-blend.config.v1";

const PROJECTORS = [
  {
    id: "A",
    name: "左翼投影机",
    short: "LEFT",
    color: "#f3b35b",
    rgb: [243, 179, 91],
    quad: [
      [-24, -18], [690, 22], [675, 894], [-18, 918],
    ],
  },
  {
    id: "B",
    name: "中置投影机",
    short: "CENTER",
    color: "#4bdac8",
    rgb: [75, 218, 200],
    quad: [
      [444, -10], [1140, -12], [1150, 910], [458, 912],
    ],
  },
  {
    id: "C",
    name: "右翼投影机",
    short: "RIGHT",
    color: "#ff7a9e",
    rgb: [255, 122, 158],
    quad: [
      [910, -8], [1624, -18], [1620, 918], [926, 904],
    ],
  },
];

const SEAMS = [
  { pair: [0, 1], x: 570, label: "A / B" },
  { pair: [1, 2], x: 1030, label: "B / C" },
];

const state = {
  view: "edit",
  pattern: "checker",
  checkerSize: 72,
  feather: 0.14,
  selectedChannel: 0,
  selectedPoint: null,
  hoverPoint: null,
  dragging: false,
  showCoverage: true,
  showSeams: true,
  channels: [],
  seams: [],
  renderQueued: false,
  overlayScale: 2,
  outputWindow: null,
  popupTimer: 0,
};

const dom = {};
let renderer = null;
let overlayContext = null;
let toastTimer = 0;
let saveTimer = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createChannels() {
  return PROJECTORS.map((projector, index) => {
    const nominalMatrix = matrixFromQuad(projector.quad);
    const points = [];
    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        const u = col / (GRID_COLS - 1);
        const v = row / (GRID_ROWS - 1);
        const mapped = applyHomography(nominalMatrix, { x: u, y: v });
        points.push({
          index: points.length,
          u,
          v,
          col,
          row,
          x: mapped.x,
          y: mapped.y,
          idealX: mapped.x,
          idealY: mapped.y,
        });
      }
    }
    return {
      ...projector,
      index,
      nominalMatrix,
      points,
      matrix: nominalMatrix,
      inverse: invertMat3(nominalMatrix),
      fit: { rms: 0, max: 0, residuals: new Array(points.length).fill(0) },
      gain: 1,
      enabled: true,
    };
  });
}

function sourcePoints(channel) {
  return channel.points.map((point) => ({ x: point.u, y: point.v }));
}

function solveChannel(channel) {
  const fit = fitHomography(sourcePoints(channel), channel.points);
  channel.fit = fit;
  channel.matrix = fit.matrix;
  channel.inverse = invertMat3(fit.matrix);
  return fit;
}

function solveAll() {
  for (const channel of state.channels) solveChannel(channel);
}

function formatFixed(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function channelStateForMetrics(channel) {
  return {
    enabled: channel.enabled,
    gain: channel.gain,
    inverse: channel.inverse,
    feather: state.feather,
  };
}

function predictedPatternPoint(channel, screenPoint) {
  const uv = applyHomography(channel.inverse, screenPoint);
  if (uv.w <= 0 || uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return null;
  return applyHomography(channel.nominalMatrix, uv);
}

function evaluateSeams() {
  const metricChannels = state.channels.map(channelStateForMetrics);
  const targetLinear = srgbToLinear(0.5);
  return SEAMS.map((seam) => {
    const positionErrors = [];
    const luminanceErrors = [];
    const [firstIndex, secondIndex] = seam.pair;
    const first = state.channels[firstIndex];
    const second = state.channels[secondIndex];
    for (let step = 1; step <= 9; step += 1) {
      const y = (STAGE_HEIGHT * step) / 10;
      const point = { x: seam.x, y };
      if (first.enabled && second.enabled) {
        const firstPrediction = predictedPatternPoint(first, point);
        const secondPrediction = predictedPatternPoint(second, point);
        if (firstPrediction && secondPrediction) {
          positionErrors.push(Math.hypot(
            firstPrediction.x - secondPrediction.x,
            firstPrediction.y - secondPrediction.y,
          ));
        }
      }
      const blended = metricChannels.reduce((accumulator, channel) => {
        if (!channel.enabled) return accumulator;
        const uv = applyHomography(channel.inverse, point);
        if (uv.w <= 0 || uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) {
          return accumulator;
        }
        const weight = edgeFeather(uv.x, channel.feather);
        accumulator.numerator += targetLinear * channel.gain * weight;
        accumulator.denominator += weight;
        return accumulator;
      }, { numerator: 0, denominator: 0 });
      if (blended.denominator > 1e-8) {
        const luminance = blended.numerator / blended.denominator;
        luminanceErrors.push(Math.abs(luminance - targetLinear) / targetLinear * 100);
      } else {
        luminanceErrors.push(100);
      }
    }
    const rms = positionErrors.length
      ? Math.sqrt(positionErrors.reduce((sum, value) => sum + value * value, 0) / positionErrors.length)
      : 0;
    const maxPosition = positionErrors.length ? Math.max(...positionErrors) : 0;
    const maxLuminance = luminanceErrors.length ? Math.max(...luminanceErrors) : 0;
    const avgLuminance = luminanceErrors.length
      ? luminanceErrors.reduce((sum, value) => sum + value, 0) / luminanceErrors.length
      : 0;
    return {
      ...seam,
      rms,
      maxPosition,
      maxLuminance,
      avgLuminance,
      samples: positionErrors.length,
    };
  });
}

function shaderSource(source, type) {
  const shader = renderer?.gl.createShader(type);
  if (!shader) throw new Error("WebGL is unavailable");
  renderer.gl.shaderSource(shader, source);
  renderer.gl.compileShader(shader);
  if (!renderer.gl.getShaderParameter(shader, renderer.gl.COMPILE_STATUS)) {
    const message = renderer.gl.getShaderInfoLog(shader);
    renderer.gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

const VERTEX_SHADER = `
attribute vec2 aPosition;
uniform vec2 uResolution;
varying vec2 vScreen;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vScreen = vec2(
    (aPosition.x + 1.0) * 0.5 * uResolution.x,
    (1.0 - (aPosition.y + 1.0) * 0.5) * uResolution.y
  );
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vScreen;
uniform vec2 uResolution;
uniform mat3 uInverse[3];
uniform mat3 uNominal[3];
uniform float uGain[3];
uniform float uEnabled[3];
uniform float uFeather;
uniform int uPattern;
uniform float uChecker;

float smoothStep(float edge0, float edge1, float value) {
  float t = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 srgbToLinear(vec3 value) {
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, step(value, vec3(0.04045)));
}

vec3 linearToSrgb(vec3 value) {
  vec3 low = value * 12.92;
  vec3 high = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, step(value, vec3(0.0031308)));
}

vec3 testPattern(vec2 point) {
  vec2 uv = clamp(point / uResolution, 0.0, 1.0);
  if (uPattern == 0) {
    vec2 cellCoord = point / uChecker;
    vec2 cell = floor(cellCoord);
    vec2 local = fract(cellCoord);
    float parity = mod(cell.x + cell.y, 2.0);
    vec3 color = mix(vec3(0.014, 0.018, 0.023), vec3(0.92, 0.925, 0.93), parity);
    float edgeDistance = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y));
    float aa = 1.35 / uChecker;
    float gridLine = 1.0 - smoothStep(0.0, aa, edgeDistance);
    return mix(color, vec3(0.12, 0.135, 0.15), gridLine * 0.45);
  }
  if (uPattern == 1) {
    return vec3(0.5);
  }
  float stepIndex = floor(uv.x * 11.0);
  float level = clamp((stepIndex + 0.5) / 11.0, 0.025, 1.0);
  vec3 color = vec3(level);
  float local = fract(uv.x * 11.0);
  float divider = 1.0 - smoothStep(0.0, 0.012, min(local, 1.0 - local) * 11.0);
  return mix(color, vec3(0.035), divider * 0.3);
}

float featherWeight(float coordinate) {
  float width = min(0.48, max(0.0001, uFeather));
  return smoothStep(0.0, width, coordinate) * smoothStep(0.0, width, 1.0 - coordinate);
}

void main() {
  vec3 linearSum = vec3(0.0);
  float weightSum = 0.0;

  for (int index = 0; index < 3; index++) {
    if (uEnabled[index] < 0.5) continue;
    vec3 homogeneous = uInverse[index] * vec3(vScreen, 1.0);
    if (abs(homogeneous.z) < 0.000001) continue;
    vec2 uv = homogeneous.xy / homogeneous.z;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

    vec3 sourcePoint = uNominal[index] * vec3(uv, 1.0);
    if (abs(sourcePoint.z) < 0.000001) continue;
    vec2 targetPoint = sourcePoint.xy / sourcePoint.z;
    vec3 target = testPattern(targetPoint);
    float weight = featherWeight(uv.x);

    linearSum += srgbToLinear(target) * uGain[index] * weight;
    weightSum += weight;
  }

  vec3 color = vec3(0.0);
  if (weightSum > 0.00001) {
    color = linearToSrgb(linearSum / weightSum);
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

function createRenderer(canvas) {
  renderer = {
    gl: canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    }),
  };
  if (!renderer.gl) throw new Error("WebGL is not supported");
  const gl = renderer.gl;
  const vertex = shaderSource(VERTEX_SHADER, gl.VERTEX_SHADER);
  const fragment = shaderSource(FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

  renderer.program = program;
  renderer.uniforms = {
    resolution: gl.getUniformLocation(program, "uResolution"),
    inverse: [0, 1, 2].map((index) => gl.getUniformLocation(program, `uInverse[${index}]`)),
    nominal: [0, 1, 2].map((index) => gl.getUniformLocation(program, `uNominal[${index}]`)),
    gain: [0, 1, 2].map((index) => gl.getUniformLocation(program, `uGain[${index}]`)),
    enabled: [0, 1, 2].map((index) => gl.getUniformLocation(program, `uEnabled[${index}]`)),
    feather: gl.getUniformLocation(program, "uFeather"),
    pattern: gl.getUniformLocation(program, "uPattern"),
    checker: gl.getUniformLocation(program, "uChecker"),
  };
  return renderer;
}

function renderProjection() {
  if (!renderer?.uniforms) return;
  const gl = renderer.gl;
  gl.uniform2f(renderer.uniforms.resolution, STAGE_WIDTH, STAGE_HEIGHT);
  gl.uniform1f(renderer.uniforms.feather, state.feather);
  gl.uniform1f(renderer.uniforms.checker, state.checkerSize);
  gl.uniform1i(
    renderer.uniforms.pattern,
    state.pattern === "checker" ? 0 : state.pattern === "gray" ? 1 : 2,
  );
  state.channels.forEach((channel, index) => {
    gl.uniformMatrix3fv(
      renderer.uniforms.inverse[index],
      false,
      transposeMat3(channel.inverse),
    );
    gl.uniformMatrix3fv(
      renderer.uniforms.nominal[index],
      false,
      transposeMat3(channel.nominalMatrix),
    );
    gl.uniform1f(renderer.uniforms.gain[index], channel.gain);
    gl.uniform1f(renderer.uniforms.enabled[index], channel.enabled ? 1 : 0);
  });
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function transposeMat3(matrix) {
  return new Float32Array([
    matrix[0], matrix[3], matrix[6],
    matrix[1], matrix[4], matrix[7],
    matrix[2], matrix[5], matrix[8],
  ]);
}

function rgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function quadFor(channel) {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ].map((point) => applyHomography(channel.matrix, point));
}

function pathQuad(context, corners) {
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  for (let index = 1; index < corners.length; index += 1) {
    context.lineTo(corners[index].x, corners[index].y);
  }
  context.closePath();
}

function statusFor(positionError, lumaError) {
  if (positionError > 5 || lumaError > 2) return "bad";
  if (positionError > 1.5 || lumaError > 0.5) return "warn";
  return "good";
}

function drawChannelLabel(context, channel, scale) {
  const center = channel.points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x / channel.points.length,
      y: accumulator.y + point.y / channel.points.length,
    }),
    { x: 0, y: 0 },
  );
  const x = center.x;
  const y = 73 + (channel.id === "B" ? 2 : 0);
  const label = `${channel.id}  ${channel.short}`;
  context.save();
  context.font = `500 ${11 * scale}px "SFMono-Regular", Menlo, monospace`;
  const width = context.measureText(label).width + 22 * scale;
  const height = 21 * scale;
  context.fillStyle = "rgba(6, 10, 14, 0.62)";
  context.strokeStyle = rgba(channel.rgb, 0.28);
  context.lineWidth = Math.max(1, scale * 0.65);
  context.beginPath();
  context.roundRect(x - width / 2, y, width, height, 4 * scale);
  context.fill();
  context.stroke();
  context.fillStyle = rgba(channel.rgb, channel.enabled ? 0.92 : 0.35);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x, y + height / 2 + 0.5 * scale);
  context.restore();
}

function drawOverlay() {
  const context = overlayContext;
  const scale = state.overlayScale;
  const line = clamp(scale * 0.72, 1, 2.6);
  context.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

  if (state.showCoverage) {
    state.channels.forEach((channel) => {
      const corners = quadFor(channel);
      pathQuad(context, corners);
      context.fillStyle = rgba(channel.rgb, channel.enabled ? 0.025 : 0.008);
      context.fill();
    });
  }

  state.channels.forEach((channel) => {
    const selected = state.selectedChannel === channel.index;
    const corners = quadFor(channel);
    const alpha = channel.enabled ? (selected ? 0.75 : 0.34) : 0.13;
    pathQuad(context, corners);
    context.strokeStyle = rgba(channel.rgb, alpha);
    context.lineWidth = selected ? line * 1.45 : line;
    context.setLineDash(selected ? [] : [6 * scale, 5 * scale]);
    context.stroke();
    context.setLineDash([]);
  });

  if (state.view === "edit") {
    for (const channel of state.channels) {
      const selected = state.selectedChannel === channel.index;
      if (!selected && state.channels.some((item) => item.index === state.selectedChannel)) {
        drawControlMesh(context, channel, scale, 0.12);
      } else {
        drawControlMesh(context, channel, scale, selected ? 0.42 : 0.22);
      }
    }
  }

  if (state.showSeams) {
    context.save();
    context.setLineDash([4 * scale, 7 * scale]);
    context.lineWidth = Math.max(1, scale * 0.6);
    context.strokeStyle = "rgba(211, 229, 241, 0.25)";
    state.seams.forEach((seam) => {
      const status = statusFor(seam.maxPosition, seam.maxLuminance);
      const statusColor = status === "good" ? "#58d6a7" : status === "warn" ? "#f2b35c" : "#ff6f7d";
      context.beginPath();
      context.moveTo(seam.x, 95);
      context.lineTo(seam.x, STAGE_HEIGHT - 70);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "rgba(7, 11, 16, 0.8)";
      context.strokeStyle = `${statusColor}55`;
      context.lineWidth = Math.max(1, scale * 0.65);
      context.beginPath();
      context.roundRect(seam.x - 27 * scale, 100, 54 * scale, 20 * scale, 3 * scale);
      context.fill();
      context.stroke();
      context.fillStyle = statusColor;
      context.font = `500 ${9 * scale}px "SFMono-Regular", Menlo, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(seam.label, seam.x, 100 + 10 * scale + 0.5);
      context.setLineDash([4 * scale, 7 * scale]);
      context.strokeStyle = "rgba(211, 229, 241, 0.25)";
    });
    context.restore();
  }

  if (state.view === "edit") {
    for (const channel of state.channels) {
      drawHandles(context, channel, scale);
    }
    for (const channel of state.channels) {
      if (channel.index === state.selectedChannel) drawChannelLabel(context, channel, scale);
    }
  }
}

function drawControlMesh(context, channel, scale, alpha) {
  const selected = state.selectedChannel === channel.index;
  context.save();
  context.strokeStyle = rgba(channel.rgb, alpha);
  context.lineWidth = Math.max(0.8, scale * (selected ? 0.58 : 0.4));
  for (let row = 0; row < GRID_ROWS; row += 1) {
    context.beginPath();
    for (let col = 0; col < GRID_COLS; col += 1) {
      const point = channel.points[row * GRID_COLS + col];
      if (col === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
  }
  for (let col = 0; col < GRID_COLS; col += 1) {
    context.beginPath();
    for (let row = 0; row < GRID_ROWS; row += 1) {
      const point = channel.points[row * GRID_COLS + col];
      if (row === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
  }
  context.restore();
}

function drawHandles(context, channel, scale) {
  const selectedChannel = channel.index === state.selectedChannel;
  const radius = clamp(5.4 * scale, 6, 15);
  channel.points.forEach((point) => {
    const isSelected = selectedChannel && state.selectedPoint === point.index;
    const isHover = selectedChannel && state.hoverPoint === point.index;
    const fitted = applyHomography(channel.matrix, { x: point.u, y: point.v });
    const residual = Math.hypot(fitted.x - point.x, fitted.y - point.y);

    if (selectedChannel && residual > 0.35) {
      context.save();
      context.strokeStyle = rgba(channel.rgb, 0.58);
      context.lineWidth = Math.max(1, scale * 0.55);
      context.beginPath();
      context.moveTo(fitted.x, fitted.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      context.fillStyle = rgba(channel.rgb, 0.7);
      context.beginPath();
      context.arc(fitted.x, fitted.y, 2 * scale, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    context.save();
    context.beginPath();
    context.arc(point.x, point.y, radius + 2.3 * scale, 0, Math.PI * 2);
    context.fillStyle = "rgba(5, 9, 13, 0.85)";
    context.fill();
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = selectedChannel
      ? (channel.enabled ? rgba(channel.rgb, 0.92) : rgba(channel.rgb, 0.25))
      : "rgba(128, 150, 168, 0.36)";
    context.fill();
    if (isSelected || isHover) {
      context.strokeStyle = isSelected ? "#ffffff" : rgba(channel.rgb, 0.95);
      context.lineWidth = Math.max(1.2, scale * 0.8);
      context.beginPath();
      context.arc(point.x, point.y, radius + 3.2 * scale, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  });
}

function updateProjectorCards() {
  state.channels.forEach((channel, index) => {
    const card = dom.projectorList.querySelector(`[data-channel="${index}"]`);
    if (!card) return;
    card.classList.toggle("is-selected", state.selectedChannel === index);
    card.classList.toggle("is-disabled", !channel.enabled);
    const rms = card.querySelector("[data-rms]");
    if (rms) rms.textContent = `RMS ${formatFixed(channel.fit.rms)} px`;
    const gain = card.querySelector("[data-gain]");
    if (gain) {
      gain.value = String(Math.round(channel.gain * 100));
      gain.style.setProperty("--fill", `${((channel.gain - 0.7) / 0.6) * 100}%`);
    }
    const gainOutput = card.querySelector("[data-gain-value]");
    if (gainOutput) gainOutput.textContent = `${Math.round(channel.gain * 100)}%`;
    const toggle = card.querySelector("[data-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(channel.enabled));
      toggle.title = channel.enabled ? "关闭此投影机" : "启用此投影机";
      toggle.innerHTML = channel.enabled
        ? `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.8"/></svg>`
        : `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8Z"/><path d="M2.2 2.2l11.6 11.6"/></svg>`;
    }
  });
}

function renderProjectorList() {
  dom.projectorList.innerHTML = state.channels.map((channel, index) => `
    <article class="projector-card${index === state.selectedChannel ? " is-selected" : ""}" data-channel="${index}" style="--p-color: ${channel.color}">
      <span class="projector-glyph">${channel.id}</span>
      <div class="projector-info">
        <strong>${channel.name}</strong>
        <small data-rms>RMS ${formatFixed(channel.fit.rms)} px</small>
        <div class="gain-control">
          <input data-gain type="range" min="70" max="130" step="1" value="${Math.round(channel.gain * 100)}"
            aria-label="${channel.name}亮度" style="--fill: ${((channel.gain - 0.7) / 0.6) * 100}%">
          <output data-gain-value>${Math.round(channel.gain * 100)}%</output>
        </div>
      </div>
      <button class="projector-toggle" data-toggle type="button" aria-pressed="${channel.enabled}"
        title="${channel.enabled ? "关闭此投影机" : "启用此投影机"}">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.8"/></svg>
      </button>
    </article>
  `).join("");
}

function updatePointPanel() {
  const point = state.selectedPoint === null
    ? null
    : state.channels[state.selectedChannel]?.points[state.selectedPoint];
  dom.pointEmpty.hidden = Boolean(point);
  dom.pointEditor.hidden = !point;
  if (!point) {
    dom.nodeChip.textContent = "—";
    return;
  }
  const channel = state.channels[state.selectedChannel];
  dom.nodeChip.textContent = `R${point.row + 1}C${point.col + 1}`;
  dom.nodeName.textContent = `投影机 ${channel.id} · R${point.row + 1}C${point.col + 1}`;
  dom.nodeDot.style.background = channel.color;
  dom.nodeDot.style.color = channel.color;
  if (document.activeElement !== dom.nodeX) dom.nodeX.value = point.x.toFixed(1);
  if (document.activeElement !== dom.nodeY) dom.nodeY.value = point.y.toFixed(1);
}

function updateMatrixPreview() {
  const channel = state.channels[state.selectedChannel];
  if (!channel) return;
  const rows = [0, 1, 2].map((row) => [0, 1, 2].map((col) => {
    const value = channel.matrix[row * 3 + col];
    return (col === 2 && row === 2 ? 1 : value).toFixed(3).padStart(8);
  }).join(" "));
  dom.matrixPreview.textContent = rows.join("\n");
}

function updateSeamCards() {
  dom.seamList.innerHTML = state.seams.map((seam) => {
    const status = statusFor(seam.maxPosition, seam.maxLuminance);
    const statusLabel = status === "good" ? "通过" : status === "warn" ? "注意" : "超限";
    const onSegments = status === "good" ? 12 : status === "warn" ? 8 : 5;
    const first = state.channels[seam.pair[0]];
    const second = state.channels[seam.pair[1]];
    return `
      <article class="seam-card ${status}" data-seam="${seam.label}">
        <div class="seam-card-head">
          <div class="seam-pair" style="--pair-color: ${first.color}">
            <i style="background:${first.color}"></i><i style="background:${second.color}"></i>
          </div>
          <strong>${seam.label}</strong>
          <span>${statusLabel}</span>
        </div>
        <div class="seam-stats">
          <div><span>覆盖区位置 RMS</span><strong>${formatFixed(seam.rms)} <em>px</em></strong></div>
          <div><span>叠加亮度 ΔY</span><strong>${formatFixed(seam.maxLuminance)} <em>%</em></strong></div>
        </div>
        <div class="seam-meter">${Array.from({ length: 12 }, (_, index) => `<i class="${index < onSegments ? "on" : ""}"></i>`).join("")}</div>
      </article>
    `;
  }).join("");
}

function updateReadouts() {
  const maxPosition = state.seams.length
    ? Math.max(...state.seams.map((seam) => seam.maxPosition))
    : 0;
  const maxLuminance = state.seams.length
    ? Math.max(...state.seams.map((seam) => seam.maxLuminance))
    : 0;
  const maxResidual = Math.max(...state.channels.map((channel) => channel.fit.rms));
  const disabledCount = state.channels.filter((channel) => !channel.enabled).length;
  const score = Math.round(clamp(
    100 - maxResidual * 2.1 - maxPosition * 1.25 - maxLuminance * 5.5 - disabledCount * 7,
    0,
    100,
  ));

  dom.footerPosError.innerHTML = `${formatFixed(maxPosition)} <small>px</small>`;
  dom.footerLumaError.innerHTML = `${formatFixed(maxLuminance)} <small>%</small>`;
  dom.footerResidual.innerHTML = `${formatFixed(maxResidual)} <small>px</small>`;
  dom.metricRms.textContent = `${formatFixed(maxResidual)} px`;
  dom.metricMax.textContent = `${formatFixed(Math.max(...state.channels.map((channel) => channel.fit.max)))} px`;
  dom.metricPoints.textContent = `${state.channels.filter((channel) => channel.enabled).length * state.channels[0].points.length} / ${state.channels.length * state.channels[0].points.length}`;
  dom.qualityScore.textContent = String(score);
  dom.scoreRing.style.setProperty("--score", score);
  dom.qualityBar.style.width = `${score}%`;
  dom.qualityBar.style.background = score >= 90
    ? "linear-gradient(90deg, var(--teal), var(--good))"
    : score >= 70
      ? "linear-gradient(90deg, var(--amber), var(--warn))"
      : "linear-gradient(90deg, #ff8b61, var(--bad))";

  const worstSeam = state.seams.reduce(
    (worst, seam) => (!worst || seam.maxPosition > worst.maxPosition ? seam : worst),
    null,
  );
  if (disabledCount > 0) {
    dom.qualityNote.textContent = `${disabledCount} 路投影已关闭，覆盖区可能缺失。`;
  } else if (worstSeam && worstSeam.maxPosition > 5) {
    dom.qualityNote.textContent = `${worstSeam.label} 存在 ${formatFixed(worstSeam.maxPosition)} px 几何偏移。`;
  } else if (worstSeam && worstSeam.maxLuminance > 2) {
    dom.qualityNote.textContent = `${worstSeam.label} 叠加亮度偏差 ${formatFixed(worstSeam.maxLuminance)}%。`;
  } else if (worstSeam && (worstSeam.maxPosition > 1.5 || worstSeam.maxLuminance > 0.5)) {
    dom.qualityNote.textContent = "接缝通过，仍有轻微偏差可继续微调。";
  } else {
    dom.qualityNote.textContent = "两处重叠接缝均通过检查。";
  }

  const maxStatus = maxResidual > 5 ? "bad" : maxResidual > 1.5 ? "warn" : "good";
  dom.solveStatus.className = `status-pill ${maxStatus}`;
  dom.solveStatus.textContent = maxStatus === "good" ? "已收敛" : maxStatus === "warn" ? "需微调" : "残差偏大";
  dom.solveTitle.textContent = maxStatus === "good" ? "平面映射已就绪" : "检测到非平面偏差";
  dom.solveSubtitle.textContent = `${GRID_COLS} × ${GRID_ROWS} 控制网格 · DLT 最小二乘`;
  updateMatrixPreview();
  updatePointPanel();
  updateSeamCards();
  updateProjectorCards();
}

function updateModeUI() {
  const output = state.view === "output";
  dom.stagePanel.classList.toggle("is-output-view", output);
  dom.stageModeLabel.textContent = output ? "输出监看" : "几何校准";
  dom.stageBadgeMain.textContent = output ? "OUTPUT / BLEND" : "EDIT / WARP";
  dom.stageBadgeSub.textContent = output ? "1600 × 900 · LIVE" : "1600 × 900 · sRGB";
  dom.viewTabs.forEach((tab) => {
    const active = tab.dataset.view === state.view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

function requestRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    state.seams = evaluateSeams();
    renderProjection();
    drawOverlay();
    updateReadouts();
    schedulePopupUpdate();
  });
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 2200);
}

function setSaveState(dirty) {
  dom.saveState.classList.toggle("is-dirty", dirty);
  dom.saveState.innerHTML = `<i></i> ${dirty ? "改动待同步" : "配置已同步"}`;
}

function configSnapshot() {
  return {
    schema: "triple-blend",
    version: 1,
    savedAt: new Date().toISOString(),
    pattern: state.pattern,
    checkerSize: state.checkerSize,
    feather: state.feather,
    channels: state.channels.map((channel) => ({
      id: channel.id,
      enabled: channel.enabled,
      gain: channel.gain,
      points: channel.points.map((point) => ({
        x: Number(point.x.toFixed(3)),
        y: Number(point.y.toFixed(3)),
      })),
    })),
  };
}

function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configSnapshot()));
    setSaveState(false);
  } catch {
    setSaveState(true);
  }
}

function markDirty() {
  setSaveState(true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistLocal, 650);
}

function downloadConfig() {
  persistLocal();
  const blob = new Blob([JSON.stringify(configSnapshot(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `triple-blend-${date}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("控制点配置已保存");
}

function applyConfig(config) {
  if (!config || !Array.isArray(config.channels) || config.channels.length !== 3) {
    throw new Error("配置缺少三路投影数据");
  }
  const channels = createChannels();
  config.channels.forEach((saved, index) => {
    if (!Array.isArray(saved.points) || saved.points.length !== channels[index].points.length) {
      throw new Error(`投影机 ${channels[index].id} 的控制点数量不匹配`);
    }
    saved.points.forEach((point, pointIndex) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error("控制点坐标无效");
      }
      channels[index].points[pointIndex].x = clamp(point.x, 0, STAGE_WIDTH);
      channels[index].points[pointIndex].y = clamp(point.y, 0, STAGE_HEIGHT);
    });
    channels[index].gain = Number.isFinite(saved.gain)
      ? clamp(saved.gain, 0.7, 1.3)
      : 1;
    channels[index].enabled = saved.enabled !== false;
  });
  if (["checker", "gray", "ramp"].includes(config.pattern)) state.pattern = config.pattern;
  if (Number.isFinite(config.checkerSize)) state.checkerSize = clamp(config.checkerSize, 32, 140);
  if (Number.isFinite(config.feather)) state.feather = clamp(config.feather, 0.02, 0.32);
  state.channels = channels;
  solveAll();
  state.selectedPoint = null;
  state.selectedChannel = 0;
  renderProjectorList();
  syncControls();
  requestRender();
}

function loadConfigFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applyConfig(JSON.parse(String(reader.result)));
      persistLocal();
      showToast("配置已重载");
    } catch (error) {
      showToast(`重载失败：${error.message}`);
    }
  };
  reader.readAsText(file);
}

function syncControls() {
  dom.patternButtons.forEach((button) => {
    const active = button.dataset.pattern === state.pattern;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  dom.checkerField.classList.toggle("is-hidden", state.pattern !== "checker");
  dom.checkerSize.value = String(state.checkerSize);
  dom.checkerOutput.textContent = `${state.checkerSize} px`;
  dom.checkerSize.style.setProperty("--fill", `${((state.checkerSize - 32) / 108) * 100}%`);
  dom.featherRange.value = String(Math.round(state.feather * 100));
  dom.featherOutput.textContent = `${Math.round(state.feather * 100)}%`;
  dom.featherRange.style.setProperty("--fill", `${((state.feather - 0.02) / 0.3) * 100}%`);
  dom.btnToggleCoverage.setAttribute("aria-pressed", String(state.showCoverage));
  dom.btnToggleSeams.setAttribute("aria-pressed", String(state.showSeams));
}

function canvasCoordinates(event) {
  const rect = dom.overlayCanvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width * STAGE_WIDTH, 0, STAGE_WIDTH),
    y: clamp((event.clientY - rect.top) / rect.height * STAGE_HEIGHT, 0, STAGE_HEIGHT),
  };
}

function hitTest(point) {
  const rect = dom.overlayCanvas.getBoundingClientRect();
  const scale = STAGE_WIDTH / Math.max(1, rect.width);
  const threshold = 10 * clamp(scale, 0.9, 2.8);
  let nearest = null;
  state.channels.forEach((channel, channelIndex) => {
    if (!channel.enabled) return;
    channel.points.forEach((controlPoint, pointIndex) => {
      const distance = Math.hypot(controlPoint.x - point.x, controlPoint.y - point.y);
      if (distance <= threshold && (!nearest || distance < nearest.distance)) {
        nearest = { channelIndex, pointIndex, distance };
      }
    });
  });
  return nearest;
}

function resetPoint(channelIndex, pointIndex) {
  const point = state.channels[channelIndex].points[pointIndex];
  point.x = point.idealX;
  point.y = point.idealY;
  solveChannel(state.channels[channelIndex]);
  markDirty();
  requestRender();
}

function selectPoint(hit) {
  state.selectedChannel = hit.channelIndex;
  state.selectedPoint = hit.pointIndex;
  requestRender();
}

function updateSelectedPointFromCoordinates(point) {
  if (state.selectedPoint === null) return;
  const channel = state.channels[state.selectedChannel];
  const controlPoint = channel.points[state.selectedPoint];
  controlPoint.x = point.x;
  controlPoint.y = point.y;
  try {
    solveChannel(channel);
  } catch {
    showToast("控制点过于集中，无法解算");
  }
  markDirty();
  requestRender();
}

function handlePointerDown(event) {
  if (state.view === "output" || event.button !== 0) return;
  event.preventDefault();
  const point = canvasCoordinates(event);
  const hit = hitTest(point);
  if (!hit) {
    state.selectedPoint = null;
    state.hoverPoint = null;
    requestRender();
    return;
  }
  state.dragging = true;
  state.hoverPoint = hit.pointIndex;
  selectPoint(hit);
  dom.overlayCanvas.setPointerCapture(event.pointerId);
  dom.overlayCanvas.style.cursor = "grabbing";
}

function handlePointerMove(event) {
  if (state.view === "output") return;
  const point = canvasCoordinates(event);
  if (state.dragging) {
    updateSelectedPointFromCoordinates(point);
    return;
  }
  const hit = hitTest(point);
  const hoverPoint = hit ? hit.pointIndex : null;
  const hoverChannel = hit ? hit.channelIndex : null;
  if (hoverPoint !== state.hoverPoint || hoverChannel !== state.selectedChannel) {
    if (hoverChannel !== null && !state.dragging) state.selectedChannel = hoverChannel;
    state.hoverPoint = hoverPoint;
    dom.overlayCanvas.style.cursor = hit ? "grab" : "crosshair";
    requestRender();
  }
}

function handlePointerUp(event) {
  if (!state.dragging) return;
  state.dragging = false;
  dom.overlayCanvas.style.cursor = "grab";
  if (dom.overlayCanvas.hasPointerCapture(event.pointerId)) {
    dom.overlayCanvas.releasePointerCapture(event.pointerId);
  }
  persistLocal();
  const channel = state.channels[state.selectedChannel];
  showToast(`平面已重解 · 残差 ${formatFixed(channel.fit.rms)} px`);
}

function handleDoubleClick(event) {
  if (state.view === "output") return;
  const point = canvasCoordinates(event);
  const hit = hitTest(point);
  if (!hit) return;
  selectPoint(hit);
  resetPoint(hit.channelIndex, hit.pointIndex);
  showToast("节点已恢复至理想位置");
}

function bindEvents() {
  dom.viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      updateModeUI();
      requestRender();
    });
  });

  dom.patternButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.pattern = button.dataset.pattern;
      syncControls();
      markDirty();
      requestRender();
    });
  });

  dom.projectorList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-channel]");
    if (!card) return;
    const index = Number(card.dataset.channel);
    if (event.target.closest("[data-toggle]")) {
      state.channels[index].enabled = !state.channels[index].enabled;
      markDirty();
      requestRender();
      return;
    }
    state.selectedChannel = index;
    state.selectedPoint = null;
    requestRender();
  });

  dom.projectorList.addEventListener("input", (event) => {
    const gain = event.target.closest("[data-gain]");
    if (!gain) return;
    const card = gain.closest("[data-channel]");
    const index = Number(card.dataset.channel);
    state.channels[index].gain = Number(gain.value) / 100;
    markDirty();
    requestRender();
  });

  dom.featherRange.addEventListener("input", () => {
    state.feather = Number(dom.featherRange.value) / 100;
    syncControls();
    markDirty();
    requestRender();
  });

  dom.checkerSize.addEventListener("input", () => {
    state.checkerSize = Number(dom.checkerSize.value);
    syncControls();
    markDirty();
    requestRender();
  });

  dom.btnToggleCoverage.addEventListener("click", () => {
    state.showCoverage = !state.showCoverage;
    syncControls();
    requestRender();
  });

  dom.btnToggleSeams.addEventListener("click", () => {
    state.showSeams = !state.showSeams;
    syncControls();
    requestRender();
  });

  dom.btnSolve.addEventListener("click", () => {
    solveAll();
    requestRender();
    persistLocal();
    const worst = Math.max(...state.channels.map((channel) => channel.fit.rms));
    showToast(`平面映射解算完成 · 最大残差 ${formatFixed(worst)} px`);
  });

  dom.btnReset.addEventListener("click", () => {
    state.channels.forEach((channel) => {
      channel.points.forEach((point) => {
        point.x = point.idealX;
        point.y = point.idealY;
      });
      solveChannel(channel);
    });
    markDirty();
    requestRender();
    showToast("全部控制点已恢复至理想位置");
  });

  dom.btnResetPoint.addEventListener("click", () => {
    if (state.selectedPoint === null) return;
    resetPoint(state.selectedChannel, state.selectedPoint);
  });

  const commitPointInput = () => {
    if (state.selectedPoint === null) return;
    const point = state.channels[state.selectedChannel].points[state.selectedPoint];
    const x = Number(dom.nodeX.value);
    const y = Number(dom.nodeY.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    point.x = clamp(x, 0, STAGE_WIDTH);
    point.y = clamp(y, 0, STAGE_HEIGHT);
    solveChannel(state.channels[state.selectedChannel]);
    markDirty();
    requestRender();
  };
  dom.nodeX.addEventListener("change", commitPointInput);
  dom.nodeY.addEventListener("change", commitPointInput);

  dom.overlayCanvas.addEventListener("pointerdown", handlePointerDown);
  dom.overlayCanvas.addEventListener("pointermove", handlePointerMove);
  dom.overlayCanvas.addEventListener("pointerup", handlePointerUp);
  dom.overlayCanvas.addEventListener("pointercancel", handlePointerUp);
  dom.overlayCanvas.addEventListener("pointerleave", () => {
    if (state.dragging) return;
    if (state.hoverPoint !== null) {
      state.hoverPoint = null;
      requestRender();
    }
  });
  dom.overlayCanvas.addEventListener("dblclick", handleDoubleClick);

  dom.btnSave.addEventListener("click", downloadConfig);
  dom.btnLoad.addEventListener("click", () => dom.fileLoad.click());
  dom.fileLoad.addEventListener("change", () => {
    const [file] = dom.fileLoad.files;
    if (file) loadConfigFile(file);
    dom.fileLoad.value = "";
  });
  dom.btnOpenOutput.addEventListener("click", openOutputWindow);
}

function popupDocument() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Triple Blend · Projection Output</title>
<style>
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #05070a; }
  body { display: flex; flex-direction: column; color: #dbe5ee; font-family: "Avenir Next", "Noto Sans SC", sans-serif; }
  header { display: flex; flex: 0 0 46px; align-items: center; gap: 12px; padding: 0 16px; border-bottom: 1px solid #1a2632; background: #080d13; }
  .brand { display: flex; align-items: center; gap: 8px; font: 600 10px "SFMono-Regular", Menlo, monospace; letter-spacing: .14em; }
  .brand i { width: 18px; height: 18px; border: 1px solid #4bdac8; border-radius: 50%; box-shadow: 6px 0 0 -1px #05070a, 6px 0 0 0 #f3b35b; }
  header span { color: #627487; font: 8px "SFMono-Regular", Menlo, monospace; letter-spacing: .08em; }
  header .right { margin-left: auto; display: flex; gap: 18px; }
  header b { color: #9fb2c3; font: 500 9px "SFMono-Regular", Menlo, monospace; }
  main { position: relative; display: flex; flex: 1; align-items: center; justify-content: center; padding: 18px; background: radial-gradient(circle at 50% 45%, #0d141b, #040608 70%); }
  .frame { position: relative; width: min(100%, calc((100vh - 108px) * 1.7778)); aspect-ratio: 16/9; background: #000; box-shadow: 0 0 0 6px #0b1015, 0 0 0 7px #27333f, 0 24px 80px #000; }
  img { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
  .tag { position: absolute; top: 12px; left: 14px; display: grid; gap: 2px; padding: 6px 8px; border: 1px solid #ffffff14; background: #05080bb8; backdrop-filter: blur(6px); }
  .tag b { color: #d7e2eb; font: 500 8px "SFMono-Regular", Menlo, monospace; letter-spacing: .1em; }
  .tag small { color: #71869a; font: 7px "SFMono-Regular", Menlo, monospace; }
  .full { margin-left: auto; color: #566b7e; font: 7px "SFMono-Regular", Menlo, monospace; }
</style>
</head>
<body>
  <header>
    <div class="brand"><i></i>TRIPLE BLEND</div>
    <span>PROJECTION OUTPUT / CLEAN FEED</span>
    <div class="right"><b id="popup-pattern">CHECKERBOARD</b><b id="popup-metric">SEAM 0.00 px</b></div>
  </header>
  <main>
    <div class="frame">
      <img id="popup-image" alt="三投影拼接输出">
      <div class="tag"><b>OUTPUT 01</b><small>1600 × 900 · 60.00 Hz</small></div>
      <div class="tag full" style="left:auto;right:14px">SIMULATED PROJECTION</div>
    </div>
  </main>
</body>
</html>`;
}

function openOutputWindow() {
  if (state.outputWindow && !state.outputWindow.closed) {
    state.outputWindow.focus();
    schedulePopupUpdate(true);
    return;
  }
  const output = window.open(
    "",
    "tripleBlendOutput",
    "popup=yes,width=1280,height=800,menubar=no,toolbar=no,location=no,status=no",
  );
  if (!output) {
    showToast("输出窗口被浏览器拦截，请允许弹窗");
    return;
  }
  output.document.open();
  output.document.write(popupDocument());
  output.document.close();
  state.outputWindow = output;
  setTimeout(() => schedulePopupUpdate(true), 120);
}

function schedulePopupUpdate(force = false) {
  if (!state.outputWindow || state.outputWindow.closed) return;
  const now = performance.now();
  if (!force && now - state.popupTimer < 320) return;
  state.popupTimer = now;
  try {
    const output = state.outputWindow;
    const image = output.document.getElementById("popup-image");
    if (!image) return;
    image.src = dom.stageCanvas.toDataURL("image/jpeg", 0.9);
    const maxPosition = Math.max(...state.seams.map((seam) => seam.maxPosition));
    const maxLuma = Math.max(...state.seams.map((seam) => seam.maxLuminance));
    const pattern = output.document.getElementById("popup-pattern");
    const metric = output.document.getElementById("popup-metric");
    if (pattern) {
      pattern.textContent = state.pattern === "checker"
        ? "CHECKERBOARD"
        : state.pattern === "gray"
          ? "GRAY 50%"
          : "GRAYSCALE 11";
    }
    if (metric) {
      metric.textContent = `SEAM ${maxPosition.toFixed(2)} px · ΔY ${maxLuma.toFixed(2)}%`;
    }
  } catch {
    state.outputWindow = null;
  }
}

function cacheDom() {
  dom.stagePanel = document.querySelector(".stage-panel");
  dom.stageFrame = document.getElementById("stageFrame");
  dom.stageCanvas = document.getElementById("stageCanvas");
  dom.overlayCanvas = document.getElementById("overlayCanvas");
  dom.projectorList = document.getElementById("projectorList");
  dom.patternButtons = [...document.querySelectorAll(".pattern-option")];
  dom.checkerField = document.getElementById("checkerField");
  dom.checkerSize = document.getElementById("checkerSize");
  dom.checkerOutput = document.getElementById("checkerOutput");
  dom.featherRange = document.getElementById("featherRange");
  dom.featherOutput = document.getElementById("featherOutput");
  dom.saveState = document.getElementById("saveState");
  dom.toast = document.getElementById("toast");
  dom.viewTabs = [...document.querySelectorAll(".view-tab")];
  dom.stageModeLabel = document.getElementById("stageModeLabel");
  dom.stageBadgeMain = document.getElementById("stageBadgeMain");
  dom.stageBadgeSub = document.getElementById("stageBadgeSub");
  dom.btnToggleCoverage = document.getElementById("btnToggleCoverage");
  dom.btnToggleSeams = document.getElementById("btnToggleSeams");
  dom.btnReset = document.getElementById("btnReset");
  dom.btnSolve = document.getElementById("btnSolve");
  dom.btnSave = document.getElementById("btnSave");
  dom.btnLoad = document.getElementById("btnLoad");
  dom.btnOpenOutput = document.getElementById("btnOpenOutput");
  dom.fileLoad = document.getElementById("fileLoad");
  dom.solveTitle = document.getElementById("solveTitle");
  dom.solveSubtitle = document.getElementById("solveSubtitle");
  dom.solveStatus = document.getElementById("solveStatus");
  dom.metricRms = document.getElementById("metricRms");
  dom.metricMax = document.getElementById("metricMax");
  dom.metricPoints = document.getElementById("metricPoints");
  dom.matrixPreview = document.getElementById("matrixPreview");
  dom.footerPosError = document.getElementById("footerPosError");
  dom.footerLumaError = document.getElementById("footerLumaError");
  dom.footerResidual = document.getElementById("footerResidual");
  dom.qualityScore = document.getElementById("qualityScore");
  dom.scoreRing = document.getElementById("scoreRing");
  dom.qualityBar = document.getElementById("qualityBar");
  dom.qualityNote = document.getElementById("qualityNote");
  dom.pointEmpty = document.getElementById("pointEmpty");
  dom.pointEditor = document.getElementById("pointEditor");
  dom.nodeChip = document.getElementById("nodeChip");
  dom.nodeName = document.getElementById("nodeName");
  dom.nodeDot = document.getElementById("nodeDot");
  dom.nodeX = document.getElementById("nodeX");
  dom.nodeY = document.getElementById("nodeY");
  dom.btnResetPoint = document.getElementById("btnResetPoint");
  dom.seamList = document.getElementById("seamList");
}

function initialize() {
  cacheDom();
  state.channels = createChannels();
  solveAll();
  overlayContext = dom.overlayCanvas.getContext("2d");
  try {
    createRenderer(dom.stageCanvas);
  } catch (error) {
    showToast(`WebGL 初始化失败：${error.message}`);
  }
  renderProjectorList();
  bindEvents();
  updateModeUI();
  syncControls();

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      applyConfig(JSON.parse(saved));
      showToast("已恢复上次控制点配置");
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    state.overlayScale = STAGE_WIDTH / Math.max(1, entry.contentRect.width);
    requestRender();
  });
  resizeObserver.observe(dom.overlayCanvas);
  requestRender();
}

initialize();
