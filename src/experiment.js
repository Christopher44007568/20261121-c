import {
  coverageChannel,
  edgeMae,
  holeFraction,
  JITTERS,
  makeRoi,
  mipChainReport,
  summarize,
  summarizeBy,
  temporalStats,
} from "./metrics.js";

export const DISTANCES = Object.freeze([2.2, 4.0, 7.0, 14.0, 32.0]);
export const TILTS = Object.freeze([0, 30, 60, 75]);
export const METRIC_WIDTH = 640;
export const METRIC_HEIGHT = 400;

export const PIPELINES = Object.freeze([
  {
    id: "geometry",
    label: "Geometry ref · MSAA 4x",
    short: "Geometry",
    mode: "geometry",
    samples: 4,
    alphaMode: 0,
  },
  {
    id: "hard",
    label: "Binary alpha test · 1x",
    short: "Binary 1x",
    mode: "alpha",
    samples: 0,
    alphaMode: 0,
  },
  {
    id: "dither",
    label: "Bayer alpha test · 1x",
    short: "Bayer 1x",
    mode: "alpha",
    samples: 0,
    alphaMode: 1,
  },
  {
    id: "a2c4",
    label: "Alpha-to-coverage · MSAA 4x",
    short: "A2C 4x",
    mode: "alpha",
    samples: 4,
    alphaMode: 2,
  },
]);

function baseSettings(pipeline, distance, tiltDegrees, overrides = {}) {
  return {
    mode: pipeline.mode,
    alphaMode: pipeline.alphaMode,
    samples: pipeline.samples,
    threshold: 0.5,
    mipBias: 0,
    distance,
    tiltDegrees,
    jitter: [0, 0],
    width: METRIC_WIDTH,
    height: METRIC_HEIGHT,
    showBackground: false,
    ...overrides,
  };
}

function captureJitterFrames(renderer, settings, kind) {
  const frames = [];
  for (const jitter of JITTERS) {
    const pixels = renderer.captureCoverage({ ...settings, kind, jitter });
    frames.push(coverageChannel(pixels));
  }
  return frames;
}

function metricRow(pipeline, distance, tiltDegrees, frames, geometryFrame, roi) {
  const hole = holeFraction(frames[0], roi);
  const geometryHole = holeFraction(geometryFrame, roi);
  const temporal = temporalStats(frames, roi);
  const errorPp = (hole - geometryHole) * 100;
  const relativeError = geometryHole > 0.02 ? (errorPp / (geometryHole * 100)) * 100 : null;
  return {
    pipeline: pipeline.id,
    label: pipeline.label,
    distance,
    tiltDegrees,
    samples: pipeline.samples,
    alphaMode: pipeline.alphaMode,
    roiPixels: roi.count,
    holeFractionPct: hole * 100,
    geometryHoleFractionPct: geometryHole * 100,
    holeErrorPp: errorPp,
    holeRelativeErrorPct: relativeError,
    edgeMaePct: edgeMae(frames[0], geometryFrame, roi) * 100,
    flickerStdPct: temporal.flickerStdPct,
    togglePct: temporal.togglePct,
    temporalRangePct: temporal.temporalRangePct,
  };
}

function rendererEnvironment(renderer) {
  const info = renderer.info;
  const rendererName = info.unmaskedRenderer || info.renderer || "";
  const isSoftware = /swiftshader|llvmpipe|softpipe|software/i.test(rendererName);
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    ...info,
    accelerationClass: isSoftware ? "software-rasterizer" : "hardware-or-native-gpu",
  };
}

