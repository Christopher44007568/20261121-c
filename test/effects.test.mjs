import test from "node:test";
import assert from "node:assert/strict";
import {
  compileScene,
  effectMargins,
  filterMargin,
  shadowMargin,
} from "../src/effects.mjs";

test("effect margins include blur support, offsets and spread", () => {
  assert.equal(
    shadowMargin({ blur: 30, offsetX: 16, offsetY: 24, spread: 5 }),
    89,
  );
  assert.equal(filterMargin({ blur: 12 }), 37);
  assert.equal(
    filterMargin({ dropShadow: { blur: 10, offsetX: 5, offsetY: -3 } }),
    25,
  );
  assert.equal(effectMargins({ filter: { blur: 12, extraMargin: 4 } }).total, 41);
  assert.deepEqual(effectMargins({}), {
    shadow: 0,
    filter: 0,
    mask: 0,
    extra: 0,
    total: 0,
  });
});

test("compileScene publishes a conservative apron", () => {
  const scene = compileScene({
    width: 500,
    height: 400,
    background(ctx) {
      ctx.fillRect(0, 0, 500, 400);
    },
    ops: [
      {
        id: "shadow-and-blur",
        bounds: { x: 100, y: 80, width: 120, height: 70 },
        effects: {
          shadow: { blur: 10, offsetX: 4, offsetY: -3 },
          filter: { blur: 6 },
          mask: { kind: "linear" },
        },
        draw() {},
      },
    ],
  });

  assert.equal(scene.ops[0].margins.shadow, 24);
  assert.equal(scene.ops[0].margins.filter, 19);
  assert.equal(scene.ops[0].margins.mask, 0);
  assert.equal(scene.maxMargin, 45);
  assert.deepEqual(scene.ops[0].renderBounds, {
    x: 55,
    y: 35,
    width: 210,
    height: 160,
  });
  assert.equal(scene.hasMasks, true);
});

test("compileScene rejects invalid bounds", () => {
  assert.throws(
    () =>
      compileScene({
        width: 100,
        height: 100,
        background() {},
        ops: [{ bounds: { x: 0, y: 0, width: -1, height: 2 }, draw() {} }],
      }),
    /non-negative rectangle/,
  );
});
