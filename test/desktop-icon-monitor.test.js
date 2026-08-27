const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDesktopIconMonitor } = require("../src/runtime/desktop-icon-monitor");

test("desktop icon monitor publishes trusted snapshots and preserves them on reader failure", async () => {
  const snapshots = [];
  let status = "ok";
  let items = [{ source: "desktop-icon", id: "desktop-icon:1", rect: { x: 1, y: 2, width: 3, height: 4 } }];
  const monitor = createDesktopIconMonitor({
    async readRects() { return items; },
    getDiagnostic() { return { status }; },
    onChange(value) { snapshots.push(value); },
    setIntervalFn() { return 1; },
    clearIntervalFn() {}
  });

  monitor.start();
  await monitor.refresh();
  assert.deepEqual(snapshots, [items]);

  status = "unavailable";
  items = [];
  assert.equal(await monitor.refresh(), false);
  assert.deepEqual(snapshots, [snapshots[0]]);
  monitor.stop();
});

test("desktop icon monitor clears disabled collisions and refreshes when re-enabled", async () => {
  const snapshots = [];
  const icons = [{ source: "desktop-icon", id: "desktop-icon:1", rect: { x: 1, y: 2, width: 3, height: 4 } }];
  const monitor = createDesktopIconMonitor({
    async readRects() { return icons; },
    getDiagnostic() { return { status: "ok" }; },
    onChange(value) { snapshots.push(value); },
    enabled: false,
    setIntervalFn() { return 1; },
    clearIntervalFn() {}
  });

  monitor.start();
  assert.deepEqual(snapshots, [[]]);
  monitor.setEnabled(true);
  await monitor.refresh();
  assert.deepEqual(snapshots.at(-1), icons);
  monitor.stop();
});
