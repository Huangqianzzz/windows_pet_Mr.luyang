(function hitRendererModule(global) {
  function screenPoint(event) {
    if (![event?.screenX, event?.screenY].every(Number.isFinite)) return null;
    return { x: event.screenX, y: event.screenY };
  }

  function mountHitInput({ document, desktopPet }) {
    let dragging = false;

    document.addEventListener("mousedown", event => {
      if (event.button !== 0) return;
      const point = screenPoint(event);
      if (!point) return;
      dragging = true;
      event.preventDefault?.();
      desktopPet.petAction("drag-start", point);
    });
    document.addEventListener("mousemove", event => {
      if (!dragging) return;
      const point = screenPoint(event);
      if (point) desktopPet.petAction("drag-move", point);
    });
    document.addEventListener("mouseup", event => {
      if (!dragging || event.button !== 0) return;
      const point = screenPoint(event);
      dragging = false;
      if (point) desktopPet.petAction("drag-end", point);
    });
    document.addEventListener("contextmenu", event => {
      event.preventDefault();
      desktopPet.openContextMenu();
    });
  }

  const api = { mountHitInput };
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    global.DesktopPetHitRenderer = api;
    if (global.document && global.desktopPet) {
      mountHitInput({ document: global.document, desktopPet: global.desktopPet });
    }
  }
}(typeof window === "undefined" ? globalThis : window));
