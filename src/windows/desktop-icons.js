const { execFile } = require("node:child_process");

const LVM_FIRST = 0x1000;
const LVM_GETITEMCOUNT = LVM_FIRST + 4;
const LVM_GETITEMRECT = LVM_FIRST + 14;
const LVIR_BOUNDS = 0;
const MEM_COMMIT = 0x1000;
const MEM_RESERVE = 0x2000;
const MEM_RELEASE = 0x8000;
const PAGE_READWRITE = 0x04;
const PROCESS_VM_OPERATION = 0x0008;
const PROCESS_VM_READ = 0x0010;
const PROCESS_VM_WRITE = 0x0020;
const SMTO_ABORTIFHUNG = 0x0002;
const SMTO_ERRORONEXIT = 0x0020;
const MAX_DESKTOP_ICONS = 4096;

function normalizeIcon(item) {
  if (!item || !Array.isArray(item.rect) || item.rect.length !== 4) return null;
  if (!item.rect.every(Number.isFinite)) return null;

  const left = Math.floor(item.rect[0]);
  const top = Math.floor(item.rect[1]);
  const right = Math.ceil(item.rect[2]);
  const bottom = Math.ceil(item.rect[3]);
  if (right <= left || bottom <= top) return null;

  return Object.freeze({
    source: "desktop-icon",
    id: `desktop-icon:${String(item.id)}`,
    rect: Object.freeze({ x: left, y: top, width: right - left, height: bottom - top })
  });
}

function collectExplorerIconRects({ count, readItemRect, toLogicalRect }) {
  const rects = [];
  for (let index = 0; index < count; index += 1) {
    const itemRect = readItemRect(index);
    if (!itemRect) throw new Error("item-read-failed");

    const logicalRect = toLogicalRect(itemRect, index);
    if (!Array.isArray(logicalRect) || logicalRect.length !== 4) {
      throw new Error("coordinate-conversion-failed");
    }
    rects.push({ id: String(index), rect: logicalRect });
  }
  return rects;
}

function createDesktopIconReader({ explorer, uia }) {
  let diagnostic = Object.freeze({ status: "not-run", count: 0 });

  async function tryReader(reader) {
    const items = await reader.readRects();
    if (!Array.isArray(items)) throw new TypeError("invalid-provider-result");
    return Object.freeze(items.map(normalizeIcon).filter(Boolean));
  }

  return Object.freeze({
    async readDesktopIconRects() {
      try {
        const obstacles = await tryReader(explorer);
        diagnostic = Object.freeze({
          status: "ok",
          method: "explorer-list-view",
          count: obstacles.length
        });
        return obstacles;
      } catch {
        try {
          const obstacles = await tryReader(uia);
          diagnostic = Object.freeze({
            status: "degraded",
            method: "uia-fallback",
            primary: "failed",
            count: obstacles.length
          });
          return obstacles;
        } catch {
          diagnostic = Object.freeze({
            status: "unavailable",
            primary: "failed",
            fallback: "failed",
            count: 0
          });
          return Object.freeze([]);
        }
      }
    },
    getDesktopIconDiagnostic() {
      return diagnostic;
    }
  });
}

