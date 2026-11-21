export const DOMAIN = Object.freeze({ halfHeight: 0.5, halfWidth: 0.78 });

export const VORTEX_CORE2 = 0.0092;

export const OBSTACLE = Object.freeze({ x: 0.34, y: -0.035, r: 0.105 });

export const GAPS = Object.freeze([
  Object.freeze({ type: "circle", x: -0.43, y: -0.265, r: 0.082 }),
  Object.freeze({ type: "rect", x: 0.105, y: 0.305, hx: 0.125, hy: 0.054 }),
]);

export const MASK = Object.freeze({
  VALID: 0,
  OBSTACLE: 1,
  MISSING: 2,
  OUTSIDE: 3,
});

export const DEFAULT_PROBE = Object.freeze({ x: -0.55, y: 0.18 });

export function vortexCenter(t) {
  return {
    x: -0.1 + 0.118 * Math.sin(0.34 * t),
    y: 0.1 * Math.cos(0.43 * t) + 0.022 * Math.sin(0.73 * t),
  };
}

export function uniformFlow(t) {
  return {
    x: 0.64,
    y: 0.105 * Math.sin(0.38 * t),
  };
}

export function vortexStrength(t) {
  return 0.34 + 0.045 * Math.sin(0.61 * t + 0.35);
}

export function sinkStrength(t) {
  return 0.032 + 0.007 * Math.sin(0.47 * t + 1.2);
}

function circleMask(x, y, circle) {
  const dx = x - circle.x;
  const dy = y - circle.y;
  return dx * dx + dy * dy < circle.r * circle.r;
}

function rectMask(x, y, rect) {
  return Math.abs(x - rect.x) < rect.hx && Math.abs(y - rect.y) < rect.hy;
}

export function maskCode(
  x,
  y,
  halfWidth = DOMAIN.halfWidth,
  { obstacle = true, missing = true } = {},
) {
  if (Math.abs(x) >= halfWidth || Math.abs(y) >= DOMAIN.halfHeight) {
    return MASK.OUTSIDE;
  }
  if (missing && (circleMask(x, y, GAPS[0]) || rectMask(x, y, GAPS[1]))) {
    return MASK.MISSING;
  }
  if (obstacle && circleMask(x, y, OBSTACLE)) {
    return MASK.OBSTACLE;
  }
  return MASK.VALID;
}

export function analyticVelocity(x, y, t) {
  const flow = uniformFlow(t);
  const center = vortexCenter(t);
  const gamma = vortexStrength(t);
  const sink = sinkStrength(t);
  const dx = x - center.x;
  const dy = y - center.y;
  const denominator = dx * dx + dy * dy + VORTEX_CORE2;

  const swirlX = (gamma * -dy) / denominator;
  const swirlY = (gamma * dx) / denominator;
  const sinkX = (-sink * dx) / denominator;
  const sinkY = (-sink * dy) / denominator;

  return {
    u: flow.x + swirlX + sinkX,
    v: flow.y + swirlY + sinkY,
  };
}

export function sampleField(
  x,
  y,
  t,
  halfWidth = DOMAIN.halfWidth,
  maskOptions = {},
) {
  const velocity = analyticVelocity(x, y, t);
  return {
    ...velocity,
    speed: Math.hypot(velocity.u, velocity.v),
    mask: maskCode(x, y, halfWidth, maskOptions),
  };
}

export function fieldDerivatives(x, y, t, h = 0.0025) {
  const left = analyticVelocity(x - h, y, t);
  const right = analyticVelocity(x + h, y, t);
  const bottom = analyticVelocity(x, y - h, t);
  const top = analyticVelocity(x, y + h, t);
  return {
    curl: (right.v - left.v - (top.u - bottom.u)) / (2 * h),
    divergence: (right.u - left.u + (top.v - bottom.v)) / (2 * h),
  };
}

export function circulation(t, radius = 0.075, segments = 192) {
  const center = vortexCenter(t);
  let total = 0;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const nextAngle = ((i + 1) / segments) * Math.PI * 2;
    const mid = (angle + nextAngle) * 0.5;
    const px = center.x + Math.cos(mid) * radius;
    const py = center.y + Math.sin(mid) * radius;
    const velocity = analyticVelocity(px, py, t);
    const ds = radius * (nextAngle - angle);
    total += (-Math.sin(mid) * velocity.u + Math.cos(mid) * velocity.v) * ds;
  }
  return total;
}

export function inwardFlux(t, radius = 0.075, segments = 192) {
  const center = vortexCenter(t);
  let total = 0;
  for (let i = 0; i < segments; i += 1) {
    const angle = ((i + 0.5) / segments) * Math.PI * 2;
    const px = center.x + Math.cos(angle) * radius;
    const py = center.y + Math.sin(angle) * radius;
    const velocity = analyticVelocity(px, py, t);
    const outward = Math.cos(angle) * velocity.u + Math.sin(angle) * velocity.v;
    const ds = radius * (Math.PI * 2) / segments;
    total += outward * ds;
  }
  return total;
}

