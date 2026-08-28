function sameBounds(first, second) {
  return Boolean(first && second)
    && first.x === second.x
    && first.y === second.y
    && first.width === second.width
    && first.height === second.height;
}

function liveWindowAdapter(getWindow, onBoundsChanged) {
  return {
    setBounds(bounds) {
      const window = getWindow();
      if (!window || window.isDestroyed() || sameBounds(window.getBounds(), bounds)) return;
      window.setBounds(bounds, false);
      onBoundsChanged?.();
    },
    hide() {
      const window = getWindow();
      if (window && !window.isDestroyed() && window.isVisible()) window.hide();
    },
    showInactive() {
      const window = getWindow();
      if (window && !window.isDestroyed() && !window.isVisible()) window.showInactive();
    }
  };
}

module.exports = { liveWindowAdapter };
