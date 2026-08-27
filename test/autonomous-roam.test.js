const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAutonomousRoam } = require("../src/runtime/autonomous-roam");

test("autonomous roam alternates deterministic idle and crawl phases", () => {
  const roam = createAutonomousRoam({
    random: () => 0,
    idleDurationMs: [1000, 1000],
    crawlDurationMs: [2000, 2000],
    speed: 20
  });

  assert.deepEqual(roam.tick(500, { enabled: true, mode: "idle" }), { kind: "none" });
  assert.deepEqual(roam.tick(500, { enabled: true, mode: "idle" }), {
    kind: "start",
    direction: "left"
  });
  assert.deepEqual(roam.tick(100, { enabled: true, mode: "crawling" }), {
    kind: "move",
    direction: "left",
    dx: -2,
    dy: 0
  });

  assert.equal(roam.blocked(), "right");
  assert.deepEqual(roam.tick(100, { enabled: true, mode: "crawling" }), {
    kind: "move",
    direction: "right",
    dx: 2,
    dy: 0
  });
  assert.deepEqual(roam.tick(1800, { enabled: true, mode: "crawling" }), { kind: "stop" });
});

test("autonomous roam pauses for interactions and stops when disabled", () => {
  const roam = createAutonomousRoam({
    random: () => 0.75,
    idleDurationMs: [100, 100],
    crawlDurationMs: [1000, 1000],
    speed: 30
  });

  assert.deepEqual(roam.tick(100, { enabled: true, mode: "idle" }), {
    kind: "start",
    direction: "right"
  });
  assert.deepEqual(roam.tick(900, { enabled: true, mode: "attached" }), { kind: "none" });
  assert.deepEqual(roam.tick(100, { enabled: true, mode: "crawling" }), {
    kind: "move",
    direction: "right",
    dx: 3,
    dy: 0
  });
  assert.deepEqual(roam.tick(16, { enabled: false, mode: "crawling" }), { kind: "stop" });
  assert.deepEqual(roam.tick(1000, { enabled: false, mode: "idle" }), { kind: "none" });
});

test("autonomous roam rejects invalid timing and tick inputs", () => {
  assert.throws(() => createAutonomousRoam({ speed: 0 }), /speed/);
  assert.throws(() => createAutonomousRoam({ idleDurationMs: [1000, 500] }), /idleDurationMs/);
  const roam = createAutonomousRoam();
  assert.throws(() => roam.tick(-1, { enabled: true, mode: "idle" }), /dtMs/);
  assert.throws(() => roam.tick(16, null), /context/);
  assert.equal(roam.blocked(), false);
});
