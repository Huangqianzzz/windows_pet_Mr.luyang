const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPetLayerCoordinator } = require("../src/runtime/pet-layer-coordinator");

function harness(failPlacement = false) {
  const calls = [];
  function window(name, hwnd) {
    let visible = true;
    return { getNativeWindowHandle: () => hwnd, isDestroyed: () => false,
      isVisible: () => visible,
      hide() { visible = false; calls.push([name, "hide"]); },
      setAlwaysOnTop(value) { calls.push([name, "top", value]); },
      showInactive() { visible = true; calls.push([name, "show"]); },
      moveTop() { calls.push([name, "moveTop"]); } };
  }
  const options = { renderWindow: window("render", 1), hitWindow: window("hit", 2), bubbleWindow: window("bubble", 3),
    zOrder: { placeBelow(hwnd, target) { calls.push(["below", hwnd, target]); return !failPlacement; },
      sendToBottom(hwnd) { calls.push(["bottom", hwnd]); return true; } } };
  return { calls, options, coordinator: createPetLayerCoordinator(options) };
}

test("layer coordinator uses background > behind-window > normal and only inserts render behind", () => {
  const h = harness();
  assert.equal(h.coordinator.apply({ backgroundPaused: false, behindTarget: { hwnd: 77 } }), true);
  assert.deepEqual(h.calls, [["hit", "hide"], ["bubble", "hide"], ["render", "top", false], ["below", 1, 77]]);
  h.calls.length = 0;
  assert.equal(h.coordinator.apply({ backgroundPaused: true, behindTarget: { hwnd: 77 } }), true);
  assert.equal(h.calls.filter(call => call[0] === "below").length, 0);
  assert.deepEqual(h.calls.filter(call => call[0] === "bottom"), [["bottom", 1], ["bottom", 2], ["bottom", 3]]);
  h.calls.length = 0;
  h.coordinator.apply({ backgroundPaused: false, behindTarget: { hwnd: 77 } });
  assert.deepEqual(h.calls.filter(call => call[0] === "below"), [["below", 1, 77]]);
  assert.equal(h.calls.some(call => call[2] === true && call[0] === "render"), false);
  h.calls.length = 0;
  assert.equal(h.coordinator.restoreNormal(), true);
  assert.deepEqual(h.calls, [["render", "top", true], ["hit", "top", true], ["bubble", "top", true]]);
});

test("layer placement failure rolls render back and normal restoration tries visible fallback", () => {
  const h = harness(true);
  assert.equal(h.coordinator.apply({ backgroundPaused: false, behindTarget: { hwnd: 77 } }), false);
  assert.ok(h.calls.some(call => call[0] === "render" && call[1] === "top" && call[2] === true));
  h.options.renderWindow.setAlwaysOnTop = () => { throw new Error("top failed"); };
  assert.equal(h.coordinator.restoreNormal(), false);
  assert.ok(h.calls.some(call => call[0] === "render" && call[1] === "moveTop"));
  assert.ok(h.calls.some(call => call[0] === "render" && call[1] === "show"));
});

test("background transactions retain a real automatic escape across resume and rollback", () => {
  const { PetController } = require("../src/runtime/pet-controller");
  const { ObstacleIndex } = require("../src/runtime/obstacle-index");
  const { createBackgroundModeTransitions } = require("../src/runtime/foreground-gate");
  const { runRuntimeTick } = require("../src/runtime/runtime-tick");
  for (const invalid of [false, true]) {
    const h = harness();
    const obstacleIndex = new ObstacleIndex();
    const target = { source: "window", id: "window:77", hwnd: 77,
      rect: { x: 100, y: 100, width: 200, height: 200 } };
    obstacleIndex.replace("windows", [target]);
    let paused = false;
    let rejectResume = false;
    const controller = new PetController({ obstacleIndex,
      animationBridge: { play: () => true },
      body: { x: 130, y: 130, width: 20, height: 30, vx: 0, vy: 0 },
      renderWindow: { setBounds() {} },
      hitWindow: { ...h.options.hitWindow, setBounds() {} },
      layerCoordinator: h.coordinator,
      hideBubble: () => h.options.bubbleWindow.hide(),
      isBackgroundPaused: () => paused
    });
    controller.setFrameHitBox({ x: 0, y: 0, width: 10, height: 10 });
    controller.startCrawl();
    controller.beginAutoClimb({ target, edge: "left", t: 0.5 });
    const tick = () => runRuntimeTick({ controller, roam: { tick() { throw new Error("roam competed"); } },
      settings: {}, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 500, height: 500 } }) },
      dtMs: 16, nowMs: 16 });
    tick();
    tick();
    assert.equal(controller.state.mode, "behind-window");
    assert.equal(h.calls.filter(call => call[0] === "below").length, 1);
    assert.equal(h.calls.filter(call => call[0] === "hit" && call[1] === "hide").length, 1);
    assert.equal(h.calls.filter(call => call[0] === "bubble" && call[1] === "hide").length, 1);

    const transactions = createBackgroundModeTransitions({
      setRuntimePaused(value) { paused = value; return true; },
      setInputEnabled: enabled => controller.setInputBlocked("background", !enabled),
      hideBubble() {}, dismissSpeech() {},
      sendRendererPaused(value) { return value || !rejectResume; },
      setAlwaysOnTop(enabled) {
        if (enabled) return controller.reapplyLayer(false);
        for (const window of [h.options.renderWindow, h.options.hitWindow, h.options.bubbleWindow]) {
          window.setAlwaysOnTop(false);
        }
        return true;
      },
      lowerWindows: () => controller.reapplyLayer(true),
      refreshObstacles() { h.calls.push(["refresh"]); controller.syncObstacles(); },
      resetTickClock() {}
    });
    assert.equal(transactions.enter(), true);
    const before = controller.snapshot();
    controller.advanceBehindWindowEscape(1000);
    assert.deepEqual(controller.snapshot(), before);
    rejectResume = true;
    assert.equal(transactions.leave(), false);
    assert.equal(paused, true);
    assert.equal(controller.inputEnabled, false);
    assert.equal(controller.state.mode, "behind-window");
    assert.deepEqual(h.calls.filter(call => call[0] === "bottom").slice(-3),
      [["bottom", 1], ["bottom", 2], ["bottom", 3]]);

    if (invalid) obstacleIndex.replace("windows", []);
    rejectResume = false;
    h.calls.length = 0;
    assert.equal(transactions.leave(), true);
    assert.equal(paused, false);
    assert.equal(h.calls[0][0], "refresh");
    assert.equal(controller.state.mode, invalid ? "falling" : "behind-window");
    assert.equal(h.options.hitWindow.isVisible(), false);
    assert.equal(h.options.bubbleWindow.isVisible(), false);
    if (invalid) {
      assert.equal(h.calls.some(call => call[0] === "below"), false);
      assert.equal(controller.behindEscape, null);
    } else {
      assert.deepEqual(h.calls.filter(call => call[0] === "below"), [["below", 1, 77]]);
      assert.equal(h.calls.some(call => call[0] === "render" && call[2] === true), false);
    }
  }
});
