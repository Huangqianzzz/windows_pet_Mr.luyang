const { test } = require("node:test");
const assert = require("node:assert/strict");

test("loads the validated local animation manifest for the renderer bootstrap", () => {
  const { loadAnimationBootstrap } = require("../src/runtime/animation-bootstrap");

  const bootstrap = loadAnimationBootstrap();

  assert.equal(bootstrap.manifest.actions.idle.sheet.file, "sheets/idle.png");
  assert.equal(Object.isFrozen(bootstrap.manifest), true);
});

test("derives immutable attachment anchors from the first frame of release actions", () => {
  const { poseAnchorsFromManifest } = require("../src/runtime/animation-bootstrap");
  const manifest = {
    actions: {
      sit: { frames: [{ supportAnchor: { x: 80, y: 160 } }] },
      hang: { frames: [{ supportAnchor: { x: 96, y: 12 } }] }
    }
  };

  const anchors = poseAnchorsFromManifest(manifest, ["sit", "wall-climb", "hang"]);

  assert.deepEqual(anchors, { sit: { x: 80, y: 160 }, hang: { x: 96, y: 12 } });
  assert.equal(Object.isFrozen(anchors), true);
  assert.equal(Object.isFrozen(anchors.sit), true);
  manifest.actions.sit.frames[0].supportAnchor.x = 1;
  assert.equal(anchors.sit.x, 80);
});
