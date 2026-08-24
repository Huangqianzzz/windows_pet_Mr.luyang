function normalizeRect(raw) {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every(Number.isFinite)) return null;
  const left = Math.floor(raw[0]);
  const top = Math.floor(raw[1]);
  const right = Math.ceil(raw[2]);
  const bottom = Math.ceil(raw[3]);
  if (right <= left || bottom <= top) return null;
  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

function createTaskbarProvider({ native }) {
  return Object.freeze({
    readTaskbarRects() {
      let taskbars;
      try {
        taskbars = native.readTaskbars();
      } catch {
        taskbars = [];
      }
      if (!Array.isArray(taskbars)) taskbars = [];

      return Object.freeze(taskbars.map(taskbar => {
        const rect = normalizeRect(taskbar.rect);
        if (!rect) return null;
        return Object.freeze({
          source: "taskbar",
          id: `taskbar:${String(taskbar.id)}`,
          rect
        });
      }).filter(Boolean));
    },
    readScreenBounds() {
      let rawRects;
      try {
        rawRects = typeof native.readScreenRects === "function"
          ? native.readScreenRects()
          : [native.readScreenBounds()];
      } catch {
        return null;
      }
      if (!Array.isArray(rawRects)) return null;

      const rects = rawRects.map(normalizeRect).filter(Boolean);
      if (rects.length === 0) return null;
      const left = Math.min(...rects.map(rect => rect.x));
      const top = Math.min(...rects.map(rect => rect.y));
      const right = Math.max(...rects.map(rect => rect.x + rect.width));
      const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
      return Object.freeze({
        source: "screen",
        id: "screen:virtual",
        rect: Object.freeze({ x: left, y: top, width: right - left, height: bottom - top })
      });
    }
  });
}

function createNativeTaskbarBindings() {
  if (process.platform !== "win32") {
    return {
      readTaskbars() { return []; },
      readScreenRects() { return []; }
    };
  }

  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const HANDLE = koffi.pointer("TASKBAR_HANDLE", koffi.opaque());
  const HWND = koffi.alias("TASKBAR_HWND", HANDLE);
  const HMONITOR = koffi.alias("TASKBAR_HMONITOR", HANDLE);
  const HDC = koffi.alias("TASKBAR_HDC", HANDLE);
  const RECT = koffi.struct("TASKBAR_RECT", {
    left: "int32_t",
    top: "int32_t",
    right: "int32_t",
    bottom: "int32_t"
  });
  const MONITORENUMPROC = koffi.proto(
    "int32_t __stdcall TASKBAR_MONITORENUMPROC(TASKBAR_HMONITOR monitor, TASKBAR_HDC hdc, const TASKBAR_RECT *rect, intptr_t data)"
  );

  const FindWindowW = user32.func(
    "TASKBAR_HWND __stdcall FindWindowW(const char16_t *className, const char16_t *windowName)"
  );
  const FindWindowExW = user32.func(
    "TASKBAR_HWND __stdcall FindWindowExW(TASKBAR_HWND parent, TASKBAR_HWND childAfter, const char16_t *className, const char16_t *windowName)"
  );
  const GetWindowRect = user32.func(
    "int32_t __stdcall GetWindowRect(TASKBAR_HWND hwnd, _Out_ TASKBAR_RECT *rect)"
  );
  const SetThreadDpiAwarenessContext = user32.func(
    "intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t dpiContext)"
  );
  const EnumDisplayMonitors = user32.func(
    "int32_t __stdcall EnumDisplayMonitors(TASKBAR_HDC hdc, const TASKBAR_RECT *clip, TASKBAR_MONITORENUMPROC *callback, intptr_t data)"
  );

  function withUnawareDpi(operation) {
    const previous = SetThreadDpiAwarenessContext(-1);
    if (!previous) return null;
    try {
      return operation();
    } finally {
      SetThreadDpiAwarenessContext(previous);
    }
  }

  function readTaskbarRect(hwnd) {
    return withUnawareDpi(() => {
      const rect = {};
      return GetWindowRect(hwnd, rect)
        ? [rect.left, rect.top, rect.right, rect.bottom]
        : null;
    });
  }

  return {
    readTaskbars() {
      const taskbars = [];
      const primary = FindWindowW("Shell_TrayWnd", null);
      if (primary) {
        const rect = readTaskbarRect(primary);
        if (rect) taskbars.push({ id: "primary", rect });
      }

      let previous = null;
      let secondaryIndex = 0;
      for (;;) {
        const next = FindWindowExW(null, previous, "Shell_SecondaryTrayWnd", null);
        if (!next) break;
        const rect = readTaskbarRect(next);
        if (rect) taskbars.push({ id: `secondary-${secondaryIndex}`, rect });
        secondaryIndex += 1;
        previous = next;
      }
      return taskbars;
    },
    readScreenRects() {
      return withUnawareDpi(() => {
        const screens = [];
        EnumDisplayMonitors(null, null, (_monitor, _hdc, rectPointer) => {
          const rect = koffi.decode(rectPointer, RECT);
          screens.push([rect.left, rect.top, rect.right, rect.bottom]);
          return 1;
        }, 0);
        return screens;
      }) || [];
    }
  };
}

let defaultProvider = null;

function getDefaultProvider() {
  if (!defaultProvider) {
    defaultProvider = createTaskbarProvider({ native: createNativeTaskbarBindings() });
  }
  return defaultProvider;
}

function readTaskbarRects() {
  return getDefaultProvider().readTaskbarRects();
}

function readScreenBounds() {
  return getDefaultProvider().readScreenBounds();
}

module.exports = { createTaskbarProvider, readScreenBounds, readTaskbarRects };
