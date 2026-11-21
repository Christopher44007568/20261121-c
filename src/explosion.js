import { ASSEMBLY, ancestorPath, nodeMap } from "./assembly-data.js";
import {
  add,
  clamp,
  mat4Compose,
  scale,
  vec3,
} from "./geometry.js";
import { AXIS_VECTORS, makeObb, obbDistance } from "./scene-geometry.js";

export const TRAVEL_SCALE = 1;

function stableDrift(id, index) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return ((hash / 997) * 2 - 1) * (0.22 + index * 0.035);
}

export class ExplosionEngine {
  constructor(assembly = ASSEMBLY) {
    this.assembly = assembly;
    this.nodes = nodeMap(assembly);
    this.parts = assembly.nodes.filter((node) => node.type === "part");
    this.partIndex = new Map(this.parts.map((part, index) => [part.id, index]));
    this.state = {
      amount: 0,
      axis: "x",
      axialLock: true,
      scopeId: "root",
    };
    this.lockedParts = new Set(this.parts.filter((part) => part.fixed).map((part) => part.id));
  }

  setAmount(value) {
    this.state.amount = clamp(Number(value) || 0, 0, 1);
    return this.state.amount;
  }

  setAxis(axis) {
    if (!AXIS_VECTORS[axis]) throw new Error(`Unknown explosion axis: ${axis}`);
    this.state.axis = axis;
    return axis;
  }

  setAxialLock(enabled) {
    this.state.axialLock = Boolean(enabled);
    return this.state.axialLock;
  }

  setScope(scopeId) {
    const node = this.nodes.get(scopeId);
    if (!node) throw new Error(`Unknown assembly node: ${scopeId}`);
    if (node.type === "part" && node.fixed) return this.state.scopeId;
    this.state.scopeId = scopeId;
    return scopeId;
  }

  isLocked(partId) {
    return this.lockedParts.has(partId);
  }

  setLocked(partId, locked) {
    const part = this.nodes.get(partId);
    if (!part || part.type !== "part") throw new Error(`Unknown part: ${partId}`);
    if (part.fixed && !locked) return true;
    if (locked) this.lockedParts.add(partId);
    else this.lockedParts.delete(partId);
    return this.lockedParts.has(partId);
  }

  toggleLocked(partId) {
    return this.setLocked(partId, !this.lockedParts.has(partId));
  }

  isInScope(part) {
    return ancestorPath(part.id, this.assembly)
      .some((node) => node.id === this.state.scopeId);
  }

  pathFor(part) {
    return ancestorPath(part.id, this.assembly);
  }

  signFor(part) {
    const path = this.pathFor(part);
    for (let index = path.length - 1; index >= 0; index -= 1) {
      if (Number.isFinite(path[index].sign)) return path[index].sign;
    }
    return 1;
  }

  hierarchyFactor(part) {
    const path = this.pathFor(part);
    const scopeIndex = path.findIndex((node) => node.id === this.state.scopeId);
    const relevant = scopeIndex >= 0 ? path.slice(scopeIndex) : path;
    return relevant.reduce((sum, node) =>
      sum + (node.type === "part" ? 0 : (node.factor || 0)), 0);
  }

  crossAxisDrift(part) {
    const index = this.partIndex.get(part.id) || 0;
    const swing = Math.sin((index + 1) * 1.7) * 0.34;
    const secondary = stableDrift(part.id, index) + swing;
    const drift = vec3();
    if (this.state.axis !== "x") drift.x = secondary;
    if (this.state.axis !== "y") drift.y = stableDrift(`${part.id}y`, index) * 0.65;
    if (this.state.axis !== "z") drift.z = stableDrift(`${part.id}z`, index) * 0.75;
    return scale(drift, this.state.axialLock ? 0 : 1);
  }

