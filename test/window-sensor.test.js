const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createWinEventSubscriber,
  createWindowSensor,
  classifyWindowEvent
} = require("../src/windows/window-sensor");
const {
  collectExplorerIconRects,
  createDesktopIconReader
} = require("../src/windows/desktop-icons");
const { createTaskbarProvider } = require("../src/windows/taskbar");

function windowRecord(hwnd, overrides = {}) {
  return {
    hwnd,
    visible: true,
    cloaked: false,
    processId: 1,
    rect: [10, 10, 210, 110],
    ...overrides
  };
}

function fakeWindowNative(initialWindows) {
  let windows = initialWindows;
  let listener = null;

  return {
    enumerateWindows() {
      return windows;
    },
    toDipRect(_hwnd, rect) {
      return rect;
    },
    subscribe(nextListener) {
      listener = nextListener;
      return () => {
        listener = null;
      };
    },
    replace(nextWindows) {
      windows = nextWindows;
    },
    emitChange(meta) {
      listener?.(meta);
    }
  };
}

test("classifies only and destructive native window events without treating restore as support loss", () => {
  assert.deepEqual(classifyWindowEvent(0x8001, 7, 0), { event: 0x8001, hwnd: 7, immediate: true });
  assert.deepEqual(classifyWindowEvent(0x0016, 7, 0), { event: 0x0016, hwnd: 7, immediate: true });
  assert.deepEqual(classifyWindowEvent(0x0017, 7, 0), { event: 0x0017, hwnd: 7, immediate: false });
  assert.deepEqual(classifyWindowEvent(0x800b, 7, 0), { event: 0x800b, hwnd: 7, immediate: false });
  assert.equal(classifyWindowEvent(0x800b, 7, -4), null);
});

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now && timers.delete(id)) timer.callback();
      }
    },
    pending() { return timers.size; }
  };
}

test("filters invisible, cloaked, own, and zero-area windows", () => {
  const native = fakeWindowNative([
    windowRecord(1),
    windowRecord(2, { visible: false }),
    windowRecord(3, { cloaked: true }),
    windowRecord(4, { processId: 99 }),
    windowRecord(5, { rect: [10, 10, 10, 20] }),
    windowRecord(6, { rect: null }),
    windowRecord(7, { minimized: true }),
    windowRecord(8, { systemWindow: true })
  ]);
  const sensor = createWindowSensor({ native, ownProcessId: 99, onChange() {} });

  assert.deepEqual(sensor.snapshot(), [
    {
      source: "window",
      id: "window:1",
      hwnd: 1,
      rect: { x: 10, y: 10, width: 200, height: 100 }
    }
  ]);
});

test("normalizes the injected DPI conversion result to integer rectangles", () => {
  const native = fakeWindowNative([windowRecord(7, { rect: [20, 20, 220, 120] })]);
  native.toDipRect = (hwnd, rect) => {
    assert.equal(hwnd, 7);
    assert.deepEqual(rect, [20, 20, 220, 120]);
    return [10.2, 10.8, 110.1, 60.2];
  };

  const [obstacle] = createWindowSensor({ native, onChange() {} }).snapshot();

  assert.deepEqual(obstacle.rect, { x: 10, y: 10, width: 101, height: 51 });
  assert.equal(Object.values(obstacle.rect).every(Number.isInteger), true);
});

test("start refreshes on native events and stop detaches the event source", () => {
  const native = fakeWindowNative([windowRecord(1)]);
  const changes = [];
  const sensor = createWindowSensor({
    native,
    onChange(obstacles) {
      changes.push(obstacles);
    }
  });

  sensor.start();
  native.replace([windowRecord(2)]);
  native.emitChange({ immediate: true });
  sensor.stop();
  native.replace([windowRecord(3)]);
  native.emitChange();

  assert.deepEqual(changes.map(items => items.map(item => item.hwnd)), [[2]]);
  assert.deepEqual(sensor.snapshot().map(item => item.hwnd), [2]);
});

