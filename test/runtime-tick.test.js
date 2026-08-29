const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runRuntimeTick } = require("../src/runtime/runtime-tick");

const body = { x: 10, y: 20, width: 30, height: 40, vx: 0, vy: 0 };
const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

test("runtime tick gives the same nowMs to blocked and applies one changed facing", () => {
  const calls = [];
  const controller = {
    tick(dtMs) { calls.push(["physics", dtMs]); },
    snapshot() { return { state: { mode: "crawling" }, body }; },
    moveCrawl(dx, dy, area) {
      calls.push(["move", dx, dy, area]);
      return { moved: false, fullyMoved: false, blockedAxes: ["x"] };
    },
    setCrawlDirection(direction) { calls.push(["face", direction]); }
  };
  const roam = {
    tick() { return { kind: "move", direction: "right", dx: 4, dy: 1 }; },
    blocked(nowMs) { calls.push(["blocked", nowMs]); return "left"; },
    cleared() { calls.push(["cleared"]); }
  };
  const screen = { getDisplayMatching() { return { workArea }; } };

  runRuntimeTick({ controller, roam, settings: { autonomousActivity: true }, screen, dtMs: 100, nowMs: 1234 });

  assert.deepEqual(calls, [
    ["physics", 100],
    ["move", 4, 1, workArea],
    ["blocked", 1234],
    ["face", "left"]
  ]);
});

test("runtime tick does not replay crawl animation while reroute is cooling down", () => {
  const calls = [];
  const controller = {
    tick() {},
    snapshot() { return { state: { mode: "crawling" }, body }; },
    moveCrawl() { return { moved: false, fullyMoved: false, blockedAxes: ["x"] }; },
    setCrawlDirection(direction) { calls.push(direction); }
  };
  const roam = {
    tick() { return { kind: "move", direction: "right", dx: 4, dy: 1 }; },
    blocked() { return false; },
    cleared() {}
  };
  const screen = { getDisplayMatching() { return { workArea }; } };

  runRuntimeTick({ controller, roam, settings: { autonomousActivity: true }, screen, dtMs: 16, nowMs: 200 });
  runRuntimeTick({ controller, roam, settings: { autonomousActivity: true }, screen, dtMs: 16, nowMs: 216 });
  assert.deepEqual(calls, []);
});

test("runtime tick clears only a fully completed move and ignores vertical-only blocking", () => {
  const calls = [];
  const results = [
    { moved: true, fullyMoved: true, blockedAxes: [] },
    { moved: true, fullyMoved: false, blockedAxes: ["y"] }
  ];
  const controller = {
    tick() {},
    snapshot() { return { state: { mode: "crawling" }, body }; },
    moveCrawl() { return results.shift(); },
    setCrawlDirection() { calls.push("face"); }
  };
  const roam = {
    tick() { return { kind: "move", direction: "right", dx: 4, dy: 1 }; },
    blocked() { calls.push("blocked"); return "left"; },
    cleared() { calls.push("cleared"); }
  };
  const screen = { getDisplayMatching() { return { workArea }; } };

  runRuntimeTick({ controller, roam, settings: { autonomousActivity: true }, screen, dtMs: 16, nowMs: 10 });
  runRuntimeTick({ controller, roam, settings: { autonomousActivity: true }, screen, dtMs: 16, nowMs: 26 });
  assert.deepEqual(calls, ["cleared"]);
});

test("runtime tick forwards a disabled autonomous setting without moving", () => {
  const controller = {
    tick() {},
    snapshot() { return { state: { mode: "idle" }, body: { x: 0, y: 0, width: 1, height: 1 } }; }
  };
  let context;
  const roam = { tick(_dtMs, value) { context = value; return { kind: "none" }; } };
  runRuntimeTick({
    controller,
    roam,
    settings: { autonomousActivity: false },
    screen: {},
    dtMs: 16,
    nowMs: 16
  });
  assert.deepEqual(context, { enabled: false, mode: "idle" });
});

test("main runtime owns one autonomous scheduler and supplies its monotonic tick time", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(main, /createAutonomousRoam/);
  assert.match(main, /autonomousRoam\s*=\s*createAutonomousRoam\(\)/);
  assert.match(main, /let runtimeNowMs;/);
  assert.match(main, /runtimeNowMs\s*\+=\s*dtMs/);
  assert.match(main, /runRuntimeTick\(\{[\s\S]*nowMs:\s*runtimeNowMs/);
  assert.match(main, /poseAnchorsFromManifest/);
  assert.match(main, /poseAnchors:\s*poseAnchorsFromManifest\(animationBootstrap\.manifest/);
  assert.match(main, /backgroundPaused:\s*runtimePaused/);
  assert.match(main, /refreshObstacles:\s*createTransitionCommand\(syncControllerObstacles\)/);
});
