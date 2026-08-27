const { nearestEdge } = require("./geometry");

const RELEASE_POSES = Object.freeze({
  top: Object.freeze(["sit"]),
  side: Object.freeze(["wall-climb"]),
  bottom: Object.freeze(["hang"]),
  open: Object.freeze(["land", "crawl"])
});

function cloneRect(rect) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
    throw new TypeError("target must have a finite rectangle");
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new RangeError("target rectangle must have positive area");
  }
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function targetParts(targetRect) {
  if (targetRect?.rect) {
    const target = {};
    if (typeof targetRect.source === "string") target.source = targetRect.source;
    if (typeof targetRect.id === "string") target.id = targetRect.id;
    if (Number.isSafeInteger(targetRect.hwnd)) target.hwnd = targetRect.hwnd;
    return {
      target: Object.freeze(target),
      rect: cloneRect(targetRect.rect)
    };
  }
  return { target: null, rect: cloneRect(targetRect) };
}

function poseZone(edge) {
  if (edge === "left" || edge === "right") return "side";
  return edge;
}

function releasePoseOptions(zone) {
  const choices = RELEASE_POSES[zone];
  if (!choices) throw new RangeError(`Unknown release zone: ${zone}`);
  return [...choices];
}

function chooseReleasePose(zone, chooser = choices => choices[0]) {
  if (typeof chooser !== "function") throw new TypeError("pose chooser must be a function");
  const choices = releasePoseOptions(zone);
  const pose = chooser(Object.freeze(choices), zone);
  if (!choices.includes(pose)) throw new RangeError(`Pose ${pose} is not allowed for ${zone}`);
  return pose;
}

function createAttachment(targetRect, edge, t, pose) {
  const zone = poseZone(edge);
  if (!RELEASE_POSES[zone] || zone === "open") throw new RangeError(`Unknown attachment edge: ${edge}`);
  if (!RELEASE_POSES[zone].includes(pose)) {
    throw new RangeError(`Invalid pose ${pose} for ${edge} edge`);
  }
  if (!Number.isFinite(t)) throw new TypeError("attachment t must be finite");

  const { target, rect } = targetParts(targetRect);
  return Object.freeze({
    target,
    edge,
    t: Math.min(1, Math.max(0, t)),
    pose,
    lastRect: rect
  });
}

function resolveAttachment(anchor, nextRect) {
  if (!anchor || !RELEASE_POSES[poseZone(anchor.edge)]) {
    throw new TypeError("invalid attachment anchor");
  }
  const rect = cloneRect(nextRect);
  let point;
  if (anchor.edge === "top" || anchor.edge === "bottom") {
    point = {
      x: rect.x + rect.width * anchor.t,
      y: anchor.edge === "top" ? rect.y : rect.y + rect.height
    };
  } else {
    point = {
      x: anchor.edge === "left" ? rect.x : rect.x + rect.width,
      y: rect.y + rect.height * anchor.t
    };
  }

  return Object.freeze({
    point: Object.freeze(point),
    anchor: Object.freeze({ ...anchor, lastRect: rect })
  });
}

function edgeDistance(point, rect, edge) {
  if (edge === "top") return Math.abs(point.y - rect.y);
  if (edge === "bottom") return Math.abs(point.y - rect.y - rect.height);
  if (edge === "left") return Math.abs(point.x - rect.x);
  return Math.abs(point.x - rect.x - rect.width);
}

function findReleaseZone(point, obstacles, threshold) {
  if (!point || ![point.x, point.y, threshold].every(Number.isFinite) || threshold < 0) {
    throw new TypeError("release point and threshold must be finite");
  }
  if (!Array.isArray(obstacles)) throw new TypeError("obstacles must be an array");

  let best = null;
  for (const target of obstacles) {
    const rect = cloneRect(target?.rect);
    const edge = nearestEdge(point, rect, threshold);
    if (!edge) continue;
    const candidate = { ...edge, distance: edgeDistance(point, rect, edge.edge), target };
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  if (!best) return Object.freeze({ zone: "open" });

  return Object.freeze({
    zone: poseZone(best.edge),
    edge: best.edge,
    t: best.t,
    target: best.target
  });
}

module.exports = {
  chooseReleasePose,
  createAttachment,
  findReleaseZone,
  releasePoseOptions,
  resolveAttachment
};
