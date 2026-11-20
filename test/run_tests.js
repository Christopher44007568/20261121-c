// Validation harness: unequal-length boundaries, reversed winding,
// concave notch, interactive-style anchor moves, glTF output.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from '../src/mesh.js';
import * as S from '../src/stitch.js';
import * as G from '../src/gltf.js';
import * as F from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  PASS ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}

function corners(w, h, o) {
  return [
    [o[0], o[1], o[2]],
    [o[0] + w, o[1], o[2]],
    [o[0] + w, o[1] + h, o[2]],
    [o[0], o[1] + h, o[2]],
  ];
}

function validateStitch(label, meshA, meshB, anchors, extra) {
  console.log(label);
  const loopsA = M.extractBoundaryLoops(meshA);
  const loopsB = M.extractBoundaryLoops(meshB);
  check('single boundary loop per piece', loopsA.length === 1 && loopsB.length === 1,
    loopsA.length + '/' + loopsB.length);

  const res = S.stitch(meshA, loopsA[0], meshB, loopsB[0], anchors,
    extra && extra.closed ? { closed: true } : undefined);
  const dbg = res.debug;

  check('equal sample counts on both sides',
    dbg.sampleParamsA.length === dbg.sampleParamsB.length,
    dbg.sampleParamsA.length + ' vs ' + dbg.sampleParamsB.length);

  const inSpan = (p, span) => {
    const rel = (((p - span[0]) % 1) + 1) % 1;
    return rel <= span[1] - span[0] + 1e-9;
  };
  const cover = (vparams, sparams, span) => vparams.every((p) => {
    if (!inSpan(p, span)) return true;
    return sparams.some((s) => {
      const d = Math.abs((((s - p) % 1) + 1) % 1);
      return Math.min(d, 1 - d) < 1e-6;
    });
  });
  check('no unpaired vertices on piece A side',
    cover(dbg.vertexParamsA, dbg.sampleParamsA, dbg.spanA));
  check('no unpaired vertices on piece B side',
    cover(dbg.vertexParamsB, dbg.sampleParamsB, dbg.spanB));

  const seamGroup = res.groups[2];
  const seamStartFace = seamGroup.start / 3;
  const seamFaces = seamGroup.count / 3;
  let minDot = Infinity;
  for (let f = 0; f < seamFaces; f++) {
    const n = M.faceNormal(res, seamStartFace + f);
    const ref = dbg.quadRefs[dbg.seamFaceQuad[f]];
    const d = M.dot(n, ref);
    if (d < minDot) minDot = d;
  }
  check('no locally flipped seam faces (min dot > 0)', minDot > 0, 'minDot=' + minDot.toFixed(4));

  check('UVs finite', res.uvs.every(Number.isFinite));
  check('boundary ids preserved', (() => {
    const loops = [M.extractBoundaryLoops(meshA)[0], M.extractBoundaryLoops(meshB)[0]];
    const nA = meshA.positions.length / 3;
    return loops[0].vertices.every((v) => res.boundaryIds[v] === 1) &&
      loops[1].vertices.every((v) => res.boundaryIds[nA + v] === 2);
  })());

  const glb = G.buildGLB(res, { name: label });
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  check('GLB header valid', dv.getUint32(0, true) === 0x46546c67 && dv.getUint32(4, true) === 2);
  const jsonLen = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)));
  check('GLB has 3 named primitives',
    gltf.meshes[0].primitives.length === 3 &&
    gltf.materials.map((m) => m.name).join(',') === 'pieceA,pieceB,seam');
  check('GLB boundary identity extras',
    gltf.meshes[0].extras.boundaryIdAttribute === '_BOUNDARYID');

  if (extra && extra.outFile) {
    fs.writeFileSync(extra.outFile, glb);
    console.log('  wrote ' + extra.outFile + ' (' + glb.length + ' bytes)');
  }
  return res;
}

const outDir = path.join(__dirname, '..', 'output');
fs.mkdirSync(outDir, { recursive: true });

// Anchors along the two edges to be joined (A top edge, B bottom edge),
// given as corresponding pairs from right to left.
function edgeAnchors(A, B, ptsA, ptsB) {
  const loopsA = M.extractBoundaryLoops(A);
  const loopsB = M.extractBoundaryLoops(B);
  return F.cornerAnchors(A, loopsA[0], B, loopsB[0], ptsA, ptsB);
}

