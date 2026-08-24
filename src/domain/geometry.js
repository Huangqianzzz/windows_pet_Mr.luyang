function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}

function clampRect(rect, bounds) {
  return {
    ...rect,
    x: rect.width > bounds.width
      ? bounds.x
      : Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.width - rect.width),
    y: rect.height > bounds.height
      ? bounds.y
      : Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.height - rect.height)
  };
}

function nearestEdge(point, rect, threshold) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const candidates = [];

  if (point.x >= rect.x && point.x <= right) {
    candidates.push({ edge: "top", t: (point.x - rect.x) / rect.width, distance: Math.abs(point.y - rect.y) });
    candidates.push({ edge: "bottom", t: (point.x - rect.x) / rect.width, distance: Math.abs(point.y - bottom) });
  }
  if (point.y >= rect.y && point.y <= bottom) {
    candidates.push({ edge: "left", t: (point.y - rect.y) / rect.height, distance: Math.abs(point.x - rect.x) });
    candidates.push({ edge: "right", t: (point.y - rect.y) / rect.height, distance: Math.abs(point.x - right) });
  }

  const nearest = candidates.reduce(
    (best, candidate) => candidate.distance < best.distance ? candidate : best,
    { distance: Infinity }
  );

  return nearest.distance <= threshold
    ? { edge: nearest.edge, t: nearest.t }
    : null;
}

module.exports = { clampRect, intersects, nearestEdge };
