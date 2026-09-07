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
    placeBelow(hwnd, targetHwnd) {
      const pet = normalizeHwnd(hwnd);
      const target = normalizeHwnd(targetHwnd);
      if (pet <= 0n || target <= 0n || pet === target) return false;
      try {
        if (!native.isWindow(pet) || !native.isWindow(target)
          || native.isTopmost(target) !== false) return false;
        return Boolean(native.setWindowPos(pet, target, 0, 0, 0, 0, BOTTOM_FLAGS));
      } catch {
        return false;
      }
    },
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
  const IsWindow = user32.func("int32_t __stdcall IsWindow(uintptr_t hwnd)");
  const GetWindowLong = user32.func(process.arch === "ia32"
    ? "int32_t __stdcall GetWindowLongW(uintptr_t hwnd, int32_t index)"
    : "intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd, int32_t index)");
  const kernel32 = koffi.load("kernel32.dll");
  const SetLastError = kernel32.func("void __stdcall SetLastError(uint32_t error)");
  const GetLastError = kernel32.func("uint32_t __stdcall GetLastError()");
  return {
    setWindowPos: SetWindowPos,
    isWindow: hwnd => Boolean(IsWindow(hwnd)),
    isTopmost(hwnd) {
      SetLastError(0);
      const style = BigInt(GetWindowLong(hwnd, -20));
      if (style === 0n && GetLastError() !== 0) return null;
      return (style & 0x8n) !== 0n;
    }
  };
}

module.exports = { createWindowZOrder };
