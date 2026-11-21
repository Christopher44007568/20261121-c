// Collects structured, serialisable diagnostics instead of throwing away
// context. Codes use E_ (blocking), W_ (recovered automatically), I_ (info).

export const SEVERITY = {
  E_NON_FINITE: "error",
  E_SELF_INTERSECT: "error",
  E_TRIVIAL_INPUT: "error",
  E_AREA_IDENTITY: "error",
  W_NEAR_THRESHOLD: "warning",
  W_COLLAPSED_EDGE: "warning",
  W_DEGENERATE_RING: "warning",
  W_UNWOUND_RING: "warning",
  W_SPLIT_INTERSECTION: "warning",
  W_ORPHAN_HOLE: "warning",
  W_AREA_MISMATCH: "warning",
  I_ZERO_RESULT: "info",
  I_TOUCH_POINT: "info",
};

export class Diagnostics {
  constructor() {
    this.entries = [];
  }

  add(severity, code, detail = {}) {
    this.entries.push({ severity, code, detail, message: formatMessage(code, detail) });
  }

  error(code, detail) {
    this.add("error", code, detail);
  }

  warn(code, detail) {
    this.add("warning", code, detail);
  }

  info(code, detail) {
    this.add("info", code, detail);
  }

  hasErrors() {
    return this.entries.some((e) => e.severity === "error");
  }

  byCode(code) {
    return this.entries.filter((e) => e.code === code);
  }

  toJSON() {
    return this.entries;
  }

  text() {
    return this.entries
      .map((e) => `${e.severity[0].toUpperCase()} ${e.code}: ${e.message}`)
      .join("\n");
  }
}

function formatMessage(code, d) {
  const where = d.set !== undefined
    ? `set${d.set}/poly${d.polygon ?? "?"}/ring${d.ring ?? "?"}`
    : "";
  switch (code) {
    case "E_NON_FINITE":
      return `${where} vertex ${d.vertex} is not finite (${d.x}, ${d.y})`;
    case "E_SELF_INTERSECT":
      return `${where} ring self-intersects at (${d.x}, ${d.y})`;
    case "E_TRIVIAL_INPUT":
      return `operation needs at least two polygon sets; got ${d.given}`;
    case "W_NEAR_THRESHOLD":
      return `${where} vertex ${d.vertex} ${d.axis}=${d.scaledValue.toFixed(4)} is ${d.distanceToBoundary.toFixed(4)} from a half-unit boundary -> ${d.snappedTo}`;
    case "W_COLLAPSED_EDGE":
      return `${where} collapsed duplicates on snapping: ${d.before} -> ${d.after} vertices`;
    case "W_DEGENERATE_RING":
      return `${where} ring has only ${d.distinctVertices} distinct vertices and was dropped`;
    case "W_SPLIT_INTERSECTION":
      return `edge intersection at (${d.x}, ${d.y}) split into atomic edges`;
    case "W_UNWOUND_RING":
      return `${where} ring orientation corrected to ${d.expected}`;
    case "W_ORPHAN_HOLE":
      return `inner ring ${d.ring} is not contained in any outer ring`;
    case "W_AREA_MISMATCH":
      return `polygon ${d.polygon} triangulated area ${d.triangulated} != expected ${d.expected}`;
    case "I_ZERO_RESULT":
      return "operation produced an empty region";
    case "I_TOUCH_POINT":
      return `tangent contact at (${d.x}, ${d.y})`;
    default:
      return JSON.stringify(d);
  }
}
