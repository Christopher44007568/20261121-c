import {
  add,
  convexHull2D,
  pointInPolygon,
  scale,
  vec3,
} from "./geometry.js";
import {
  makeObb,
  obbCorners,
  projectPoint,
} from "./scene-geometry.js";

const LABEL_WIDTH = 104;
const LABEL_HEIGHT = 28;
const LABEL_GAP = 5;

function layoutSideItems(items, width, height) {
  const ordered = [...items].sort((a, b) => a.anchor.y - b.anchor.y);
  let previousBottom = 12;
  for (const item of ordered) {
    const desired = item.anchor.y - LABEL_HEIGHT / 2;
    const top = Math.max(12, desired, previousBottom + LABEL_GAP);
    item.label = {
      x: Math.max(8, Math.min(width - LABEL_WIDTH - 8, item.labelX)),
      y: top,
      width: LABEL_WIDTH,
      height: LABEL_HEIGHT,
    };
    previousBottom = item.label.y + LABEL_HEIGHT;
  }
  const overflow = Math.max(0, previousBottom - (height - 10));
  if (overflow > 0) {
    for (const item of ordered) {
      item.label.y = Math.max(10, item.label.y - overflow);
    }
  }
}

export function createSceneLayout(engine, camera, viewport) {
  const { width, height } = viewport;
  const partItems = engine.parts.map((part, index) => {
    const trajectory = engine.trajectory(part.id);
    const center = trajectory.end;
    const obb = makeObb(center, part.size, part.rotation || vec3());
    const worldCorners = obbCorners(obb);
    const projectedCorners = worldCorners.map((point) =>
      projectPoint(point, camera, width, height));
    const visibleCorners = projectedCorners.filter((point) => point.visible);
    const hull = convexHull2D(visibleCorners);
    const anchor = projectPoint(center, camera, width, height);
    const averageDepth = projectedCorners.reduce((sum, point) => sum + point.depth, 0)
      / projectedCorners.length;
    const leftSide = anchor.x < width / 2;
    return {
      id: part.id,
      part,
      index,
      labelNumber: String(index + 1).padStart(2, "0"),
      trajectory,
      obb,
      worldCorners,
      projectedCorners,
      hull,
      anchor,
      depth: averageDepth,
      leftSide,
      labelX: leftSide ? 10 : width - LABEL_WIDTH - 10,
    };
  });

  const leftItems = partItems.filter((item) => item.leftSide);
  const rightItems = partItems.filter((item) => !item.leftSide);
  layoutSideItems(leftItems, width, height);
  layoutSideItems(rightItems, width, height);

  const sorted = [...partItems].sort((a, b) => a.depth - b.depth);
  return {
    width,
    height,
    camera,
    parts: sorted,
    byId: new Map(partItems.map((item) => [item.id, item])),
    labels: partItems
      .filter((item) => item.anchor.visible && item.hull.length >= 3)
      .sort((a, b) => a.label.y - b.label.y),
  };
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function pickScene(layout, point) {
  for (const item of layout.labels) {
    if (pointInRect(point, item.label)) {
      return { id: item.id, type: "label", item };
    }
  }
  for (const item of layout.parts) {
    if (item.part.transparent) continue;
    if (item.hull.length >= 3 && pointInPolygon(point, item.hull)) {
      return { id: item.id, type: "part", item };
    }
  }
  const housing = layout.parts.find((item) => item.id === "housing-shell");
  if (housing?.hull.length >= 3 && pointInPolygon(point, housing.hull)) {
    return { id: housing.id, type: "part", item: housing };
  }
  return null;
}

export function labelCenter(item) {
  return vec3(
    item.label.x + item.label.width / 2,
    item.label.y + item.label.height / 2,
    0,
  );
}

export function sceneScreenBounds(engine, camera, width, height) {
  const layout = createSceneLayout(engine, camera, { width, height });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of layout.parts) {
    for (const point of item.projectedCorners) {
      if (!point.visible) continue;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { minX, minY, maxX, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

export function moveAlongAxis(camera, axis, amount) {
  const direction = axis === "x" ? vec3(1, 0, 0) : axis === "y" ? vec3(0, 1, 0) : vec3(0, 0, 1);
  return add(camera.target, scale(direction, amount));
}
