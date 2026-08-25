const DISPLAY_METRICS = new Set(["bounds", "workArea", "scaleFactor"]);

function createBubbleDisplayMonitor({ screen, reposition }) {
  if (!screen || typeof screen.on !== "function" || typeof screen.removeListener !== "function") {
    throw new TypeError("bubble display monitor requires Electron screen events");
  }
  if (typeof reposition !== "function") throw new TypeError("bubble display monitor requires reposition");
  let started = false;
  const onMetricsChanged = (_event, _display, changedMetrics) => {
    if (!Array.isArray(changedMetrics) || changedMetrics.some(metric => DISPLAY_METRICS.has(metric))) {
      reposition();
    }
  };
  const onDisplayChanged = () => reposition();

  return Object.freeze({
    start() {
      if (started) return false;
      started = true;
      screen.on("display-metrics-changed", onMetricsChanged);
      screen.on("display-added", onDisplayChanged);
      screen.on("display-removed", onDisplayChanged);
      return true;
    },
    stop() {
      if (!started) return false;
      started = false;
      screen.removeListener("display-metrics-changed", onMetricsChanged);
      screen.removeListener("display-added", onDisplayChanged);
      screen.removeListener("display-removed", onDisplayChanged);
      return true;
    }
  });
}

module.exports = { createBubbleDisplayMonitor };
