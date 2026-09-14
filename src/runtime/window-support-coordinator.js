function sameTarget(obstacle, target) {
  return obstacle.id === target.id
    && (!target.source || obstacle.source === target.source)
    && (!Object.hasOwn(target, "hwnd") || obstacle.hwnd === target.hwnd)
    && (!Object.hasOwn(target, "processId") || obstacle.processId === target.processId);
}

function createWindowSupportCoordinator({
  getAttachment,
  replaceWindows,
  syncController,
  refreshWindows,
  delayMs = 75,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let timer = null;
  let missing = false;
  let paused = false;
  let stopped = false;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    cancel();
    timer = setTimer(() => {
      timer = null;
      if (paused || stopped) return;
      const obstacles = refreshWindows();
      if (!Array.isArray(obstacles)) {
        schedule();
        return;
      }
      handleSnapshot(obstacles, { immediate: false });
    }, delayMs);
  }

  function handleSnapshot(obstacles, meta = {}) {
    if (paused || stopped || !Array.isArray(obstacles)) return false;
    const target = getAttachment()?.target;
    if (!target?.id || target.source !== "window" || obstacles.some(item => sameTarget(item, target))) {
      cancel();
      missing = false;
      replaceWindows(obstacles);
      syncController();
      return true;
    }
    if (meta.immediate || missing) {
      cancel();
      missing = false;
      replaceWindows(obstacles);
      syncController();
      return true;
    }
    missing = true;
    schedule();
    return true;
  }

  return Object.freeze({
    handleSnapshot,
    setPaused(value) {
      paused = Boolean(value);
      if (paused) {
        cancel();
        missing = false;
      }
    },
    stop() {
      stopped = true;
      cancel();
      missing = false;
    }
  });
}

module.exports = { createWindowSupportCoordinator };
