const PAUSE_REASONS = new Set(["rest", "background"]);

function createPauseCoordinator({ freeze = () => {}, resume = () => {} } = {}) {
  const reasons = new Set();

  return Object.freeze({
    set(reason, paused) {
      if (!PAUSE_REASONS.has(reason) || typeof paused !== "boolean") return false;
      const wasPaused = reasons.size > 0;
      const alreadySet = reasons.has(reason);
      if (paused === alreadySet) return false;

      if (paused) reasons.add(reason);
      else reasons.delete(reason);

      const isPaused = reasons.size > 0;
      if (!wasPaused && isPaused) freeze();
      else if (wasPaused && !isPaused) resume();
      return true;
    },
    snapshot() {
      return { paused: reasons.size > 0, reasons: [...reasons] };
    }
  });
}

module.exports = { createPauseCoordinator };
