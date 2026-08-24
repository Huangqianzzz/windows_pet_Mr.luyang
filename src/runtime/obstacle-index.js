function cloneObstacle(obstacle) {
  if (!obstacle || typeof obstacle.source !== "string" || typeof obstacle.id !== "string") {
    throw new TypeError("obstacle must have string source and id");
  }

  const rect = obstacle.rect;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)) {
    throw new TypeError("obstacle must have an integer rectangle");
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new RangeError("obstacle rectangle must have positive area");
  }

  const clone = {
    source: obstacle.source,
    id: obstacle.id,
    rect: Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  };
  if (Object.hasOwn(obstacle, "hwnd")) {
    if (!Number.isSafeInteger(obstacle.hwnd)) {
      throw new TypeError("window obstacle hwnd must be a safe integer");
    }
    clone.hwnd = obstacle.hwnd;
  }
  return Object.freeze(clone);
}

class ObstacleIndex {
  #sources = new Map();

  replace(source, obstacles) {
    if (typeof source !== "string" || !Array.isArray(obstacles)) {
      throw new TypeError("replace requires a source and obstacle array");
    }

    const replacement = Object.freeze(obstacles.map(cloneObstacle));
    this.#sources.set(source, replacement);
  }

  snapshot() {
    return Object.freeze(Array.from(this.#sources.values()).flat());
  }
}

module.exports = { ObstacleIndex };
