function validBody(body) {
  return Boolean(body)
    && [body.x, body.y, body.width, body.height].every(Number.isFinite)
    && body.width > 0
    && body.height > 0;
}

function createRenderBuffer({ margin = 96, safeInset = 32 } = {}) {
  if (!Number.isFinite(margin) || margin <= 0) throw new RangeError("margin must be positive");
  if (!Number.isFinite(safeInset) || safeInset < 0 || safeInset > margin) {
    throw new RangeError("safeInset must be between zero and margin");
  }

  let hostBounds;
  let bodySize;

  function recenter(body) {
    hostBounds = {
      x: Math.floor(body.x - margin),
      y: Math.floor(body.y - margin),
      width: Math.ceil(body.width + margin * 2),
      height: Math.ceil(body.height + margin * 2)
    };
    bodySize = { width: body.width, height: body.height };
  }

  return {
    place(body, { dragging = false } = {}) {
      if (!validBody(body)) throw new TypeError("body must be finite with positive area");
      const localX = hostBounds ? body.x - hostBounds.x : 0;
      const localY = hostBounds ? body.y - hostBounds.y : 0;
      const sizeChanged = !bodySize || body.width !== bodySize.width || body.height !== bodySize.height;
      const outsideSafeInset = !hostBounds
        || localX < safeInset
        || localY < safeInset
        || hostBounds.width - localX - body.width < safeInset
        || hostBounds.height - localY - body.height < safeInset;
      const recentered = Boolean(dragging || sizeChanged || outsideSafeInset);
      if (recentered) recenter(body);
      return {
        hostBounds: { ...hostBounds },
        localX: body.x - hostBounds.x,
        localY: body.y - hostBounds.y,
        recentered
      };
    },
    reset() {
      hostBounds = undefined;
      bodySize = undefined;
    }
  };
}

module.exports = { createRenderBuffer };
