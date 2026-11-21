import { ASSEMBLY, nodeMap } from "./assembly-data.js";

function stronglyConnected(nodes, edges) {
  let index = 0;
  const indices = new Map();
  const lowlinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  const adjacency = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);

  const visit = (node) => {
    indices.set(node, index);
    lowlinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) || []) {
      if (!indices.has(next)) {
        visit(next);
        lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(next)));
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(next)));
      }
    }

    if (lowlinks.get(node) === indices.get(node)) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      components.push(component);
    }
  };

  for (const node of nodes) {
    if (!indices.has(node)) visit(node);
  }
  return components;
}

export function analyzeConstraints(assembly = ASSEMBLY) {
  const nodes = [...new Set(assembly.constraints.flatMap((edge) => [edge.from, edge.to]))];
  const components = stronglyConnected(nodes, assembly.constraints);
  const cycles = components.filter((component) =>
    component.length > 1 || assembly.constraints.some((edge) =>
      edge.from === component[0] && edge.to === component[0]));
  const cycleByNode = new Map();
  for (const cycle of cycles) {
    for (const node of cycle) cycleByNode.set(node, cycle);
  }
  const conflictEdges = assembly.constraints.filter((edge) =>
    cycleByNode.has(edge.from) && cycleByNode.get(edge.from) === cycleByNode.get(edge.to));
  return {
    nodes,
    cycles,
    conflictEdges,
    conflictCount: cycles.length,
    inConflict: (nodeId) => cycleByNode.has(nodeId),
  };
}

export function layoutConflictGraph(assembly = ASSEMBLY, width = 306, height = 166) {
  const analysis = analyzeConstraints(assembly);
  const nodes = nodeMap(assembly);
  const cycleNodes = new Set(analysis.cycles.flat());
  const directPredecessors = new Set();
  for (const edge of assembly.constraints) {
    if (cycleNodes.has(edge.to) && !cycleNodes.has(edge.from)) directPredecessors.add(edge.from);
  }
  const upstream = new Set([...directPredecessors]);
  for (const edge of assembly.constraints) {
    if (directPredecessors.has(edge.to) && !cycleNodes.has(edge.from)) upstream.add(edge.from);
  }
  const before = [...upstream].slice(0, 2).reverse();
  const cycle = [...cycleNodes];
  const placed = new Map();
  before.forEach((id, index) => {
    placed.set(id, {
      x: 38 + index * 78,
      y: height / 2 - 4,
    });
  });
  cycle.forEach((id, index) => {
    placed.set(id, {
      x: width - 58,
      y: 42 + (index * (height - 84)) / Math.max(1, cycle.length - 1),
    });
  });
  const graphNodes = [...before, ...cycle].map((id) => {
    const node = nodes.get(id);
    return {
      id,
      label: node?.name || id,
      code: node?.code || id.toUpperCase(),
      ...placed.get(id),
      conflict: cycleNodes.has(id),
    };
  });
  const graphEdges = assembly.constraints
    .filter((edge) => placed.has(edge.from) && placed.has(edge.to))
    .map((edge, index) => ({
      id: `edge-${index}`,
      ...edge,
      source: placed.get(edge.from),
      target: placed.get(edge.to),
      conflict: cycleNodes.has(edge.from) && cycleNodes.has(edge.to),
    }));
  return { ...analysis, graphNodes, graphEdges, width, height };
}

export function isPrecedenceSatisfied(partA, partB, assembly = ASSEMBLY) {
  return assembly.constraints.some((edge) => edge.from === partA && edge.to === partB);
}
