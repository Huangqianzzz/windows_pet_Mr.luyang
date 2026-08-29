function createForegroundGate({ settleMs = 250 } = {}) {
  if (!Number.isFinite(settleMs) || settleMs < 0) {
    throw new RangeError("settleMs must be a non-negative finite number");
  }

  let stableState = false;
  let candidateState = false;
  let candidateSince = 0;
  let lastNow = Number.NEGATIVE_INFINITY;
  let lastTransition = null;

  return Object.freeze({
    tick(backgroundRequested, now) {
      lastTransition = null;
      if (typeof backgroundRequested !== "boolean" || !Number.isFinite(now)) return "none";
      if (now < lastNow && candidateState !== stableState) candidateSince = now;
      lastNow = now;

      if (backgroundRequested === stableState) {
        candidateState = stableState;
        candidateSince = now;
        return "none";
      }
      if (backgroundRequested !== candidateState) {
        candidateState = backgroundRequested;
        candidateSince = now;
      }
      if (now - candidateSince < settleMs) return "none";

      const previousStable = stableState;
      stableState = candidateState;
      const action = stableState ? "enter" : "leave";
      lastTransition = { action, previousStable };
      return action;
    },
    confirm(action) {
      if (lastTransition?.action !== action) return false;
      lastTransition = null;
      return true;
    },
    reject(action) {
      if (lastTransition?.action !== action) return false;
      stableState = lastTransition.previousStable;
      lastTransition = null;
      return true;
    }
  });
}

function createBackgroundModeCoordinator({
  readForeground,
  getPetBody,
  screen,
  classify,
  gate,
  enter,
  leave,
  now = () => performance.now()
}) {
  return Object.freeze({
    poll() {
      let snapshot;
      let targetDisplay;
      try {
        snapshot = readForeground();
        if (!snapshot) return "none";
        targetDisplay = screen.getDisplayMatching(getPetBody());
      } catch {
        return "none";
      }

      let action;
      try {
        const backgroundRequested = classify(snapshot, targetDisplay);
        if (typeof backgroundRequested !== "boolean") return "none";
        action = gate.tick(backgroundRequested, now());
      } catch {
        return "none";
      }
      if (action !== "enter" && action !== "leave") return "none";

      let transitioned = false;
      try {
        transitioned = (action === "enter" ? enter() : leave()) !== false;
      } catch {
        transitioned = false;
      }
      try {
        if (transitioned) gate.confirm?.(action);
        else gate.reject?.(action);
      } catch {}
      return transitioned ? action : "none";
    }
  });
}

function executeTransition(steps) {
  const rollbacks = [];
  try {
    for (const [forward, rollback] of steps) {
      if (rollback) rollbacks.push(rollback);
      if (forward() === false) throw new Error("background transition rejected");
    }
    return true;
  } catch {
    for (let index = rollbacks.length - 1; index >= 0; index -= 1) {
      try { rollbacks[index](); } catch {}
    }
    return false;
  }
}

function createBackgroundModeTransitions({
  setRuntimePaused,
  setInputEnabled,
  hideBubble,
  dismissSpeech,
  sendRendererPaused,
  setAlwaysOnTop,
  lowerWindows,
  refreshObstacles,
  resetTickClock
}) {
  let background = false;
  return Object.freeze({
    enter() {
      if (background) return false;
      const completed = executeTransition([
        [() => setRuntimePaused(true), () => setRuntimePaused(false)],
        [() => setInputEnabled(false), () => setInputEnabled(true)],
        [hideBubble],
        [dismissSpeech],
        [() => sendRendererPaused(true), () => sendRendererPaused(false)],
        [() => setAlwaysOnTop(false), () => setAlwaysOnTop(true)],
        [lowerWindows]
      ]);
      if (!completed) return false;
      background = true;
      return true;
    },
    leave() {
      if (!background) return false;
      const completed = executeTransition([
        [refreshObstacles],
        [resetTickClock],
        [() => setAlwaysOnTop(true), () => setAlwaysOnTop(false)],
        [() => sendRendererPaused(false), () => sendRendererPaused(true)],
        [() => setRuntimePaused(false), () => setRuntimePaused(true)],
        [() => setInputEnabled(true), () => setInputEnabled(false)]
      ]);
      if (!completed) return false;
      background = false;
      return true;
    },
    snapshot() {
      return { background };
    }
  });
}

module.exports = {
  createBackgroundModeCoordinator,
  createBackgroundModeTransitions,
  createForegroundGate
};
