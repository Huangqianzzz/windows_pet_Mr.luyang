const { test } = require("node:test");
const assert = require("node:assert/strict");

test("placeBelow inserts the render HWND after the specific target without move or activation", () => {
  const { createWindowZOrder } = require("../src/windows/window-z-order");
  const calls = [];
  const native = { isWindow: () => true, isTopmost: () => false,
    isWindowVisible: () => true, isIconic: () => false,
    setWindowPos: (...args) => { calls.push(args); return true; } };
  const zOrder = createWindowZOrder({ native });
  assert.equal(typeof zOrder.placeBelow, "function");
  assert.equal(zOrder.placeBelow(123, 456), true);
  assert.deepEqual(calls, [[123n, 456n, 0, 0, 0, 0, 0x0213]]);
  for (const invalid of [undefined, null, 0, -1, 1.5, Buffer.alloc(0)]) {
    assert.equal(zOrder.placeBelow(123, invalid), false);
    assert.equal(zOrder.placeBelow(invalid, 456), false);
  }
  assert.equal(zOrder.placeBelow(123, 123), false);
  native.isWindow = () => false;
  assert.equal(zOrder.placeBelow(123, 456), false);
  native.isWindow = () => true;
  for (const topmost of [true, undefined, null]) {
    native.isTopmost = () => topmost;
    assert.equal(zOrder.placeBelow(123, 456), false);
  }
  assert.equal(calls.length, 1);
  native.isTopmost = () => false;
  native.setWindowPos = () => false;
  assert.equal(zOrder.placeBelow(123, 456), false);
  native.setWindowPos = () => { throw new Error("native failure"); };
  assert.equal(zOrder.placeBelow(123, 456), false);
});

test("placeBelow rejects an invisible or minimized target immediately before placement", () => {
  const { createWindowZOrder } = require("../src/windows/window-z-order");
  let placements = 0;
  let visible = false;
  let minimized = false;
  const zOrder = createWindowZOrder({ native: {
    isWindow: () => true, isTopmost: () => false,
    isWindowVisible: () => visible, isIconic: () => minimized,
    setWindowPos() { placements++; return true; }
  } });
  assert.equal(zOrder.placeBelow(123, 77), false);
  visible = true;
  minimized = true;
  assert.equal(zOrder.placeBelow(123, 77), false);
  minimized = undefined;
  assert.equal(zOrder.placeBelow(123, 77), false);
  assert.equal(placements, 0);
  minimized = false;
  assert.equal(zOrder.placeBelow(123, 77), true);
  assert.equal(placements, 1);
});

test("window z-order sends an Electron native handle to HWND_BOTTOM without moving or activating", () => {
  const { createWindowZOrder } = require("../src/windows/window-z-order");
  const calls = [];
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(123n);
  const zOrder = createWindowZOrder({
    native: {
      setWindowPos(...args) {
        calls.push(args);
        return true;
      }
    }
  });

  assert.equal(zOrder.sendToBottom(handle), true);
  assert.deepEqual(calls, [[123n, 1, 0, 0, 0, 0, 0x0213]]);
});

test("window z-order safely rejects invalid handles and native failures", () => {
  const { createWindowZOrder } = require("../src/windows/window-z-order");
  const zOrder = createWindowZOrder({
    native: { setWindowPos() { throw new Error("invalid HWND"); } }
  });

  assert.equal(zOrder.sendToBottom(null), false);
  assert.equal(zOrder.sendToBottom(Buffer.alloc(0)), false);
  assert.equal(zOrder.sendToBottom(0), false);
  assert.equal(zOrder.sendToBottom(44), false);
});
