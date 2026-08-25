function validateRect(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(`${name} must be a rectangle`);
  const keys = ["x", "y", "width", "height"];
  if (!keys.every(key => Number.isFinite(value[key])) || value.width <= 0 || value.height <= 0) {
    throw new RangeError(`${name} must have finite coordinates and positive size`);
  }
}

function validatePoint(value, name) {
  if (!value || typeof value !== "object" || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError(`${name} must be a finite point`);
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function contains(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function frozenPoint(x, y) {
  return Object.freeze({ x, y });
}

function pointerGeometry(rect, faceRect) {
  const bubbleCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const faceCenter = { x: faceRect.x + faceRect.width / 2, y: faceRect.y + faceRect.height / 2 };
  const horizontal = Math.abs(faceCenter.x - bubbleCenter.x) > Math.abs(faceCenter.y - bubbleCenter.y);
  const halfBase = Math.min(8, (horizontal ? rect.height : rect.width) / 4);
  let tip;
  let baseStart;
  let baseEnd;

  if (horizontal) {
    const x = faceCenter.x < bubbleCenter.x ? rect.x : rect.x + rect.width;
    const y = clamp(faceCenter.y, rect.y + halfBase, rect.y + rect.height - halfBase);
    tip = frozenPoint(x, y);
    const insetX = faceCenter.x < bubbleCenter.x ? x + Math.min(10, rect.width / 4) : x - Math.min(10, rect.width / 4);
    baseStart = frozenPoint(insetX, y - halfBase);
    baseEnd = frozenPoint(insetX, y + halfBase);
  } else {
    const y = faceCenter.y < bubbleCenter.y ? rect.y : rect.y + rect.height;
    const x = clamp(faceCenter.x, rect.x + halfBase, rect.x + rect.width - halfBase);
    tip = frozenPoint(x, y);
    const insetY = faceCenter.y < bubbleCenter.y ? y + Math.min(10, rect.height / 4) : y - Math.min(10, rect.height / 4);
    baseStart = frozenPoint(x - halfBase, insetY);
    baseEnd = frozenPoint(x + halfBase, insetY);
  }

  return Object.freeze({ tip, baseStart, baseEnd });
}

function candidateRect(region, bubbleSize, desired) {
  if (region.width <= 0 || region.height <= 0) return null;
  const width = Math.min(region.width, bubbleSize.width);
  const height = Math.min(region.height, bubbleSize.height);
  return {
    x: clamp(desired.x, region.x, region.x + region.width - width),
    y: clamp(desired.y, region.y, region.y + region.height - height),
    width,
    height
  };
}

function regionVariants(region, bubbleSize, desired) {
  const seeds = [
    desired,
    { x: region.x, y: region.y },
    { x: region.x + region.width, y: region.y },
    { x: region.x, y: region.y + region.height },
    { x: region.x + region.width, y: region.y + region.height }
  ];
  const unique = new Map();
  for (const seed of seeds) {
    const rect = candidateRect(region, bubbleSize, seed);
    if (rect) unique.set(`${rect.x}:${rect.y}:${rect.width}:${rect.height}`, rect);
  }
  return [...unique.values()];
}

function placeBubble({ faceBox, petRect, bubbleSize, workArea, pointer }) {
  validateRect(faceBox, "faceBox");
  validateRect(petRect, "petRect");
  validateRect({ x: 0, y: 0, ...bubbleSize }, "bubbleSize");
  validateRect(workArea, "workArea");
  if (pointer !== undefined) validatePoint(pointer, "pointer");

  const faceRect = {
    x: petRect.x + faceBox.x,
    y: petRect.y + faceBox.y,
    width: faceBox.width,
    height: faceBox.height
  };
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;
  const faceRight = faceRect.x + faceRect.width;
  const faceBottom = faceRect.y + faceRect.height;
  const gap = 10;
  const definitions = [
    {
      region: { x: workArea.x, y: workArea.y, width: workArea.width, height: Math.max(0, Math.min(bottom, faceRect.y - gap) - workArea.y) },
      desired: { x: faceRect.x - bubbleSize.width - gap, y: faceRect.y - bubbleSize.height - gap }
    },
    {
      region: { x: workArea.x, y: workArea.y, width: workArea.width, height: Math.max(0, Math.min(bottom, faceRect.y - gap) - workArea.y) },
      desired: { x: faceRight + gap, y: faceRect.y - bubbleSize.height - gap }
    },
    {
      region: { x: workArea.x, y: workArea.y, width: Math.max(0, Math.min(right, faceRect.x - gap) - workArea.x), height: workArea.height },
      desired: { x: faceRect.x - bubbleSize.width - gap, y: petRect.y + petRect.height / 2 - bubbleSize.height / 2 }
    },
    {
      region: { x: Math.max(workArea.x, faceRight + gap), y: workArea.y, width: Math.max(0, right - Math.max(workArea.x, faceRight + gap)), height: workArea.height },
      desired: { x: faceRight + gap, y: petRect.y + petRect.height / 2 - bubbleSize.height / 2 }
    },
    {
      region: { x: workArea.x, y: Math.max(workArea.y, faceBottom + gap), width: workArea.width, height: Math.max(0, bottom - Math.max(workArea.y, faceBottom + gap)) },
      desired: { x: faceRect.x + faceRect.width / 2 - bubbleSize.width / 2, y: faceBottom + gap }
    }
  ];

  const candidates = [];
  definitions.forEach((definition, preference) => {
    for (const rect of regionVariants(definition.region, bubbleSize, definition.desired)) {
      if (pointer && contains(rect, pointer)) continue;
      const area = rect.width * rect.height;
      const sizeScore = area / (bubbleSize.width * bubbleSize.height);
      candidates.push({ rect, score: sizeScore * 1000 - preference });
    }
  });
  if (candidates.length === 0) throw new RangeError("No face-safe bubble placement is available");
  candidates.sort((a, b) => b.score - a.score);
  const rect = Object.freeze({ ...candidates[0].rect });
  return Object.freeze({ rect, pointer: pointerGeometry(rect, faceRect) });
}

module.exports = { placeBubble };
