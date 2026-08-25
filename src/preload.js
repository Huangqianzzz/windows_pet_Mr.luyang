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
const INTERACTION_TYPES = new Set(["kneel", "freeze", "resume", "recover"]);
const RECOVERY_ACTIONS = new Set([
  "idle",
  "crawl",
  "sit",
  "prone",
  "legs-dangle",
  "wall-grab",
  "wall-climb",
  "hang"
]);
const SPEECH_TEXT = new Set(["爸爸", "我错了"]);

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

function interactionCommand(value) {
  const base = exactKeys(value, ["id", "type", "expiresAt"]);
  const recovery = exactKeys(value, ["id", "type", "action", "expiresAt"]);
  if (!base && !recovery) return null;
  if (!Number.isSafeInteger(value.id) || value.id <= 0 || !INTERACTION_TYPES.has(value.type)) return null;
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) return null;
  if ((value.type === "recover") !== recovery) return null;
  if (recovery && !RECOVERY_ACTIONS.has(value.action)) return null;
  return recovery
    ? { id: value.id, type: value.type, action: value.action, expiresAt: value.expiresAt }
    : { id: value.id, type: value.type, expiresAt: value.expiresAt };
}

function interactionResult(value) {
  const base = exactKeys(value, ["id", "accepted"]);
  const withAction = exactKeys(value, ["id", "accepted", "action"]);
  const withReason = exactKeys(value, ["id", "accepted", "reason"]);
  if (!base && !withAction && !withReason) return null;
  if (!Number.isSafeInteger(value.id) || value.id <= 0 || typeof value.accepted !== "boolean") return null;
  if (withAction && !RECOVERY_ACTIONS.has(value.action) && value.action !== "kneel") return null;
  if (withReason && (value.accepted || value.reason !== "expired")) return null;
  if (withAction) return { id: value.id, accepted: value.accepted, action: value.action };
  if (withReason) return { id: value.id, accepted: false, reason: "expired" };
  return { id: value.id, accepted: value.accepted };
}

function bubbleUpdate(value) {
  if (!exactKeys(value, ["text"]) || !SPEECH_TEXT.has(value.text)) return null;
  return { text: value.text };
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

ipcRenderer.on("desktop-pet:interaction-command", (_event, rawCommand) => {
  const command = interactionCommand(rawCommand);
  if (command) {
    window.dispatchEvent(new CustomEvent("desktop-pet:interaction-command", { detail: command }));
  }
});

ipcRenderer.on("desktop-pet:bubble-update", (_event, rawUpdate) => {
  const update = bubbleUpdate(rawUpdate);
  if (update) window.dispatchEvent(new CustomEvent("desktop-pet:bubble-update", { detail: update }));
});

window.addEventListener("desktop-pet:frame-hit-box", event => {
  invokeInternal("desktop-pet:update-hit-box", frameHitBox(event.detail));
});

window.addEventListener("desktop-pet:frame-face-box", event => {
  invokeInternal("desktop-pet:update-face-box", frameHitBox(event.detail));
});

window.addEventListener("desktop-pet:interaction-result", event => {
  const result = interactionResult(event.detail);
  if (result) invokeInternal("desktop-pet:interaction-result", result);
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
