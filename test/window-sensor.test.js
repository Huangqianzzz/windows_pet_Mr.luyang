const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createWinEventSubscriber,
  createWindowSensor
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
    emitChange() {
      listener?.();
    }
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
  native.emitChange();
  sensor.stop();
  native.replace([windowRecord(3)]);
  native.emitChange();

  assert.deepEqual(changes.map(items => items.map(item => item.hwnd)), [[2]]);
  assert.deepEqual(sensor.snapshot().map(item => item.hwnd), [2]);
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
