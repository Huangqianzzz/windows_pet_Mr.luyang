function createForegroundGate({ settleMs = 250 } = {}) {
  if (!Number.isFinite(settleMs) || settleMs < 0) {
    throw new RangeError("settleMs must be a non-negative finite number");
  }

  let stableState = false;
  let candidateState = false;
  let candidateSince = 0;
  let lastNow = Number.NEGATIVE_INFINITY;

  return Object.freeze({
    tick(backgroundRequested, now) {
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

      stableState = candidateState;
      return stableState ? "enter" : "leave";
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
        action = gate.tick(Boolean(classify(snapshot, targetDisplay)), now());
      } catch {
        return "none";
      }
      if (action === "enter") enter();
      else if (action === "leave") leave();
      return action === "enter" || action === "leave" ? action : "none";
    }
  });
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
      background = true;
      setRuntimePaused(true);
      setInputEnabled(false);
      hideBubble();
      dismissSpeech();
      sendRendererPaused(true);
      setAlwaysOnTop(false);
      lowerWindows();
      return true;
    },
    leave() {
      if (!background) return false;
      refreshObstacles();
      resetTickClock();
      setAlwaysOnTop(true);
      sendRendererPaused(false);
      setRuntimePaused(false);
      setInputEnabled(true);
      background = false;
      return true;
    }
  });
}

module.exports = {
  createBackgroundModeCoordinator,
  createBackgroundModeTransitions,
  createForegroundGate
};
