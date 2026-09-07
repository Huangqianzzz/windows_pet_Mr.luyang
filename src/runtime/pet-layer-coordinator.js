function createPetLayerCoordinator({ renderWindow, hitWindow, bubbleWindow, zOrder }) {
  const windows = [renderWindow, hitWindow, bubbleWindow];

  function restoreNormal() {
    let succeeded = true;
    for (const window of windows) {
      try {
        if (!window || window.isDestroyed()) throw new Error("window unavailable");
        window.setAlwaysOnTop(true);
      } catch {
        succeeded = false;
        if (window === renderWindow) {
          try { window.moveTop(); } catch {}
          try { window.showInactive(); } catch {}
        }
      }
    }
    return succeeded;
  }

  return Object.freeze({
    restoreNormal,
    apply({ backgroundPaused, behindTarget }) {
      if (!backgroundPaused && !behindTarget) return restoreNormal();
      try {
        if (windows.some(window => !window || window.isDestroyed())) return false;
        for (const window of [hitWindow, bubbleWindow]) {
          if (window.isVisible()) window.hide();
        }
        if (backgroundPaused) {
          let succeeded = true;
          for (const window of windows) {
            try {
              window.setAlwaysOnTop(false);
              if (!zOrder.sendToBottom(window.getNativeWindowHandle())) succeeded = false;
            } catch { succeeded = false; }
          }
          return succeeded;
        }
        if (!Number.isSafeInteger(behindTarget.hwnd) || behindTarget.hwnd <= 0) return false;
        renderWindow.setAlwaysOnTop(false);
        if (zOrder.placeBelow(renderWindow.getNativeWindowHandle(), behindTarget.hwnd)) return true;
      } catch {}
      restoreNormal();
      return false;
    }
  });
}

module.exports = { createPetLayerCoordinator };
