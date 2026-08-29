const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAutonomousRoam } = require("../src/runtime/autonomous-roam");

function sequence(values) {
  let index = 0;
  return () => {
    if (index >= values.length) throw new Error("unexpected random sample");
    return values[index++];
  };
}

test("autonomous roam samples idle, crawl, horizontal direction, then vertical target for a curved crawl", () => {
  const roam = createAutonomousRoam({
    random: sequence([0, 0, 0, 0]),
    idleDurationMs: [100, 100],
    crawlDurationMs: [2000, 2000],
    speed: 20
  });

  assert.deepEqual(roam.tick(100, { enabled: true, mode: "idle" }), {
    kind: "start",
    direction: "left"
  });
  assert.deepEqual(roam.tick(0, { enabled: true, mode: "crawling" }), { kind: "none" });

  const firstMove = roam.tick(100, { enabled: true, mode: "crawling" });
  const secondMove = roam.tick(100, { enabled: true, mode: "crawling" });
  assert.equal(firstMove.kind, "move");
  assert.equal(firstMove.direction, "left");
  assert.equal(firstMove.dx, -2);
  assert.notEqual(firstMove.dy, 0);
  assert.ok(Math.abs(firstMove.dy) <= Math.abs(firstMove.dx) * 0.4);
  assert.ok(Math.abs(secondMove.dy) > Math.abs(firstMove.dy));
  assert.ok(Math.abs(secondMove.dy) <= Math.abs(secondMove.dx) * 0.4);
});

test("autonomous roam clamps vertical interpolation for large ticks and stops at crawl expiry", () => {
  const roam = createAutonomousRoam({
    random: sequence([0, 0, 0.75, 1 - Number.EPSILON]),
    idleDurationMs: [1, 1],
    crawlDurationMs: [10_000, 10_000],
    speed: 30
  });

  assert.equal(roam.tick(1, { enabled: true, mode: "idle" }).kind, "start");
  const longMove = roam.tick(5_000, { enabled: true, mode: "crawling" });
  assert.equal(longMove.kind, "move");
  assert.ok(Number.isFinite(longMove.dy));
  assert.ok(Math.abs(longMove.dy) <= Math.abs(longMove.dx) * 0.4);

  const expiry = createAutonomousRoam({
    random: sequence([0, 0, 0, 0, 0]),
    idleDurationMs: [1, 1],
    crawlDurationMs: [100, 100],
    speed: 30
  });
  assert.equal(expiry.tick(1, { enabled: true, mode: "idle" }).kind, "start");
  assert.deepEqual(expiry.tick(100, { enabled: true, mode: "crawling" }), { kind: "stop" });
});

test("autonomous roam debounces reroutes for 450ms and cleared resets its temporary detour", () => {
  const roam = createAutonomousRoam({
    random: sequence([0, 0, 0, 0]),
    idleDurationMs: [1, 1],
    crawlDurationMs: [1000, 1000]
  });
  assert.equal(roam.tick(1, { enabled: true, mode: "idle" }).kind, "start");

  assert.equal(roam.blocked(100), "right");
  assert.equal(roam.blocked(100), false);
  assert.equal(roam.blocked(549), false);
  assert.equal(roam.blocked(550), "left");
  roam.cleared();
  assert.equal(roam.blocked(600), "right");
});

test("autonomous roam pauses for interactions, stops when disabled, and rejects invalid timing", () => {
  const roam = createAutonomousRoam({
    random: sequence([0.75, 0.75, 0.75, 0.75, 0.75]),
    idleDurationMs: [100, 100],
    crawlDurationMs: [1000, 1000],
    speed: 30
  });

  assert.equal(roam.tick(100, { enabled: true, mode: "idle" }).kind, "start");
  assert.deepEqual(roam.tick(900, { enabled: true, mode: "attached" }), { kind: "none" });
  assert.equal(roam.tick(100, { enabled: true, mode: "crawling" }).kind, "move");
  assert.deepEqual(roam.tick(16, { enabled: false, mode: "crawling" }), { kind: "stop" });
  assert.deepEqual(roam.tick(1000, { enabled: false, mode: "idle" }), { kind: "none" });

  assert.throws(() => createAutonomousRoam({ speed: 0 }), /speed/);
  assert.throws(() => createAutonomousRoam({ idleDurationMs: [1000, 500] }), /idleDurationMs/);
  assert.throws(() => roam.tick(-1, { enabled: true, mode: "idle" }), /dtMs/);
  assert.throws(() => roam.blocked(NaN), /nowMs/);
});
