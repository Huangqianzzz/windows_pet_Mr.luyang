const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ObstacleIndex } = require("../src/runtime/obstacle-index");
const { PetController } = require("../src/runtime/pet-controller");
const { runRuntimeTick } = require("../src/runtime/runtime-tick");
const { createWindowSupportCoordinator } = require("../src/runtime/window-support-coordinator");

function fakeClock() {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimer(callback) { const id = nextId++; timers.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); },
    run() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    count() { return timers.size; }
  };
}

const support = { source: "window", id: "window:7", hwnd: 7, processId: 111,
  rect: { x: 0, y: 0, width: 100, height: 100 } };
const attachment = { target: { source: "window", id: "window:7", hwnd: 7, processId: 111 } };

function harness(refreshes = []) {
  const clock = fakeClock();
  const calls = [];
  const coordinator = createWindowSupportCoordinator({
    getAttachment: () => attachment,
    replaceWindows(obstacles) { calls.push(["replace", obstacles]); },
    syncController() { calls.push(["sync"]); },
    refreshWindows() { calls.push(["refresh"]); return refreshes.shift(); },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  });
  return { coordinator, clock, calls };
}

test("keeps the last anchor on first ordinary miss and drops after an active confirmation", () => {
  const h = harness([[]]);
  h.coordinator.handleSnapshot([], { immediate: false });
  assert.deepEqual(h.calls, []);
  assert.equal(h.clock.count(), 1);
  h.clock.run();
  assert.deepEqual(h.calls, [["refresh"], ["replace", []], ["sync"]]);
});

test("support reappearance clears pending confirmation and synchronizes normally", () => {
  const h = harness();
  h.coordinator.handleSnapshot([], { immediate: false });
  h.coordinator.handleSnapshot([support], { immediate: false });
  assert.equal(h.clock.count(), 0);
  assert.deepEqual(h.calls, [["replace", [support]], ["sync"]]);
});

test("treats the same hwnd from another process as missing support", () => {
  const h = harness([[{ ...support, processId: 222 }]]);

  h.coordinator.handleSnapshot([{ ...support, processId: 222 }], { immediate: false });

  assert.deepEqual(h.calls, []);
  assert.equal(h.clock.count(), 1);
});

test("an immediate missing snapshot synchronizes support loss without delay", () => {
  const h = harness();
  h.coordinator.handleSnapshot([], { immediate: true });
  assert.equal(h.clock.count(), 0);
  assert.deepEqual(h.calls, [["replace", []], ["sync"]]);
});

test("an incomplete confirmation does not advance support loss and retries", () => {
  const h = harness([null, []]);
  h.coordinator.handleSnapshot([], { immediate: false });
  h.clock.run();
  assert.deepEqual(h.calls, [["refresh"]]);
  assert.equal(h.clock.count(), 1);
  h.clock.run();
  assert.deepEqual(h.calls, [["refresh"], ["refresh"], ["replace", []], ["sync"]]);
});

test("pause and stop cancel confirmation timers and suppress stale callbacks", () => {
  const h = harness([[]]);
  h.coordinator.handleSnapshot([], { immediate: false });
  h.coordinator.setPaused(true);
  assert.equal(h.clock.count(), 0);
  h.coordinator.handleSnapshot([], { immediate: true });
  assert.deepEqual(h.calls, []);
  h.coordinator.setPaused(false);
  h.coordinator.handleSnapshot([], { immediate: false });
  h.coordinator.stop();
  h.clock.run();
  assert.equal(h.calls.filter(call => call[0] === "sync").length, 0);
});

test("first ordinary miss remains invisible to attached and behind-window runtime paths", () => {
  for (const mode of ["attached", "behind-window"]) {
    const clock = fakeClock();
    const obstacleIndex = new ObstacleIndex();
    obstacleIndex.replace("windows", [support]);
    const controller = new PetController({
      obstacleIndex,
      animationBridge: { play() { return true; } },
      body: { x: -20, y: 50, width: 20, height: 30, vx: 0, vy: 0 },
      renderWindow: { setBounds() {} },
      hitWindow: { hide() {}, setBounds() {}, showInactive() {} },
      layerCoordinator: { apply() { return true; }, restoreNormal() { return true; } },
      poseAnchors: { "wall-climb": { x: 20, y: 0 } }
    });
    controller.startCrawl();
    assert.equal(controller.beginAutoClimb({ target: support, edge: "left", t: 0.5 }), true);
    if (mode === "behind-window") {
      const plan = controller.planBehindWindowEscape(support);
      assert.ok(plan);
      assert.equal(controller.beginBehindWindowEscape(plan), true);
    }
    const coordinator = createWindowSupportCoordinator({
      getAttachment: () => controller.snapshot().attachment,
      replaceWindows: obstacles => obstacleIndex.replace("windows", obstacles),
      syncController: () => controller.syncObstacles(),
      refreshWindows: () => [],
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    });

    coordinator.handleSnapshot([], { immediate: false });
    runRuntimeTick({
      controller,
      roam: { tick: () => ({ kind: "none" }) },
      settings: { autonomousActivity: true },
      screen: { getDisplayMatching: () => ({ workArea: { x: -500, y: -500, width: 1000, height: 1000 } }) },
      dtMs: 16,
      nowMs: 16
    });

    assert.equal(controller.snapshot().state.mode, mode);
    assert.equal(obstacleIndex.snapshot().some(item => item.id === support.id), true);
    clock.run();
    assert.equal(controller.snapshot().state.mode, "falling");
  }
});
