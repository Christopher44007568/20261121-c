// Minimal glTF 2.0 binary (GLB) writer for the stitched preview mesh.
// Dependency-free (Uint8Array/DataView): runs in Node and the browser.
// Emits one mesh with one primitive per group (pieceA / pieceB / seam),
// POSITION + TEXCOORD_0 + _BOUNDARYID attributes, and named materials.

const COMP_TYPE = { FLOAT: 5126, UINT: 5125 };

function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function padChunk(u8, padByte) {
  const pad = (4 - (u8.length % 4)) % 4;
  if (!pad) return u8;
  const out = new Uint8Array(u8.length + pad);
  out.set(u8);
  out.fill(padByte, u8.length);
  return out;
}

// result: { positions, uvs, boundaryIds, faces, groups }
// options: { name } -> Uint8Array GLB
export function buildGLB(result, options) {
  const opts = options || {};
  const binChunks = [];
  let byteOffset = 0;
  const bufferViews = [];
  const accessors = [];

  function pushAccessor(data, comps, type, count, target, minMax) {
    const buf = new ArrayBuffer(data.length * 4);
    const view = new DataView(buf);
    for (let i = 0; i < data.length; i++) {
      if (comps === COMP_TYPE.FLOAT) view.setFloat32(i * 4, data[i], true);
      else view.setUint32(i * 4, data[i], true);
    }
    let u8 = new Uint8Array(buf);
    const bv = { buffer: 0, byteOffset, byteLength: u8.length };
    if (target) bv.target = target;
    bufferViews.push(bv);
    binChunks.push(u8);
    byteOffset += u8.length;
    const pad = (4 - (byteOffset % 4)) % 4;
    if (pad) {
      binChunks.push(new Uint8Array(pad));
      byteOffset += pad;
    }
    const acc = { bufferView: bufferViews.length - 1, componentType: comps, count, type };
    if (minMax) {
      acc.min = minMax.min;
      acc.max = minMax.max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  }

  const n = result.positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = result.positions[3 * i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const posAcc = pushAccessor(result.positions, COMP_TYPE.FLOAT, 'VEC3', n, 34962, { min, max });
  const uvAcc = pushAccessor(result.uvs, COMP_TYPE.FLOAT, 'VEC2', n, 34962);
  const bidAcc = pushAccessor(result.boundaryIds, COMP_TYPE.FLOAT, 'SCALAR', n, 34962);

  const materials = [
    { name: 'pieceA', color: [0.65, 0.78, 0.95, 1] },
    { name: 'pieceB', color: [0.95, 0.75, 0.6, 1] },
    { name: 'seam', color: [0.35, 0.85, 0.55, 1] },
  ];
  const primitives = [];
  result.groups.forEach((g, gi) => {
    const idx = result.faces.slice(g.start, g.start + g.count);
    const idxAcc = pushAccessor(idx, COMP_TYPE.UINT, 'SCALAR', idx.length, 34963);
    primitives.push({
      attributes: { POSITION: posAcc, TEXCOORD_0: uvAcc, _BOUNDARYID: bidAcc },
      indices: idxAcc,
      material: gi,
      mode: 4,
    });
  });

  const gltf = {
    asset: { version: '2.0', generator: 'boundary-stitch-preview' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: opts.name || 'stitched' }],
    meshes: [{
      name: opts.name || 'stitched',
      primitives,
      extras: {
        boundaryIdentity: result.groups.map((g) => g.name),
        boundaryIdAttribute: '_BOUNDARYID',
        boundaryIdMeaning: { 0: 'interior', 1: 'pieceA seam loop', 2: 'pieceB seam loop' },
      },
    }],
    materials: materials.map((m) => ({
      name: m.name,
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: 0, roughnessFactor: 0.9 },
    })),
    bufferViews,
    accessors,
    buffers: [{ byteLength: byteOffset }],
  };

  const jsonU8 = padChunk(new TextEncoder().encode(JSON.stringify(gltf)), 0x20);
  const binU8 = padChunk(concat(binChunks), 0);
  const total = 12 + 8 + jsonU8.length + 8 + binU8.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonU8.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  u8.set(jsonU8, 20);
  const bo = 20 + jsonU8.length;
  dv.setUint32(bo, binU8.length, true);
  dv.setUint32(bo + 4, 0x004e4942, true); // 'BIN'
  u8.set(binU8, bo + 8);
  return u8;
}
