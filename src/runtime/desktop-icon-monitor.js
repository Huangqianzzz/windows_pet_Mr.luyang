function createDesktopIconMonitor({
  readRects,
  getDiagnostic,
  onChange,
  enabled = true,
  intervalMs = 5000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  if (typeof readRects !== "function" || typeof getDiagnostic !== "function" || typeof onChange !== "function") {
    throw new TypeError("desktop icon monitor requires reader, diagnostic, and change handlers");
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new RangeError("interval must be at least one second");

  let active = false;
  let collisionsEnabled = Boolean(enabled);
  let timer;
  let pending;

  async function refresh() {
    if (!active || !collisionsEnabled) return false;
    if (pending) return pending;
    pending = (async () => {
      try {
        const icons = await readRects();
        const diagnostic = getDiagnostic();
        if (diagnostic?.status === "unavailable") return false;
        onChange(icons);
        return true;
      } catch {
        return false;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  }

  return Object.freeze({
    start() {
      if (active) return false;
      active = true;
      if (collisionsEnabled) void refresh();
      else onChange([]);
      timer = setIntervalFn(() => { void refresh(); }, intervalMs);
      return true;
    },
    stop() {
      if (!active) return false;
      active = false;
      if (timer !== undefined) clearIntervalFn(timer);
      timer = undefined;
      return true;
    },
    refresh,
    setEnabled(value) {
      if (typeof value !== "boolean" || value === collisionsEnabled) return false;
      collisionsEnabled = value;
      if (!value) onChange([]);
      else if (active) void refresh();
      return true;
    }
  });
}

module.exports = { createDesktopIconMonitor };
