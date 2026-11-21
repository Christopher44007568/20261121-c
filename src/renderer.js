import {
  add,
  clamp,
  convexHull2D,
  cross,
  dot,
  normalize,
  scale,
  sub,
  vec3,
} from "./geometry.js";
import {
  cameraFrame,
  makeObb,
  projectPoint,
} from "./scene-geometry.js";
import { createSceneLayout } from "./scene.js";
import {
  drawArrow,
  pathFromPoints,
  roundedRect,
  shade,
  truncateText,
  withAlpha,
} from "./draw-utils.js";

const AXIS_COLORS = {
  x: "#ff7858",
  y: "#6fd8b2",
  z: "#7ea6ff",
};

const FACE_DEFINITIONS = [
  { indices: [0, 1, 3, 2], light: 0.72 },
  { indices: [4, 6, 7, 5], light: 1.08 },
  { indices: [0, 4, 5, 1], light: 0.62 },
  { indices: [2, 3, 7, 6], light: 1.18 },
  { indices: [0, 2, 6, 4], light: 0.78 },
  { indices: [1, 5, 7, 3], light: 0.96 },
];

export class CadRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.context = canvas.getContext("2d");
    this.selectedId = null;
    this.hoveredId = null;
    this.showLabels = true;
    this.showGhosts = true;
    this.layout = null;
    this.width = 0;
    this.height = 0;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.dpr = dpr;
  }

  isSelectedPart(partId) {
    if (!this.selectedId) return false;
    const node = this.engine.nodes.get(this.selectedId);
    if (!node) return false;
    if (node.type === "part") return node.id === partId;
    const part = this.engine.nodes.get(partId);
    return Boolean(part) && this.engine.pathFor(part)
      .some((ancestor) => ancestor.id === this.selectedId);
  }

  draw(camera) {
    const context = this.context;
    this.resize();
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    this.layout = createSceneLayout(this.engine, camera, {
      width: this.width,
      height: this.height,
    });
    this.drawBackdrop();
    this.drawGrid(camera);
    this.drawTrajectories(this.layout);
    if (this.showGhosts) this.drawGhosts(this.layout, camera);
    this.drawParts(this.layout, camera);
    this.drawSelection(this.layout);
    if (this.showLabels) this.drawLabels(this.layout);
    this.drawAxisCompass(camera);
    return this.layout;
  }

  drawBackdrop() {
    const context = this.context;
    const gradient = context.createRadialGradient(
      this.width * 0.52,
      this.height * 0.42,
      20,
      this.width * 0.52,
      this.height * 0.42,
      this.width * 0.7,
    );
    gradient.addColorStop(0, "rgba(38,57,76,0.24)");
    gradient.addColorStop(0.55, "rgba(18,29,42,0.08)");
    gradient.addColorStop(1, "rgba(5,10,16,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);
  }

  drawGrid(camera) {
    const context = this.context;
    const extent = 14;
    const floor = -2.12;
    context.save();
    context.lineWidth = 1;
    for (let coordinate = -extent; coordinate <= extent; coordinate += 2) {
      const major = coordinate === 0;
      context.strokeStyle = major
        ? "rgba(111,142,168,0.16)"
        : "rgba(91,118,140,0.075)";
      const alongX = [
        projectPoint(vec3(-extent, floor, coordinate), camera, this.width, this.height),
        projectPoint(vec3(extent, floor, coordinate), camera, this.width, this.height),
      ];
      const alongZ = [
        projectPoint(vec3(coordinate, floor, -extent), camera, this.width, this.height),
        projectPoint(vec3(coordinate, floor, extent), camera, this.width, this.height),
      ];
      for (const line of [alongX, alongZ]) {
        if (!line[0].visible || !line[1].visible) continue;
        context.beginPath();
        context.moveTo(line[0].x, line[0].y);
        context.lineTo(line[1].x, line[1].y);
        context.stroke();
      }
    }
    const origin = projectPoint(vec3(0, floor, 0), camera, this.width, this.height);
    if (origin.visible) {
      context.beginPath();
      context.arc(origin.x, origin.y, 2.2, 0, Math.PI * 2);
      context.fillStyle = "rgba(157,181,201,0.4)";
      context.fill();
    }
    context.restore();
  }

  drawLabels(layout) {
    const context = this.context;
    for (const item of layout.labels) {
      const selected = this.isSelectedPart(item.id);
      const hovered = item.id === this.hoveredId;
      this.drawLeader(item, selected, hovered);
      const rect = item.label;
      roundedRect(context, rect.x, rect.y, rect.width, rect.height, 5);
      context.fillStyle = selected
        ? "rgba(35,24,22,0.96)"
        : "rgba(10,18,28,0.92)";
      context.fill();
      context.lineWidth = selected ? 1.4 : 0.8;
      context.strokeStyle = selected
        ? AXIS_COLORS.x
        : hovered
          ? "rgba(185,211,231,0.85)"
          : "rgba(121,149,171,0.34)";
      context.stroke();

      context.fillStyle = selected ? AXIS_COLORS.x : "rgba(128,162,187,0.9)";
      context.font = "600 9px 'IBM Plex Mono', monospace";
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillText(item.part.code, rect.x + 9, rect.y + rect.height / 2);
      context.fillStyle = selected ? "#fff3ec" : "#dbe7f1";
      context.font = "500 10px 'Noto Sans SC', sans-serif";
      const name = truncateText(context, item.part.name, rect.width - 48);
      context.fillText(name, rect.x + 39, rect.y + rect.height / 2 + 0.5);
      context.fillStyle = selected ? AXIS_COLORS.x : "rgba(112,140,160,0.66)";
      context.font = "500 8px 'IBM Plex Mono', monospace";
      context.textAlign = "right";
      context.fillText(item.labelNumber, rect.x + rect.width - 7, rect.y + rect.height / 2);
    }
  }

  drawLeader(item, selected, hovered) {
    const context = this.context;
    const rect = item.label;
    const end = {
      x: item.leftSide ? rect.x + rect.width : rect.x,
      y: rect.y + rect.height / 2,
    };
    const shoulder = { x: end.x + (item.leftSide ? 7 : -7), y: end.y };
    context.save();
    context.beginPath();
    context.moveTo(item.anchor.x, item.anchor.y);
    context.lineTo(shoulder.x, shoulder.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = selected
      ? withAlpha(AXIS_COLORS.x, 0.86)
      : hovered
        ? "rgba(188,213,231,0.72)"
        : "rgba(125,153,175,0.28)";
    context.lineWidth = selected ? 1.25 : 0.75;
    context.setLineDash(selected ? [] : [2, 3]);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(item.anchor.x, item.anchor.y, selected ? 2.8 : 1.8, 0, Math.PI * 2);
    context.fillStyle = selected ? AXIS_COLORS.x : "rgba(139,169,191,0.65)";
    context.fill();
    if (selected) {
      context.beginPath();
      context.arc(item.anchor.x, item.anchor.y, 6, 0, Math.PI * 2);
      context.strokeStyle = withAlpha(AXIS_COLORS.x, 0.35);
      context.stroke();
    }
    context.restore();
  }

  drawTrajectories(layout) {
    const context = this.context;
    const axisColor = AXIS_COLORS[this.engine.state.axis];
    for (const item of layout.parts) {
      const trajectory = item.trajectory;
      if (trajectory.locked || trajectory.distance < 0.04) continue;
      const start = projectPoint(
        trajectory.start,
        layout.camera,
        this.width,
        this.height,
      );
      if (!start.visible || !item.anchor.visible) continue;
      const selected = this.isSelectedPart(item.id);
      context.save();
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(item.anchor.x, item.anchor.y);
      context.strokeStyle = selected
        ? withAlpha(axisColor, 0.88)
        : withAlpha(axisColor, 0.22);
      context.lineWidth = selected ? 1.4 : 0.7;
      context.setLineDash(selected ? [5, 4] : [3, 5]);
      context.stroke();
      context.setLineDash([]);
      if (selected || item.id === this.hoveredId) {
        drawArrow(context, start, item.anchor, withAlpha(axisColor, 0.9));
      }
      context.beginPath();
      context.arc(start.x, start.y, selected ? 3 : 1.8, 0, Math.PI * 2);
      context.fillStyle = withAlpha(axisColor, selected ? 0.9 : 0.36);
      context.fill();
      context.restore();
    }
  }

  drawGhosts(layout) {
    const context = this.context;
    for (const item of layout.parts) {
      if (item.trajectory.locked || item.trajectory.distance < 0.04) continue;
      const ghost = makeObb(
        item.trajectory.start,
        item.part.size,
        item.part.rotation || vec3(),
      );
      const points = [];
      const corners = [
        [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
        [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
      ];
      for (const [x, y, z] of corners) {
        const point = add(add(add(
          ghost.center,
          scale(ghost.axes[0], ghost.extents.x * x),
        ), scale(ghost.axes[1], ghost.extents.y * y)),
        scale(ghost.axes[2], ghost.extents.z * z));
        const projected = projectPoint(point, layout.camera, this.width, this.height);
        if (projected.visible) points.push(projected);
      }
      if (points.length < 3) continue;
      const selected = this.isSelectedPart(item.id);
      pathFromPoints(context, convexHull2D(points));
      context.fillStyle = selected
        ? withAlpha(item.part.color, 0.055)
        : "rgba(135,160,180,0.012)";
      context.fill();
      context.strokeStyle = selected
        ? withAlpha(item.part.color, 0.42)
        : "rgba(126,151,171,0.12)";
      context.lineWidth = selected ? 1 : 0.6;
      context.setLineDash([3, 4]);
      context.stroke();
      context.setLineDash([]);
    }
  }

  drawParts(layout, camera) {
    const housing = layout.parts.find((item) => item.part.shape === "housing");
    if (housing) this.drawHousing(housing, camera);
    for (const item of layout.parts) {
      if (item.part.shape === "housing") continue;
      this.drawCylinderPart(item, camera);
    }
  }

  drawHousing(item, camera) {
    const context = this.context;
    const frame = cameraFrame(camera);
    const faces = this.visibleFaces(item, frame.eye)
      .sort((a, b) => b.depth - a.depth);
    context.save();
    for (const face of faces) {
      pathFromPoints(context, face.points);
      context.fillStyle = "rgba(96,120,140,0.065)";
      context.fill();
      context.strokeStyle = "rgba(118,148,170,0.3)";
      context.lineWidth = 0.9;
      context.stroke();
    }
    const edges = new Map();
    for (const face of faces) {
      for (let index = 0; index < face.points.length; index += 1) {
        const a = face.points[index];
        const b = face.points[(index + 1) % face.points.length];
        const key = [a.x, a.y, b.x, b.y].map((value) => Math.round(value)).join(":");
        if (!edges.has(key)) edges.set(key, [a, b]);
      }
    }
    context.strokeStyle = "rgba(148,177,198,0.22)";
    context.lineWidth = 0.75;
    for (const [a, b] of edges.values()) {
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
    context.restore();
  }

  circlePoints(center, axes, radiusY, radiusZ, segments = 30) {
    const points = [];
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      const point = add(center, add(
        scale(axes[1], Math.cos(angle) * radiusY),
        scale(axes[2], Math.sin(angle) * radiusZ),
      ));
      const projected = projectPoint(point, this.layout.camera, this.width, this.height);
      if (projected.visible) points.push(projected);
    }
    return points;
  }

  drawCylinderPart(item, camera) {
    const context = this.context;
    const { obb, part } = item;
    const frame = cameraFrame(camera);
    const [axis, vertical, depthAxis] = obb.axes;
    const positive = dot(axis, sub(frame.eye, obb.center)) >= 0 ? 1 : -1;
    const backCenter = add(obb.center, scale(axis, -obb.extents.x * positive));
    const frontCenter = add(obb.center, scale(axis, obb.extents.x * positive));
    const backRing = this.circlePoints(
      backCenter, obb.axes, obb.extents.y, obb.extents.z,
    );
    const frontRing = this.circlePoints(
      frontCenter, obb.axes, obb.extents.y, obb.extents.z,
    );
    const body = convexHull2D([...backRing, ...frontRing]);
    if (body.length < 3) return;

    const top = projectPoint(add(obb.center, scale(vertical, obb.extents.y)), camera, this.width, this.height);
    const bottom = projectPoint(add(obb.center, scale(vertical, -obb.extents.y)), camera, this.width, this.height);
    const left = projectPoint(add(obb.center, scale(depthAxis, -obb.extents.z)), camera, this.width, this.height);
    const right = projectPoint(add(obb.center, scale(depthAxis, obb.extents.z)), camera, this.width, this.height);
    const gradient = context.createLinearGradient(left.x, top.y, right.x, bottom.y);
    gradient.addColorStop(0, shade(part.color, 1.12));
    gradient.addColorStop(0.48, shade(part.color, 0.76));
    gradient.addColorStop(1, shade(part.color, 0.46));

    context.save();
    pathFromPoints(context, body);
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = shade(part.color, 0.35);
    context.lineWidth = 0.85;
    context.stroke();

    const capCenter = positive > 0 ? frontCenter : backCenter;
    this.drawCap(item, capCenter, obb.axes, obb.extents.y, obb.extents.z, positive);

    context.globalAlpha = 0.28;
    context.beginPath();
    const centerScreen = projectPoint(obb.center, camera, this.width, this.height);
    const axisEnd = projectPoint(frontCenter, camera, this.width, this.height);
    if (centerScreen.visible && axisEnd.visible) {
      context.moveTo(centerScreen.x, centerScreen.y);
      context.lineTo(axisEnd.x, axisEnd.y);
      context.strokeStyle = "rgba(255,255,255,0.8)";
      context.lineWidth = 0.7;
      context.stroke();
    }
    context.restore();
  }

  drawCap(item, center, axes, radiusY, radiusZ, side) {
    const context = this.context;
    const { part } = item;
    const shape = part.shape;
    const segments = shape === "gear" ? 40 : shape === "bolt" ? 6 : 32;
    const points = [];
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      const tooth = shape === "gear" && index % 2 === 0 ? 1.075 : 1;
      const point = add(center, add(
        scale(axes[1], Math.cos(angle) * radiusY * tooth),
        scale(axes[2], Math.sin(angle) * radiusZ * tooth),
      ));
      const projected = projectPoint(point, this.layout.camera, this.width, this.height);
      if (projected.visible) points.push(projected);
    }
    if (points.length < 3) return;

    const top = projectPoint(add(center, scale(axes[1], radiusY)), this.layout.camera, this.width, this.height);
    const bottom = projectPoint(add(center, scale(axes[1], -radiusY)), this.layout.camera, this.width, this.height);
    const gradient = context.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
    gradient.addColorStop(0, shade(part.color, 1.23));
    gradient.addColorStop(0.58, shade(part.color, 0.92));
    gradient.addColorStop(1, shade(part.color, 0.58));
    context.save();
    pathFromPoints(context, points);
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = shade(part.color, 0.48);
    context.lineWidth = 1;
    context.stroke();

    const holeRatio = {
      ring: 0.7,
      bearing: 0.55,
      gear: 0.2,
      disc: 0.17,
      bolt: 0,
      shaft: 0,
    }[shape] ?? 0;
    if (holeRatio > 0) {
      const hole = this.circlePoints(
        center,
        axes,
        radiusY * holeRatio,
        radiusZ * holeRatio,
        28,
      );
      pathFromPoints(context, hole);
      context.fillStyle = "rgba(9,16,24,0.88)";
      context.fill();
      context.strokeStyle = shade(part.color, 0.35);
      context.lineWidth = 1.1;
      context.stroke();
    }

    if (shape === "bearing") {
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        const ball = add(center, add(
          scale(axes[1], Math.cos(angle) * radiusY * 0.76),
          scale(axes[2], Math.sin(angle) * radiusZ * 0.76),
        ));
        const point = projectPoint(ball, this.layout.camera, this.width, this.height);
        if (!point.visible) continue;
        context.beginPath();
        context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        context.fillStyle = "#d7e1ea";
        context.fill();
        context.strokeStyle = "rgba(50,66,80,0.75)";
        context.lineWidth = 0.55;
        context.stroke();
      }
    }

    if (shape === "disc") {
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
        const hole = add(center, add(
          scale(axes[1], Math.cos(angle) * radiusY * 0.72),
          scale(axes[2], Math.sin(angle) * radiusZ * 0.72),
        ));
        const point = projectPoint(hole, this.layout.camera, this.width, this.height);
        if (!point.visible) continue;
        context.beginPath();
        context.arc(point.x, point.y, 2.4, 0, Math.PI * 2);
        context.fillStyle = "rgba(13,22,31,0.76)";
        context.fill();
      }
    }

    if (shape === "bolt" && side < 0) {
      context.beginPath();
      const point = projectPoint(center, this.layout.camera, this.width, this.height);
      if (point.visible) {
        context.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
        context.fillStyle = "rgba(25,36,47,0.72)";
        context.fill();
      }
    }
    context.restore();
  }

  visibleFaces(item, eye) {
    const faces = [];
    for (const definition of FACE_DEFINITIONS) {
      const world = definition.indices.map((index) => item.worldCorners[index]);
      const points = definition.indices.map((index) =>
        item.projectedCorners[index]).filter((point) => point.visible);
      if (points.length < 3) continue;
      const normal = normalize(cross(
        sub(world[1], world[0]),
        sub(world[2], world[0]),
      ));
      const center = world.reduce((sum, point) => add(sum, point), vec3());
      const faceCenter = scale(center, 1 / world.length);
      const outward = dot(normal, sub(faceCenter, item.obb.center)) >= 0
        ? normal
        : scale(normal, -1);
      if (dot(outward, sub(eye, faceCenter)) <= 0) continue;
      const depth = points.reduce((sum, point) => sum + point.depth, 0) / points.length;
      faces.push({ points, depth, light: definition.light });
    }
    return faces;
  }

  drawSelection(layout) {
    const selectedNode = this.engine.nodes.get(this.selectedId);
    const items = layout.parts.filter((item) =>
      this.isSelectedPart(item.id) && item.hull.length >= 3);
    if (!items.length) return;
    const context = this.context;
    const color = AXIS_COLORS[this.engine.state.axis];
    context.save();
    for (const item of items) {
      context.shadowColor = withAlpha(color, 0.6);
      context.shadowBlur = selectedNode?.type === "part" ? 14 : 7;
      pathFromPoints(context, item.hull);
      context.fillStyle = withAlpha(color, selectedNode?.type === "part" ? 0.045 : 0.018);
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = withAlpha(color, 0.92);
      context.lineWidth = selectedNode?.type === "part" ? 1.5 : 1;
      context.stroke();
    }
    if (selectedNode?.type === "part") {
      const item = items[0];
      const bounds = item.hull.reduce((result, point) => ({
        minX: Math.min(result.minX, point.x),
        minY: Math.min(result.minY, point.y),
        maxX: Math.max(result.maxX, point.x),
        maxY: Math.max(result.maxY, point.y),
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const size = 8;
      const corners = [
        [bounds.minX, bounds.minY, 1, 1],
        [bounds.maxX, bounds.minY, -1, 1],
        [bounds.minX, bounds.maxY, 1, -1],
        [bounds.maxX, bounds.maxY, -1, -1],
      ];
      context.strokeStyle = color;
      context.lineWidth = 1.6;
      for (const [x, y, sx, sy] of corners) {
        context.beginPath();
        context.moveTo(x + sx * size, y);
        context.lineTo(x, y);
        context.lineTo(x, y + sy * size);
        context.stroke();
      }
    }
    context.restore();
  }

  drawAxisCompass(camera) {
    const context = this.context;
    const frame = cameraFrame(camera);
    const center = { x: 48, y: this.height - 92 };
    context.save();
    context.beginPath();
    context.arc(center.x, center.y, 30, 0, Math.PI * 2);
    context.fillStyle = "rgba(9,16,25,0.58)";
    context.fill();
    context.strokeStyle = "rgba(127,153,174,0.24)";
    context.lineWidth = 0.8;
    context.stroke();
    const axes = [
      ["X", vec3(1, 0, 0)],
      ["Y", vec3(0, 1, 0)],
      ["Z", vec3(0, 0, 1)],
    ];
    for (const [label, vector] of axes) {
      const x = dot(vector, frame.right) * 20;
      const y = -dot(vector, frame.up) * 20;
      context.beginPath();
      context.moveTo(center.x, center.y);
      context.lineTo(center.x + x, center.y + y);
      context.strokeStyle = AXIS_COLORS[label.toLowerCase()];
      context.lineWidth = this.engine.state.axis === label.toLowerCase() ? 1.8 : 1;
      context.stroke();
      context.fillStyle = AXIS_COLORS[label.toLowerCase()];
      context.font = "600 8px 'IBM Plex Mono', monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, center.x + x * 1.3, center.y + y * 1.3);
    }
    context.fillStyle = "rgba(139,165,184,0.52)";
    context.font = "500 7px 'IBM Plex Mono', monospace";
    context.fillText("WORLD", center.x, center.y + 39);
    context.restore();
  }
}
