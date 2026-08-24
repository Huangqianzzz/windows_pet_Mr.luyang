const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ObstacleIndex } = require("../src/runtime/obstacle-index");

function obstacle(source, id, x) {
  return { source, id, rect: { x, y: 20, width: 30, height: 40 } };
}

test("replace atomically swaps one provider without disturbing the others", () => {
  const index = new ObstacleIndex();
  index.replace("windows", [obstacle("window", "window:1", 10)]);
  index.replace("taskbars", [obstacle("taskbar", "taskbar:primary", 0)]);
  index.replace("windows", [obstacle("window", "window:2", 50)]);

  assert.deepEqual(index.snapshot(), [
    obstacle("window", "window:2", 50),
    obstacle("taskbar", "taskbar:primary", 0)
  ]);
});

test("replace clones input and snapshot returns deeply frozen plain data", () => {
  const index = new ObstacleIndex();
  const input = obstacle("window", "window:1", 10);
  input.metadata = { native: "must-not-cross-runtime-boundary" };
  index.replace("windows", [input]);
  input.rect.x = 999;

  const snapshot = index.snapshot();

  assert.equal(snapshot[0].rect.x, 10);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot[0]), true);
  assert.equal(Object.isFrozen(snapshot[0].rect), true);
  assert.equal(Object.getPrototypeOf(snapshot[0]), Object.prototype);
  assert.equal(Object.getPrototypeOf(snapshot[0].rect), Object.prototype);
  assert.equal("metadata" in snapshot[0], false);
});

test("replace rejects non-integer and zero-area rectangles", () => {
  const index = new ObstacleIndex();

  assert.throws(
    () => index.replace("windows", [obstacle("window", "window:1", 1.5)]),
    /integer rectangle/
  );
  assert.throws(
    () => index.replace("windows", [
      { source: "window", id: "window:1", rect: { x: 0, y: 0, width: 0, height: 10 } }
    ]),
    /positive area/
  );
  assert.deepEqual(index.snapshot(), []);
});
