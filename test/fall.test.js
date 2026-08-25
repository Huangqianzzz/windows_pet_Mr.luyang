const { test } = require("node:test");
const assert = require("node:assert/strict");
const { stepFall } = require("../src/domain/fall");

test("integrates gravity in DIP per second squared", () => {
  const body = { x: 10, y: 20, width: 10, height: 10, vx: 30, vy: 0 };

  assert.deepEqual(stepFall(body, [], 100, { gravity: 1000 }), {
    body: { x: 13, y: 25, width: 10, height: 10, vx: 30, vy: 100 },
    landing: null
  });
  assert.deepEqual(body, { x: 10, y: 20, width: 10, height: 10, vx: 30, vy: 0 });
});

test("uses swept AABB so a 100 ms step cannot tunnel through a thin edge", () => {
  const ledge = {
    source: "window",
    id: "window:thin",
    rect: { x: 0, y: 50, width: 100, height: 1 }
  };
  const result = stepFall(
    { x: 10, y: 0, width: 10, height: 10, vx: 0, vy: 1000 },
    [ledge],
    100,
    { gravity: 0 }
  );

  assert.deepEqual(result.body, { x: 10, y: 40, width: 10, height: 10, vx: 0, vy: 0 });
  assert.equal(result.landing, ledge);
});

test("lands on the nearest surface below regardless of obstacle order", () => {
  const far = { source: "taskbar", id: "far", rect: { x: 0, y: 90, width: 100, height: 20 } };
  const near = { source: "window", id: "near", rect: { x: 0, y: 40, width: 100, height: 20 } };

  const result = stepFall(
    { x: 10, y: 0, width: 10, height: 10, vx: 0, vy: 1000 },
    [far, near],
    100,
    { gravity: 0 }
  );

  assert.equal(result.landing, near);
  assert.equal(result.body.y, 30);
});

test("tests horizontal overlap at time of impact", () => {
  const ledge = { source: "window", id: "moving", rect: { x: 45, y: 50, width: 10, height: 5 } };

  const result = stepFall(
    { x: 0, y: 0, width: 10, height: 10, vx: 1000, vy: 1000 },
    [ledge],
    100,
    { gravity: 0 }
  );

  assert.equal(result.landing, ledge);
  assert.deepEqual(result.body, { x: 40, y: 40, width: 10, height: 10, vx: 1000, vy: 0 });
});

test("uses the quadratic gravity TOI for horizontal overlap at the impact boundary", () => {
  const ledge = { source: "window", id: "gravity", rect: { x: 55, y: 135, width: 10, height: 5 } };

  const result = stepFall(
    { x: 0, y: 0, width: 10, height: 10, vx: 100, vy: 0 },
    [ledge],
    1000,
    { gravity: 1000 }
  );

  assert.equal(result.landing, ledge);
  assert.deepEqual(result.body, { x: 50, y: 125, width: 10, height: 10, vx: 100, vy: 0 });
});

test("resolves a slight initial downward overlap at time zero", () => {
  const support = { source: "window", id: "overlap", rect: { x: 0, y: 20, width: 100, height: 10 } };

  const result = stepFall(
    { x: 10, y: 9.5, width: 10, height: 11, vx: 0, vy: 0 },
    [support],
    16,
    { gravity: 1000 }
  );

  assert.equal(result.landing, support);
  assert.deepEqual(result.body, { x: 10, y: 9, width: 10, height: 11, vx: 0, vy: 0 });
});

test("does not pull a body fully below a platform back onto its top", () => {
  const platform = { source: "window", id: "above-body", rect: { x: 0, y: 20, width: 100, height: 10 } };

  const result = stepFall(
    { x: 10, y: 21, width: 10, height: 10, vx: 0, vy: 0 },
    [platform],
    100,
    { gravity: 1000 }
  );

  assert.equal(result.landing, null);
  assert.equal(result.body.y, 26);
});

test("ignores surfaces outside the downward motion path", () => {
  const obstacles = [
    { source: "window", id: "above", rect: { x: 0, y: -20, width: 100, height: 5 } },
    { source: "window", id: "beside", rect: { x: 100, y: 30, width: 20, height: 5 } },
    { source: "window", id: "too-far", rect: { x: 0, y: 200, width: 100, height: 5 } }
  ];

  const result = stepFall(
    { x: 10, y: 0, width: 10, height: 10, vx: 0, vy: 500 },
    obstacles,
    100,
    { gravity: 0 }
  );

  assert.equal(result.landing, null);
  assert.equal(result.body.y, 50);
});

test("keeps a body resting on an unchanged support", () => {
  const support = { source: "window", id: "support", rect: { x: 0, y: 20, width: 100, height: 20 } };
  const result = stepFall(
    { x: 10, y: 10, width: 10, height: 10, vx: 0, vy: 0 },
    [support],
    100,
    { gravity: 1000 }
  );

  assert.equal(result.landing, support);
  assert.equal(result.body.y, 10);
  assert.equal(result.body.vy, 0);
});

test("rejects invalid bodies, time steps, gravity, and obstacle rectangles", () => {
  const body = { x: 0, y: 0, width: 10, height: 10, vx: 0, vy: 0 };

  assert.throws(() => stepFall({ ...body, width: 0 }, [], 16), /positive area/);
  assert.throws(() => stepFall(body, [], -1), /time step/);
  assert.throws(() => stepFall(body, [], 16, { gravity: Number.NaN }), /gravity/);
  assert.throws(
    () => stepFall(body, [{ rect: { x: 0, y: 20, width: 0, height: 2 } }], 16),
    /positive area/
  );
});
