// Validation cloth pieces: unequal lengths, reversed winding, concave notch.

import * as M from '../src/mesh.js';
import * as S from '../src/stitch.js';

// Rectangular grid patch in the z=0 plane.
// opts: { name, width, height, nx, ny, origin:[x,y,z], flipWinding,
//         notch: { edge:'top'|'bottom', from, to, depth } }
function makeClothPiece(opts) {
  const nx = opts.nx || 8;
  const ny = opts.ny || 5;
  const w = opts.width;
  const h = opts.height;
  const o = opts.origin || [0, 0, 0];
  const positions = [];
  const uvs = [];
  const idx = [];
  const inNotch = (x, y) => {
    if (!opts.notch) return false;
    const n = opts.notch;
    if (x <= n.from || x >= n.to) return false;
    return n.edge === 'top' ? y > h - n.depth : y < n.depth;
  };
  // grid vertices, skipping those strictly inside the notch
  const vid = new Map();
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx) * w;
      const y = (j / ny) * h;
      if (inNotch(x, y)) continue;
      vid.set(i + ',' + j, positions.length / 3);
      positions.push(o[0] + x, o[1] + y, o[2]);
      uvs.push(i / nx, j / ny);
    }
  }
  const faces = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v00 = vid.get(i + ',' + j);
      const v10 = vid.get((i + 1) + ',' + j);
      const v01 = vid.get(i + ',' + (j + 1));
      const v11 = vid.get((i + 1) + ',' + (j + 1));
      if (v00 === undefined || v10 === undefined || v01 === undefined || v11 === undefined) continue;
      if (opts.flipWinding) {
        faces.push(v00, v01, v11, v00, v11, v10);
      } else {
        faces.push(v00, v11, v01, v00, v10, v11);
      }
    }
  }
  return M.makeMesh(opts.name || 'piece', positions, uvs, faces);
}

// Corner anchor params for a loop: snap the four piece corners.
function cornerAnchors(meshA, loopA, meshB, loopB, cornersA, cornersB) {
  
  const anchors = [];
  for (let k = 0; k < cornersA.length; k++) {
    anchors.push({
      a: S.snapToLoop(meshA, loopA, cornersA[k]),
      b: S.snapToLoop(meshB, loopB, cornersB[k]),
    });
  }
  return anchors;
}

export { makeClothPiece, cornerAnchors };
