const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runRuntimeTick } = require("../src/runtime/runtime-tick");

const body = { x: 10, y: 20, width: 30, height: 40, vx: 0, vy: 0 };
const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

test("runtime tick routes automatic-climb stall to a valid behind plan exactly once", () => {
  for (const outcome of [{ stalled: true }, { atEdge: true }]) {
    const calls = [];
    let mode = "attached";
    const target = { id: "window:1", source: "window", hwnd: 77 };
    const plan = { target, points: [{ x: 10, y: 20 }, { x: 0, y: 20 }] };
    const controller = {
      tick() {}, snapshot: () => ({ state: { mode }, body }), isAutoClimbing: () => true,
      advanceAutoClimb: () => ({ ...outcome, target }),
      planBehindWindowEscape(value) { calls.push(["plan", value]); return plan; },
      beginBehindWindowEscape(value) { calls.push(["begin", value]); mode = "behind-window"; return true; },
      advanceBehindWindowEscape(dtMs) { calls.push(["escape", dtMs]); }
    };
    const args = { controller, roam: { tick() { throw new Error("roam competed"); } },
      settings: { autonomousActivity: true }, screen: { getDisplayMatching: () => ({ workArea }) }, dtMs: 16, nowMs: 0 };
    runRuntimeTick(args);
    runRuntimeTick(args);
    assert.deepEqual(calls, [["plan", target], ["begin", plan], ["escape", 16]]);
  }
});

test("runtime tick falls once when automatic climb loses target or cannot escape", () => {
  for (const target of [null, { source: "window", id: "window:1" }]) {
    let mode = "attached";
    let losses = 0;
    const controller = { tick() {}, snapshot: () => ({ state: { mode }, body }), isAutoClimbing: () => true,
      advanceAutoClimb: () => ({ stalled: true, target }), planBehindWindowEscape: () => null,
      supportLost() { losses++; mode = "falling"; } };
    const args = { controller, roam: { tick: () => ({ kind: "none" }) }, settings: {},
      screen: { getDisplayMatching: () => ({ workArea }) }, dtMs: 16, nowMs: 0 };
    runRuntimeTick(args);
    runRuntimeTick(args);
    assert.equal(losses, 1);
  }
});

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

test("runtime tick passes timing into moveCrawl and climbs once from a candidate", () => {
  const calls = [];
  const candidate = { target: { id: "window:1", source: "window" }, edge: "left", t: 0.5 };
  const controller = {
    tick() {},
    snapshot() { return { state: { mode: "crawling" }, body }; },
    moveCrawl(dx, dy, area, timing) {
      calls.push(["move", dx, dy, timing]);
      return { moved: false, fullyMoved: false, blockedAxes: ["x"], climbCandidate: candidate };
    },
    setCrawlDirection(direction) { calls.push(["face", direction]); },
    beginAutoClimb(value) { calls.push(["climb", value]); return true; }
  };
  const roam = {
    tick() { return { kind: "move", direction: "right", dx: 4, dy: 1 }; },
    blocked() { calls.push(["blocked"]); return false; },
    cleared() { calls.push(["cleared"]); }
  };
  const screen = { getDisplayMatching() { return { workArea }; } };

  runRuntimeTick({ controller, roam, settings: { autonomousActivity: true }, screen, dtMs: 16, nowMs: 300 });

  assert.deepEqual(calls.filter(entry => entry[0] === "move"),
    [["move", 4, 1, { dtMs: 16, nowMs: 300 }]]);
  assert.deepEqual(calls.filter(entry => entry[0] === "climb"), [["climb", candidate]]);
  assert.equal(calls.some(entry => entry[0] === "cleared"), false);
});

test("runtime tick advances an automatic climb instead of roaming while attached", () => {
  const calls = [];
  const controller = {
    tick() {},
    snapshot() { return { state: { mode: "attached" }, body }; },
    isAutoClimbing() { return true; },
    advanceAutoClimb(dtMs, area) { calls.push(["advance", dtMs, area]); return { moved: true }; }
  };
  const roam = { tick() { calls.push(["roam"]); return { kind: "none" }; } };
  const screen = { getDisplayMatching() { return { workArea }; } };

  const intent = runRuntimeTick({
    controller, roam, settings: { autonomousActivity: true }, screen, dtMs: 16, nowMs: 400
  });

  assert.deepEqual(intent, { kind: "auto-climb" });
  assert.deepEqual(calls, [["advance", 16, workArea]]);
});

test("runtime tick leaves manually attached pets to roam normally", () => {
  const calls = [];
  const controller = {
    tick() {},
    snapshot() { return { state: { mode: "attached" }, body }; },
    isAutoClimbing() { return false; },
    advanceAutoClimb() { calls.push(["advance"]); }
  };
  const roam = { tick() { calls.push(["roam"]); return { kind: "none" }; } };
  const screen = { getDisplayMatching() { return { workArea }; } };

  runRuntimeTick({ controller, roam, settings: { autonomousActivity: true }, screen, dtMs: 16, nowMs: 400 });
  assert.deepEqual(calls, [["roam"]]);
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
