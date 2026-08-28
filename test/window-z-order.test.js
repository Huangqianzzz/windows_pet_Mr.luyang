const { test } = require("node:test");
const assert = require("node:assert/strict");

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
