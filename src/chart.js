const GOLD = "#e6b566";
const TEAL = "#6fc6bd";

export class ConvergenceChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.data = null;
    this.type = "spp";
    this.selected = null;
    this.hover = -1;
    this.padding = { left: 42, right: 14, top: 18, bottom: 25 };
    canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    canvas.addEventListener("pointerleave", () => {
      this.hover = -1;
      this.draw();
      if (this.onHover) this.onHover(null);
    });
  }

  setData(data, type = this.type) {
    this.data = data;
    this.type = type;
    this.draw();
  }

  setType(type) {
    this.type = type;
    this.selected = null;
    this.hover = -1;
    this.draw();
  }

  setSelected(value) {
    this.selected = value;
    this.draw();
  }

  entries() {
    if (!this.data) return [];
    return this.type === "spp" ? this.data.series : this.data.distanceSweep;
  }

  resizeBacking() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(100, this.canvas.clientWidth);
    const height = Math.max(80, this.canvas.clientHeight);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  xScale(value, entries, width) {
    const inner = width - this.padding.left - this.padding.right;
    if (this.type === "spp") {
      return this.padding.left + (Math.log2(value) - 2) / 7 * inner;
    }
    const distances = entries.map((entry) => entry.maxDistance);
    const min = Math.log(Math.min(...distances));
    const max = Math.log(Math.max(...distances));
    return this.padding.left + (Math.log(value) - min) / (max - min) * inner;
  }

  yValue(entry) {
    return this.type === "spp" ? entry.rmse : entry.averageAO;
  }

  draw() {
    const { width, height } = this.resizeBacking();
    const ctx = this.ctx;
    const entries = this.entries();
    ctx.clearRect(0, 0, width, height);
    if (!entries.length) return;
    const { left, top, right, bottom } = this.padding;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const values = entries.map((entry) => this.yValue(entry));
    let max = Math.max(...values);
    if (this.type === "spp") max = Math.max(0.02, Math.ceil(max * 100) / 100);
    else max = 1;
    const min = this.type === "spp" ? 0 : 0.84;
    const yScale = (value) => top + (1 - (value - min) / (max - min)) * plotH;

    ctx.lineWidth = 1;
    ctx.font = "8px 'Ubuntu Mono', monospace";
    ctx.fillStyle = "#536163";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const y = top + ratio * plotH;
      ctx.strokeStyle = i === 4 ? "#243134" : "#182427";
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
      const value = max - ratio * (max - min);
      ctx.fillText(this.type === "spp" ? value.toFixed(3) : value.toFixed(2), left - 7, y);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ticks = this.type === "spp"
      ? entries.map((entry) => entry.samples)
      : entries.map((entry) => entry.maxDistance);
    for (let i = 0; i < ticks.length; i++) {
      const x = this.xScale(ticks[i], entries, width);
      if (i === 0 || i === ticks.length - 1 || ticks.length <= 6 || i % 2 === 1) {
        ctx.fillText(this.type === "spp" ? String(ticks[i]) : ticks[i].toFixed(1), x, height - bottom + 8);
      }
    }

    ctx.font = "7px 'Ubuntu Mono', monospace";
    ctx.fillStyle = "#445153";
    ctx.textAlign = "left";
    ctx.fillText(this.type === "spp" ? "RMSE" : "AVG AO", left, 4);
    ctx.textAlign = "right";
    ctx.fillText(this.type === "spp" ? "SAMPLES" : "MAX DISTANCE", width - right, height - 8);

    const gradient = ctx.createLinearGradient(0, top, 0, top + plotH);
    gradient.addColorStop(0, "rgba(230,181,102,0.19)");
    gradient.addColorStop(1, "rgba(230,181,102,0.00)");
    ctx.beginPath();
    entries.forEach((entry, index) => {
      const x = this.xScale(this.type === "spp" ? entry.samples : entry.maxDistance, entries, width);
      const y = yScale(this.yValue(entry));
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const lastX = this.xScale(
      this.type === "spp" ? entries.at(-1).samples : entries.at(-1).maxDistance,
      entries,
      width
    );
    ctx.lineTo(lastX, top + plotH);
    const firstX = this.xScale(
      this.type === "spp" ? entries[0].samples : entries[0].maxDistance,
      entries,
      width
    );
    ctx.lineTo(firstX, top + plotH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    entries.forEach((entry, index) => {
      const x = this.xScale(this.type === "spp" ? entry.samples : entry.maxDistance, entries, width);
      const y = yScale(this.yValue(entry));
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    const selectedValue = this.selected;
    if (selectedValue != null) {
      const index = entries.findIndex((entry) =>
        this.type === "spp" ? entry.samples === selectedValue : Math.abs(entry.maxDistance - selectedValue) < 1e-6
      );
      if (index >= 0) {
        const x = this.xScale(
          this.type === "spp" ? entries[index].samples : entries[index].maxDistance,
          entries,
          width
        );
        const y = yScale(this.yValue(entries[index]));
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "rgba(230,181,102,0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#101619";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (this.hover >= 0 && this.hover < entries.length) {
      const entry = entries[this.hover];
      const x = this.xScale(this.type === "spp" ? entry.samples : entry.maxDistance, entries, width);
      const y = yScale(this.yValue(entry));
      ctx.fillStyle = TEAL;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  pointerMove(event) {
    const entries = this.entries();
    if (!entries.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const scale = this.canvas.clientWidth;
    let best = -1;
    let bestDistance = Infinity;
    entries.forEach((entry, index) => {
      const px = this.xScale(this.type === "spp" ? entry.samples : entry.maxDistance, entries, scale);
      const distance = Math.abs(x - px);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    if (bestDistance < 18) {
      this.hover = best;
      this.draw();
      if (this.onHover) this.onHover(entries[best]);
    }
  }
}
