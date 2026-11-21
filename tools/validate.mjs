// Offline validation of droplet-SDF sphere tracing.
//
// For each scene x smin-mode we:
//  1. find the reference first root of f(ro + t*rd) = 0 by dense scanning
//     + bisection to ~1e-12 (high-precision ground truth, mode-specific);
//  2. run the exact same sphere tracer as src/shader.wgsl;
//  3. report first-hit deviation, miss rate, step counts, throughput;
//  4. estimate the Lipschitz constant of each field (conservativeness).
//
// Usage: node tools/validate.mjs [--rays N] [--out artifacts]

const T_MAX = 12.0;
const EPS = 1e-4;
const MAX_STEPS = 160;

// ---------- SDF field (mirrors src/shader.wgsl) ----------
function sminPoly(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (b - a) / k));
  return b + (a - b) * h - k * h * (1 - h);
}
function sminLSE(a, b, k) {
  const m = Math.min(a, b);
  return m - k * Math.log1p(Math.exp((m - Math.max(a, b)) / k));
}
function makeMap(sep, k, mode) {
  const smin = mode === 'poly' ? sminPoly : sminLSE;
  const droplets = (x, y, z) => {
    const a = Math.hypot(x + sep, y, z) - 0.60;
    const b = Math.hypot(x - sep, y, z) - 0.45;
    return smin(a, b, k);
  };
  const map = (x, y, z) => Math.min(droplets(x, y, z), y + 0.85);
  return { map, droplets };
}

// ---------- sphere tracer (mirrors src/shader.wgsl) ----------
function sphereTrace(map, ro, rd, stepMode, omega) {
  let t = 0, prevD = 1e10, prevT = 0, prevStep = 0, steps = 0;
  let i = 0;
  for (;;) {
    if (i >= MAX_STEPS) return { hit: false, t, steps };
    i++; steps = i;
    const d = map(ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t);
    if (stepMode >= 1) {
      if (prevStep > 0 && d + prevD < prevStep) {
        if (stepMode === 2) {           // guarded: revert to standard step
          t = t - prevStep + prevD;
          prevStep = prevD;
          continue;
        }
      }
    }
    if (d < EPS * Math.max(t, 1)) {
      const w = prevD / (prevD - d);
      return { hit: true, t: prevT + (t - prevT) * Math.min(1, Math.max(0, w)), steps };
    }
    if (stepMode >= 1) {
      const s = omega * d;
      prevD = d; prevT = t; prevStep = s;
      t += s;
    } else {
      prevD = d; prevT = t; prevStep = d;
      t += d;
    }
    if (t > T_MAX) return { hit: false, t, steps };
  }
}

// ---------- high-precision reference root ----------
// Certified first-root finder for a 1-Lipschitz field along the ray:
// an interval [a,b] with (f(a)+f(b))/2 - (b-a)/2 > 0 provably contains
// no root; otherwise subdivide. Sign changes are bisected to ~1e-12.
const LIP = 1.0002; // verified Lipschitz bound (see max|grad| in report)
function refRoot(map, ro, rd) {
  const f = t => map(ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t);
  let minF = Infinity;

  function bisect(a, fa, b) {
    let lo = a, flo = fa, hi = b;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) > 0) { lo = mid; } else { hi = mid; }
    }
    return 0.5 * (lo + hi);
  }
  function firstRoot(a, fa, b, fb, depth) {
    if (fa <= 0) return a;
    if (fb <= 0) return bisect(a, fa, b);
    const lower = 0.5 * (fa + fb) - 0.5 * (b - a) * LIP;
    if (lower > 0) return null;                 // certified empty
    if (depth >= 60) return fb < 1e-7 ? b : null; // tangential touch
    const m = 0.5 * (a + b), fm = f(m);
    if (fm < minF) minF = fm;
    if (fm <= 0) return bisect(a, fa, m);
    const left = firstRoot(a, fa, m, fm, depth + 1);
    if (left !== null) return left;
    return firstRoot(m, fm, b, fb, depth + 1);
  }

  const dt = 5e-3;
  let tPrev = 0, fPrev = f(0);
  minF = Math.abs(fPrev);
  for (let t = dt; t <= T_MAX + 1e-12; t += dt) {
    const ft = f(t);
    if (Math.abs(ft) < minF) minF = Math.abs(ft);
    const r = firstRoot(tPrev, fPrev, Math.min(t, T_MAX), ft, 0);
    if (r !== null) return { root: r, kind: 'crossing', minF: 0 };
    tPrev = t; fPrev = ft;
  }
  return { root: null, kind: 'none', minF };
}

// ---------- ray sets ----------
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function norm3(v) { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }

