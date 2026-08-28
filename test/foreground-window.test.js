const { test } = require("node:test");
const assert = require("node:assert/strict");

const MODULE_PATH = "../src/windows/foreground-window";

function display(id, bounds) {
  return { id, bounds, workArea: { ...bounds, height: bounds.height - 40 } };
}

function fakeScreen(displays) {
  return {
    getDisplayMatching(rect) {
      return displays.find(item => (
        rect.x < item.bounds.x + item.bounds.width
        && rect.x + rect.width > item.bounds.x
        && rect.y < item.bounds.y + item.bounds.height
        && rect.y + rect.height > item.bounds.y
      )) || displays[0];
    }
  };
}

test("foreground reader returns null when the native window snapshot is unavailable", () => {
  const { createForegroundWindowReader } = require(MODULE_PATH);
  const screen = fakeScreen([display(1, { x: 0, y: 0, width: 1920, height: 1080 })]);
  const missingHandle = createForegroundWindowReader({
    screen,
    native: { getForegroundWindow: () => 0 }
  });
  const missingRect = createForegroundWindowReader({
    screen,
    native: {
      getForegroundWindow: () => 7,
      getWindowProcessId: () => 99,
      getWindowRect: () => null,
      isZoomed: () => false,
      toDipRect: () => null
    }
  });

  assert.equal(missingHandle.snapshot(), null);
  assert.equal(missingRect.snapshot(), null);
});

test("foreground reader converts native coordinates to DIP and classifies 99.5 percent display coverage", () => {
  const { createForegroundWindowReader } = require(MODULE_PATH);
  const target = display(1, { x: 0, y: 0, width: 1000, height: 800 });
  const screen = fakeScreen([target]);
  const reader = createForegroundWindowReader({
    screen,
    native: {
      getForegroundWindow: () => 7,
      getWindowProcessId: () => 99,
      getWindowRect: () => [0, 0, 1500, 1200],
      isZoomed: () => false,
      toDipRect: (_hwnd, rect) => rect.map(value => value / 1.5)
    }
  });

  assert.deepEqual(reader.snapshot(), {
    hwnd: 7,
    processId: 99,
    rect: { x: 0, y: 0, width: 1000, height: 800 },
    maximized: false,
    fullscreen: true
  });
});

test("blocking classification ignores own, ordinary, and other-display windows", () => {
  const { isForegroundBlocking } = require(MODULE_PATH);
  const primary = display(1, { x: 0, y: 0, width: 1920, height: 1080 });
  const secondary = display(2, { x: -1280, y: -100, width: 1280, height: 1024 });
  const screen = fakeScreen([secondary, primary]);
  const own = {
    hwnd: 10,
    processId: 42,
    rect: { ...primary.bounds },
    maximized: true,
    fullscreen: true
  };
  const ordinary = {
    ...own,
    hwnd: 11,
    processId: 77,
    rect: { x: 100, y: 100, width: 900, height: 700 },
    maximized: false,
    fullscreen: false
  };
  const otherDisplay = {
    ...own,
    hwnd: 12,
    processId: 77,
    rect: { ...secondary.bounds }
  };

  assert.equal(isForegroundBlocking(own, { screen, targetDisplay: primary, ownProcessId: 42 }), false);
  assert.equal(isForegroundBlocking({ ...own, processId: 77 }, {
    screen,
    targetDisplay: primary,
    ownProcessId: 42,
    ownWindowHandles: [10]
  }), false);
  assert.equal(isForegroundBlocking(ordinary, { screen, targetDisplay: primary, ownProcessId: 42 }), false);
  assert.equal(isForegroundBlocking(otherDisplay, { screen, targetDisplay: primary, ownProcessId: 42 }), false);
  assert.equal(isForegroundBlocking({ ...own, processId: 77 }, {
    screen,
    targetDisplay: primary,
    ownProcessId: 42
  }), true);
});

test("fullscreen classification uses display bounds rather than work area", () => {
  const { classifyFullscreen } = require(MODULE_PATH);
  const target = display(1, { x: 0, y: 0, width: 1000, height: 800 });

  assert.equal(classifyFullscreen({ x: 0, y: 0, width: 1000, height: 760 }, target), false);
  assert.equal(classifyFullscreen({ x: 0, y: 0, width: 1000, height: 796 }, target), true);
});
