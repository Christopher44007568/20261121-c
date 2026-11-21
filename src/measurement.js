import { V3, rectDistance, clamp } from "./math.js";

const LABEL_WIDTH = 132;
const LABEL_HEIGHT = 34;
const MODEL_CLEARANCE = 12;
const LABEL_CLEARANCE = 8;
const VIEWPORT_CLEARANCE = 12;
const MAX_ANCHOR_DISTANCE = 340;
const DEPTH_EPSILON = 0.045;

const SLOT_VECTORS = [
  [0, 42],
  [-83, 42],
  [83, 42],
  [0, 70],
  [-108, 38],
  [108, 38],
  [-83, 70],
  [83, 70],
  [-132, 42],
  [132, 42],
  [0, 101],
  [-52, -44],
  [52, -44],
  [0, 132],
  [-116, 92],
  [116, 92],
  [0, 168],
  [-118, 142],
  [118, 142],
  [-180, 76],
  [180, 76],
  [-96, 176],
  [96, 176],
  [0, 214],
  [-154, 188],
  [154, 188],
  [-226, 92],
  [226, 92],
  [-70, 244],
  [70, 244],
];

function roundRect(rect, grid = 1) {
  return {
    x: Math.round(rect.x / grid) * grid,
    y: Math.round(rect.y / grid) * grid,
    width: rect.width,
    height: rect.height,
  };
}

function rectCenter(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function viewportGap(rect, width, height) {
  return Math.min(rect.x, rect.y, width - (rect.x + rect.width), height - (rect.y + rect.height));
}

function minimumFieldInRect(rect, probe) {
  const x0 = clamp(Math.floor(rect.x), 0, probe.width - 1);
  const x1 = clamp(Math.ceil(rect.x + rect.width), 0, probe.width - 1);
  const y0 = clamp(Math.floor(rect.y), 0, probe.height - 1);
  const y1 = clamp(Math.ceil(rect.y + rect.height), 0, probe.height - 1);
  let minimum = 9999;
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const value = probe.distanceField[y * probe.width + x];
      if (value < minimum) minimum = value;
    }
  }
  return minimum;
}

function segmentIntersectsRect(a, b, rect) {
  const steps = Math.max(2, Math.ceil(pointDistance(a, b) / 7));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return true;
    }
  }
  return false;
}

function mergeSegments(samples, project, measurement, hiddenValue) {
  const segments = [];
  let start = null;
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i].hidden === hiddenValue && start === null) start = i;
    if (samples[i].hidden !== hiddenValue && start !== null) {
      segments.push(makeSegment(start, i - 1, samples, project, measurement));
      start = null;
    }
  }
  if (start !== null) segments.push(makeSegment(start, samples.length - 1, samples, project, measurement));
  return segments.filter((segment) => segment.lengthPx > 1.2);
}

function makeSegment(startIndex, endIndex, samples, project, measurement) {
  const first = samples[startIndex];
  const last = samples[endIndex];
  const before = Math.max(0, startIndex - 1);
  const after = Math.min(samples.length - 1, endIndex + 1);
  const startT = (samples[before].t + first.t) / 2;
  const endT = (samples[after].t + last.t) / 2;
  const a = project(V3.lerp(measurement.a, measurement.b, startT));
  const b = project(V3.lerp(measurement.a, measurement.b, endT));
  return {
    startT,
    endT,
    start: a,
    end: b,
    startPx: pointDistance(project(measurement.a), a),
    endPx: pointDistance(project(measurement.a), b),
    lengthPx: pointDistance(a, b),
  };
}

