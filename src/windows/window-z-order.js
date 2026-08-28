const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOOWNERZORDER = 0x0200;
const BOTTOM_FLAGS = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;

function normalizeHwnd(hwnd) {
  if (Buffer.isBuffer(hwnd)) {
    if (hwnd.length >= 8) return hwnd.readBigUInt64LE(0);
    if (hwnd.length >= 4) return BigInt(hwnd.readUInt32LE(0));
    return 0n;
  }
  if (typeof hwnd === "bigint") return hwnd;
  if (Number.isSafeInteger(hwnd)) return BigInt(hwnd);
  return 0n;
}

function createWindowZOrder({ native = createNativeZOrderBindings() } = {}) {
  return Object.freeze({
    sendToBottom(hwnd) {
      const normalized = normalizeHwnd(hwnd);
      if (normalized <= 0n) return false;
      try {
        return Boolean(native.setWindowPos(
          normalized,
          HWND_BOTTOM,
          0,
          0,
          0,
          0,
          BOTTOM_FLAGS
        ));
      } catch {
        return false;
      }
    }
  });
}

function createNativeZOrderBindings() {
  if (process.platform !== "win32") return { setWindowPos: () => false };
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const SetWindowPos = user32.func(
    "int32_t __stdcall SetWindowPos(uintptr_t hwnd, intptr_t insertAfter, int32_t x, int32_t y, int32_t width, int32_t height, uint32_t flags)"
  );
  return { setWindowPos: SetWindowPos };
}

module.exports = { createWindowZOrder };