  trajectory(partId, amount = this.state.amount) {
    const part = this.nodes.get(partId);
    if (!part || part.type !== "part") throw new Error(`Unknown part: ${partId}`);
    const locked = this.isLocked(part.id) || !this.isInScope(part);
    if (part.fixed || locked) {
      return {
        partId,
        start: { ...part.position },
        end: { ...part.position },
        delta: vec3(),
        distance: 0,
        locked: true,
        inScope: this.isInScope(part),
      };
    }
    const factor = this.hierarchyFactor(part) + (part.lane || 0);
    const axialDelta = scale(
      AXIS_VECTORS[this.state.axis],
      this.signFor(part) * factor * TRAVEL_SCALE * clamp(amount, 0, 1),
    );
    const delta = add(axialDelta, scale(this.crossAxisDrift(part), clamp(amount, 0, 1)));
    return {
      partId,
      start: { ...part.position },
      end: add(part.position, delta),
      delta,
      distance: Math.hypot(delta.x, delta.y, delta.z),
      axialDistance: factor * TRAVEL_SCALE * clamp(amount, 0, 1),
      locked: false,
      inScope: true,
    };
  }

  positionAt(partId, amount = this.state.amount) {
    return this.trajectory(partId, amount).end;
  }

  matrixAt(partId, amount = this.state.amount) {
    const part = this.nodes.get(partId);
    if (!part || part.type !== "part") throw new Error(`Unknown part: ${partId}`);
    return mat4Compose(this.positionAt(partId, amount), part.rotation || vec3());
  }

  restMatrix(partId) {
    const part = this.nodes.get(partId);
    if (!part || part.type !== "part") throw new Error(`Unknown part: ${partId}`);
    return mat4Compose(part.position, part.rotation || vec3());
  }

  targetMatrices(amount = this.state.amount) {
    return new Map(this.parts.map((part) => [part.id, this.matrixAt(part.id, amount)]));
  }

  reset() {
    this.state.amount = 0;
    return this.targetMatrices(0);
  }

  clearLocks() {
    this.lockedParts = new Set(this.parts.filter((part) => part.fixed).map((part) => part.id));
  }

  obbAt(partId, amount = this.state.amount) {
    const part = this.nodes.get(partId);
    if (!part || part.type !== "part") throw new Error(`Unknown part: ${partId}`);
    return makeObb(
      this.positionAt(partId, amount),
      part.size,
      part.rotation || vec3(),
    );
  }

  minimumDistance(amount = this.state.amount, options = {}) {
    const excluded = new Set(options.excludeIds || ["housing-shell"]);
    const ids = options.partIds
      ? options.partIds.filter((id) => this.nodes.get(id)?.type === "part")
      : this.parts
        .filter((part) => !excluded.has(part.id) && !part.fixed)
        .map((part) => part.id);
    let minimum = Infinity;
    let pair = null;
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        const value = obbDistance(
          this.obbAt(ids[left], amount),
          this.obbAt(ids[right], amount),
        );
        if (value < minimum) {
          minimum = value;
          pair = [ids[left], ids[right]];
        }
      }
    }
    return { distance: minimum, pair };
  }

  clearanceReport(amount = this.state.amount, options = {}) {
    const excluded = new Set(options.excludeIds || ["housing-shell"]);
    const ids = options.partIds
      ? options.partIds.filter((id) => this.nodes.get(id)?.type === "part")
      : this.parts
        .filter((part) => !excluded.has(part.id) && !part.fixed)
        .map((part) => part.id);
    const minimumRestGap = options.minimumRestGap ?? 0.02;
    let minimum = Infinity;
    let pair = null;
    let restDistance = null;
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        const rest = obbDistance(
          this.obbAt(ids[left], 0),
          this.obbAt(ids[right], 0),
        );
        if (rest <= minimumRestGap) continue;
        const value = obbDistance(
          this.obbAt(ids[left], amount),
          this.obbAt(ids[right], amount),
        );
        if (value < minimum) {
          minimum = value;
          pair = [ids[left], ids[right]];
          restDistance = rest;
        }
      }
    }
    return { distance: minimum, pair, restDistance };
  }
}

export const createExplosionEngine = (assembly = ASSEMBLY) =>
  new ExplosionEngine(assembly);
