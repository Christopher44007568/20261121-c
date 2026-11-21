import { readFileSync } from "node:fs";

export function processHighWaterMark() {
  let rss = process.memoryUsage().rss;
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    const match = status.match(/^VmHWM:\s+(\d+)\s+kB$/m);
    if (match) {
      rss = Math.max(rss, Number(match[1]) * 1024);
    }
  } catch {
    // VmHWM is Linux-specific; process.memoryUsage() is the portable fallback.
  }
  return rss;
}

export class MemoryMonitor {
  constructor() {
    this.start = this.sample();
    this.peak = { ...this.start };
  }

  sample() {
    const usage = process.memoryUsage();
    return {
      rss: processHighWaterMark(),
      heapUsed: usage.heapUsed,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
    };
  }

  update() {
    const current = this.sample();
    for (const key of Object.keys(this.peak)) {
      this.peak[key] = Math.max(this.peak[key], current[key]);
    }
    return this.peak;
  }

  report(extra = {}) {
    this.update();
    return {
      startRssBytes: this.start.rss,
      peakRssBytes: this.peak.rss,
      peakHeapUsedBytes: this.peak.heapUsed,
      peakExternalBytes: this.peak.external,
      peakArrayBuffersBytes: this.peak.arrayBuffers,
      ...extra,
    };
  }
}
