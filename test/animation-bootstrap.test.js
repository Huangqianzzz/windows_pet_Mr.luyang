const { test } = require("node:test");
const assert = require("node:assert/strict");

test("loads the validated local animation manifest for the renderer bootstrap", () => {
  const { loadAnimationBootstrap } = require("../src/runtime/animation-bootstrap");

  const bootstrap = loadAnimationBootstrap();

  assert.equal(bootstrap.manifest.actions.idle.sheet.file, "sheets/idle.png");
  assert.equal(Object.isFrozen(bootstrap.manifest), true);
});
