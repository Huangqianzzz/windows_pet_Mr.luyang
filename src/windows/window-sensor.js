const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const EVENT_SYSTEM_MINIMIZESTART = 0x0016;
const EVENT_SYSTEM_MINIMIZEEND = 0x0017;
const EVENT_OBJECT_DESTROY = 0x8001;
const EVENT_OBJECT_SHOW = 0x8002;
const EVENT_OBJECT_HIDE = 0x8003;
const EVENT_OBJECT_LOCATIONCHANGE = 0x800b;
const WINEVENT_OUTOFCONTEXT = 0;
const WINEVENT_SKIPOWNPROCESS = 2;

function normalizeRect(rect) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) {
    return null;
  }

  const left = Math.floor(rect[0]);
  const top = Math.floor(rect[1]);
  const right = Math.ceil(rect[2]);
  const bottom = Math.ceil(rect[3]);
  if (right <= left || bottom <= top) {
    return null;
  }

  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

function toObstacle(record, native, ownProcessId) {
  if (
    !record ||
    !Number.isInteger(record.hwnd) ||
    !record.visible ||
    record.cloaked ||
    record.minimized ||
    record.systemWindow
  ) {
    return null;
  }
  if (record.processId === ownProcessId || !record.rect) {
    return null;
  }

  let dipRect;
  try {
    dipRect = native.toDipRect(record.hwnd, record.rect);
  } catch {
    return null;
  }
  const rect = normalizeRect(dipRect);
  if (!rect) {
    return null;
  }

  return Object.freeze({
    source: "window",
    id: `window:${record.hwnd}`,
    hwnd: record.hwnd,
    rect
  });
}

function createWinEventSubscriber({
  registerCallback,
  unregisterCallback,
  installHooks,
  unhook
}) {
  return Object.freeze({
    subscribe(listener) {
      const callback = registerCallback(listener);
      let hooks;
      try {
        hooks = installHooks(callback).filter(Boolean);
      } catch (error) {
        unregisterCallback(callback);
        throw error;
      }

      const activeHooks = new Set(hooks);
      let callbackRegistered = true;
      if (activeHooks.size === 0) {
        unregisterCallback(callback);
        callbackRegistered = false;
      }

      return () => {
        if (!callbackRegistered) return true;

        for (const hook of [...activeHooks]) {
          let removed = false;
          try {
            removed = Boolean(unhook(hook));
          } catch {
            removed = false;
          }
          if (removed) activeHooks.delete(hook);
        }
        if (activeHooks.size > 0) return false;

        unregisterCallback(callback);
        callbackRegistered = false;
        return true;
      };
    }
  });
}

function createWindowSensor({
  native = createNativeWindowBindings(),
  ownProcessId = process.pid,
  onChange = () => {}
} = {}) {
  let obstacles = Object.freeze([]);
  let unsubscribe = null;

  function refresh() {
    let records;
    try {
      records = native.enumerateWindows();
    } catch {
      records = [];
    }
    if (!Array.isArray(records)) {
      records = [];
    }

    obstacles = Object.freeze(
      records.map(record => toObstacle(record, native, ownProcessId)).filter(Boolean)
    );
    return obstacles;
  }

  refresh();

  return Object.freeze({
    start() {
      if (!unsubscribe) {
        unsubscribe = native.subscribe(() => {
          onChange(refresh());
        });
      }
      return this;
    },
    stop() {
      if (!unsubscribe) return true;
      if (unsubscribe() === false) return false;
      unsubscribe = null;
      return true;
    },
    snapshot() {
      return obstacles;
    }
  });
}

