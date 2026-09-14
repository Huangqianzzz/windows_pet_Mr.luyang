const DEFAULT_GRAVITY = 1800;

function validateBody(body) {
  if (!body || ![body.x, body.y, body.width, body.height, body.vx, body.vy].every(Number.isFinite)) {
    throw new TypeError("fall body values must be finite");
  }
  if (body.width <= 0 || body.height <= 0) {
    throw new RangeError("fall body must have positive area");
  }
}

function obstacleRect(obstacle) {
  const rect = obstacle?.rect || obstacle;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
    throw new TypeError("obstacle must have a finite rectangle");
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new RangeError("obstacle rectangle must have positive area");
  }
  return rect;
}

function overlapsHorizontally(x, width, rect) {
  return x < rect.x + rect.width && x + width > rect.x;
}

function downwardImpactTime(distance, vy, gravity, dt) {
  const epsilon = 1e-9;
  if (distance < -epsilon) return null;
  if (Math.abs(gravity) <= epsilon) {
    if (Math.abs(distance) <= epsilon && vy >= 0) return 0;
    if (vy <= 0) return null;
    const time = distance / vy;
    return time <= dt + epsilon ? Math.max(0, time) : null;
  }

  const discriminant = vy * vy + 2 * gravity * distance;
  if (discriminant < 0) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const roots = [(-vy - root) / gravity, (-vy + root) / gravity]
    .filter(time => time >= -epsilon && time <= dt + epsilon)
    .filter(time => vy + gravity * time >= -epsilon)
    .map(time => Math.max(0, time));
  return roots.length > 0 ? Math.min(...roots) : null;
}

function horizontalPosition(body, workArea, elapsed) {
  if (!workArea) return body.x + body.vx * elapsed;
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - body.width);
  const targetX = Math.min(Math.max(body.x, workArea.x), maxX);
  if (targetX === body.x) return body.x + body.vx * elapsed;
  const distance = targetX - body.x;
  return body.x + Math.sign(distance) * Math.min(Math.abs(distance), workArea.width * elapsed);
}

function stepFall(body, obstacles, dtMs, { gravity = DEFAULT_GRAVITY, workArea } = {}) {
  validateBody(body);
  if (!Array.isArray(obstacles)) throw new TypeError("obstacles must be an array");
  if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError("time step must be non-negative");
  if (!Number.isFinite(gravity)) throw new TypeError("gravity must be finite");
  if (workArea) obstacleRect(workArea);

  const dt = dtMs / 1000;
  const dy = body.vy * dt + 0.5 * gravity * dt * dt;
  const nextVy = body.vy + gravity * dt;
  const startBottom = body.y + body.height;
  let nearest = null;

  const floor = workArea
    ? { source: "work-area", id: "floor", rect: {
        x: workArea.x,
        y: workArea.y + workArea.height,
        width: workArea.width,
        height: 1
      } }
    : null;
  const surfaces = floor ? [...obstacles, floor] : obstacles;

  for (const obstacle of surfaces) {
    const rect = obstacleRect(obstacle);
    let time;
    const startsSlightlyOverlapping = body.y < rect.y
      && startBottom >= rect.y
      && body.vy >= 0;
    const startsBelowFloor = obstacle === floor && startBottom >= rect.y && body.vy >= 0;
    if (startsSlightlyOverlapping || startsBelowFloor) {
      time = 0;
    } else if (startBottom <= rect.y) {
      time = downwardImpactTime(rect.y - startBottom, body.vy, gravity, dt);
    } else {
      continue;
    }
    if (time === null) continue;
    const xAtImpact = horizontalPosition(body, workArea, time);
    const supported = obstacle === floor
      ? xAtImpact >= rect.x && xAtImpact + body.width <= rect.x + rect.width
      : overlapsHorizontally(xAtImpact, body.width, rect);
    if (!supported) continue;
    if (!nearest || time < nearest.time) {
      nearest = { obstacle, rect, time, xAtImpact };
    }
  }

  if (nearest) {
    return {
      body: {
        ...body,
        x: nearest.xAtImpact,
        y: nearest.rect.y - body.height,
        vy: 0
      },
      landing: nearest.obstacle
    };
  }

  return {
    body: {
      ...body,
      x: horizontalPosition(body, workArea, dt),
      // Once already below the work-area floor, no downward trajectory can cross it again.
      y: floor && startBottom >= floor.rect.y && body.vy >= 0
        ? floor.rect.y - body.height
        : body.y + dy,
      vy: nextVy
    },
    landing: null
  };
}

module.exports = { DEFAULT_GRAVITY, stepFall };
