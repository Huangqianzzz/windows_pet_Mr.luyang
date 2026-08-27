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

  const duration = range => range[0] + (range[1] - range[0]) * random();
  let phase = "idle";
  let remaining = duration(idleRange);
  let direction = "right";

  function resetIdle() {
    phase = "idle";
    remaining = duration(idleRange);
  }

  function startCrawl() {
    phase = "crawl";
    remaining = duration(crawlRange);
    direction = random() < 0.5 ? "left" : "right";
  }

  return Object.freeze({
    tick(dtMs, context) {
      if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError("dtMs must be non-negative");
      if (!context || typeof context !== "object"
        || typeof context.enabled !== "boolean" || typeof context.mode !== "string") {
        throw new TypeError("context must include enabled and mode");
      }

      if (!context.enabled) {
        const shouldStop = context.mode === "crawling";
        resetIdle();
        return shouldStop ? { kind: "stop" } : { kind: "none" };
      }
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
      const distance = speed * dtMs / 1000;
      return {
        kind: "move",
        direction,
        dx: direction === "left" ? -distance : distance,
        dy: 0
      };
    },
    blocked() {
      if (phase !== "crawl") return false;
      direction = direction === "left" ? "right" : "left";
      return direction;
    }
  });
}

module.exports = { createAutonomousRoam };
