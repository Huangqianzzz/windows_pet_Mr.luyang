const { test } = require("node:test");
const assert = require("node:assert/strict");
const { clampRect, intersects, nearestEdge } = require("../src/domain/geometry");

test("intersects recognizes overlapping rectangles but not touching rectangles", () => {
  assert.equal(
    intersects(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 9, y: 9, width: 10, height: 10 }
    ),
    true
  );
  assert.equal(
    intersects(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 }
    ),
    false
  );
});

test("clampRect keeps a rectangle within its bounds", () => {
  assert.deepEqual(
    clampRect(
      { x: -20, y: 180, width: 40, height: 30 },
      { x: 0, y: 0, width: 200, height: 200 }
    ),
    { x: 0, y: 170, width: 40, height: 30 }
  );
});

test("clampRect anchors oversized rectangles to the bounds origin", () => {
  assert.deepEqual(
    clampRect(
      { x: 150, y: -50, width: 300, height: 250 },
      { x: 0, y: 0, width: 200, height: 200 }
    ),
    { x: 0, y: 0, width: 300, height: 250 }
  );
});

test("nearestEdge classifies top, side, bottom, and none", () => {
  const rect = { x: 100, y: 100, width: 300, height: 200 };

  assert.deepEqual(nearestEdge({ x: 220, y: 104 }, rect, 12), { edge: "top", t: 0.4 });
  assert.deepEqual(nearestEdge({ x: 396, y: 180 }, rect, 12), { edge: "right", t: 0.4 });
  assert.deepEqual(nearestEdge({ x: 250, y: 296 }, rect, 12), { edge: "bottom", t: 0.5 });
  assert.equal(nearestEdge({ x: 250, y: 180 }, rect, 12), null);
});
