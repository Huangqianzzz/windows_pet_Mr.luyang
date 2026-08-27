const path = require("node:path");
const { loadManifest } = require("../domain/animation-manifest");

function loadAnimationBootstrap() {
  return {
    manifest: loadManifest(path.join(__dirname, "..", "..", "assets", "animations", "manifest.json"))
  };
}

function poseAnchorsFromManifest(manifest, actionNames) {
  if (!manifest?.actions || !Array.isArray(actionNames)) {
    throw new TypeError("manifest actions and action names are required");
  }
  const anchors = {};
  for (const actionName of actionNames) {
    const anchor = manifest.actions[actionName]?.frames?.[0]?.supportAnchor;
    if (anchor && [anchor.x, anchor.y].every(Number.isFinite)) {
      anchors[actionName] = Object.freeze({ x: anchor.x, y: anchor.y });
    }
  }
  return Object.freeze(anchors);
}

module.exports = { loadAnimationBootstrap, poseAnchorsFromManifest };
