const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runRuntimeTick } = require("../src/runtime/runtime-tick");

test("runtime tick advances physics and applies autonomous crawl intents", () => {
  const calls = [];
  const body = { x: 10, y: 20, width: 30, height: 40, vx: 0, vy: 0 };
  let mode = "idle";
  const intents = [
    { kind: "start", direction: "right" },
    { kind: "move", direction: "right", dx: 4, dy: 0 },
    { kind: "stop" }
  ];
  const controller = {
    tick(dtMs) { calls.push(["physics", dtMs]); },
    snapshot() { return { state: { mode }, body }; },
    startCrawl(direction) { calls.push(["start", direction]); mode = "crawling"; return true; },
    moveCrawl(dx, dy, workArea) {
      calls.push(["move", dx, dy, workArea]);
      return { moved: false, blocked: true };
    },
    stopCrawl() { calls.push(["stop"]); mode = "idle"; return true; },
    setCrawlDirection(direction) { calls.push(["face", direction]); return true; }
  };
  const roam = {
    tick(dtMs, context) {
      calls.push(["roam", dtMs, context]);
      return intents.shift();
    },
    blocked() { calls.push(["blocked"]); return "left"; }
  };
  const screen = {
    getDisplayMatching(rect) {
      calls.push(["display", rect]);
      return { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
    }
  };

  for (let index = 0; index < 3; index += 1) {
    runRuntimeTick({ controller, roam, settings: { autonomousActivity: true }, screen, dtMs: 100 });
  }

  assert.deepEqual(calls, [
    ["physics", 100],
    ["roam", 100, { enabled: true, mode: "idle" }],
    ["start", "right"],
    ["physics", 100],
    ["roam", 100, { enabled: true, mode: "crawling" }],
    ["display", body],
    ["move", 4, 0, { x: 0, y: 0, width: 1920, height: 1040 }],
    ["blocked"],
    ["face", "left"],
    ["physics", 100],
    ["roam", 100, { enabled: true, mode: "crawling" }],
    ["stop"]
  ]);
});

test("runtime tick forwards a disabled autonomous setting without moving", () => {
  const controller = {
    tick() {},
    snapshot() { return { state: { mode: "idle" }, body: { x: 0, y: 0, width: 1, height: 1 } }; }
  };
  let context;
  const roam = {
    tick(_dtMs, value) { context = value; return { kind: "none" }; }
  };
  runRuntimeTick({
    controller,
    roam,
    settings: { autonomousActivity: false },
    screen: {},
    dtMs: 16
  });
  assert.deepEqual(context, { enabled: false, mode: "idle" });
});

test("main runtime owns one autonomous scheduler and ticks it with persisted settings", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(main, /createAutonomousRoam/);
  assert.match(main, /autonomousRoam\s*=\s*createAutonomousRoam\(\)/);
  assert.match(main, /runRuntimeTick\(\{[\s\S]*settings:\s*settingsStore\.snapshot\(\)/);
  assert.match(main, /poseAnchorsFromManifest/);
  assert.match(main, /poseAnchors:\s*poseAnchorsFromManifest\(animationBootstrap\.manifest/);
});
