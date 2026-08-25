const { test } = require("node:test");
const assert = require("node:assert/strict");

function intersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function contains(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function assertSafePlacement(result, faceBox, petRect, workArea, pointer) {
  const faceRect = {
    x: petRect.x + faceBox.x,
    y: petRect.y + faceBox.y,
    width: faceBox.width,
    height: faceBox.height
  };
  assert.ok(result.rect.width > 0);
  assert.ok(result.rect.height > 0);
  assert.ok(result.rect.x >= workArea.x);
  assert.ok(result.rect.y >= workArea.y);
  assert.ok(result.rect.x + result.rect.width <= workArea.x + workArea.width);
  assert.ok(result.rect.y + result.rect.height <= workArea.y + workArea.height);
  assert.equal(intersectionArea(result.rect, faceRect), 0);
  if (pointer) assert.equal(contains(result.rect, pointer), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rect), true);
  assert.equal(Object.isFrozen(result.pointer), true);
  assert.equal(Object.isFrozen(result.pointer.tip), true);
}

test("places a face-safe bubble at every screen corner from 100% through 200% scale", () => {
  const { placeBubble } = require("../src/domain/bubble-placement");
  const workArea = { x: -100, y: 50, width: 1200, height: 800 };

  for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
    const width = 120 * scale;
    const height = 160 * scale;
    const positions = [
      { x: workArea.x, y: workArea.y },
      { x: workArea.x + workArea.width - width, y: workArea.y },
      { x: workArea.x, y: workArea.y + workArea.height - height },
      { x: workArea.x + workArea.width - width, y: workArea.y + workArea.height - height }
    ];
    for (const position of positions) {
      const petRect = { ...position, width, height };
      const faceBox = { x: 35 * scale, y: 12 * scale, width: 50 * scale, height: 46 * scale };
      const result = placeBubble({
        faceBox,
        petRect,
        bubbleSize: { width: 240, height: 92 },
        workArea
      });
      assertSafePlacement(result, faceBox, petRect, workArea);
    }
  }
});

test("avoids the mouse pointer without sacrificing face safety", () => {
  const { placeBubble } = require("../src/domain/bubble-placement");
  const workArea = { x: 0, y: 0, width: 900, height: 700 };
  const petRect = { x: 340, y: 260, width: 160, height: 220 };
  const faceBox = { x: 45, y: 18, width: 70, height: 62 };
  const pointer = { x: 280, y: 190 };

  const result = placeBubble({
    faceBox,
    petRect,
    bubbleSize: { width: 220, height: 90 },
    workArea,
    pointer
  });

  assertSafePlacement(result, faceBox, petRect, workArea, pointer);
});

test("shrinks an oversized bubble into the largest available face-safe region", () => {
  const { placeBubble } = require("../src/domain/bubble-placement");
  const workArea = { x: 0, y: 0, width: 240, height: 180 };
  const petRect = { x: 90, y: 35, width: 80, height: 120 };
  const faceBox = { x: 15, y: 20, width: 50, height: 55 };

  const result = placeBubble({
    faceBox,
    petRect,
    bubbleSize: { width: 800, height: 600 },
    workArea
  });

  assert.ok(result.rect.width < 800 || result.rect.height < 600);
  assertSafePlacement(result, faceBox, petRect, workArea);
});

test("rejects malformed placement inputs instead of returning unsafe geometry", () => {
  const { placeBubble } = require("../src/domain/bubble-placement");
  const valid = {
    faceBox: { x: 1, y: 1, width: 10, height: 10 },
    petRect: { x: 0, y: 0, width: 20, height: 20 },
    bubbleSize: { width: 20, height: 10 },
    workArea: { x: 0, y: 0, width: 100, height: 100 }
  };

  assert.throws(() => placeBubble({ ...valid, bubbleSize: { width: 0, height: 10 } }), /bubbleSize/);
  assert.throws(() => placeBubble({ ...valid, pointer: { x: Number.NaN, y: 0 } }), /pointer/);
});
