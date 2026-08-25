const { contextBridge, ipcRenderer } = require("electron");

const ANIMATION_ACTIONS = new Set([
  "idle",
  "drag",
  "sit",
  "prone",
  "legs-dangle",
  "wall-grab",
  "wall-climb",
  "hang",
  "land",
  "crawl",
  "fall"
]);
const FORCE_ACTIONS = new Set(["fall", "land"]);

function exactKeys(value, keys) {
  if (!value || typeof value !== "object") return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => actual.includes(key));
}

function animationCommand(value) {
  if (!exactKeys(value, ["id", "action", "force"])) return null;
  if (!Number.isSafeInteger(value.id) || value.id <= 0) return null;
  if (!ANIMATION_ACTIONS.has(value.action) || typeof value.force !== "boolean") return null;
  if (value.force && !FORCE_ACTIONS.has(value.action)) return null;
  return { id: value.id, action: value.action, force: value.force };
}

function animationCompletion(value) {
  if (!exactKeys(value, ["id"]) || !Number.isSafeInteger(value.id) || value.id <= 0) return null;
  return { id: value.id };
}

function frameHitBox(value) {
  if (!exactKeys(value, ["x", "y", "width", "height"])) return null;
  if (![value.x, value.y, value.width, value.height].every(Number.isFinite)) return null;
  if (value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function invokeInternal(channel, payload) {
  ipcRenderer.invoke(channel, payload).catch(() => {});
}

ipcRenderer.on("desktop-pet:animation-command", (_event, rawCommand) => {
  const command = animationCommand(rawCommand);
  if (command) {
    window.dispatchEvent(new CustomEvent("desktop-pet:animation-command", { detail: command }));
  }
});

window.addEventListener("desktop-pet:frame-hit-box", event => {
  invokeInternal("desktop-pet:update-hit-box", frameHitBox(event.detail));
});

window.addEventListener("desktop-pet:animation-complete", event => {
  const completion = animationCompletion(event.detail);
  if (completion) invokeInternal("desktop-pet:animation-complete", completion);
});

contextBridge.exposeInMainWorld("desktopPet", Object.freeze({
  getBootstrap: () => ipcRenderer.invoke("desktop-pet:get-bootstrap"),
  petAction: (action, payload) => ipcRenderer.invoke("desktop-pet:action", action, payload),
  openContextMenu: () => ipcRenderer.invoke("desktop-pet:open-context-menu")
}));
