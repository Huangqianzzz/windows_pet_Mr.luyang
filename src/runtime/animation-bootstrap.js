const path = require("node:path");
const { loadManifest } = require("../domain/animation-manifest");

function loadAnimationBootstrap() {
  return {
    manifest: loadManifest(path.join(__dirname, "..", "..", "assets", "animations", "manifest.json"))
  };
}

module.exports = { loadAnimationBootstrap };
