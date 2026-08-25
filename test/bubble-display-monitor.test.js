const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

test("an active static bubble repositions for display bounds, work area, scale, add, and remove events", () => {
  const { createBubbleDisplayMonitor } = require("../src/runtime/bubble-display-monitor");
  const screen = new EventEmitter();
  const calls = [];
  const monitor = createBubbleDisplayMonitor({
    screen,
    reposition() { calls.push("reposition"); }
  });
  monitor.start();

  screen.emit("display-metrics-changed", {}, {}, ["bounds"]);
  screen.emit("display-metrics-changed", {}, {}, ["workArea"]);
  screen.emit("display-metrics-changed", {}, {}, ["scaleFactor"]);
  screen.emit("display-metrics-changed", {}, {}, ["rotation"]);
  screen.emit("display-added", {}, {});
  screen.emit("display-removed", {}, {});

  assert.equal(calls.length, 5);
  monitor.stop();
  screen.emit("display-added", {}, {});
  assert.equal(calls.length, 5);
  assert.equal(screen.listenerCount("display-metrics-changed"), 0);
  assert.equal(screen.listenerCount("display-added"), 0);
  assert.equal(screen.listenerCount("display-removed"), 0);
});