export function velocityAngle(velocity) {
  return Math.atan2(velocity.v, velocity.u);
}

export function integrateStreamline(
  start,
  t0,
  duration,
  dt,
  halfWidth = DOMAIN.halfWidth,
  maskOptions = {},
) {
  let x = start.x;
  let y = start.y;
  const steps = Math.max(1, Math.ceil(duration / dt));
  const step = duration / steps;
  let exited = false;
  let masked = false;
  let completedSteps = 0;

  for (let i = 0; i < steps; i += 1) {
    const time = t0 + i * step;
    const first = analyticVelocity(x, y, time);
    const mid = analyticVelocity(x + first.u * step * 0.5, y + first.v * step * 0.5, time + step * 0.5);
    x += mid.u * step;
    y += mid.v * step;
    completedSteps = i + 1;

    if (Math.abs(x) > halfWidth) {
      exited = true;
      break;
    }
    if (Math.abs(y) >= DOMAIN.halfHeight) {
      break;
    }
    if (maskCode(x, y, halfWidth, maskOptions) !== MASK.VALID) {
      masked = true;
      break;
    }
  }

  return { x, y, exited, masked, steps: completedSteps };
}

export function traceBackward(
  start,
  t,
  dt,
  halfWidth = DOMAIN.halfWidth,
  maskOptions = {},
  maxSubsteps = 10,
) {
  const speed = Math.hypot(
    analyticVelocity(start.x, start.y, t).u,
    analyticVelocity(start.x, start.y, t).v,
  );
  const substeps = Math.max(1, Math.min(maxSubsteps, Math.ceil((speed * dt) / 0.012)));
  const step = dt / substeps;
  let x = start.x;
  let y = start.y;

  for (let i = 0; i < substeps; i += 1) {
    const time = t - step * (i + 0.5);
    const first = analyticVelocity(x, y, time);
    const mid = analyticVelocity(
      x - first.u * step * 0.5,
      y - first.v * step * 0.5,
      time,
    );
    x -= mid.u * step;
    y -= mid.v * step;
  }

  return { x, y, inside: Math.abs(x) <= halfWidth && Math.abs(y) <= DOMAIN.halfHeight };
}

export function frameRateTracerDrift(duration = 2, coarseHz = 30, fineHz = 120) {
  const starts = [
    { x: -0.64, y: 0.34 },
    { x: -0.58, y: -0.18 },
    { x: -0.2, y: 0.37 },
    { x: 0.04, y: -0.36 },
    { x: 0.3, y: 0.25 },
    { x: 0.56, y: -0.24 },
  ];
  let sumSquared = 0;
  let max = 0;
  for (const start of starts) {
    const coarse = integrateStreamline(start, 0, duration, 1 / coarseHz);
    const fine = integrateStreamline(start, 0, duration, 1 / fineHz);
    const drift = Math.hypot(coarse.x - fine.x, coarse.y - fine.y);
    sumSquared += drift * drift;
    max = Math.max(max, drift);
  }
  return {
    duration,
    coarseHz,
    fineHz,
    rms: Math.sqrt(sumSquared / starts.length),
    max,
    probes: starts.length,
  };
}

export function runAnalyticChecks(time = 0) {
  const probe = sampleField(DEFAULT_PROBE.x, DEFAULT_PROBE.y, time);
  const boundaryPath = integrateStreamline(
    { x: -0.65, y: -0.3 },
    time,
    4,
    1 / 480,
  );
  const circulationValue = circulation(time);
  const fluxValue = inwardFlux(time);
  const derivatives = fieldDerivatives(vortexCenter(time).x, vortexCenter(time).y, time);
  const drift = frameRateTracerDrift(2, 30, 120);

  return {
    direction: {
      pass: probe.u > 0 && boundaryPath.exited && boundaryPath.x > 0,
      probe: { ...probe },
      path: boundaryPath,
      label: probe.u > 0 ? "EASTWARD" : "REVERSED",
    },
    rotation: {
      pass: circulationValue > 0 && derivatives.curl > 0,
      circulation: circulationValue,
      curl: derivatives.curl,
      label: circulationValue > 0 ? "CCW +" : "CW −",
    },
    convergence: {
      pass: fluxValue < 0 && derivatives.divergence < 0,
      flux: fluxValue,
      divergence: derivatives.divergence,
      label: fluxValue < 0 ? "CONVERGENT" : "DIVERGENT",
    },
    frameRate: {
      ...drift,
      label: `${drift.rms.toFixed(4)} u RMS`,
    },
    time,
  };
}
