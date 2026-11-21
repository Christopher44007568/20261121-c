import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "test-results");
await mkdir(outputDir, { recursive: true });
const app = await startServer(root);
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
try {
  await page.goto(app.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.SCREEN_LAB_READY || window.SCREEN_LAB_ERROR, null, {
    timeout: 30_000,
  });
  const result = await page.evaluate(() => {
    const renderer = window.ScreenLab?.renderer;
    const base = {
      width: 640,
      height: 400,
      threshold: 0.5,
      alphaMode: 0,
      samples: 4,
      jitter: [0, 0],
    };
    const openFraction = (coverage, mask) => {
      let total = 0;
      let metal = 0;
      for (let i = 0; i < mask.length / 4; i += 1) {
        if (mask[i * 4] > 127) {
          total += 1;
          metal += coverage[i * 4] / 255;
        }
      }
      return 1 - metal / total;
    };
    const measure = (distance, tiltDegrees) => {
      const settings = { ...base, distance, tiltDegrees };
      const mask = renderer.captureCoverage({ ...settings, kind: "mask" });
      const geometry = renderer.captureCoverage({ ...settings, kind: "geometry" });
      const hard = renderer.captureCoverage({
        ...settings, kind: "alpha", alphaMode: 0, samples: 0,
      });
      const a2c = renderer.captureCoverage({
        ...settings, kind: "alpha", alphaMode: 2, samples: 4,
      });
      return {
        geometry: openFraction(geometry, mask),
        hard: openFraction(hard, mask),
        a2c: openFraction(a2c, mask),
      };
    };
    const mipOpens = renderer.mask.levels.map((level) => 1 - level.metalFraction);
    return {
      ready: Boolean(window.SCREEN_LAB_READY),
      error: window.SCREEN_LAB_ERROR ?? null,
      canvas: [document.querySelector("#view").width, document.querySelector("#view").height],
      renderer: renderer?.info?.unmaskedRenderer ?? null,
      mips: renderer?.mask?.levels?.length ?? 0,
      mipSpreadPct: (Math.max(...mipOpens) - Math.min(...mipOpens)) * 100,
      near: measure(2.2, 0),
      far: measure(32, 0),
      imageBytes: document.querySelector("#view").toDataURL("image/png").length,
    };
  });
  if (!result.ready) throw new Error(result.error || "WebGL2 initialization failed");
  assert.ok(result.mips >= 9, "mip chain should reach at least 3x2");
  assert.ok(result.mipSpreadPct < 0.5, "mip open coverage should stay stable");
  assert.ok(result.far.geometry > 0.32, "far geometry reference should retain apertures");
  assert.ok(result.far.a2c > 0.32, "A2C should preserve far-field aperture coverage");
  assert.ok(result.far.hard < 0.25, "binary alpha test should visibly lose far-field apertures");
  assert.ok(
    Math.abs(result.near.a2c - result.near.geometry) < 0.02,
    "A2C should closely match true geometry in the near field",
  );
  assert.ok(result.imageBytes > 20_000, "viewport should contain a rendered image");
  await page.screenshot({ path: path.join(outputDir, "smoke.png"), fullPage: true });
  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await app.close();
}