export async function runExperiment(renderer, onProgress = () => {}) {
  const rows = [];
  const total = DISTANCES.length * TILTS.length;
  let completed = 0;
  const started = performance.now();

  for (const distance of DISTANCES) {
    for (const tiltDegrees of TILTS) {
      const reference = baseSettings(PIPELINES[0], distance, tiltDegrees);
      const maskPixels = renderer.captureCoverage({
        ...reference,
        samples: 4,
        kind: "mask",
      });
      const roi = makeRoi(maskPixels);
      const geometryFrames = captureJitterFrames(renderer, reference, "geometry");
      rows.push(metricRow(
        PIPELINES[0], distance, tiltDegrees, geometryFrames, geometryFrames[0], roi,
      ));

      for (const pipeline of PIPELINES.slice(1)) {
        const settings = baseSettings(pipeline, distance, tiltDegrees);
        const frames = captureJitterFrames(renderer, settings, "alpha");
        rows.push(metricRow(
          pipeline, distance, tiltDegrees, frames, geometryFrames[0], roi,
        ));
      }
      completed += 1;
      onProgress({
        completed,
        total,
        distance,
        tiltDegrees,
        message: `${completed}/${total} · d=${distance.toFixed(1)} · tilt=${tiltDegrees}°`,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  onProgress({ completed: total, total, message: "MSAA cost benchmark..." });
  const msaaCost = renderer.benchmarkMSAAFill({
    samplesList: [0, 2, 4, 8],
    width: 960,
    height: 600,
    framesPerBatch: 20,
    batches: 9,
    passesPerFrame: 12,
  });
  const msaaSceneCost = renderer.benchmarkMSAA({
    samplesList: [0, 2, 4, 8],
    width: 960,
    height: 600,
    distance: 1.25,
    tiltDegrees: 30,
    framesPerBatch: 12,
    batches: 5,
  });
  const requestedSamples = [0, 2, 4, 8];

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    durationMs: performance.now() - started,
    environment: rendererEnvironment(renderer),
    testMatrix: {
      distances: DISTANCES,
      tiltDegrees: TILTS,
      jitterPhases: JITTERS.length,
      metricViewport: [METRIC_WIDTH, METRIC_HEIGHT],
      alphaThreshold: 0.5,
    },
    mipChain: {
      baseWidth: renderer.mask.baseWidth,
      baseHeight: renderer.mask.baseHeight,
      analyticMetalFraction: renderer.mask.analyticMetalFraction,
      levels: mipChainReport(renderer.mask),
    },
    msaaCost,
    msaaSceneCost,
    msaaCostKind: "full-screen fill + MSAA resolve stress",
    msaaRequestedSamples: requestedSamples,
    msaaUnsupportedSamples: requestedSamples.filter(
      (samples) => samples > 1 && samples > renderer.info.maxSamples,
    ),
    msaaCostNote:
      "Timing includes offscreen render, MSAA resolve, and the same A2C scene. " +
      "Check environment.timerSource and accelerationClass before treating values as hardware numbers.",
    summary: summarize(rows),
    summaryByDistance: summarizeBy(rows, "distance", DISTANCES),
    summaryByTilt: summarizeBy(rows, "tiltDegrees", TILTS),
    measurements: rows,
  };
  return report;
}

function metricLookup(report) {
  const map = new Map();
  for (const row of report?.measurements ?? []) {
    map.set(`${row.pipeline}:${row.distance}:${row.tiltDegrees}`, row);
  }
  return map;
}

function formatMetric(row) {
  if (!row) return "";
  const hole = row.holeFractionPct.toFixed(1);
  const error = row.holeErrorPp;
  const err = Number.isFinite(error) ? `${error >= 0 ? "+" : ""}${error.toFixed(1)}` : "n/a";
  return `open ${hole}%  err ${err}pp  flick ${row.flickerStdPct.toFixed(2)}pp`;
}

function makeSheetCanvas(title, subtitle, rowLabels, columnLabels) {
  const tileW = 330;
  const imageH = 206;
  const tileH = 226;
  const left = 184;
  const top = 94;
  const gap = 12;
  const width = left + columnLabels.length * tileW + (columnLabels.length - 1) * gap + 22;
  const height = top + rowLabels.length * tileH + (rowLabels.length - 1) * gap + 62;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#080d10";
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.62, 30, 0, width * 0.62, 30, width * 0.65);
  glow.addColorStop(0, "rgba(36,103,111,0.24)");
  glow.addColorStop(1, "rgba(8,13,16,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#edf4f2";
  ctx.font = "600 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(title, 22, 34);
  ctx.fillStyle = "#8ba1a1";
  ctx.font = "13px ui-monospace, SFMono-Regular, monospace";
  ctx.fillText(subtitle, 22, 57);
  ctx.strokeStyle = "rgba(128,174,174,0.22)";
  ctx.beginPath();
  ctx.moveTo(22, 72);
  ctx.lineTo(width - 22, 72);
  ctx.stroke();

  ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  for (let col = 0; col < columnLabels.length; col += 1) {
    ctx.fillStyle = "#b7c8c6";
    ctx.fillText(columnLabels[col], left + col * (tileW + gap) + 4, 86);
  }
  for (let row = 0; row < rowLabels.length; row += 1) {
    ctx.fillStyle = "#d6e2df";
    ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(rowLabels[row], 22, top + row * (tileH + gap) + 18);
  }
  return { canvas, ctx, tileW, imageH, tileH, left, top, gap, width, height };
}

function drawTile(renderer, sheet, settings, col, row, footer) {
  const {
    canvas, ctx, tileW, imageH, tileH, left, top, gap,
  } = sheet;
  const x = left + col * (tileW + gap);
  const y = top + row * (tileH + gap);
  renderer.resizeCanvas(960, 600);
  renderer.renderAndPresent(settings);
  ctx.drawImage(renderer.canvas, 0, 0, 960, 600, x, y, tileW, imageH);
  ctx.strokeStyle = "rgba(154,197,195,0.28)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, tileW - 1, imageH - 1);
  if (footer) {
    ctx.fillStyle = "#78908f";
    ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
    ctx.fillText(footer, x + 3, y + imageH + 16);
  }
}

function pipelineAt(pipeline, distance, tiltDegrees, extra = {}) {
  return baseSettings(pipeline, distance, tiltDegrees, {
    width: 960,
    height: 600,
    showBackground: true,
    ...extra,
  });
}

function sheetDataUrl(sheet) {
  return sheet.canvas.toDataURL("image/png");
}

export async function captureArtifacts(renderer, report, onProgress = () => {}) {
  const lookup = metricLookup(report);
  const artifacts = {};
  const environment = report?.environment ?? rendererEnvironment(renderer);
  const envLabel = environment.unmaskedRenderer || environment.renderer || "WebGL2";

  onProgress({ message: "Rendering geometry reference..." });
  renderer.resizeCanvas(1280, 800);
  renderer.renderAndPresent(pipelineAt(
    PIPELINES[0], 2.72, 22, { width: 1280, height: 800, showContours: true },
  ));
  artifacts["geometry-reference.png"] = renderer.canvas.toDataURL("image/png");
  await new Promise((resolve) => setTimeout(resolve, 0));

  onProgress({ message: "Rendering edge comparison..." });
  const edge = makeSheetCanvas(
    "True mesh contour vs alpha coverage",
    "Close range · true hole rims overlaid in orange · MSAA 4x reference · same camera",
    ["tilt 0°", "tilt 60°"],
    ["Geometry + true rim", "Alpha-to-coverage 4x"],
  );
  for (let row = 0; row < 2; row += 1) {
    const tilt = [0, 60][row];
    for (let col = 0; col < 2; col += 1) {
      const pipeline = PIPELINES[col === 0 ? 0 : 3];
      const rowMetric = lookup.get(`${pipeline.id}:2.2:${tilt}`);
      drawTile(
        renderer,
        edge,
        pipelineAt(pipeline, 2.2, tilt, { showContours: col === 0 }),
        col,
        row,
        formatMetric(rowMetric),
      );
    }
  }
  artifacts["edge-comparison.png"] = sheetDataUrl(edge);
  await new Promise((resolve) => setTimeout(resolve, 0));

  onProgress({ message: "Rendering distance sweep..." });
  const distanceSheet = makeSheetCanvas(
    "Distance sweep · mip coverage",
    "Tilt 30° · 8 subpixel phases per point · open% is inside the projected plate",
    PIPELINES.map((pipeline) => pipeline.short),
    DISTANCES.map((distance) => `distance ${distance.toFixed(1)}`),
  );
  for (let row = 0; row < PIPELINES.length; row += 1) {
    for (let col = 0; col < DISTANCES.length; col += 1) {
      const pipeline = PIPELINES[row];
      const distance = DISTANCES[col];
      drawTile(
        renderer,
        distanceSheet,
        pipelineAt(pipeline, distance, 30),
        col,
        row,
        formatMetric(lookup.get(`${pipeline.id}:${distance}:30`)),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  artifacts["distance-sweep.png"] = sheetDataUrl(distanceSheet);

  onProgress({ message: "Rendering tilt sweep..." });
  const tiltSheet = makeSheetCanvas(
    "Tilt sweep · anisotropic minification",
    "Distance 7.0 · hole rims become subpixel along the compressed screen axis",
    PIPELINES.map((pipeline) => pipeline.short),
    TILTS.map((tilt) => `tilt ${tilt}°`),
  );
  for (let row = 0; row < PIPELINES.length; row += 1) {
    for (let col = 0; col < TILTS.length; col += 1) {
      const pipeline = PIPELINES[row];
      const tilt = TILTS[col];
      drawTile(
        renderer,
        tiltSheet,
        pipelineAt(pipeline, 7.0, tilt),
        col,
        row,
        formatMetric(lookup.get(`${pipeline.id}:7:${tilt}`)),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  artifacts["tilt-sweep.png"] = sheetDataUrl(tiltSheet);

  for (const sheet of [distanceSheet, tiltSheet, edge]) {
    sheet.ctx.fillStyle = "#607674";
    sheet.ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
    if (sheet.width < 1100) {
      sheet.ctx.fillText(`WebGL2 · ${envLabel}`, 22, sheet.height - 34);
      sheet.ctx.fillText("flick = temporal coverage std (percentage points)", 22, sheet.height - 19);
    } else {
      sheet.ctx.fillText(
        `WebGL2 · ${envLabel} · flick = temporal coverage std (percentage points)`,
        22,
        sheet.height - 22,
      );
    }
  }
  artifacts["distance-sweep.png"] = sheetDataUrl(distanceSheet);
  artifacts["tilt-sweep.png"] = sheetDataUrl(tiltSheet);
  artifacts["edge-comparison.png"] = sheetDataUrl(edge);
  return artifacts;
}
