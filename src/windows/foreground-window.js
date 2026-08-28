function normalizeRect(rect) {
  const values = Array.isArray(rect)
    ? rect
    : rect && [rect.left, rect.top, rect.right, rect.bottom];
  if (!values || values.length !== 4 || !values.every(Number.isFinite)) return null;
  const [left, top, right, bottom] = values;
  if (right <= left || bottom <= top) return null;
  return {
    x: Math.floor(left),
    y: Math.floor(top),
    width: Math.ceil(right) - Math.floor(left),
    height: Math.ceil(bottom) - Math.floor(top)
  };
}

function intersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function classifyFullscreen(rect, targetDisplay) {
  const bounds = targetDisplay?.bounds;
  if (!rect || !bounds || bounds.width <= 0 || bounds.height <= 0) return false;
  return intersectionArea(rect, bounds) / (bounds.width * bounds.height) >= 0.995;
}

function createForegroundWindowReader({
  native = createNativeForegroundBindings(),
  screen
} = {}) {
  return Object.freeze({
    snapshot() {
      try {
        const hwnd = native.getForegroundWindow();
        if (!hwnd) return null;
        const physicalRect = native.getWindowRect(hwnd);
        if (!physicalRect) return null;
        const rect = normalizeRect(native.toDipRect(hwnd, physicalRect));
        const processId = native.getWindowProcessId(hwnd);
        if (!rect || !Number.isInteger(processId) || processId <= 0) return null;
        const foregroundDisplay = screen?.getDisplayMatching(rect);
        return {
          hwnd,
          processId,
          rect,
          maximized: Boolean(native.isZoomed(hwnd)),
          fullscreen: classifyFullscreen(rect, foregroundDisplay)
        };
      } catch {
        return null;
      }
    }
  });
}

function isForegroundBlocking(snapshot, {
  screen,
  targetDisplay,
  ownProcessId = process.pid,
  ownWindowHandles = []
} = {}) {
  if (!snapshot || !targetDisplay || snapshot.processId === ownProcessId) return false;
  if (ownWindowHandles.some(hwnd => hwnd === snapshot.hwnd)) return false;
  let foregroundDisplay;
  try {
    foregroundDisplay = screen?.getDisplayMatching(snapshot.rect);
  } catch {
    return false;
  }
  if (!foregroundDisplay || foregroundDisplay.id !== targetDisplay.id) return false;
  return Boolean(snapshot.maximized || snapshot.fullscreen);
}

function createNativeForegroundBindings() {
  if (process.platform !== "win32") {
    return {
      getForegroundWindow: () => 0,
      getWindowProcessId: () => 0,
      getWindowRect: () => null,
      isZoomed: () => false,
      toDipRect: (_hwnd, rect) => rect
    };
  }

  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const RECT = koffi.struct("FOREGROUND_WINDOW_RECT", {
    left: "int32_t",
    top: "int32_t",
    right: "int32_t",
    bottom: "int32_t"
  });
  const GetForegroundWindow = user32.func("uintptr_t __stdcall GetForegroundWindow()");
  const GetWindowThreadProcessId = user32.func(
    "uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *processId)"
  );
  const IsZoomed = user32.func("int32_t __stdcall IsZoomed(uintptr_t hwnd)");
  const GetWindowRect = user32.func(
    "int32_t __stdcall GetWindowRect(uintptr_t hwnd, _Out_ FOREGROUND_WINDOW_RECT *rect)"
  );
  const SetThreadDpiAwarenessContext = user32.func(
    "intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t dpiContext)"
  );

  function withDpiContext(context, operation) {
    const previous = SetThreadDpiAwarenessContext(context);
    if (!previous) return null;
    try {
      return operation();
    } finally {
      SetThreadDpiAwarenessContext(previous);
    }
  }

  function readRect(hwnd, context) {
    return withDpiContext(context, () => {
      const rect = {};
      return GetWindowRect(hwnd, rect) ? [rect.left, rect.top, rect.right, rect.bottom] : null;
    });
  }

  return {
    getForegroundWindow: () => Number(GetForegroundWindow()),
    getWindowProcessId(hwnd) {
      const processId = [null];
      GetWindowThreadProcessId(hwnd, processId);
      return Number(processId[0] || 0);
    },
    getWindowRect: hwnd => readRect(hwnd, -4),
    isZoomed: hwnd => Boolean(IsZoomed(hwnd)),
    toDipRect(hwnd, frame) {
      const physical = readRect(hwnd, -4);
      const logical = readRect(hwnd, -1);
      if (!physical || !logical) return null;
      const physicalWidth = physical[2] - physical[0];
      const physicalHeight = physical[3] - physical[1];
      const logicalWidth = logical[2] - logical[0];
      const logicalHeight = logical[3] - logical[1];
      if (physicalWidth <= 0 || physicalHeight <= 0 || logicalWidth <= 0 || logicalHeight <= 0) {
        return null;
      }
      const scaleX = logicalWidth / physicalWidth;
      const scaleY = logicalHeight / physicalHeight;
      return [
        logical[0] + (frame[0] - physical[0]) * scaleX,
        logical[1] + (frame[1] - physical[1]) * scaleY,
        logical[0] + (frame[2] - physical[0]) * scaleX,
        logical[1] + (frame[3] - physical[1]) * scaleY
      ];
    }
  };
}

module.exports = {
  classifyFullscreen,
  createForegroundWindowReader,
  isForegroundBlocking
};
