import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const port = Number(process.env.VERIFY_PORT || 4187);
const executable = await findChromium();
if (!executable) {
  console.error("No Chromium executable found. Set CHROME_PATH to run browser verification.");
  process.exit(1);
}

const server = spawn(process.execPath, ["server.mjs"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"]
});
await new Promise((resolve) => setTimeout(resolve, 350));

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: executable,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-sandbox"
    ]
  });
  await mkdir("artifacts", { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const messages = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));

  const stations = [];
  for (const station of ["overview", "fin", "occluded", "far"]) {
    await page.goto(`http://127.0.0.1:${port}/?station=${station}&mode=split`);
    await page.waitForFunction(() => window.__viewerReady === true, { timeout: 15000 });
    await page.waitForTimeout(550);
    const state = await page.evaluate(() => window.__viewer.getState());
    stations.push({ station, mode: "split", result: state.result });
    await page.screenshot({ path: `artifacts/${station}-split.png`, fullPage: true });
  }

  for (const mode of ["offset", "depth"]) {
    await page.goto(`http://127.0.0.1:${port}/?station=far&mode=${mode}`);
    await page.waitForFunction(() => window.__viewerReady === true, { timeout: 15000 });
    await page.waitForTimeout(550);
    await page.screenshot({ path: `artifacts/far-${mode}.png`, fullPage: true });
  }

  const fin = stations.find((entry) => entry.station === "fin").result;
  const far = stations.find((entry) => entry.station === "far").result;
  const checks = {
    webgl2Loaded: messages.length === 0,
    thinBackLeakReproduced: fin.offsetThinLeak > 0,
    depthHidesThinBackEdges: fin.depthThinLeak === 0,
    coplanarLinesPass: fin.offsetCoplanarRate === 1 && fin.depthCoplanarRate === 1,
    farOffsetEdgesDisappear: far.offsetMissed > 0,
    farDepthEdgesRemain: far.depthMissed === 0 && !Number.isFinite(far.depthFar),
    noRuntimeErrors: messages.length === 0
  };
  const report = { executable, checks, messages, stations };
  await writeFile("artifacts/browser-report.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(checks, null, 2));
  if (messages.length > 0) console.log(messages.join("\n"));
  if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

async function findChromium() {
  const candidates = [
    process.env.CHROME_PATH,
    chromium.executablePath(),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const roots = [
    join(process.env.HOME || "", ".cache", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
    join(userInfo().homedir, ".cache", "ms-playwright")
  ];
  for (const root of [...new Set(roots)]) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries.sort().reverse()) {
        if (!entry.isDirectory() || !entry.name.startsWith("chromium")) continue;
        candidates.push(join(root, entry.name, "chrome-linux", "chrome"));
        candidates.push(join(root, entry.name, "chrome-linux64", "chrome"));
        candidates.push(join(root, entry.name, "chrome-linux", "headless_shell"));
      }
    } catch {
      // Keep trying the other known locations.
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not executable, continue.
    }
  }
  return null;
}