export class MeasurementOverlay {
  constructor(scene, elements) {
    this.scene = scene;
    this.canvas = elements.canvas;
    this.context = elements.canvas.getContext("2d");
    this.layer = elements.layer;
    this.measurements = scene.measurements.map((measurement) => ({
      ...measurement,
      distance: V3.length(V3.sub(measurement.b, measurement.a)),
      previousRect: null,
      previousSlot: -1,
      invalidFrames: 0,
      layout: null,
      segments: [],
      hiddenPx: 0,
      hiddenRatio: 0,
      projectedLength: 0,
      projected: null,
    }));
    this.labels = new Map();
    for (const measurement of this.measurements) {
      const element = document.createElement("div");
      element.className = "measure-label";
      element.dataset.dimension = measurement.id;
      element.dataset.stable = "true";
      element.innerHTML = `
        <span class="label-id">${measurement.label}</span>
        <span class="label-value">${measurement.distance.toFixed(3)}</span>
        <span class="label-unit">mm</span>
        <span class="label-anchor"></span>
      `;
      this.layer.appendChild(element);
      this.labels.set(measurement.id, element);
    }
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.slotSwitches = 0;
    this.lastReport = null;
  }

  resize(width, height, dpr) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    for (const measurement of this.measurements) {
      measurement.previousRect = null;
      measurement.invalidFrames = 0;
    }
  }

  update(viewProjection, camera, probe, options = {}) {
    const project = (point) => this.projectToCss(point, viewProjection);
    const screenColor = options.screenColor ?? "#df5b32";
    for (const measurement of this.measurements) {
      measurement.projected = {
        a: project(measurement.a),
        b: project(measurement.b),
      };
      measurement.projectedLength = pointDistance(measurement.projected.a, measurement.projected.b);
      this.sampleMeasurement(measurement, camera, probe, project);
    }
    this.layoutLabels(probe, options);
    this.draw(project, screenColor);
    this.lastReport = this.createReport(probe);
    return this.lastReport;
  }

  projectToCss(point, viewProjection) {
    const [x, y, , w] = [
      viewProjection[0] * point[0] + viewProjection[4] * point[1] + viewProjection[8] * point[2] + viewProjection[12],
      viewProjection[1] * point[0] + viewProjection[5] * point[1] + viewProjection[9] * point[2] + viewProjection[13],
      viewProjection[2] * point[0] + viewProjection[6] * point[1] + viewProjection[10] * point[2] + viewProjection[14],
      viewProjection[3] * point[0] + viewProjection[7] * point[1] + viewProjection[11] * point[2] + viewProjection[15],
    ];
    return {
      x: (x / w * 0.5 + 0.5) * this.width,
      y: (1 - (y / w * 0.5 + 0.5)) * this.height,
    };
  }

  sampleMeasurement(measurement, camera, probe, project) {
    const projectedLength = Math.max(measurement.projectedLength, 1);
    const sampleCount = clamp(Math.ceil(projectedLength * 1.15), 96, 720);
    const samples = [];
    for (let i = 0; i < sampleCount; i += 1) {
      const t = i / (sampleCount - 1);
      const world = V3.lerp(measurement.a, measurement.b, t);
      const screen = project(world);
      const depth = probe ? probe.sampleAt(screen.x, screen.y) : null;
      const eyeDistance = V3.length(V3.sub(world, camera.eye));
      const hidden = Boolean(depth && eyeDistance > depth.distance + DEPTH_EPSILON);
      samples.push({ t, world, screen, hidden });
    }
    measurement.segments = mergeSegments(samples, project, measurement, true);
    measurement.visibleSegments = mergeSegments(samples, project, measurement, false);
    measurement.hiddenPx = measurement.segments.reduce((sum, segment) => sum + segment.lengthPx, 0);
    measurement.hiddenRatio = measurement.hiddenPx / projectedLength;
    measurement.hiddenSamples = samples.filter((sample) => sample.hidden).length;
  }

  layoutLabels(probe, options) {
    const ordered = [...this.measurements].sort((a, b) => {
      if (a.id === "M2") return -1;
      if (b.id === "M2") return 1;
      return b.distance - a.distance;
    });
    const items = ordered.map((measurement) => {
      const base = {
        x: (measurement.projected.a.x + measurement.projected.b.x) / 2,
        y: (measurement.projected.a.y + measurement.projected.b.y) / 2,
      };
      const dx = measurement.projected.b.x - measurement.projected.a.x;
      const dy = measurement.projected.b.y - measurement.projected.a.y;
      const length = Math.hypot(dx, dy) || 1;
      const direction = { x: dx / length, y: dy / length };
      let normal = { x: direction.y, y: -direction.x };
      if (normal.y > 0) normal = { x: -normal.x, y: -normal.y };
      const quantizedBase = { x: Math.round(base.x / 2) * 2, y: Math.round(base.y / 2) * 2 };
      const candidates = SLOT_VECTORS.map(([tangent, normalOffset], index) => {
        const center = {
          x: quantizedBase.x + direction.x * tangent + normal.x * normalOffset,
          y: quantizedBase.y + direction.y * tangent + normal.y * normalOffset,
        };
        const rect = roundRect({
          x: center.x - LABEL_WIDTH / 2,
          y: center.y - LABEL_HEIGHT / 2,
          width: LABEL_WIDTH,
          height: LABEL_HEIGHT,
        });
        return { index, rect, center, base };
      });
      if (measurement.previousRect) {
        const nearOffsets = [[0, 0]];
        for (const distance of [2, 4, 6, 8, 10, 14, 18, 24]) {
          nearOffsets.push(
            [0, -distance], [-distance, 0], [distance, 0], [0, distance],
            [-distance, -distance], [distance, -distance],
            [-distance, distance], [distance, distance],
          );
        }
        for (const [offsetX, offsetY] of nearOffsets) {
          const rect = {
            ...measurement.previousRect,
            x: measurement.previousRect.x + offsetX,
            y: measurement.previousRect.y + offsetY,
          };
          candidates.push({
            index: measurement.previousSlot,
            rect,
            center: rectCenter(rect),
            base,
            nearPrevious: true,
          });
        }
      }
      return { measurement, base, candidates };
    });

    const allPrevious = items.every(({ measurement }) => measurement.previousRect);
    let chosenItems = null;
    if (options.zooming && allPrevious) {
      chosenItems = items.map(({ measurement, base }) => ({
        measurement,
        base,
        chosen: {
          index: measurement.previousSlot,
          rect: measurement.previousRect,
          center: rectCenter(measurement.previousRect),
          retained: true,
        },
      }));
    } else {
      const previousPairValid = allPrevious && this.previousPairValid(items, probe);
      if (previousPairValid) {
        chosenItems = items.map(({ measurement, base }) => ({
          measurement,
          base,
          chosen: {
            index: measurement.previousSlot,
            rect: measurement.previousRect,
            center: rectCenter(measurement.previousRect),
            retained: true,
          },
        }));
      } else {
        chosenItems = this.solvePair(items, probe);
      }
    }

    for (const { measurement, base, chosen } of chosenItems) {
      if (measurement.previousRect && chosen.index !== measurement.previousSlot) this.slotSwitches += 1;
      measurement.previousRect = chosen.rect;
      measurement.previousSlot = chosen.index;
      measurement.layout = {
        rect: chosen.rect,
        base,
        anchor: base,
        slot: chosen.index,
        retained: Boolean(chosen.retained),
      };
    }
    this.positionLabels();
  }

  previousPairValid(items, probe) {
    for (let i = 0; i < items.length; i += 1) {
      const measurement = items[i].measurement;
      const validity = this.validRect(measurement.previousRect, probe, []);
      const anchorDistance = pointDistance(rectCenter(measurement.previousRect), items[i].base);
      if (!validity.valid || anchorDistance > MAX_ANCHOR_DISTANCE) return false;
      for (let j = i + 1; j < items.length; j += 1) {
        if (rectDistance(measurement.previousRect, items[j].measurement.previousRect) < LABEL_CLEARANCE - 0.5) {
          return false;
        }
      }
    }
    return true;
  }

  solvePair(items, probe) {
    if (items.length !== 2) return this.solveSequential(items, probe);
    const prepared = items.map(({ measurement, base, candidates }) => ({
      measurement,
      base,
      candidates: candidates.map((candidate) => {
        const validity = this.validRect(candidate.rect, probe, []);
        const linePenalty = segmentIntersectsRect(
          measurement.projected.a,
          measurement.projected.b,
          candidate.rect,
        ) ? 480 : 0;
        const previousShift = measurement.previousRect
          ? pointDistance(candidate.center, rectCenter(measurement.previousRect))
          : 0;
        const slotPenalty = measurement.previousSlot >= 0 && candidate.index !== measurement.previousSlot ? 34 : 0;
        const anchorDistance = pointDistance(candidate.center, base);
        const shortfall =
          Math.max(0, MODEL_CLEARANCE - validity.modelGap) * 2400 +
          Math.max(0, VIEWPORT_CLEARANCE - validity.viewportGap) * 3000;
        return {
          ...candidate,
          score: shortfall + anchorDistance * 1.25 + linePenalty + previousShift * 0.55 + slotPenalty,
        };
      }),
    }));
    let best = null;
    for (const first of prepared[0].candidates) {
      for (const second of prepared[1].candidates) {
        const labelGap = rectDistance(first.rect, second.rect);
        const score = first.score + second.score + Math.max(0, LABEL_CLEARANCE - labelGap) * 3600;
        if (!best || score < best.score) best = { score, first, second };
      }
    }
    const fallback = prepared.map((item) => item.candidates[0]);
    return [
      { measurement: prepared[0].measurement, base: prepared[0].base, chosen: { ...(best?.first ?? fallback[0]), retained: false } },
      { measurement: prepared[1].measurement, base: prepared[1].base, chosen: { ...(best?.second ?? fallback[1]), retained: false } },
    ];
  }

  solveSequential(items, probe) {
    const placed = [];
    return items.map(({ measurement, base, candidates }) => {
      const chosen = this.chooseCandidate(candidates, measurement, probe, placed, base);
      placed.push({ rect: chosen.rect, id: measurement.id });
      return { measurement, base, chosen };
    });
  }

  chooseCandidate(candidates, measurement, probe, placed, base) {
    let best = null;
    for (const candidate of candidates) {
      const validity = this.validRect(candidate.rect, probe, placed);
      const modelGap = validity.modelGap;
      const labelGap = validity.labelGap;
      const viewport = validity.viewportGap;
      const anchorDistance = pointDistance(candidate.center, base);
      const previousShift = measurement.previousRect
        ? pointDistance(candidate.center, rectCenter(measurement.previousRect))
        : 0;
      const linePenalty = segmentIntersectsRect(
        measurement.projected.a,
        measurement.projected.b,
        candidate.rect,
      ) ? 480 : 0;
      const slotPenalty = measurement.previousSlot >= 0 && candidate.index !== measurement.previousSlot ? 34 : 0;
      const distancePenalty = anchorDistance * 1.25;
      const shortfall =
        Math.max(0, MODEL_CLEARANCE - modelGap) * 2400 +
        Math.max(0, LABEL_CLEARANCE - labelGap) * 3600 +
        Math.max(0, VIEWPORT_CLEARANCE - viewport) * 3000;
      const score = shortfall + distancePenalty + linePenalty + slotPenalty + previousShift * 0.55;
      if (!best || score < best.score) best = { ...candidate, score };
    }
    return best;
  }

  validRect(rect, probe, placed) {
    const viewport = viewportGap(rect, this.width, this.height);
    const modelGap = probe ? Math.max(0, minimumFieldInRect(rect, probe) - 0.75) : 999;
    let labelGap = 999;
    for (const other of placed) labelGap = Math.min(labelGap, rectDistance(rect, other.rect));
    const valid =
      modelGap >= MODEL_CLEARANCE - 0.5 &&
      labelGap >= LABEL_CLEARANCE - 0.5 &&
      viewport >= VIEWPORT_CLEARANCE - 0.5;
    return { valid, modelGap, labelGap, viewportGap: viewport };
  }

  positionLabels() {
    for (const measurement of this.measurements) {
      const element = this.labels.get(measurement.id);
      const layout = measurement.layout;
      if (!element || !layout) continue;
      element.style.transform = `translate3d(${layout.rect.x}px, ${layout.rect.y}px, 0)`;
      element.dataset.slot = String(layout.slot);
      element.dataset.retained = String(layout.retained);
    }
  }

  draw(project, color) {
    const ctx = this.context;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const measurement of this.measurements) {
      const a = measurement.projected.a;
      const b = measurement.projected.b;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      const normal = { x: -dy / length, y: dx / length };

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.82)";
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      for (const segment of measurement.visibleSegments) {
        ctx.beginPath();
        ctx.moveTo(segment.start.x, segment.start.y);
        ctx.lineTo(segment.end.x, segment.end.y);
        ctx.stroke();
      }

      for (const segment of measurement.segments) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "rgba(223,91,50,0.62)";
        ctx.lineWidth = 1.45;
        ctx.beginPath();
        ctx.moveTo(segment.start.x, segment.start.y);
        ctx.lineTo(segment.end.x, segment.end.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      this.drawEndpointTick(a, normal, color);
      this.drawEndpointTick(b, normal, color);

      if (measurement.layout) {
        const anchor = measurement.layout.anchor;
        const nearestX = clamp(anchor.x, measurement.layout.rect.x, measurement.layout.rect.x + LABEL_WIDTH);
        const nearestY = clamp(anchor.y, measurement.layout.rect.y, measurement.layout.rect.y + LABEL_HEIGHT);
        const gap = Math.hypot(anchor.x - nearestX, anchor.y - nearestY);
        if (gap > 20) {
          ctx.strokeStyle = "rgba(223,91,50,0.48)";
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(nearestX, nearestY);
          ctx.lineTo(anchor.x, anchor.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  drawEndpointTick(point, normal, color) {
    const ctx = this.context;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(point.x - normal.x * 5, point.y - normal.y * 5);
    ctx.lineTo(point.x + normal.x * 5, point.y + normal.y * 5);
    ctx.stroke();
    ctx.fillStyle = "rgba(223,91,50,0.92)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1.15, 0, Math.PI * 2);
    ctx.fill();
  }

  createReport(probe) {
    const labels = [];
    for (const measurement of this.measurements) {
      const rect = measurement.layout?.rect;
      if (!rect) continue;
      labels.push({
        id: measurement.id,
        rect: { ...rect },
        slot: measurement.layout.slot,
        retained: measurement.layout.retained,
        modelGap: probe ? Math.max(0, minimumFieldInRect(rect, probe) - 0.75) : 0,
      });
    }
    let minLabelGap = Infinity;
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        minLabelGap = Math.min(minLabelGap, rectDistance(labels[i].rect, labels[j].rect));
      }
    }
    const minViewportGap = labels.reduce(
      (minimum, label) => Math.min(minimum, viewportGap(label.rect, this.width, this.height)),
      Infinity,
    );
    const measureReports = {};
    for (const measurement of this.measurements) {
      measureReports[measurement.id] = {
        worldDistance: measurement.distance,
        projectedLengthPx: measurement.projectedLength,
        hiddenPx: measurement.hiddenPx,
        hiddenRatio: measurement.hiddenRatio,
        hiddenSamples: measurement.hiddenSamples,
        segments: measurement.segments.map((segment) => ({
          startT: segment.startT,
          endT: segment.endT,
          startPx: segment.startPx,
          endPx: segment.endPx,
          lengthPx: segment.lengthPx,
          start: { x: segment.start.x, y: segment.start.y },
          end: { x: segment.end.x, y: segment.end.y },
        })),
      };
    }
    return {
      labels,
      minModelGap: labels.reduce((minimum, label) => Math.min(minimum, label.modelGap), Infinity),
      minLabelGap,
      minViewportGap,
      slotSwitches: this.slotSwitches,
      measurements: measureReports,
    };
  }
}
