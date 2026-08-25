(function animationProtocolModule(global) {
  const ANIMATION_COMMAND_CHANNEL = "desktop-pet:animation-command";
  const ANIMATION_COMPLETE_CHANNEL = "desktop-pet:animation-complete";
  const ANIMATION_COMMAND_EVENT = "desktop-pet:animation-command";
  const ANIMATION_COMPLETE_EVENT = "desktop-pet:animation-complete";
  const FRAME_HIT_BOX_EVENT = "desktop-pet:frame-hit-box";
  const ANIMATION_ACTIONS = Object.freeze([
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
  const FORCE_ACTIONS = Object.freeze(["fall", "land"]);

  function validateAnimationCommand(command) {
    if (!command || typeof command !== "object") return null;
    const keys = Object.keys(command);
    if (keys.length !== 3 || !keys.includes("id") || !keys.includes("action") || !keys.includes("force")) {
      return null;
    }
    if (!Number.isSafeInteger(command.id) || command.id <= 0) return null;
    if (!ANIMATION_ACTIONS.includes(command.action) || typeof command.force !== "boolean") return null;
    if (command.force && !FORCE_ACTIONS.includes(command.action)) return null;
    return Object.freeze({ id: command.id, action: command.action, force: command.force });
  }

  function validateAnimationCompletion(completion) {
    if (!completion || typeof completion !== "object") return null;
    if (Object.keys(completion).length !== 1 || !Object.hasOwn(completion, "id")) return null;
    if (!Number.isSafeInteger(completion.id) || completion.id <= 0) return null;
    return Object.freeze({ id: completion.id });
  }

  function createAnimationBridge({ send }) {
    if (typeof send !== "function") throw new TypeError("animation bridge requires send");
    let nextId = 1;
    const completions = new Map();

    return Object.freeze({
      play(action, { force = false, onComplete } = {}) {
        if (onComplete !== undefined && typeof onComplete !== "function") return false;
        const command = validateAnimationCommand({ id: nextId, action, force });
        if (!command) return false;
        let sent = false;
        try {
          sent = send(command) !== false;
        } catch {
          sent = false;
        }
        if (!sent) return false;
        nextId += 1;
        if (onComplete) completions.set(command.id, onComplete);
        return true;
      },
      complete(payload) {
        const completion = validateAnimationCompletion(payload);
        if (!completion) return false;
        const callback = completions.get(completion.id);
        if (!callback) return false;
        completions.delete(completion.id);
        callback();
        return true;
      }
    });
  }

  const api = {
    ANIMATION_ACTIONS,
    ANIMATION_COMMAND_CHANNEL,
    ANIMATION_COMMAND_EVENT,
    ANIMATION_COMPLETE_CHANNEL,
    ANIMATION_COMPLETE_EVENT,
    FORCE_ACTIONS,
    FRAME_HIT_BOX_EVENT,
    createAnimationBridge,
    validateAnimationCommand,
    validateAnimationCompletion
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else global.DesktopPetAnimationProtocol = Object.freeze(api);
}(typeof window === "undefined" ? globalThis : window));