// Scenario 1: unequal boundary lengths and vertex counts.
{
  const A = F.makeClothPiece({ name: 'pieceA', width: 2.0, height: 1.0, nx: 8, ny: 5, origin: [0, 0, 0] });
  const B = F.makeClothPiece({ name: 'pieceB', width: 3.2, height: 1.0, nx: 13, ny: 5, origin: [0.4, 1.6, 0] });
  const anchors = edgeAnchors(A, B,
    [[2, 1, 0], [1, 1, 0], [0, 1, 0]],
    [[3.6, 1.6, 0], [2.0, 1.6, 0], [0.4, 1.6, 0]]);
  validateStitch('scenario1-unequal-lengths', A, B, anchors,
    { outFile: path.join(outDir, 'scenario1-unequal.glb') });
}

// Scenario 2: piece B wound in the opposite direction.
{
  const A = F.makeClothPiece({ name: 'pieceA', width: 2.0, height: 1.0, nx: 8, ny: 5, origin: [0, 0, 0] });
  const B = F.makeClothPiece({ name: 'pieceB', width: 2.6, height: 1.0, nx: 11, ny: 5, origin: [0.3, 1.6, 0], flipWinding: true });
  const anchors = edgeAnchors(A, B,
    [[2, 1, 0], [1, 1, 0], [0, 1, 0]],
    [[2.9, 1.6, 0], [1.6, 1.6, 0], [0.3, 1.6, 0]]);
  validateStitch('scenario2-reversed-boundary', A, B, anchors,
    { outFile: path.join(outDir, 'scenario2-reversed.glb') });
}

// Scenario 3: piece A has a concave notch on its top edge; anchors pin the
// notch corners to explicit mates on piece B.
{
  const A = F.makeClothPiece({
    name: 'pieceA', width: 2.4, height: 1.0, nx: 12, ny: 6, origin: [0, 0, 0],
    notch: { edge: 'top', from: 0.8, to: 1.4, depth: 0.5 },
  });
  const B = F.makeClothPiece({ name: 'pieceB', width: 2.4, height: 1.0, nx: 9, ny: 5, origin: [0.2, 1.6, 0] });
  const anchors = edgeAnchors(A, B,
    [[2.4, 1, 0], [1.4, 1, 0], [0.8, 1, 0], [0, 1, 0]],
    [[2.6, 1.6, 0], [1.8, 1.6, 0], [1.0, 1.6, 0], [0.2, 1.6, 0]]);
  validateStitch('scenario3-concave-notch', A, B, anchors,
    { outFile: path.join(outDir, 'scenario3-notch.glb') });
}

// Scenario 4: interactive-style anchor move on scenario 1 geometry.
{
  const A = F.makeClothPiece({ name: 'pieceA', width: 2.0, height: 1.0, nx: 8, ny: 5, origin: [0, 0, 0] });
  const B = F.makeClothPiece({ name: 'pieceB', width: 3.2, height: 1.0, nx: 13, ny: 5, origin: [0.4, 1.6, 0] });
  const anchors = edgeAnchors(A, B,
    [[2, 1, 0], [1, 1, 0], [0, 1, 0]],
    [[3.6, 1.6, 0], [2.0, 1.6, 0], [0.4, 1.6, 0]]);
  anchors[1].a = (anchors[1].a + 0.05) % 1; // drag anchor along boundary
  anchors[2].b = (anchors[2].b + 0.97) % 1;
  validateStitch('scenario4-anchor-moved', A, B, anchors, null);
}

// Scenario 5: closed-ring stitch of two full boundary loops.
{
  const oA = [0, 0, 0];
  const oB = [0.4, 1.6, 0];
  const A = F.makeClothPiece({ name: 'pieceA', width: 2.0, height: 1.0, nx: 8, ny: 5, origin: oA });
  const B = F.makeClothPiece({ name: 'pieceB', width: 3.2, height: 1.0, nx: 13, ny: 5, origin: oB });
  const loopsA = M.extractBoundaryLoops(A);
  const loopsB = M.extractBoundaryLoops(B);
  const anchors = F.cornerAnchors(A, loopsA[0], B, loopsB[0], corners(2.0, 1.0, oA), corners(3.2, 1.0, oB));
  validateStitch('scenario5-closed-ring', A, B, anchors,
    { closed: true, outFile: path.join(outDir, 'scenario5-closed.glb') });
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
