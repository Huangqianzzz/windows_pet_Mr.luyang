(function mountRenderer(global) {
  const animationProtocol = typeof module === "object" && module.exports
    ? require("../runtime/animation-protocol")
    : global.DesktopPetAnimationProtocol;

  function isLocalAnimationAsset(file) {
    return typeof file === "string"
      && file.length > 0
      && !file.includes("\\")
      && !file.includes("%")
      && !file.includes(":")
      && !file.startsWith("/")
      && file.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
  }

  function animationAssetUrl(file, locationHref) {
    if (!isLocalAnimationAsset(file)) throw new TypeError("Sprite sheet must be a local animation asset");
    const url = new URL(`../../assets/animations/${file}`, locationHref);
    if (url.protocol !== "file:") throw new TypeError("Sprite sheet must resolve to a local file URL");
    return url.href;
  }

  function mirrorBox(box, sourceWidth) {
    if (!box || ![box.x, box.y, box.width, box.height, sourceWidth].every(Number.isFinite)
      || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0
      || box.x + box.width > sourceWidth) {
      throw new RangeError("box must be inside the source width");
    }
    return { ...box, x: sourceWidth - box.x - box.width };
  }

  function mirrorPoint(point, sourceWidth) {
    if (!point || ![point.x, point.y, sourceWidth].every(Number.isFinite)
      || point.x < 0 || point.y < 0 || point.x > sourceWidth) {
      throw new RangeError("point must be inside the source width");
    }
    return { ...point, x: sourceWidth - point.x };
  }

  function applyFrame(sprite, action, frame, locationHref, facing = "right") {
    const { source } = frame;
    sprite.style.width = `${source.width}px`;
    sprite.style.height = `${source.height}px`;
    sprite.style.backgroundImage = `url("${animationAssetUrl(action.sheet.file, locationHref)}")`;
    sprite.style.backgroundPosition = `${-source.x}px ${-source.y}px`;
    sprite.style.backgroundSize = `${action.sheet.width}px ${action.sheet.height}px`;
    sprite.style.transform = facing === "left" ? "scaleX(-1)" : "none";
    sprite.style.transformOrigin = "center";
  }

  function dispatchDetail(eventTarget, type, detail) {
    const CustomEventClass = eventTarget.CustomEvent || globalThis.CustomEvent;
    eventTarget.dispatchEvent(new CustomEventClass(type, { detail }));
  }

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

  function validateInteractionCommand(value) {
    if (!value || typeof value !== "object") return null;
    const keys = Object.keys(value);
    const base = keys.length === 3
      && keys.includes("id") && keys.includes("type") && keys.includes("expiresAt");
    const recovery = keys.length === 4 && base === false
      && keys.includes("id") && keys.includes("type") && keys.includes("action") && keys.includes("expiresAt");
    if (!base && !recovery) return null;
    if (!Number.isSafeInteger(value.id) || value.id <= 0 || !INTERACTION_TYPES.has(value.type)) return null;
    if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) return null;
    if ((value.type === "recover") !== recovery) return null;
    if (recovery && !RECOVERY_ACTIONS.has(value.action)) return null;
    return recovery
      ? { id: value.id, type: value.type, action: value.action, expiresAt: value.expiresAt }
      : { id: value.id, type: value.type, expiresAt: value.expiresAt };
  }

  function mountPet({ document, desktopPet, AnimationPlayer, locationHref, eventTarget = global, now = Date.now }) {
    const root = document.getElementById("pet-root");
    const sprite = document.createElement("div");
    sprite.className = "pet-sprite";
    sprite.setAttribute("aria-hidden", "true");
    root.append(sprite);

    let player;
    let currentFacing = "right";
    const pendingCommands = [];
    const pendingInteractions = [];
    const reportFrame = (frame, _frameIndex, actionName) => {
      const hitBox = currentFacing === "left" ? mirrorBox(frame.hitBox, frame.source.width) : frame.hitBox;
      const faceBox = currentFacing === "left" ? mirrorBox(frame.faceBox, frame.source.width) : frame.faceBox;
      dispatchDetail(eventTarget, animationProtocol.FRAME_HIT_BOX_EVENT, hitBox);
      dispatchDetail(eventTarget, "desktop-pet:frame-face-box", faceBox);
      if (frame.supportAnchor && [frame.supportAnchor.x, frame.supportAnchor.y].every(Number.isFinite)) {
        dispatchDetail(eventTarget, "desktop-pet:frame-support-anchor", {
          action: actionName,
          x: frame.supportAnchor.x,
          y: frame.supportAnchor.y
        });
      }
      applyFrame(sprite, player.manifest.actions[actionName], frame, locationHref, currentFacing);
    };
    const playCommand = rawCommand => {
      const command = animationProtocol.validateAnimationCommand(rawCommand);
      if (!command || !player) return false;
      if (command.facing) currentFacing = command.facing;
      const actionName = player.manifest.actions[command.action] ? command.action : "idle";
      let completed = false;
      const complete = () => {
        if (completed) return;
        completed = true;
        dispatchDetail(eventTarget, animationProtocol.ANIMATION_COMPLETE_EVENT, { id: command.id });
      };
      const played = player.play(actionName, {
        force: command.force,
        onFrame: reportFrame,
        onComplete: complete
      });
      if (played && actionName !== command.action) complete();
      return Boolean(played);
    };
    const runInteraction = rawCommand => {
      const command = validateInteractionCommand(rawCommand);
      if (!command || !player) return false;
      if (command.expiresAt <= now()) {
        dispatchDetail(eventTarget, "desktop-pet:interaction-result", {
          id: command.id,
          accepted: false,
          reason: "expired"
        });
        return false;
      }
      if (command.type === "freeze" || command.type === "resume") {
        player[command.type]();
        dispatchDetail(eventTarget, "desktop-pet:interaction-result", {
          id: command.id,
          accepted: true
        });
        return true;
      }
      const requestedAction = command.type === "recover" ? command.action : "kneel";
      const actionName = player.manifest.actions[requestedAction] ? requestedAction : "idle";
      let reported = false;
      const played = player.play(actionName, {
        force: command.type === "recover",
        onFrame(frame, frameIndex, renderedAction) {
          reportFrame(frame, frameIndex, renderedAction);
          if (reported) return;
          reported = true;
          dispatchDetail(eventTarget, "desktop-pet:interaction-result", {
            id: command.id,
            accepted: true,
            action: actionName
          });
        }
      });
      if (!played) {
        dispatchDetail(eventTarget, "desktop-pet:interaction-result", {
          id: command.id,
          accepted: false,
          action: actionName
        });
      }
      return Boolean(played);
    };
    eventTarget.addEventListener(animationProtocol.ANIMATION_COMMAND_EVENT, event => {
      if (player) playCommand(event.detail);
      else pendingCommands.push(event.detail);
    });
    eventTarget.addEventListener("desktop-pet:interaction-command", event => {
      if (player) runInteraction(event.detail);
      else pendingInteractions.push(event.detail);
    });

    const ready = desktopPet.getBootstrap()
      .then(({ manifest }) => {
        player = new AnimationPlayer(manifest);
        player.play("idle", {
          onFrame: reportFrame
        });
        for (const command of pendingCommands.splice(0)) playCommand(command);
        for (const command of pendingInteractions.splice(0)) runInteraction(command);
        return player;
      })
      .catch(() => undefined);
    return { sprite, ready };
  }

  const api = { animationAssetUrl, applyFrame, mirrorBox, mirrorPoint, mountPet, validateInteractionCommand };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  global.DesktopPetRenderer = api;
  if (global.document && global.desktopPet && global.DesktopPetAnimationPlayer) {
    mountPet({
      document: global.document,
      desktopPet: global.desktopPet,
      AnimationPlayer: global.DesktopPetAnimationPlayer.AnimationPlayer,
      locationHref: global.location.href
    });
  }
}(typeof window === "undefined" ? globalThis : window));