function createExplorerListViewAdapter() {
  if (process.platform !== "win32") {
    return { async readRects() { throw new Error("unsupported-platform"); } };
  }

  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const HANDLE = koffi.pointer("DESKTOP_ICON_HANDLE", koffi.opaque());
  const HWND = koffi.alias("DESKTOP_ICON_HWND", HANDLE);
  const POINT = koffi.struct("DESKTOP_ICON_POINT", { x: "int32_t", y: "int32_t" });
  const WNDENUMPROC = koffi.proto(
    "int32_t __stdcall DESKTOP_ICON_WNDENUMPROC(DESKTOP_ICON_HWND hwnd, intptr_t lParam)"
  );

  const FindWindowW = user32.func(
    "DESKTOP_ICON_HWND __stdcall FindWindowW(const char16_t *className, const char16_t *windowName)"
  );
  const FindWindowExW = user32.func(
    "DESKTOP_ICON_HWND __stdcall FindWindowExW(DESKTOP_ICON_HWND parent, DESKTOP_ICON_HWND childAfter, const char16_t *className, const char16_t *windowName)"
  );
  const EnumWindows = user32.func(
    "int32_t __stdcall EnumWindows(DESKTOP_ICON_WNDENUMPROC *callback, intptr_t lParam)"
  );
  const GetWindowThreadProcessId = user32.func(
    "uint32_t __stdcall GetWindowThreadProcessId(DESKTOP_ICON_HWND hwnd, _Out_ uint32_t *processId)"
  );
  const ClientToScreen = user32.func(
    "int32_t __stdcall ClientToScreen(DESKTOP_ICON_HWND hwnd, _Inout_ DESKTOP_ICON_POINT *point)"
  );
  const SetThreadDpiAwarenessContext = user32.func(
    "intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t dpiContext)"
  );
  const SendMessageTimeoutW = user32.func(
    "uintptr_t __stdcall SendMessageTimeoutW(DESKTOP_ICON_HWND hwnd, uint32_t message, uintptr_t wParam, void *lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)"
  );
  const OpenProcess = kernel32.func(
    "DESKTOP_ICON_HANDLE __stdcall OpenProcess(uint32_t access, int32_t inheritHandle, uint32_t processId)"
  );
  const CloseHandle = kernel32.func(
    "int32_t __stdcall CloseHandle(DESKTOP_ICON_HANDLE handle)"
  );
  const VirtualAllocEx = kernel32.func(
    "void * __stdcall VirtualAllocEx(DESKTOP_ICON_HANDLE process, void *address, size_t size, uint32_t allocationType, uint32_t protect)"
  );
  const VirtualFreeEx = kernel32.func(
    "int32_t __stdcall VirtualFreeEx(DESKTOP_ICON_HANDLE process, void *address, size_t size, uint32_t freeType)"
  );
  const WriteProcessMemory = kernel32.func(
    "int32_t __stdcall WriteProcessMemory(DESKTOP_ICON_HANDLE process, void *baseAddress, const void *buffer, size_t size, _Out_ size_t *written)"
  );
  const ReadProcessMemory = kernel32.func(
    "int32_t __stdcall ReadProcessMemory(DESKTOP_ICON_HANDLE process, const void *baseAddress, _Out_ void *buffer, size_t size, _Out_ size_t *read)"
  );

  function findListView() {
    const progman = FindWindowW("Progman", null);
    let shellView = progman
      ? FindWindowExW(progman, null, "SHELLDLL_DefView", null)
      : null;

    if (!shellView) {
      EnumWindows(hwnd => {
        const candidate = FindWindowExW(hwnd, null, "SHELLDLL_DefView", null);
        if (!candidate) return 1;
        shellView = candidate;
        return 0;
      }, 0);
    }

    return shellView
      ? FindWindowExW(shellView, null, "SysListView32", null)
      : null;
  }

  function sendMessage(hwnd, message, wParam, lParam) {
    const result = [null];
    const success = SendMessageTimeoutW(
      hwnd,
      message,
      wParam,
      lParam,
      SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT,
      250,
      result
    );
    if (!success) throw new Error("explorer-query-timeout");
    return Number(result[0] || 0);
  }

  function clientRectToLogical(hwnd, topLeft, bottomRight) {
    const previous = SetThreadDpiAwarenessContext(-1);
    if (!previous) return false;
    try {
      return Boolean(ClientToScreen(hwnd, topLeft) && ClientToScreen(hwnd, bottomRight));
    } finally {
      SetThreadDpiAwarenessContext(previous);
    }
  }

  return {
    async readRects() {
      const listView = findListView();
      if (!listView) throw new Error("desktop-list-view-unavailable");

      const processId = [null];
      if (!GetWindowThreadProcessId(listView, processId) || !processId[0]) {
        throw new Error("desktop-process-unavailable");
      }

      const processHandle = OpenProcess(
        PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE,
        0,
        processId[0]
      );
      if (!processHandle) throw new Error("desktop-process-inaccessible");

      let remoteRect = null;
      try {
        remoteRect = VirtualAllocEx(
          processHandle,
          null,
          16,
          MEM_COMMIT | MEM_RESERVE,
          PAGE_READWRITE
        );
        if (!remoteRect) throw new Error("desktop-buffer-unavailable");

        const count = Math.min(sendMessage(listView, LVM_GETITEMCOUNT, 0, null), MAX_DESKTOP_ICONS);
        return collectExplorerIconRects({
          count,
          readItemRect(index) {
            const request = Buffer.alloc(16);
            request.writeInt32LE(LVIR_BOUNDS, 0);
            const written = [null];
            if (
              !WriteProcessMemory(processHandle, remoteRect, request, request.length, written) ||
              Number(written[0]) !== request.length
            ) {
              throw new Error("desktop-buffer-write-failed");
            }

            if (!sendMessage(listView, LVM_GETITEMRECT, index, remoteRect)) return null;

            const response = Buffer.alloc(16);
            const bytesRead = [null];
            if (
              !ReadProcessMemory(processHandle, remoteRect, response, response.length, bytesRead) ||
              Number(bytesRead[0]) !== response.length
            ) {
              throw new Error("desktop-buffer-read-failed");
            }
            return [
              response.readInt32LE(0),
              response.readInt32LE(4),
              response.readInt32LE(8),
              response.readInt32LE(12)
            ];
          },
          toLogicalRect(rect) {
            const topLeft = { x: rect[0], y: rect[1] };
            const bottomRight = { x: rect[2], y: rect[3] };
            if (!clientRectToLogical(listView, topLeft, bottomRight)) return null;
            return [topLeft.x, topLeft.y, bottomRight.x, bottomRight.y];
          }
        });
      } finally {
        if (remoteRect) VirtualFreeEx(processHandle, remoteRect, 0, MEM_RELEASE);
        CloseHandle(processHandle);
      }
    }
  };
}

