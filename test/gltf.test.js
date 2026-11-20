import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gltf = JSON.parse(readFileSync(new URL("../public/arm.gltf", import.meta.url), "utf8"));
const binary = Buffer.from(gltf.buffers[0].uri.split(",")[1], "base64");

function accessorData(index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  const count = accessor.count * width;
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const result = [];
  for (let item = 0; item < count; item += 1) {
    result.push(
      accessor.componentType === 5126
        ? binary.readFloatLE(offset + item * 4)
        : binary.readUInt16LE(offset + item * 2),
    );
  }
  return result;
}

test("glTF buffer and buffer views stay inside the declared payload", () => {
  assert.equal(binary.byteLength, gltf.buffers[0].byteLength);
  for (const view of gltf.bufferViews) {
    assert.ok(view.byteOffset >= 0);
    assert.ok(view.byteOffset + view.byteLength <= binary.byteLength);
  }
});

test("skinned mesh weights are normalized", () => {
  const weights = accessorData(3);
  for (let vertex = 0; vertex < weights.length; vertex += 4) {
    const sum =
      weights[vertex] +
      weights[vertex + 1] +
      weights[vertex + 2] +
      weights[vertex + 3];
    assert.ok(Math.abs(sum - 1) < 1e-6);
  }
});

test("both animation inputs declare the required 0 to 4 second bounds", () => {
  assert.equal(gltf.animations.length, 2);
  for (const animation of gltf.animations) {
    const input = gltf.accessors[animation.samplers[0].input];
    assert.deepEqual(input.min, [0]);
    assert.deepEqual(input.max, [4]);
  }
  assert.deepEqual(
    gltf.animations.map((animation) => animation.name),
    ["WristTwist240", "ElbowBend110"],
  );
});

test("the skin references four joints and four inverse bind matrices", () => {
  assert.deepEqual(gltf.skins[0].joints, [0, 1, 2, 3]);
  assert.equal(gltf.accessors[gltf.skins[0].inverseBindMatrices].count, 4);
  assert.equal(gltf.accessors[0].count, 674);
  assert.equal(gltf.accessors[5].count, 4032);
});
