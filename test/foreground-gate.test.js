const { test } = require("node:test");
const assert = require("node:assert/strict");

test("foreground gate requires a stable state before entering and leaving background", () => {
  const { createForegroundGate } = require("../src/runtime/foreground-gate");
  const gate = createForegroundGate({ settleMs: 250 });

  assert.equal(gate.tick(true, 0), "none");
  assert.equal(gate.tick(true, 249), "none");
  assert.equal(gate.tick(true, 250), "enter");
  assert.equal(gate.tick(false, 300), "none");
  assert.equal(gate.tick(false, 549), "none");
  assert.equal(gate.tick(false, 550), "leave");
});

test("foreground gate resets settling when the candidate flips", () => {
  const { createForegroundGate } = require("../src/runtime/foreground-gate");
  const gate = createForegroundGate({ settleMs: 250 });

  assert.equal(gate.tick(true, 0), "none");
  assert.equal(gate.tick(false, 249), "none");
  assert.equal(gate.tick(true, 300), "none");
  assert.equal(gate.tick(true, 549), "none");
  assert.equal(gate.tick(true, 550), "enter");
});

test("foreground gate emits each stable edge once", () => {
  const { createForegroundGate } = require("../src/runtime/foreground-gate");
  const gate = createForegroundGate({ settleMs: 0 });

  assert.equal(gate.tick(false, 0), "none");
  assert.equal(gate.tick(true, 1), "enter");
  assert.equal(gate.tick(true, 2), "none");
  assert.equal(gate.tick(false, 3), "leave");
  assert.equal(gate.tick(false, 4), "none");
});

test("foreground gate safely restarts candidate timing after the clock moves backward", () => {
  const { createForegroundGate } = require("../src/runtime/foreground-gate");
  const gate = createForegroundGate({ settleMs: 250 });

  assert.equal(gate.tick(true, 1000), "none");
  assert.equal(gate.tick(true, 900), "none");
  assert.equal(gate.tick(true, 1149), "none");
  assert.equal(gate.tick(true, 1150), "enter");
});

test("background coordinator skips unknown snapshots and resolves the current pet display", () => {
  const { createBackgroundModeCoordinator } = require("../src/runtime/foreground-gate");
  const snapshots = [null, { hwnd: 8 }, { hwnd: 8 }];
  const bodies = [
    { x: 10, y: 10, width: 100, height: 100 },
    { x: 2010, y: 10, width: 100, height: 100 }
  ];
  const gateCalls = [];
  const actions = [];
  let bodyIndex = 0;
  const coordinator = createBackgroundModeCoordinator({
    readForeground: () => snapshots.shift(),
    getPetBody: () => bodies[Math.min(bodyIndex++, bodies.length - 1)],
    screen: { getDisplayMatching: body => ({ id: body.x < 1000 ? 1 : 2 }) },
    classify: (_snapshot, display) => display.id === 2,
    gate: {
      tick(requested, now) {
        gateCalls.push([requested, now]);
        return requested ? "enter" : "none";
      }
    },
    enter: () => actions.push("enter"),
    leave: () => actions.push("leave"),
    now: () => 25
  });

  assert.equal(coordinator.poll(), "none");
  assert.equal(coordinator.poll(), "none");
  assert.equal(coordinator.poll(), "enter");
  assert.deepEqual(gateCalls, [[false, 25], [true, 25]]);
  assert.deepEqual(actions, ["enter"]);
});

test("background transitions are idempotent and restore input only after refresh and animation", () => {
  const { createBackgroundModeTransitions } = require("../src/runtime/foreground-gate");
  const calls = [];
  const transitions = createBackgroundModeTransitions({
    setRuntimePaused: paused => calls.push(`runtime:${paused}`),
    setInputEnabled: enabled => calls.push(`input:${enabled}`),
    hideBubble: () => calls.push("hide"),
    dismissSpeech: () => calls.push("dismiss"),
    sendRendererPaused: paused => calls.push(`renderer:${paused}`),
    setAlwaysOnTop: enabled => calls.push(`top:${enabled}`),
    lowerWindows: () => calls.push("lower"),
    refreshObstacles: () => calls.push("refresh"),
    resetTickClock: () => calls.push("clock")
  });

  assert.equal(transitions.enter(), true);
  assert.equal(transitions.enter(), false);
  assert.deepEqual(calls, [
    "runtime:true",
    "input:false",
    "hide",
    "dismiss",
    "renderer:true",
    "top:false",
    "lower"
  ]);

  assert.equal(transitions.leave(), true);
  assert.equal(transitions.leave(), false);
  assert.deepEqual(calls.slice(7), [
    "refresh",
    "clock",
    "top:true",
    "renderer:false",
    "runtime:false",
    "input:true"
  ]);
});