test("coalesces a normal event storm at the 75 ms trailing edge", () => {
  const native = fakeWindowNative([windowRecord(1)]);
  const clock = fakeClock();
  let enumerations = 0;
  let changes = 0;
  const enumerate = native.enumerateWindows;
  native.enumerateWindows = () => { enumerations += 1; return enumerate(); };
  const sensor = createWindowSensor({
    native,
    onChange() { changes += 1; },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  });
  enumerations = 0;
  sensor.start();

  for (let index = 0; index < 100; index += 1) {
    native.emitChange({ event: 0x800b, hwnd: 1, immediate: false });
  }
  clock.advance(74);
  assert.equal(enumerations, 0);
  assert.equal(changes, 0);
  clock.advance(1);
  assert.equal(enumerations, 1);
  assert.equal(changes, 1);
});

test("an immediate event cancels a pending normal refresh", () => {
  const native = fakeWindowNative([windowRecord(1)]);
  const clock = fakeClock();
  const changes = [];
  const sensor = createWindowSensor({
    native,
    onChange(_obstacles, meta) { changes.push(meta); },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  });
  sensor.start();
  native.emitChange({ event: 0x800b, hwnd: 1, immediate: false });
  native.emitChange({ event: 0x8001, hwnd: 1, immediate: true });
  clock.advance(75);

  assert.deepEqual(changes, [{ event: 0x8001, hwnd: 1, immediate: true }]);
});

test("stop cancels timer id zero and ignores events even when unsubscribe needs retry", () => {
  const native = fakeWindowNative([windowRecord(1)]);
  const clock = fakeClock();
  let changes = 0;
  let attempts = 0;
  let listener;
  native.subscribe = callback => {
    listener = callback;
    return () => { attempts += 1; return attempts > 1; };
  };
  const sensor = createWindowSensor({
    native,
    onChange() { changes += 1; },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  });
  sensor.start();
  listener({ immediate: false });
  assert.equal(clock.pending(), 1);
  assert.equal(sensor.stop(), false);
  assert.equal(clock.pending(), 0);
  listener({ immediate: false });
  clock.advance(75);
  assert.equal(changes, 0);
  assert.equal(sensor.stop(), true);
});

test("failed enumerations preserve the previous complete snapshot and do not notify", () => {
  const native = fakeWindowNative([windowRecord(1)]);
  let changes = 0;
  const sensor = createWindowSensor({ native, onChange() { changes += 1; } });
  sensor.start();
  native.enumerateWindows = () => { throw new Error("unavailable"); };
  assert.equal(sensor.refresh(), null);
  native.emitChange({ immediate: true });
  assert.deepEqual(sensor.snapshot().map(item => item.hwnd), [1]);
  assert.equal(changes, 0);
  native.enumerateWindows = () => null;
  assert.equal(sensor.refresh(), null);
  native.emitChange({ immediate: true });
  assert.deepEqual(sensor.snapshot().map(item => item.hwnd), [1]);
  assert.equal(changes, 0);
});

test("explicit refresh replaces stale native records before an active escape resumes", () => {
  const { PetController } = require("../src/runtime/pet-controller");
  const { ObstacleIndex } = require("../src/runtime/obstacle-index");
  for (const changed of [{ minimized: true }, { visible: false }, { rect: [600, 600, 800, 800] }]) {
    const calls = [];
    const native = fakeWindowNative([windowRecord(77, { rect: [100, 100, 300, 300] })]);
    const enumerate = native.enumerateWindows;
    native.enumerateWindows = () => { calls.push("enumerate"); return enumerate(); };
    const sensor = createWindowSensor({ native, ownProcessId: 99 });
    const obstacleIndex = new ObstacleIndex();
    obstacleIndex.replace("windows", sensor.snapshot());
    let paused = false;
    const controller = new PetController({ obstacleIndex,
      animationBridge: { play: () => true },
      body: { x: 130, y: 130, width: 20, height: 30, vx: 0, vy: 0 },
      layerCoordinator: {
        apply() { calls.push("placeBelow"); return true; },
        restoreNormal() { calls.push("restoreNormal"); return true; }
      }, isBackgroundPaused: () => paused
    });
    controller.startCrawl();
    controller.beginBehindWindowEscape(controller.planBehindWindowEscape(sensor.snapshot()[0]));
    paused = true;
    controller.setInputBlocked("background", true);
    native.replace([windowRecord(77, { rect: [100, 100, 300, 300], ...changed })]);
    assert.equal(sensor.snapshot().length, 1);
    const before = controller.snapshot().body;
    calls.length = 0;
    assert.equal(typeof sensor.refresh, "function");
    obstacleIndex.replace("windows", sensor.refresh());
    controller.syncObstacles();
    assert.equal(controller.reapplyLayer(false), true);
    assert.equal(calls[0], "enumerate");
    assert.equal(calls.includes("placeBelow"), false);
    assert.equal(controller.state.mode, "falling");
    assert.equal(controller.behindEscape, null);
    assert.deepEqual(controller.body, before);
    assert.equal(controller.inputEnabled, false);
    assert.deepEqual(sensor.snapshot(), obstacleIndex.snapshot());
  }
});

