function cloneRect(rect) {
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function cloneTarget(obstacle) {
  const target = {
    id: obstacle.id,
    source: obstacle.source,
    rect: cloneRect(obstacle.rect)
  };
  if (Object.hasOwn(obstacle, "hwnd")) target.hwnd = obstacle.hwnd;
  return Object.freeze(target);
}

function overlapArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function intervalForOpenRange(start, delta, min, max) {
  if (delta === 0) return start > min && start < max ? [-Infinity, Infinity] : null;
  const first = (min - start) / delta;
  const second = (max - start) / delta;
  return [Math.min(first, second), Math.max(first, second)];
}

function sweepTime(body, dx, dy, obstacle) {
  const rect = obstacle.rect || obstacle;
  const xRange = intervalForOpenRange(body.x, dx, rect.x - body.width, rect.x + rect.width);
  const yRange = intervalForOpenRange(body.y, dy, rect.y - body.height, rect.y + rect.height);
  if (!xRange || !yRange) return null;

  const enter = Math.max(xRange[0], yRange[0], 0);
  const exit = Math.min(xRange[1], yRange[1], 1);
  return enter < exit ? enter : null;
}

function sameIdentity(a, b) {
  return a.source === b.source && a.id === b.id &&
    Object.hasOwn(a, "hwnd") === Object.hasOwn(b, "hwnd") &&
    (!Object.hasOwn(a, "hwnd") || a.hwnd === b.hwnd);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampedDelta(body, dx, dy, workArea) {
  const x = clamp(body.x + dx, workArea.x, workArea.x + workArea.width - body.width);
  const y = clamp(body.y + dy, workArea.y, workArea.y + workArea.height - body.height);
  return { dx: x - body.x, dy: y - body.y, xClamped: x - body.x !== dx, yClamped: y - body.y !== dy };
}

function movesAwayFromOverlap(body, dx, dy, obstacle) {
  const rect = obstacle.rect;
  const bodyCenterX = body.x + body.width / 2;
  const bodyCenterY = body.y + body.height / 2;
  const obstacleCenterX = rect.x + rect.width / 2;
  const obstacleCenterY = rect.y + rect.height / 2;
  return (bodyCenterX <= obstacleCenterX && dx < 0) ||
    (bodyCenterX >= obstacleCenterX && dx > 0) ||
    (bodyCenterY <= obstacleCenterY && dy < 0) ||
    (bodyCenterY >= obstacleCenterY && dy > 0);
}

function isStepClear(body, dx, dy, obstacles) {
  const end = { ...body, x: body.x + dx, y: body.y + dy };
  for (const obstacle of obstacles) {
    const initialOverlap = overlapArea(body, obstacle.rect);
    if (initialOverlap > 0) {
      if (!movesAwayFromOverlap(body, dx, dy, obstacle) || overlapArea(end, obstacle.rect) >= initialOverlap) {
        return false;
      }
      continue;
    }
    if (sweepTime(body, dx, dy, obstacle) !== null) return false;
  }
  return true;
}

function firstHorizontalWindowContact(body, dx, obstacles) {
  if (dx === 0) return null;
  const contacts = obstacles
    .filter(obstacle => obstacle.source === "window" && overlapArea(body, obstacle.rect) === 0)
    .map(obstacle => ({ obstacle, time: sweepTime(body, dx, 0, obstacle) }))
    .filter(contact => contact.time !== null)
    .map(({ obstacle, time }) => ({
      target: cloneTarget(obstacle),
      edge: dx > 0 ? "left" : "right",
      t: clamp((body.y + body.height / 2 - obstacle.rect.y) / obstacle.rect.height, 0, 1),
      distance: Math.abs(dx) * time
    }))
    .sort((a, b) => a.distance - b.distance || a.target.id.localeCompare(b.target.id) || a.edge.localeCompare(b.edge));
  if (contacts.length === 0) return null;
  const { target, edge, t } = contacts[0];
  return Object.freeze({ target, edge, t });
}

function resolution(body, moved, fullyMoved, blockedAxes, contactCandidate) {
  return Object.freeze({
    body: cloneRect(body),
    moved,
    fullyMoved,
    blockedAxes: Object.freeze(blockedAxes),
    contactCandidate
  });
}

function requestedAxes(dx, dy) {
  return [dx !== 0 ? "x" : null, dy !== 0 ? "y" : null].filter(Boolean);
}

function resolveCrawlStep({ body, dx, dy, workArea, obstacles }) {
  const requested = requestedAxes(dx, dy);
  const limited = clampedDelta(body, dx, dy, workArea);
  const completeClear = isStepClear(body, limited.dx, limited.dy, obstacles);
  const fullyMoved = completeClear && !limited.xClamped && !limited.yClamped;

  if (completeClear) {
    const finalBody = { ...body, x: body.x + limited.dx, y: body.y + limited.dy };
    const blockedAxes = [
      limited.xClamped && dx !== 0 ? "x" : null,
      limited.yClamped && dy !== 0 ? "y" : null
    ].filter(Boolean);
    return resolution(finalBody, limited.dx !== 0 || limited.dy !== 0, fullyMoved, blockedAxes, null);
  }

  const horizontalClear = dx !== 0 && isStepClear(body, limited.dx, 0, obstacles);
  const verticalClear = dy !== 0 && isStepClear(body, 0, limited.dy, obstacles);
  const ordered = Math.abs(dx) >= Math.abs(dy) ? ["x", "y"] : ["y", "x"];
  const chosen = ordered.find(axis => axis === "x" ? horizontalClear : verticalClear) || null;
  const contactCandidate = dx !== 0 && !horizontalClear
    ? firstHorizontalWindowContact(body, limited.dx || dx, obstacles)
    : null;

  if (!chosen) return resolution(body, false, false, requested, contactCandidate);

  const finalBody = chosen === "x"
    ? { ...body, x: body.x + limited.dx }
    : { ...body, y: body.y + limited.dy };
  const blockedAxes = requested.filter(axis => axis !== chosen || (axis === "x" && limited.xClamped) || (axis === "y" && limited.yClamped));
  return resolution(finalBody, finalBody.x !== body.x || finalBody.y !== body.y, false, blockedAxes, contactCandidate);
}

function segmentClear(body, from, to, obstacles) {
  const start = { ...body, x: from.x, y: from.y };
  return obstacles.every(obstacle => overlapArea(start, obstacle.rect) === 0 && sweepTime(start, to.x - from.x, to.y - from.y, obstacle) === null);
}

function planBehindWindowEscape({ body, target, obstacles, clearance }) {
  if (!target || target.source !== "window" || !Array.isArray(obstacles)) return null;
  const currentTarget = obstacles.find(obstacle => sameIdentity(obstacle, target));
  if (!currentTarget || currentTarget.source !== "window") return null;

  const gap = Number.isFinite(clearance) && clearance >= 0 ? clearance : 0;
  const rect = currentTarget.rect;
  const others = obstacles.filter(obstacle => !sameIdentity(obstacle, currentTarget));
  const exits = [
    { edge: "left", point: { x: rect.x - body.width - gap, y: clamp(body.y, rect.y, rect.y + rect.height - body.height) } },
    { edge: "right", point: { x: rect.x + rect.width + gap, y: clamp(body.y, rect.y, rect.y + rect.height - body.height) } },
    { edge: "top", point: { x: clamp(body.x, rect.x, rect.x + rect.width - body.width), y: rect.y - body.height - gap } },
    { edge: "bottom", point: { x: clamp(body.x, rect.x, rect.x + rect.width - body.width), y: rect.y + rect.height + gap } }
  ];
  const priority = { left: 0, right: 1, top: 2, bottom: 3 };
  const candidates = exits.map(exit => {
    const turn = exit.edge === "left" || exit.edge === "right"
      ? { x: body.x, y: exit.point.y }
      : { x: exit.point.x, y: body.y };
    const points = [{ x: body.x, y: body.y }];
    if (turn.x !== body.x || turn.y !== body.y) points.push(turn);
    points.push(exit.point);
    const safe = !others.some(obstacle => overlapArea({ ...body, x: exit.point.x, y: exit.point.y }, obstacle.rect) > 0) &&
      points.slice(1).every((point, index) => segmentClear(body, points[index], point, others));
    return { ...exit, points, safe, distance: points.slice(1).reduce((sum, point, index) =>
      sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0) };
  }).filter(candidate => candidate.safe);

  candidates.sort((a, b) => a.distance - b.distance || priority[a.edge] - priority[b.edge]);
  if (candidates.length === 0) return null;
  const candidate = candidates[0];
  return Object.freeze({
    target: cloneTarget(currentTarget),
    points: Object.freeze(candidate.points.map(point => Object.freeze({ x: point.x, y: point.y }))),
    exitEdge: candidate.edge
  });
}

module.exports = { resolveCrawlStep, planBehindWindowEscape };
