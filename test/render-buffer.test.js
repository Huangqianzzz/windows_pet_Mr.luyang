const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRenderBuffer } = require("../src/runtime/render-buffer");

test("centers the first body in integer native bounds while retaining fractional local offsets", () => {
  const placement = createRenderBuffer({ margin: 96 }).place({
    x: 100.45, y: 100.2, width: 192, height: 208
  });

  assert.deepEqual(placement.hostBounds, { x: 4, y: 4, width: 384, height: 400 });
  assert.equal(placement.localX, 96.45);
  assert.equal(placement.localY, 96.2);
  assert.equal(placement.recentered, true);
});

test("subpixel movement stays inside one native host window", () => {
  const buffer = createRenderBuffer({ margin: 96, safeInset: 32 });
  const first = buffer.place({ x: 100, y: 100, width: 192, height: 208 });
  const next = buffer.place({ x: 100.45, y: 100.2, width: 192, height: 208 });

  assert.deepEqual(next.hostBounds, first.hostBounds);
  assert.equal(next.recentered, false);
  assert.ok(Math.abs(next.localX - first.localX - 0.45) < 1e-9);
  assert.ok(Math.abs(next.localY - first.localY - 0.2) < 1e-9);
});

test("recenters inside the safety boundary and for every drag update", () => {
  const body = { x: 100, y: 100, width: 20, height: 30 };
  for (const side of ["left", "top", "right", "bottom"]) {
    const buffer = createRenderBuffer({ margin: 96, safeInset: 32 });
    const first = buffer.place(body);
    const edge = { ...body };
    if (side === "left") edge.x = first.hostBounds.x + 31.999;
    if (side === "top") edge.y = first.hostBounds.y + 31.999;
    if (side === "right") edge.x = first.hostBounds.x + first.hostBounds.width - body.width - 31.999;
    if (side === "bottom") edge.y = first.hostBounds.y + first.hostBounds.height - body.height - 31.999;
    assert.equal(buffer.place(edge).recentered, true);
  }
  const threshold = createRenderBuffer({ margin: 96, safeInset: 32 });
  const first = threshold.place(body);
  assert.equal(threshold.place({ ...body, x: first.hostBounds.x + 32, y: first.hostBounds.y + 32 }).recentered, false);
  const buffer = createRenderBuffer({ margin: 96, safeInset: 32 });
  buffer.place(body);
  assert.equal(buffer.place({ ...body, x: 130, y: 140 }, { dragging: true }).recentered, true);
  assert.equal(buffer.place({ ...body, x: 131, y: 141 }, { dragging: true }).recentered, true);
});

test("resizing recenters without changing the body's global top-left anchor", () => {
  const buffer = createRenderBuffer({ margin: 96 });
  const body = { x: 100.45, y: 100.2, width: 192, height: 208 };
  buffer.place(body);
  const resized = buffer.place({ ...body, width: 384, height: 416 });

  assert.equal(resized.recentered, true);
  assert.equal(resized.hostBounds.width, 576);
  assert.equal(resized.hostBounds.height, 608);
  assert.equal(resized.hostBounds.x + resized.localX, body.x);
  assert.equal(resized.hostBounds.y + resized.localY, body.y);
});

test("rejects invalid buffer configuration and body geometry", () => {
  assert.throws(() => createRenderBuffer({ margin: 0 }), /margin/);
  assert.throws(() => createRenderBuffer({ safeInset: 97 }), /safeInset/);
  assert.throws(() => createRenderBuffer().place({ x: 0, y: 0, width: 0, height: 1 }), /body/);
});
