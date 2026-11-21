import { vec3 } from "./geometry.js";

const part = (id, parentId, options) => ({
  id,
  parentId,
  type: "part",
  fixed: false,
  rotation: vec3(),
  lane: 0,
  ...options,
});

export const ASSEMBLY = {
  id: "rg-204",
  name: "齿轮箱总装",
  code: "RG-204",
  revision: "REV. 08",
  units: "mm",
  nodes: [
    {
      id: "root",
      parentId: null,
      type: "assembly",
      name: "RG-204 齿轮箱",
      code: "00",
      sign: -1,
      factor: 0,
    },
    part("housing-shell", "root", {
      name: "壳体",
      code: "01",
      position: vec3(0, 0, 0),
      size: vec3(5.6, 3.7, 4.1),
      shape: "housing",
      color: "#6d7d8f",
      fixed: true,
      transparent: true,
      lane: 0,
    }),
    {
      id: "cover-group",
      parentId: "root",
      type: "group",
      name: "端盖组件",
      code: "A",
      sign: -1,
      factor: 7.1,
    },
    part("cover-plate", "cover-group", {
      name: "前端盖",
      code: "A1",
      position: vec3(-2.86, 0, 0),
      size: vec3(0.24, 3.9, 4.05),
      shape: "disc",
      color: "#d6dde5",
      lane: 0,
    }),
    part("cover-gasket", "cover-group", {
      name: "密封垫",
      code: "A2",
      position: vec3(-3.03, 0, 0),
      size: vec3(0.08, 3.72, 3.88),
      shape: "ring",
      color: "#d6a354",
      lane: 0.45,
    }),
    part("cover-seal", "cover-group", {
      name: "轴封",
      code: "A3",
      position: vec3(-3.1, 0.85, -0.95),
      size: vec3(0.16, 0.78, 0.78),
      shape: "ring",
      color: "#4b5b6d",
      lane: 0.9,
    }),
    {
      id: "input-group",
      parentId: "root",
      type: "group",
      name: "输入轴系",
      code: "B",
      sign: -1,
      factor: 2.15,
    },
    part("input-shaft", "input-group", {
      name: "输入轴",
      code: "B1",
      position: vec3(-0.72, -0.78, 1.02),
      size: vec3(4.7, 0.38, 0.38),
      shape: "shaft",
      color: "#c6ced8",
      lane: 0,
    }),
    part("input-bearing", "input-group", {
      name: "输入轴承 6204",
      code: "B2",
      position: vec3(-1.7, -0.78, 1.02),
      size: vec3(0.48, 1.02, 1.02),
      shape: "bearing",
      color: "#b1bcc8",
      lane: 3.2,
    }),
    {
      id: "input-gear-stack",
      parentId: "input-group",
      type: "group",
      name: "输入齿轮副",
      code: "B.1",
      sign: -1,
      factor: 5.3,
    },
    part("input-gear", "input-gear-stack", {
      name: "输入齿轮 18T",
      code: "B1.1",
      position: vec3(-0.52, -0.78, 1.02),
      size: vec3(0.64, 1.86, 1.86),
      shape: "gear",
      color: "#d29a55",
      lane: 0,
    }),
    part("input-retainer", "input-gear-stack", {
      name: "输入挡圈",
      code: "B1.2",
      position: vec3(0.26, -0.78, 1.02),
      size: vec3(0.14, 1.02, 1.02),
      shape: "ring",
      color: "#7a899a",
      lane: -0.9,
    }),
    {
      id: "output-group",
      parentId: "root",
      type: "group",
      name: "输出轴系",
      code: "C",
      sign: 1,
      factor: 2.15,
    },
    part("output-shaft", "output-group", {
      name: "输出轴",
      code: "C1",
      position: vec3(-0.62, 0.83, -0.98),
      size: vec3(4.35, 0.34, 0.34),
      shape: "shaft",
      color: "#c6ced8",
      lane: 0,
    }),
    part("output-bearing", "output-group", {
      name: "输出轴承 6205",
      code: "C2",
      position: vec3(-1.55, 0.83, -0.98),
      size: vec3(0.44, 0.9, 0.9),
      shape: "bearing",
      color: "#b1bcc8",
      lane: 3.8,
    }),
    {
      id: "output-gear-stack",
      parentId: "output-group",
      type: "group",
      name: "输出齿轮副",
      code: "C.1",
      sign: 1,
      factor: 4.4,
    },
    part("output-gear", "output-gear-stack", {
      name: "输出齿轮 42T",
      code: "C1.1",
      position: vec3(-0.44, 0.83, -0.98),
      size: vec3(0.58, 1.62, 1.62),
      shape: "gear",
      color: "#cc9250",
      lane: 0,
    }),
    part("output-spacer", "output-gear-stack", {
      name: "间隔套",
      code: "C1.2",
      position: vec3(0.21, 0.83, -0.98),
      size: vec3(0.3, 0.82, 0.82),
      shape: "ring",
      color: "#758699",
      lane: 0.75,
    }),
    {
      id: "fastener-group",
      parentId: "root",
      type: "group",
      name: "紧固件",
      code: "D",
      sign: -1,
      factor: 8.9,
    },
    ...["a", "b", "c", "d"].map((suffix, index) => part(`bolt-${suffix}`, "fastener-group", {
      name: `端盖螺栓 ${index + 1}`,
      code: `D${index + 1}`,
      position: vec3(-2.98, index < 2 ? 1.42 : -1.42, index % 2 === 0 ? 1.52 : -1.52),
      size: vec3(0.56, 0.25, 0.25),
      shape: "bolt",
      color: "#7f8c9b",
      lane: index * 0.2,
    })),
  ],
  constraints: [
    { from: "bolt-a", to: "cover-plate", reason: "先松开端盖紧固件" },
    { from: "bolt-b", to: "cover-plate", reason: "先松开端盖紧固件" },
    { from: "bolt-c", to: "cover-plate", reason: "先松开端盖紧固件" },
    { from: "bolt-d", to: "cover-plate", reason: "先松开端盖紧固件" },
    { from: "cover-plate", to: "cover-gasket", reason: "端盖移除后才能取下密封垫" },
    { from: "cover-gasket", to: "cover-seal", reason: "密封垫移除后才能取下轴封" },
    { from: "cover-gasket", to: "input-retainer", reason: "挡圈受端盖轴向限位" },
    { from: "input-retainer", to: "input-gear", reason: "先拆挡圈再拆输入齿轮" },
    { from: "input-gear", to: "input-bearing", reason: "齿轮移除后才能压出轴承" },
    { from: "input-bearing", to: "input-shaft", reason: "轴承先于输入轴拆卸" },
    { from: "input-shaft", to: "input-bearing", reason: "返修工序要求轴先退出" },
    { from: "output-spacer", to: "output-gear", reason: "先拆间隔套再拆输出齿轮" },
    { from: "output-gear", to: "output-bearing", reason: "齿轮移除后才能压出轴承" },
    { from: "output-bearing", to: "output-shaft", reason: "轴承先于输出轴拆卸" },
  ],
};

export function nodeMap(assembly = ASSEMBLY) {
  return new Map(assembly.nodes.map((node) => [node.id, node]));
}

export function ancestorPath(nodeId, assembly = ASSEMBLY) {
  const nodes = nodeMap(assembly);
  const path = [];
  let cursor = nodes.get(nodeId);
  while (cursor) {
    path.unshift(cursor);
    cursor = cursor.parentId ? nodes.get(cursor.parentId) : null;
  }
  return path;
}

export function descendantParts(nodeId, assembly = ASSEMBLY) {
  return assembly.nodes.filter((node) =>
    node.type === "part" && ancestorPath(node.id, assembly).some((item) => item.id === nodeId));
}