function createNativeWindowBindings() {
  if (process.platform !== "win32") {
    return {
      enumerateWindows() { return []; },
      toDipRect(_hwnd, rect) { return rect; },
      subscribe() { return () => {}; }
    };
  }

  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const dwmapi = koffi.load("dwmapi.dll");

  const HANDLE = koffi.pointer("WINDOW_SENSOR_HANDLE", koffi.opaque());
  const HWND = koffi.alias("WINDOW_SENSOR_HWND", HANDLE);
  const HWINEVENTHOOK = koffi.alias("WINDOW_SENSOR_HWINEVENTHOOK", HANDLE);
  const RECT = koffi.struct("WINDOW_SENSOR_RECT", {
    left: "int32_t",
    top: "int32_t",
    right: "int32_t",
    bottom: "int32_t"
  });
  const WNDENUMPROC = koffi.proto(
    "int32_t __stdcall WINDOW_SENSOR_WNDENUMPROC(WINDOW_SENSOR_HWND hwnd, intptr_t lParam)"
  );
  const WINEVENTPROC = koffi.proto(
    "void __stdcall WINDOW_SENSOR_WINEVENTPROC(WINDOW_SENSOR_HWINEVENTHOOK hook, uint32_t event, WINDOW_SENSOR_HWND hwnd, int32_t idObject, int32_t idChild, uint32_t eventThread, uint32_t eventTime)"
  );

  const EnumWindows = user32.func(
    "int32_t __stdcall EnumWindows(WINDOW_SENSOR_WNDENUMPROC *callback, intptr_t lParam)"
  );
  const IsWindowVisible = user32.func(
    "int32_t __stdcall IsWindowVisible(WINDOW_SENSOR_HWND hwnd)"
  );
  const IsIconic = user32.func("int32_t __stdcall IsIconic(WINDOW_SENSOR_HWND hwnd)");
  const GetWindowRect = user32.func(
    "int32_t __stdcall GetWindowRect(WINDOW_SENSOR_HWND hwnd, _Out_ WINDOW_SENSOR_RECT *rect)"
  );
  const GetClassNameW = user32.func(
    "int32_t __stdcall GetClassNameW(WINDOW_SENSOR_HWND hwnd, _Out_ uint16_t *className, int32_t maxCount)"
  );
  const GetWindowThreadProcessId = user32.func(
    "uint32_t __stdcall GetWindowThreadProcessId(WINDOW_SENSOR_HWND hwnd, _Out_ uint32_t *processId)"
  );
  const GetDpiForWindow = user32.func(
    "uint32_t __stdcall GetDpiForWindow(WINDOW_SENSOR_HWND hwnd)"
  );
  const SetThreadDpiAwarenessContext = user32.func(
    "intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t dpiContext)"
  );
  const SetWinEventHook = user32.func(
    "WINDOW_SENSOR_HWINEVENTHOOK __stdcall SetWinEventHook(uint32_t eventMin, uint32_t eventMax, WINDOW_SENSOR_HANDLE module, WINDOW_SENSOR_WINEVENTPROC *callback, uint32_t processId, uint32_t threadId, uint32_t flags)"
  );
  const UnhookWinEvent = user32.func(
    "int32_t __stdcall UnhookWinEvent(WINDOW_SENSOR_HWINEVENTHOOK hook)"
  );
  const DwmGetWindowRect = dwmapi.func(
    "int32_t __stdcall DwmGetWindowAttribute(WINDOW_SENSOR_HWND hwnd, uint32_t attribute, _Out_ WINDOW_SENSOR_RECT *value, uint32_t valueSize)"
  );
  const DwmGetWindowDword = dwmapi.func(
    "int32_t __stdcall DwmGetWindowAttribute(WINDOW_SENSOR_HWND hwnd, uint32_t attribute, _Out_ uint32_t *value, uint32_t valueSize)"
  );
  const eventSubscriber = createWinEventSubscriber({
    registerCallback(callback) {
      return koffi.register(callback, koffi.pointer(WINEVENTPROC));
    },
    unregisterCallback(callback) {
      koffi.unregister(callback);
    },
    installHooks(callback) {
      return [
        SetWinEventHook(
          EVENT_SYSTEM_MINIMIZESTART,
          EVENT_SYSTEM_MINIMIZEEND,
          null,
          callback,
          0,
          0,
          WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
        ),
        SetWinEventHook(
          EVENT_OBJECT_DESTROY,
          EVENT_OBJECT_LOCATIONCHANGE,
          null,
          callback,
          0,
          0,
          WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
        )
      ];
    },
    unhook(hook) {
      return Boolean(UnhookWinEvent(hook));
    }
  });

  function withDpiContext(context, operation) {
    const previous = SetThreadDpiAwarenessContext(context);
    if (!previous) return null;
    try {
      return operation();
    } finally {
      SetThreadDpiAwarenessContext(previous);
    }
  }

  function readWindowRect(hwnd, context) {
    return withDpiContext(context, () => {
      const rect = {};
      return GetWindowRect(hwnd, rect) ? rect : null;
    });
  }

  function convertPhysicalRect(hwnd, frame) {
    const dpi = GetDpiForWindow(hwnd);
    const physical = readWindowRect(hwnd, -4);
    const logical = readWindowRect(hwnd, -1);
    if (!dpi || !physical || !logical) return null;

    const physicalWidth = physical.right - physical.left;
    const physicalHeight = physical.bottom - physical.top;
    const logicalWidth = logical.right - logical.left;
    const logicalHeight = logical.bottom - logical.top;
    if (physicalWidth <= 0 || physicalHeight <= 0 || logicalWidth <= 0 || logicalHeight <= 0) {
      return null;
    }

    const scaleX = logicalWidth / physicalWidth;
    const scaleY = logicalHeight / physicalHeight;
    return [
      logical.left + (frame.left - physical.left) * scaleX,
      logical.top + (frame.top - physical.top) * scaleY,
      logical.left + (frame.right - physical.left) * scaleX,
      logical.top + (frame.bottom - physical.top) * scaleY
    ];
  }

  function isSystemShellWindow(hwnd) {
    const buffer = Buffer.alloc(512);
    const length = GetClassNameW(hwnd, buffer, 256);
    if (length <= 0) return false;
    const className = buffer.toString("utf16le", 0, length * 2);
    return new Set([
      "Progman",
      "WorkerW",
      "Shell_TrayWnd",
      "Shell_SecondaryTrayWnd"
    ]).has(className);
  }

  return {
    enumerateWindows() {
      const records = [];
      EnumWindows(hwnd => {
        const processId = [null];
        GetWindowThreadProcessId(hwnd, processId);

        const frame = {};
        const frameResult = DwmGetWindowRect(
          hwnd,
          DWMWA_EXTENDED_FRAME_BOUNDS,
          frame,
          koffi.sizeof(RECT)
        );
        const cloaked = [null];
        const cloakResult = DwmGetWindowDword(hwnd, DWMWA_CLOAKED, cloaked, 4);
        const hwndNumber = Number(koffi.address(hwnd));

        records.push({
          hwnd: hwndNumber,
          visible: Boolean(IsWindowVisible(hwnd)),
          cloaked: cloakResult !== 0 || Boolean(cloaked[0]),
          minimized: Boolean(IsIconic(hwnd)),
          systemWindow: isSystemShellWindow(hwnd),
          processId: Number(processId[0] || 0),
          rect: frameResult === 0 ? convertPhysicalRect(hwnd, frame) : null
        });
        return 1;
      }, 0);
      return records;
    },
    toDipRect(_hwnd, rect) {
      return rect;
    },
    subscribe(listener) {
      return eventSubscriber.subscribe(
        (_hook, event, _hwnd, idObject) => {
          const isSystemEvent = event === EVENT_SYSTEM_MINIMIZESTART || event === EVENT_SYSTEM_MINIMIZEEND;
          const isWindowEvent = idObject === 0 && (
            event === EVENT_OBJECT_DESTROY ||
            event === EVENT_OBJECT_SHOW ||
            event === EVENT_OBJECT_HIDE ||
            event === EVENT_OBJECT_LOCATIONCHANGE
          );
          if (isSystemEvent || isWindowEvent) listener();
        }
      );
    }
  };
}

module.exports = { createWinEventSubscriber, createWindowSensor };
