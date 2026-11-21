// End-to-end WebGPU bloom test:
//   1. A 1px HDR filament sweeps across pixel centers at 0.25 px/frame.
//   2. The same scene runs through a naive point-sampled path and through
//      the soft-knee + area-aware improved path.
//   3. Per-frame peaks and energies are recorded at the coarsest mip and
//      at the HDR composite.
//   4. A separate gray-card frame proves the 0.18 target survives the
//      rgba16float HDR pipeline, before any exposure is applied.

const fs = require('fs');
const path = require('path');
const { createDevice } = require('../src/gpu-device');
const { BloomPipeline } = require('../src/bloom-pipeline');
const { peak, energy, seriesStats, regionAccuracy } = require('../src/metrics');
const { writeCsv, writeStats, writeSvg, renderPngCharts } = require('./reporters');

const OUT_DIR = path.join(__dirname, '..', 'artifacts');

const config = {
  width: 256,
  height: 256,
  mipLevels: 4,
  threshold: 1,
  knee: 0.5,
  exposure: 1,
  bloomStrength: 1,
  grayTarget: 0.18,
  sweep: { startX: 60, stepX: 0.25, frames: 64 },
  line: { energy: 24, width: 1, tint: [0.55, 0.9, 1.35] },
};

async function measureFrame(pipeline, lineX, variant) {
  const out = pipeline.renderFrame(lineX, variant);
  const coarsest = await pipeline.readCoarsestMip(out.bloomCoarsest);
  const composite = await pipeline.readTexture(out.composite);
  return {
    mip3Peak: peak(coarsest),
    mip3Energy: energy(coarsest),
    bloomPeak: peak(composite.data),
  };
}

async function measureGrayCard(pipeline) {
  // Line placed completely outside the frame: the scene is pure gray card.
  const out = pipeline.renderFrame(-100, 'improved');
  const scene = await pipeline.readTexture(out.scene);
  const accuracy = regionAccuracy(
    scene.data, scene.width, scene.height, null, config.grayTarget,
  );

  // Structural ordering check: exposure must be applied after composite.
  // On a uniform sub-threshold card the bloom contribution is zero, so the
  // HDR composite equals the scene exactly, before tonemap clamps it.
  const composite = await pipeline.readTexture(out.composite);
  let compositeDrift = 0;
  for (let i = 0; i < scene.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      compositeDrift = Math.max(
        compositeDrift,
        Math.abs(scene.data[i + c] - composite.data[i + c]),
      );
    }
  }
  return { ...accuracy, format: 'rgba16float', compositeDrift };
}

function summarize(rows, key) {
  const accessor = typeof key === 'function' ? key : (row) => row[key];
  return seriesStats(rows.map(accessor));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { device } = await createDevice();
  const pipeline = new BloomPipeline(device, config);

  const rows = [];
  for (let frame = 0; frame < config.sweep.frames; frame += 1) {
    const lineX = config.sweep.startX + frame * config.sweep.stepX;
    const naive = await measureFrame(pipeline, lineX, 'naive');
    const improved = await measureFrame(pipeline, lineX, 'improved');
    rows.push({ frame, lineX, naive, improved });
    process.stdout.write(`frame ${frame + 1}/${config.sweep.frames}\n`);
  }

  const stats = {
    naive: {
      mip3Peak: summarize(rows, (r) => r.naive.mip3Peak),
      bloomPeak: summarize(rows, (r) => r.naive.bloomPeak),
      mip3Energy: summarize(rows, (r) => r.naive.mip3Energy),
    },
    improved: {
      mip3Peak: summarize(rows, (r) => r.improved.mip3Peak),
      bloomPeak: summarize(rows, (r) => r.improved.bloomPeak),
      mip3Energy: summarize(rows, (r) => r.improved.mip3Energy),
    },
  };

  const grayCard = await measureGrayCard(pipeline);

  const peakGain = stats.naive.mip3Peak.relativeRange
    / Math.max(stats.improved.mip3Peak.relativeRange, 1e-9);
  const assertions = {
    naivePeakUnstable: stats.naive.mip3Peak.relativeRange > 1.5,
    // Subpixel coverage makes single-texel peak vary smoothly even when
    // total energy is conserved; require it to be far calmer than naive and
    // bounded to a 2x modulation rather than the on/off naive pulse.
    improvedPeakStable: stats.improved.mip3Peak.relativeRange < 1.0
      && peakGain > 5,
    naiveEnergyUnstable: stats.naive.mip3Energy.relativeRange > 1.5,
    improvedEnergyStable: stats.improved.mip3Energy.relativeRange < 0.1,
    grayCardPreserved: grayCard.maxDeviation < 0.001,
    compositeBeforeExposure: grayCard.compositeDrift < 1e-6,
  };
  const comparison = {
    mip3PeakSwingRatio:
      stats.naive.mip3Peak.relativeRange
      / Math.max(stats.improved.mip3Peak.relativeRange, 1e-9),
    energySwingRatio:
      stats.naive.mip3Energy.relativeRange
      / Math.max(stats.improved.mip3Energy.relativeRange, 1e-9),
  };

  const report = {
    config,
    stages: [
      'scene-hdr',
      'threshold',
      'downsample',
      'upsample-add',
      'composite-hdr',
      'exposure-tonemap',
    ],
    definitions: {
      threshold: 'frostbite quadratic soft-knee, luminance-weighted',
      downsampleNaive: 'nearest/load sample on the 2x lattice',
      downsampleImproved: 'energy-conserving 2x2 area box with edge clamp',
      upsampleNaive: 'nearest/load sample + add',
      upsampleImproved: '9-tap tent + add',
      composite: 'sceneHdr + bloomHdr * strength, stored as rgba16float',
      exposure: 'applied only after the HDR composite',
    },
    stats,
    grayCard: {
      target: config.grayTarget,
      mean: grayCard.mean,
      maxDeviation: grayCard.maxDeviation,
      samples: grayCard.samples,
      format: grayCard.format,
    },
    comparison,
    assertions,
    passed: Object.values(assertions).every(Boolean),
  };

  writeCsv(path.join(OUT_DIR, 'bloom_peaks.csv'), rows);
  writeStats(path.join(OUT_DIR, 'bloom_stats.json'), report);
  writeSvg(path.join(OUT_DIR, 'bloom_peaks.svg'), report, rows);
  await renderPngCharts(path.join(OUT_DIR, 'bloom_peaks.png'), report, rows);

  console.log('\n=== HDR bloom stability ===');
  console.log(`naive    mip3 peak range : ${stats.naive.mip3Peak.min.toFixed(3)} .. ${stats.naive.mip3Peak.max.toFixed(3)} (swing ${(stats.naive.mip3Peak.relativeRange * 100).toFixed(1)}%)`);
  console.log(`improved mip3 peak range : ${stats.improved.mip3Peak.min.toFixed(3)} .. ${stats.improved.mip3Peak.max.toFixed(3)} (swing ${(stats.improved.mip3Peak.relativeRange * 100).toFixed(1)}%)`);
  console.log(`gray card ${grayCard.mean.toFixed(6)} vs target ${config.grayTarget} (max d ${grayCard.maxDeviation.toExponential(2)})`);
  console.log(`stability gain: ${comparison.mip3PeakSwingRatio.toFixed(1)}x peak, ${comparison.energySwingRatio.toFixed(1)}x energy`);
  console.log('assertions:', assertions);
  if (!report.passed) {
    console.error('TEST FAILED');
    process.exit(1);
  }
  console.log('TEST PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
