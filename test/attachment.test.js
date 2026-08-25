const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  chooseReleasePose,
  createAttachment,
  findReleaseZone,
  releasePoseOptions,
  resolveAttachment
} = require("../src/domain/attachment");

test("keeps normalized top-edge position after resize", () => {
  const anchor = createAttachment(
    { x: 100, y: 100, width: 400, height: 300 },
    "top",
    0.25,
    "sit"
  );

  assert.deepEqual(
    resolveAttachment(anchor, { x: 200, y: 80, width: 800, height: 500 }).point,
    { x: 400, y: 80 }
  );
});

test("stores target identity, clamps t, and refreshes the last target rectangle", () => {
  const target = {
    source: "window",
    id: "window:42",
    hwnd: 42,
    rect: { x: 10, y: 20, width: 100, height: 80 }
  };
  const anchor = createAttachment(target, "right", 2, "wall-grab");
  const resolved = resolveAttachment(anchor, { x: -50, y: 40, width: 200, height: 120 });

  assert.deepEqual(anchor.target, { source: "window", id: "window:42", hwnd: 42 });
  assert.deepEqual(anchor.lastRect, target.rect);
  assert.equal(anchor.t, 1);
  assert.deepEqual(resolved.point, { x: 150, y: 160 });
  assert.deepEqual(resolved.anchor.lastRect, { x: -50, y: 40, width: 200, height: 120 });
  assert.equal(Object.isFrozen(resolved.anchor.lastRect), true);
});

test("resolves every edge from the current target rectangle", () => {
  const rect = { x: 20, y: 30, width: 200, height: 100 };

  assert.deepEqual(resolveAttachment(createAttachment(rect, "left", 0.5, "wall-climb"), rect).point,
    { x: 20, y: 80 });
  assert.deepEqual(resolveAttachment(createAttachment(rect, "bottom", 0.75, "hang"), rect).point,
    { x: 170, y: 130 });
});

test("rejects invalid rectangles and edge-pose combinations", () => {
  assert.throws(
    () => createAttachment({ x: 0, y: 0, width: 0, height: 20 }, "top", 0.5, "sit"),
    /positive area/
  );
  assert.throws(
    () => createAttachment({ x: 0, y: 0, width: 20, height: 20 }, "top", 0.5, "hang"),
    /pose/
  );
  assert.throws(
    () => resolveAttachment(
      createAttachment({ x: 0, y: 0, width: 20, height: 20 }, "top", 0.5, "sit"),
      { x: 0, y: 0, width: Number.NaN, height: 20 }
    ),
    /finite rectangle/
  );
});

test("exposes only the exact release poses and accepts an injected deterministic choice", () => {
  assert.deepEqual(releasePoseOptions("top"), ["sit", "prone", "legs-dangle"]);
  assert.deepEqual(releasePoseOptions("side"), ["wall-grab", "wall-climb"]);
  assert.deepEqual(releasePoseOptions("bottom"), ["hang"]);
  assert.deepEqual(releasePoseOptions("open"), ["land", "crawl"]);
  assert.equal(chooseReleasePose("top", choices => choices[2]), "legs-dangle");
  assert.throws(() => chooseReleasePose("bottom", () => "sit"), /allowed/);
});

test("finds the nearest edge release zone or reports open space", () => {
  const obstacles = [
    { source: "window", id: "window:1", rect: { x: 100, y: 100, width: 300, height: 200 } },
    { source: "window", id: "window:2", rect: { x: 500, y: 100, width: 200, height: 200 } }
  ];

  const side = findReleaseZone({ x: 503, y: 180 }, obstacles, 12);
  assert.equal(side.zone, "side");
  assert.equal(side.edge, "left");
  assert.equal(side.target.id, "window:2");
  assert.equal(side.t, 0.4);
  assert.deepEqual(findReleaseZone({ x: 450, y: 250 }, obstacles, 12), { zone: "open" });
});
