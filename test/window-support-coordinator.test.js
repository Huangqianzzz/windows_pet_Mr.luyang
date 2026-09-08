const { test } = require("node:test");
const assert = require("node:assert/strict");
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

const support = { source: "window", id: "window:7", hwnd: 7, rect: { x: 0, y: 0, width: 100, height: 100 } };
const attachment = { target: { source: "window", id: "window:7", hwnd: 7 } };

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
  assert.deepEqual(h.calls, [["replace", []]]);
  assert.equal(h.clock.count(), 1);
  h.clock.run();
  assert.deepEqual(h.calls, [["replace", []], ["refresh"], ["replace", []], ["sync"]]);
});

test("support reappearance clears pending confirmation and synchronizes normally", () => {
  const h = harness();
  h.coordinator.handleSnapshot([], { immediate: false });
  h.coordinator.handleSnapshot([support], { immediate: false });
  assert.equal(h.clock.count(), 0);
  assert.deepEqual(h.calls, [["replace", []], ["replace", [support]], ["sync"]]);
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
  assert.deepEqual(h.calls, [["replace", []], ["refresh"]]);
  assert.equal(h.clock.count(), 1);
  h.clock.run();
  assert.deepEqual(h.calls, [["replace", []], ["refresh"], ["refresh"], ["replace", []], ["sync"]]);
});

test("pause and stop cancel confirmation timers and suppress stale callbacks", () => {
  const h = harness([[]]);
  h.coordinator.handleSnapshot([], { immediate: false });
  h.coordinator.setPaused(true);
  assert.equal(h.clock.count(), 0);
  h.coordinator.handleSnapshot([], { immediate: true });
  assert.deepEqual(h.calls, [["replace", []]]);
  h.coordinator.setPaused(false);
  h.coordinator.handleSnapshot([], { immediate: false });
  h.coordinator.stop();
  h.clock.run();
  assert.equal(h.calls.filter(call => call[0] === "sync").length, 0);
});
