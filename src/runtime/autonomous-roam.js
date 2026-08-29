function validateRange(name, value) {
  if (!Array.isArray(value) || value.length !== 2
    || !value.every(Number.isFinite) || value[0] <= 0 || value[1] < value[0]) {
    throw new RangeError(`${name} must be an ascending positive range`);
  }
  return [...value];
}

function createAutonomousRoam({
  random = Math.random,
  idleDurationMs = [2500, 6000],
  crawlDurationMs = [4500, 9000],
  speed = 28
} = {}) {
  if (typeof random !== "function") throw new TypeError("random must be a function");
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError("speed must be positive");
  const idleRange = validateRange("idleDurationMs", idleDurationMs);
  const crawlRange = validateRange("crawlDurationMs", crawlDurationMs);

  function sample() {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("random must return a value in [0, 1)");
    }
    return value;
  }

  const duration = range => range[0] + (range[1] - range[0]) * sample();
  let phase = "idle";
  let remaining = duration(idleRange);
  let direction = "right";
  let verticalBias = 0;
  let verticalTarget = 0;
  let lastRerouteAt;

  function resetIdle() {
    phase = "idle";
    remaining = duration(idleRange);
    verticalBias = 0;
    verticalTarget = 0;
    lastRerouteAt = undefined;
  }

  function startCrawl() {
    phase = "crawl";
    remaining = duration(crawlRange);
    direction = sample() < 0.5 ? "left" : "right";
    const verticalSample = sample();
    verticalTarget = (verticalSample < 0.5 ? -1 : 1) * (0.1 + verticalSample * 0.25);
    verticalBias = 0;
    lastRerouteAt = undefined;
  }

  function stopForDisabled(context) {
    const shouldStop = context.mode === "crawling";
    if (phase !== "idle") resetIdle();
    return shouldStop ? { kind: "stop" } : { kind: "none" };
  }

  return Object.freeze({
    tick(dtMs, context) {
      if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError("dtMs must be non-negative");
      if (!context || typeof context !== "object"
        || typeof context.enabled !== "boolean" || typeof context.mode !== "string") {
        throw new TypeError("context must include enabled and mode");
      }

      if (!context.enabled) return stopForDisabled(context);
      if (!["idle", "crawling"].includes(context.mode)) return { kind: "none" };

      if (phase === "idle") {
        if (context.mode === "crawling") startCrawl();
        else {
          remaining -= dtMs;
          if (remaining > 0) return { kind: "none" };
          startCrawl();
          return { kind: "start", direction };
        }
      } else if (context.mode === "idle") {
        resetIdle();
        return { kind: "none" };
      }

      remaining -= dtMs;
      if (remaining <= 0) {
        resetIdle();
        return { kind: "stop" };
      }
      if (dtMs === 0) return { kind: "none" };

      const distance = speed * dtMs / 1000;
      const interpolation = Math.min(1, dtMs / 1200);
      verticalBias += (verticalTarget - verticalBias) * interpolation;
      return {
        kind: "move",
        direction,
        dx: direction === "left" ? -distance : distance,
        dy: distance * verticalBias
      };
    },
    blocked(nowMs) {
      if (!Number.isFinite(nowMs)) throw new RangeError("nowMs must be finite");
      if (phase !== "crawl") return false;
      if (lastRerouteAt !== undefined && nowMs < lastRerouteAt) return false;
      if (lastRerouteAt !== undefined && nowMs - lastRerouteAt < 450) return false;
      direction = direction === "left" ? "right" : "left";
      lastRerouteAt = nowMs;
      return direction;
    },
    cleared() {
      lastRerouteAt = undefined;
    }
  });
}

module.exports = { createAutonomousRoam };
