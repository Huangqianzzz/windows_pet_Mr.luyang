(function animationManifestModule(global) {
  const fs = typeof module === "object" && module.exports ? require("node:fs") : undefined;

  function problem(actionName, frameIndex, message) {
    return new TypeError(`Animation manifest action "${actionName}", frame index ${frameIndex}: ${message}`);
  }

  function requireObject(value, label, actionName, frameIndex) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw problem(actionName, frameIndex, `${label} is required`);
    }
  }

  function requireNumber(value, label, actionName, frameIndex, { positive = false } = {}) {
    if (value === undefined) throw problem(actionName, frameIndex, `${label} is required`);
    if (!Number.isFinite(value)) throw problem(actionName, frameIndex, `${label} must be finite`);
    if (value < 0) throw problem(actionName, frameIndex, `${label} cannot be negative`);
    if (positive && value === 0) throw problem(actionName, frameIndex, `${label} must be greater than zero`);
  }

  function validateRectangle(rectangle, label, actionName, frameIndex) {
    requireObject(rectangle, label, actionName, frameIndex);
    requireNumber(rectangle.x, `${label}.x`, actionName, frameIndex);
    requireNumber(rectangle.y, `${label}.y`, actionName, frameIndex);
    requireNumber(rectangle.width, `${label}.width`, actionName, frameIndex, { positive: true });
    requireNumber(rectangle.height, `${label}.height`, actionName, frameIndex, { positive: true });
  }

  function validatePoint(point, label, actionName, frameIndex) {
    requireObject(point, label, actionName, frameIndex);
    requireNumber(point.x, `${label}.x`, actionName, frameIndex);
    requireNumber(point.y, `${label}.y`, actionName, frameIndex);
  }

  function isLocalAnimationAsset(file) {
    return typeof file === "string"
      && file.length > 0
      && !file.includes("\\")
      && !file.includes("%")
      && !file.includes(":")
      && !file.startsWith("/")
      && file.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
  }

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  function cloneManifest(manifest) {
    return structuredClone(manifest);
  }

  function isInside(inner, outer) {
    return inner.x + inner.width <= outer.width && inner.y + inner.height <= outer.height;
  }

  function validateFrame(frame, actionName, frameIndex, sheet) {
    requireObject(frame, "frame", actionName, frameIndex);
    const missing = ["source", "faceBox", "hitBox", "contacts", "supportAnchor"].filter((key) => frame[key] === undefined);
    if (missing.length > 0) throw problem(actionName, frameIndex, `${missing.join(" and ")} are required`);

    validateRectangle(frame.source, "source", actionName, frameIndex);
    validateRectangle(frame.faceBox, "faceBox", actionName, frameIndex);
    validateRectangle(frame.hitBox, "hitBox", actionName, frameIndex);
    if (frame.source.x + frame.source.width > sheet.width || frame.source.y + frame.source.height > sheet.height) {
      throw problem(actionName, frameIndex, "source is outside sheet bounds");
    }
    if (!isInside(frame.faceBox, frame.source)) throw problem(actionName, frameIndex, "faceBox is outside source bounds");
    if (!isInside(frame.hitBox, frame.source)) throw problem(actionName, frameIndex, "hitBox is outside source bounds");
    if (!Array.isArray(frame.contacts)) throw problem(actionName, frameIndex, "contacts must be an array");
    frame.contacts.forEach((contact, contactIndex) => {
      validatePoint(contact, `contacts[${contactIndex}]`, actionName, frameIndex);
      if (contact.x > frame.source.width || contact.y > frame.source.height) {
        throw problem(actionName, frameIndex, `contacts[${contactIndex}] is outside source bounds`);
      }
    });
    validatePoint(frame.supportAnchor, "supportAnchor", actionName, frameIndex);
    if (frame.supportAnchor.x > frame.source.width || frame.supportAnchor.y > frame.source.height) {
      throw problem(actionName, frameIndex, "supportAnchor is outside source bounds");
    }
  }

  function validateAction(action, actionName) {
    const frameIndex = "n/a";
    requireObject(action, "action", actionName, frameIndex);
    requireObject(action.sheet, "sheet", actionName, frameIndex);
    if (!isLocalAnimationAsset(action.sheet.file)) {
      throw problem(actionName, frameIndex, "sheet.file must be a local animation asset path");
    }
    requireNumber(action.sheet.width, "sheet.width", actionName, frameIndex, { positive: true });
    requireNumber(action.sheet.height, "sheet.height", actionName, frameIndex, { positive: true });
    requireNumber(action.fps, "fps", actionName, frameIndex, { positive: true });
    if (typeof action.loop !== "boolean") throw problem(actionName, frameIndex, "loop is required");
    if (typeof action.interruptible !== "boolean") throw problem(actionName, frameIndex, "interruptible is required");
    if (!Array.isArray(action.frames) || action.frames.length === 0) {
      throw problem(actionName, frameIndex, "frames must be a non-empty array");
    }
    action.frames.forEach((frame, index) => validateFrame(frame, actionName, index, action.sheet));
  }

  function validateManifest(manifest) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw problem("<manifest>", "n/a", "manifest must be an object");
    }
    if (manifest.version !== 1) throw problem("<manifest>", "n/a", "version must be 1");
    if (!manifest.actions || typeof manifest.actions !== "object" || Array.isArray(manifest.actions)) {
      throw problem("<manifest>", "n/a", "actions must be an object");
    }
    for (const [actionName, action] of Object.entries(manifest.actions)) validateAction(action, actionName);
    return deepFreeze(cloneManifest(manifest));
  }

  function loadManifest(filePath) {
    if (!fs) throw new Error("loadManifest is only available in the main process");
    return validateManifest(JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  const api = { loadManifest, validateManifest };
  if (typeof module === "object" && module.exports) module.exports = api;
  else global.DesktopPetAnimationManifest = api;
}(typeof window === "undefined" ? globalThis : window));
