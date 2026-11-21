import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome";
const TARGET = process.argv[2] || "http://localhost:8123/index.html";
const OUT = new URL("../artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--window-size=1680,945",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 945, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console.error: " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

const telemetry = await page.evaluate(() => {
  const txt = (id) => document.getElementById(id).textContent.trim();
  return {
    frame: txt("frameNo"),
    coverage: txt("coverageVal"),
    meshCov: txt("meshCoverage"),
    proxyCov: txt("proxyCoverage"),
    tris: txt("triCount"),
    fades: txt("fadeCount"),
    meshInst: txt("meshInstances"),
    proxyInst: txt("proxyInstances"),
    badge: txt("verifyBadge"),
    weightErr: txt("vWeightErr"),
    triDrift: txt("vTriDrift"),
    repMismatch: txt("vRepMismatch"),
    flips: txt("vFlips"),
    stations: txt("vStations"),
    note: txt("verifyNote"),
    trees: window.__forest.state.trees.length,
    meshTris: window.__forest.meshTris,
  };
});

await page.screenshot({ path: OUT + "run-auto.png" });

await page.click('[data-mode="mesh"]');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: OUT + "run-mesh.png" });

await page.click('[data-mode="proxy"]');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: OUT + "run-proxy.png" });

await page.click('[data-mode="auto"]');

console.log(JSON.stringify({ errors, telemetry }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