test("stop preserves a failed native unsubscribe so cleanup can be retried", () => {
  const native = fakeWindowNative([windowRecord(1)]);
  let attempts = 0;
  native.subscribe = () => () => {
    attempts += 1;
    return attempts > 1;
  };
  const sensor = createWindowSensor({ native, onChange() {} });

  sensor.start();

  assert.equal(sensor.stop(), false);
  assert.equal(sensor.stop(), true);
  assert.equal(attempts, 2);
});

test("WinEvent cleanup retains the callback thunk until every hook is unhooked", () => {
  const activeHooks = new Set(["object-hook", "system-hook"]);
  let failObjectHook = true;
  let unregisterCalls = 0;
  const subscriber = createWinEventSubscriber({
    registerCallback(callback) {
      return { callback };
    },
    unregisterCallback() {
      unregisterCalls += 1;
    },
    installHooks() {
      return [...activeHooks];
    },
    unhook(hook) {
      if (hook === "object-hook" && failObjectHook) {
        failObjectHook = false;
        return false;
      }
      activeHooks.delete(hook);
      return true;
    }
  });
  const unsubscribe = subscriber.subscribe(() => {});

  assert.equal(unsubscribe(), false);
  assert.equal(unregisterCalls, 0);
  assert.deepEqual([...activeHooks], ["object-hook"]);

  assert.equal(unsubscribe(), true);
  assert.equal(unregisterCalls, 1);
  assert.deepEqual([...activeHooks], []);
});

test("desktop icon reader prefers a successful Explorer list-view result", async () => {
  let fallbackCalls = 0;
  const reader = createDesktopIconReader({
    explorer: {
      async readRects() {
        return [{ id: "0", rect: [40, 50, 72, 90] }];
      }
    },
    uia: {
      async readRects() {
        fallbackCalls += 1;
        return [];
      }
    }
  });

  assert.deepEqual(await reader.readDesktopIconRects(), [
    {
      source: "desktop-icon",
      id: "desktop-icon:0",
      rect: { x: 40, y: 50, width: 32, height: 40 }
    }
  ]);
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(reader.getDesktopIconDiagnostic(), {
    status: "ok",
    method: "explorer-list-view",
    count: 1
  });
});

test("desktop icon reader uses UI Automation only after Explorer fails", async () => {
  const calls = [];
  const reader = createDesktopIconReader({
    explorer: {
      async readRects() {
        calls.push("explorer");
        throw new Error("list-view-unavailable");
      }
    },
    uia: {
      async readRects() {
        calls.push("uia");
        return [{ id: "fallback-0", rect: [100, 120, 148, 168] }];
      }
    }
  });

  const obstacles = await reader.readDesktopIconRects();

  assert.deepEqual(calls, ["explorer", "uia"]);
  assert.deepEqual(obstacles[0], {
    source: "desktop-icon",
    id: "desktop-icon:fallback-0",
    rect: { x: 100, y: 120, width: 48, height: 48 }
  });
  assert.deepEqual(reader.getDesktopIconDiagnostic(), {
    status: "degraded",
    method: "uia-fallback",
    primary: "failed",
    count: 1
  });
});

