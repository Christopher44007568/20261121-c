import puppeteer from "puppeteer-core";

const CHROME = "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader",
         "--use-gl=angle", "--use-angle=swiftshader", "--window-size=1680,945"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 945 });
await page.goto("http://localhost:8123/index.html?cb=" + Date.now(), { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 1200));

// Sample the same camera stations walking forward, then backward, and compare.
const sample = await page.evaluate(async () => {
  const f = window.__forest;
  const stations = 40;
  const z0 = -100, z1 = 100;
  const snap = (z) => {
    f.state.z = z;
    f.state.running = false;
    // Force one synchronous frame evaluation through the public state.
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const r = f.state.lastResult;
        resolve(r.ev.records.map((x) => [x.treeId, +x.weight.toFixed(6), x.kind]));
      }));
    });
  };
  const zs = Array.from({ length: stations }, (_, i) => z0 + ((z1 - z0) * i) / (stations - 1));
  const forward = [];
  for (const z of zs) forward.push(await snap(z));
  const reverse = [];
  for (const z of [...zs].reverse()) reverse.push(await snap(z));
  reverse.reverse();

  let maxErr = 0;
  let mismatches = 0;
  let compared = 0;
  for (let s = 0; s < stations; s++) {
    const a = new Map(forward[s]);
    const b = new Map(reverse[s]);
    for (const [id, w] of a) {
      if (!b.has(id)) { mismatches++; continue; }
      const wb = b.get(id)[0];
      const err = Math.abs(Number(w) - Number(wb));
      if (Number.isFinite(err)) maxErr = Math.max(maxErr, err);
      if (a.get(id)[2] !== b.get(id)[2]) mismatches++;
      compared++;
    }
  }
  return { stations, compared, maxErr, mismatches };
});

console.log("REVERSE WALK:", JSON.stringify(sample));
await page.screenshot({ path: "artifacts/reverse-walk.png" });
await browser.close();
if (sample.maxErr !== 0 || sample.mismatches !== 0) process.exit(1);
