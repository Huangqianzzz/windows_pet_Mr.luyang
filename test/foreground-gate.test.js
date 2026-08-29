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

test("background coordinator stays entered through display-query errors longer than settle time", () => {
  const {
    createBackgroundModeCoordinator,
    createForegroundGate
  } = require("../src/runtime/foreground-gate");
  const { isForegroundBlocking } = require("../src/windows/foreground-window");
  const targetDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } };
  const foreground = {
    hwnd: 7,
    processId: 99,
    rect: { ...targetDisplay.bounds },
    maximized: true,
    fullscreen: true
  };
  let now = 0;
  let displayQueries = 0;
  const actions = [];
  const coordinator = createBackgroundModeCoordinator({
    readForeground: () => foreground,
    getPetBody: () => ({ x: 10, y: 10, width: 100, height: 100 }),
    screen: { getDisplayMatching: () => targetDisplay },
    classify(snapshot, display) {
      return isForegroundBlocking(snapshot, {
        screen: {
          getDisplayMatching() {
            displayQueries += 1;
            if (displayQueries > 2 && displayQueries < 6) {
              throw new Error("display query failed");
            }
            return targetDisplay;
          }
        },
        targetDisplay: display,
        ownProcessId: 42
      });
    },
    gate: createForegroundGate({ settleMs: 250 }),
    enter: () => actions.push("enter"),
    leave: () => actions.push("leave"),
    now: () => now
  });

  coordinator.poll();
  now = 250;
  coordinator.poll();
  now = 300;
  coordinator.poll();
  now = 600;
  coordinator.poll();
  now = 900;
  coordinator.poll();
  assert.deepEqual(actions, ["enter"]);

  now = 1000;
  coordinator.poll();
  assert.deepEqual(actions, ["enter"]);
});

test("failed enter does not escape the poll, consume the edge, or leave partial background state", () => {
  const {
    createBackgroundModeCoordinator,
    createBackgroundModeTransitions,
    createForegroundGate
  } = require("../src/runtime/foreground-gate");
  const state = { runtime: false, input: true, renderer: false, top: true };
  let failLower = true;
  const transitions = createBackgroundModeTransitions({
    setRuntimePaused: value => { state.runtime = value; },
    setInputEnabled: value => { state.input = value; },
    hideBubble() {},
    dismissSpeech() {},
    sendRendererPaused: value => { state.renderer = value; },
    setAlwaysOnTop: value => { state.top = value; },
    lowerWindows() {
      if (failLower) {
        failLower = false;
        throw new Error("SetWindowPos failed");
      }
    },
    refreshObstacles() {},
    resetTickClock() {}
  });
  const coordinator = createBackgroundModeCoordinator({
    readForeground: () => ({ hwnd: 7 }),
    getPetBody: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    screen: { getDisplayMatching: () => ({ id: 1 }) },
    classify: () => true,
    gate: createForegroundGate({ settleMs: 0 }),
    enter: () => transitions.enter(),
    leave: () => transitions.leave(),
    now: () => 0
  });

  assert.doesNotThrow(() => assert.equal(coordinator.poll(), "none"));
  assert.deepEqual(state, { runtime: false, input: true, renderer: false, top: true });
  assert.deepEqual(transitions.snapshot(), { background: false });

  assert.equal(coordinator.poll(), "enter");
  assert.deepEqual(state, { runtime: true, input: false, renderer: true, top: false });
  assert.deepEqual(transitions.snapshot(), { background: true });
});

test("failed leave rolls back to background and retries the same stable edge", () => {
  const {
    createBackgroundModeCoordinator,
    createBackgroundModeTransitions,
    createForegroundGate
  } = require("../src/runtime/foreground-gate");
  const state = { runtime: false, input: true, renderer: false, top: true };
  let requested = true;
  let failLeaveInput = false;
  const transitions = createBackgroundModeTransitions({
    setRuntimePaused: value => { state.runtime = value; },
    setInputEnabled(value) {
      state.input = value;
      if (value && failLeaveInput) {
        failLeaveInput = false;
        throw new Error("hit window unavailable");
      }
    },
    hideBubble() {},
    dismissSpeech() {},
    sendRendererPaused: value => { state.renderer = value; },
    setAlwaysOnTop: value => { state.top = value; },
    lowerWindows() {},
    refreshObstacles() {},
    resetTickClock() {}
  });
  const coordinator = createBackgroundModeCoordinator({
    readForeground: () => ({ hwnd: 7 }),
    getPetBody: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    screen: { getDisplayMatching: () => ({ id: 1 }) },
    classify: () => requested,
    gate: createForegroundGate({ settleMs: 0 }),
    enter: () => transitions.enter(),
    leave: () => transitions.leave(),
    now: () => 0
  });

  assert.equal(coordinator.poll(), "enter");
  requested = false;
  failLeaveInput = true;
  assert.doesNotThrow(() => assert.equal(coordinator.poll(), "none"));
  assert.deepEqual(state, { runtime: true, input: false, renderer: true, top: false });
  assert.deepEqual(transitions.snapshot(), { background: true });

  assert.equal(coordinator.poll(), "leave");
  assert.deepEqual(state, { runtime: false, input: true, renderer: false, top: true });
  assert.deepEqual(transitions.snapshot(), { background: false });
});

test("refresh command treats a normal domain false as successful execution", () => {
  const {
    createBackgroundModeTransitions,
    createTransitionCommand
  } = require("../src/runtime/foreground-gate");
  let syncCalls = 0;
  const transitions = createBackgroundModeTransitions({
    setRuntimePaused() {},
    setInputEnabled() {},
    hideBubble() {},
    dismissSpeech() {},
    sendRendererPaused() {},
    setAlwaysOnTop() {},
    lowerWindows() {},
    refreshObstacles: createTransitionCommand(() => {
      syncCalls += 1;
      return false;
    }),
    resetTickClock() {}
  });

  assert.equal(transitions.enter(), true);
  assert.equal(transitions.leave(), true);
  assert.equal(syncCalls, 1);
  assert.deepEqual(transitions.snapshot(), { background: false });
});

test("failed leave restores non-topmost and HWND_BOTTOM in that order", () => {
  const { createBackgroundModeTransitions } = require("../src/runtime/foreground-gate");
  const calls = [];
  let failRendererLeave = false;
  const transitions = createBackgroundModeTransitions({
    setRuntimePaused: value => calls.push(`runtime:${value}`),
    setInputEnabled: value => calls.push(`input:${value}`),
    hideBubble: () => calls.push("hide"),
    dismissSpeech: () => calls.push("dismiss"),
    sendRendererPaused(value) {
      calls.push(`renderer:${value}`);
      if (!value && failRendererLeave) {
        failRendererLeave = false;
        throw new Error("renderer unavailable");
      }
    },
    setAlwaysOnTop: value => calls.push(`top:${value}`),
    lowerWindows: () => calls.push("lower"),
    refreshObstacles: () => calls.push("refresh"),
    resetTickClock: () => calls.push("clock")
  });

  assert.equal(transitions.enter(), true);
  calls.length = 0;
  failRendererLeave = true;
  assert.equal(transitions.leave(), false);
  assert.deepEqual(calls, [
    "refresh",
    "clock",
    "top:true",
    "renderer:false",
    "renderer:true",
    "top:false",
    "lower"
  ]);
  assert.deepEqual(transitions.snapshot(), { background: true });
});