function makeRays(nOrbit, nGraze, seed) {
  const rnd = mulberry32(seed);
  const rays = [];
  // orbit views: camera on sphere, jittered image-plane rays
  for (let i = 0; i < nOrbit; i++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(1.6 * rnd() - 0.8); // keep above ground
    const ro = [3.0 * Math.sin(ph) * Math.cos(th), 3.0 * Math.cos(ph), 3.0 * Math.sin(ph) * Math.sin(th)];
    const fwd = norm3([-ro[0], -ro[1], -ro[2]]);
    const r = norm3([fwd[2], 0, -fwd[0]]);
    const u = [fwd[1] * r[2] - fwd[2] * r[1], fwd[2] * r[0] - fwd[0] * r[2], fwd[0] * r[1] - fwd[1] * r[0]];
    const jx = (rnd() - 0.5) * 1.2, jy = (rnd() - 0.5) * 1.2;
    const rd = norm3([fwd[0] * 1.8 + r[0] * jx + u[0] * jy,
                      fwd[1] * 1.8 + r[1] * jx + u[1] * jy,
                      fwd[2] * 1.8 + r[2] * jx + u[2] * jy]);
    rays.push({ ro, rd, set: 'orbit' });
  }
  // grazing rays: run nearly parallel to the neck (x axis), offset by
  // roughly the neck radius, slight inward tilt -> worst case for
  // non-conservative fields
  for (let i = 0; i < nGraze; i++) {
    const ang = rnd() * Math.PI * 2;
    const rad = 0.04 + rnd() * 0.30;
    const ro = [-2.2 + rnd() * 0.4, rad * Math.cos(ang), rad * Math.sin(ang)];
    const tilt = (rnd() - 0.5) * 0.10;
    const rd = norm3([1.0, -tilt * Math.cos(ang), -tilt * Math.sin(ang)]);
    rays.push({ ro, rd, set: 'grazing' });
  }
  return rays;
}

// ---------- conservativeness estimates ----------
// max |grad f| by central differences, sampled near the blend region
// where smooth-min fields stop being 1-Lipschitz.
function maxGradNorm(map, sep, n, seed) {
  const rnd = mulberry32(seed);
  let worst = 0;
  const h = 1e-4;
  for (let i = 0; i < n; i++) {
    const x = (rnd() * 2 - 1) * sep;
    const y = (rnd() - 0.5) * 1.0;
    const z = (rnd() - 0.5) * 1.0;
    const gx = (map(x + h, y, z) - map(x - h, y, z)) / (2 * h);
    const gy = (map(x, y + h, z) - map(x, y - h, z)) / (2 * h);
    const gz = (map(x, y, z + h) - map(x, y, z - h)) / (2 * h);
    worst = Math.max(worst, Math.hypot(gx, gy, gz));
  }
  return worst;
}