const UIA_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopIconNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFO {
    public int Size;
    public RECT Monitor;
    public RECT Work;
    public uint Flags;
  }
  [DllImport("user32.dll")]
  private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")]
  private static extern IntPtr MonitorFromPoint(POINT point, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFO info);

  private static RECT ReadMonitorRect(IntPtr monitor, IntPtr context) {
    IntPtr previous = SetThreadDpiAwarenessContext(context);
    if (previous == IntPtr.Zero) throw new InvalidOperationException("dpi-context-unavailable");
    try {
      MONITORINFO info = new MONITORINFO();
      info.Size = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfoW(monitor, ref info)) {
        throw new InvalidOperationException("monitor-info-unavailable");
      }
      return info.Monitor;
    } finally {
      SetThreadDpiAwarenessContext(previous);
    }
  }

  public static int[] ToLogicalRect(double left, double top, double right, double bottom) {
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    if (previous == IntPtr.Zero) throw new InvalidOperationException("dpi-context-unavailable");
    IntPtr monitor;
    try {
      POINT center = new POINT {
        X = (int)Math.Round((left + right) / 2),
        Y = (int)Math.Round((top + bottom) / 2)
      };
      monitor = MonitorFromPoint(center, 2);
    } finally {
      SetThreadDpiAwarenessContext(previous);
    }
    if (monitor == IntPtr.Zero) throw new InvalidOperationException("monitor-unavailable");

    RECT physical = ReadMonitorRect(monitor, new IntPtr(-4));
    RECT logical = ReadMonitorRect(monitor, new IntPtr(-1));
    double physicalWidth = physical.Right - physical.Left;
    double physicalHeight = physical.Bottom - physical.Top;
    if (physicalWidth <= 0 || physicalHeight <= 0) {
      throw new InvalidOperationException("monitor-bounds-invalid");
    }
    double scaleX = (logical.Right - logical.Left) / physicalWidth;
    double scaleY = (logical.Bottom - logical.Top) / physicalHeight;
    return new int[] {
      (int)Math.Floor(logical.Left + (left - physical.Left) * scaleX),
      (int)Math.Floor(logical.Top + (top - physical.Top) * scaleY),
      (int)Math.Ceiling(logical.Left + (right - physical.Left) * scaleX),
      (int)Math.Ceiling(logical.Top + (bottom - physical.Top) * scaleY)
    };
  }
}
'@
$root = [System.Windows.Automation.AutomationElement]::RootElement
$class = [System.Windows.Automation.AutomationElement]::ClassNameProperty
$desktopClasses = [System.Windows.Automation.OrCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new($class, 'Progman'),
  [System.Windows.Automation.PropertyCondition]::new($class, 'WorkerW')
)
$desktops = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $desktopClasses)
$container = $null
$largestArea = -1
foreach ($desktop in $desktops) {
  $shellCondition = [System.Windows.Automation.PropertyCondition]::new(
    $class, 'SHELLDLL_DefView'
  )
  $shellView = $desktop.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants, $shellCondition
  )
  if ($null -eq $shellView) { continue }
  $listCondition = [System.Windows.Automation.PropertyCondition]::new(
    $class, 'SysListView32'
  )
  $listView = $shellView.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants, $listCondition
  )
  if ($null -eq $listView) { continue }

  $bounds = $desktop.Current.BoundingRectangle
  $area = $bounds.Width * $bounds.Height
  if ($area -gt $largestArea) {
    $container = $listView
    $largestArea = $area
  }
}
if ($null -eq $container) { throw 'desktop-automation-chain-unavailable' }
$itemCondition = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::ListItem
)
$items = $container.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemCondition)
$rects = @()
$limit = [Math]::Min($items.Count, 4096)
for ($i = 0; $i -lt $limit; $i += 1) {
  $bounds = $items.Item($i).Current.BoundingRectangle
  if ($bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
  $rect = [DesktopIconNative]::ToLogicalRect(
    $bounds.Left, $bounds.Top, $bounds.Right, $bounds.Bottom
  )
  $rects += [pscustomobject]@{
    id = [string]$i
    rect = @($rect[0], $rect[1], $rect[2], $rect[3])
  }
}
[pscustomobject]@{ rects = @($rects) } | ConvertTo-Json -Compress -Depth 4
`;

function createUiaAdapter() {
  return {
    readRects() {
      if (process.platform !== "win32") {
        return Promise.reject(new Error("unsupported-platform"));
      }
      const encoded = Buffer.from(UIA_SCRIPT, "utf16le").toString("base64");
      return new Promise((resolve, reject) => {
        execFile(
          "powershell.exe",
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
          { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 },
          (error, stdout) => {
            if (error) {
              reject(new Error("uia-query-failed"));
              return;
            }
            try {
              const parsed = JSON.parse(stdout.trim());
              if (!parsed || !Array.isArray(parsed.rects)) throw new Error("invalid-uia-result");
              resolve(parsed.rects);
            } catch {
              reject(new Error("uia-result-invalid"));
            }
          }
        );
      });
    }
  };
}

let defaultReader = null;

function getDefaultReader() {
  if (!defaultReader) {
    defaultReader = createDesktopIconReader({
      explorer: createExplorerListViewAdapter(),
      uia: createUiaAdapter()
    });
  }
  return defaultReader;
}

async function readDesktopIconRects() {
  return getDefaultReader().readDesktopIconRects();
}

function getDesktopIconDiagnostic() {
  return defaultReader
    ? defaultReader.getDesktopIconDiagnostic()
    : Object.freeze({ status: "not-run", count: 0 });
}

module.exports = {
  collectExplorerIconRects,
  createDesktopIconReader,
  getDesktopIconDiagnostic,
  readDesktopIconRects
};