test("desktop icon reader fails closed without exposing native error details", async () => {
  const reader = createDesktopIconReader({
    explorer: { async readRects() { throw new Error("secret Explorer detail"); } },
    uia: { async readRects() { throw new Error("secret UIA detail"); } }
  });

  assert.deepEqual(await reader.readDesktopIconRects(), []);
  assert.deepEqual(reader.getDesktopIconDiagnostic(), {
    status: "unavailable",
    primary: "failed",
    fallback: "failed",
    count: 0
  });
  assert.equal(JSON.stringify(reader.getDesktopIconDiagnostic()).includes("secret"), false);
});

test("one Explorer coordinate failure rejects the whole snapshot and fails closed", async () => {
  let conversions = 0;
  const explorer = {
    async readRects() {
      return collectExplorerIconRects({
        count: 2,
        readItemRect(index) {
          return [index * 40, 0, index * 40 + 32, 32];
        },
        toLogicalRect(rect) {
          conversions += 1;
          return conversions === 1 ? rect : null;
        }
      });
    }
  };
  const reader = createDesktopIconReader({
    explorer,
    uia: { async readRects() { throw new Error("uia-unavailable"); } }
  });

  assert.throws(
    () => collectExplorerIconRects({
      count: 2,
      readItemRect(index) {
        return [index * 40, 0, index * 40 + 32, 32];
      },
      toLogicalRect(_rect, index) {
        return index === 0 ? [0, 0, 32, 32] : null;
      }
    }),
    /coordinate-conversion-failed/
  );
  assert.deepEqual(await reader.readDesktopIconRects(), []);
  assert.deepEqual(reader.getDesktopIconDiagnostic(), {
    status: "unavailable",
    primary: "failed",
    fallback: "failed",
    count: 0
  });
});

test("one Explorer item read failure rejects the whole snapshot and fails closed", async () => {
  function readRects() {
    return collectExplorerIconRects({
      count: 2,
      readItemRect(index) {
        return index === 0 ? [0, 0, 32, 32] : null;
      },
      toLogicalRect(rect) {
        return rect;
      }
    });
  }
  const reader = createDesktopIconReader({
    explorer: { async readRects() { return readRects(); } },
    uia: { async readRects() { throw new Error("uia-unavailable"); } }
  });

  const obstacles = await reader.readDesktopIconRects();
  let directError = null;
  try {
    readRects();
  } catch (error) {
    directError = error;
  }

  assert.match(directError?.message ?? "", /item-read-failed/);
  assert.deepEqual(obstacles, []);
  assert.deepEqual(reader.getDesktopIconDiagnostic(), {
    status: "unavailable",
    primary: "failed",
    fallback: "failed",
    count: 0
  });
});

test("taskbar provider returns only plain integer rectangles", () => {
  const provider = createTaskbarProvider({
    native: {
      readTaskbars() {
        return [{ id: "primary", rect: [0.2, 1040.1, 1920, 1080] }];
      },
      readScreenBounds() {
        return [-1920, 0, 1920, 1080];
      }
    }
  });

  assert.deepEqual(provider.readTaskbarRects(), [
    {
      source: "taskbar",
      id: "taskbar:primary",
      rect: { x: 0, y: 1040, width: 1920, height: 40 }
    }
  ]);
  assert.deepEqual(provider.readScreenBounds(), {
    source: "screen",
    id: "screen:virtual",
    rect: { x: -1920, y: 0, width: 3840, height: 1080 }
  });
});

test("screen bounds union per-monitor DIP rectangles on mixed-DPI desktops", () => {
  const provider = createTaskbarProvider({
    native: {
      readTaskbars() {
        return [];
      },
      readScreenRects() {
        return [
          [0, 0, 1920, 1080],
          [1920, -854, 3000, 1066]
        ];
      }
    }
  });

  assert.deepEqual(provider.readScreenBounds(), {
    source: "screen",
    id: "screen:virtual",
    rect: { x: 0, y: -854, width: 3000, height: 1934 }
  });
});