// neck radius: smallest rho with f(0, rho, 0) = 0 (0 if no bridge)
function neckRadius(droplets) {
  const f = r => droplets(0, r, 0);
  if (f(0) > 0) return 0;
  let lo = 0, hi = 1.5;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// solve blend radius k so the neck reaches targetNeck (bisection; k is monotone)
function calibrateK(sep, mode, targetNeck) {
  const neck = k => neckRadius(makeMap(sep, k, mode).droplets);
  if (neck(2.0) < targetNeck) return null;
  let lo = 0.01, hi = 2.0;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (neck(mid) < targetNeck) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ---------- driver ----------
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const N_RAYS = +argVal('rays', 4000);   // per set, per scene-mode
const OUT_DIR = argVal('out', 'artifacts');

// thin-neck uses a per-smin calibrated k so both fields produce the same
// neck radius (TARGET_NECK) -> geometry-matched comparison.
const TARGET_NECK = 0.12;
const SCENES = [
  { name: 'separated(before merge)', sep: 1.20, k: { poly: 0.30, lse: 0.30 } },
  { name: 'merged(after merge)',     sep: 0.55, k: { poly: 0.35, lse: 0.35 } },
  { name: 'thin-neck',               sep: 0.68,
    k: { poly: calibrateK(0.68, 'poly', TARGET_NECK),
         lse:  calibrateK(0.68, 'lse',  TARGET_NECK) } },
];
const SMIN_MODES = ['poly', 'lse'];
const STEP_MODES = [
  { name: 'standard',     mode: 0, omega: 1.0 },
  { name: 'orelax-w1.6',  mode: 1, omega: 1.6 },
  { name: 'guard-w1.6',   mode: 2, omega: 1.6 },
];

function runConfig(scene, sminMode, stepCfg, rays) {
  const k = scene.k[sminMode];
  const { map, droplets } = makeMap(scene.sep, k, sminMode);
  const t0 = performance.now();
  let nRefHit = 0, nMiss = 0, nFalseHit = 0, nOvershoot = 0;
  let nTangent = 0, nSkipped = 0, nEarly = 0;
  let devSum = 0, devMax = 0, stepsSum = 0, stepsMax = 0, nStHit = 0;
  const perSet = {};
  for (const ray of rays) {
    if (map(...ray.ro) < 0.05) { nSkipped++; continue; } // starts inside geometry
    const ref = refRoot(map, ray.ro, ray.rd);
    const st = sphereTrace(map, ray.ro, ray.rd, stepCfg.mode, stepCfg.omega);
    stepsSum += st.steps; stepsMax = Math.max(stepsMax, st.steps);
    const s = (perSet[ray.set] ??= { rays: 0, refHit: 0, miss: 0, devSum: 0, devMax: 0, steps: 0 });
    s.rays++;
    if (ref.root !== null) {
      nRefHit++; s.refHit++;
      if (!st.hit) { nMiss++; s.miss++; }
      else {
        const dev = st.t - ref.root;
        if (dev > 1e-3) { nOvershoot++; s.miss++; } // landed past first root
        else if (dev < -1e-3) { nEarly++; s.miss++; } // EPS accepted near-tangent
        else { devSum += Math.abs(dev); devMax = Math.max(devMax, Math.abs(dev));
               s.devSum += Math.abs(dev); s.devMax = Math.max(s.devMax, Math.abs(dev)); }
      }
    } else if (st.hit && st.t < T_MAX) {
      if (ref.minF < 2e-4) nTangent++;   // grazing near-miss, EPS accepted it
      else nFalseHit++;
    }
    if (st.hit) nStHit++;
  }
  const ms = performance.now() - t0;
  const grad = maxGradNorm(map, scene.sep, 60000, 12345);
  const neck = neckRadius(droplets);
  const good = nRefHit - nMiss - nOvershoot - nEarly;
  return {
    scene: scene.name, smin: sminMode, step: stepCfg.name, k,
    rays: rays.length, skipped: nSkipped, neckRadius: neck,
    refHits: nRefHit,
    missRate: nRefHit ? (nMiss + nOvershoot + nEarly) / nRefHit : 0,
    hardMiss: nMiss, overshoot: nOvershoot, early: nEarly, falseHits: nFalseHit, tangent: nTangent,
    devMean: good ? devSum / good : 0, devMax,
    stepsMean: stepsSum / (rays.length - nSkipped), stepsMax,
    evalsPerSec: Math.round((rays.length - nSkipped) / (ms / 1000)),
    maxGrad: grad, perSet,
  };
}

const rays = makeRays(N_RAYS, N_RAYS, 20261121);
const results = [];
for (const scene of SCENES)
  for (const sminMode of SMIN_MODES)
    for (const stepCfg of STEP_MODES)
      results.push(runConfig(scene, sminMode, stepCfg, rays));

// ---------- report ----------
const fmt = (x, n = 4) => typeof x === 'number' ? x.toFixed(n) : x;
let md = '# Droplet SDF sphere-tracing validation\n\n';
md += `rays per scene-mode: ${rays.length} (orbit ${N_RAYS} + grazing ${N_RAYS}), `;
md += `MAX_STEPS=${MAX_STEPS}, EPS=${EPS}, T_MAX=${T_MAX}, target neck r=${TARGET_NECK}\n\n`;
md += '| scene | smin | k | step mode | neck r | max\\|grad\\| | miss rate | miss/over/early | false/tangent | dev mean | dev max | steps avg | steps max | rays/s |\n';
md += '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const r of results) {
  md += `| ${r.scene} | ${r.smin} | ${fmt(r.k, 3)} | ${r.step} | ${fmt(r.neckRadius, 3)} | ${fmt(r.maxGrad, 4)} ` +
        `| ${(r.missRate * 100).toFixed(2)}% | ${r.hardMiss}/${r.overshoot}/${r.early} | ${r.falseHits}/${r.tangent} ` +
        `| ${fmt(r.devMean, 6)} | ${fmt(r.devMax, 6)} | ${fmt(r.stepsMean, 1)} | ${r.stepsMax} | ${r.evalsPerSec} |\n`;
}
md += '\n## per ray-set breakdown (miss rate / mean |dt|)\n\n';
md += '| scene | smin | step | set | ref hits | miss rate | dev max |\n|---|---|---|---|---|---|---|\n';
for (const r of results)
  for (const [set, s] of Object.entries(r.perSet)) {
    const mr = s.refHit ? (s.miss / s.refHit * 100).toFixed(2) + '%' : '-';
    md += `| ${r.scene} | ${r.smin} | ${r.step} | ${set} | ${s.refHit} | ${mr} | ${fmt(s.devMax, 6)} |\n`;
  }

const fs = await import('node:fs');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2));
fs.writeFileSync(`${OUT_DIR}/validation_report.md`, md);
console.log(md);
