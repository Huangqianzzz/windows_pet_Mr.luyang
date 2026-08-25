const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function validManifest() {
  return {
    version: 1,
    actions: {
      idle: {
        sheet: { file: "idle.png", width: 128, height: 128 },
        fps: 30,
        loop: true,
        interruptible: true,
        frames: [{
          source: { x: 0, y: 0, width: 64, height: 64 },
          faceBox: { x: 8, y: 8, width: 20, height: 16 },
          hitBox: { x: 4, y: 4, width: 48, height: 56 },
          contacts: [{ x: 16, y: 64 }],
          supportAnchor: { x: 16, y: 64 }
        }]
      }
    }
  };
}

test("rejects a frame without face and hit metadata", () => {
  assert.throws(
    () => require("../src/domain/animation-manifest").validateManifest({
      version: 1,
      actions: {
        idle: {
          sheet: { file: "idle.png", width: 128, height: 128 },
          fps: 30,
          loop: true,
          interruptible: true,
          frames: [{ source: { x: 0, y: 0, width: 128, height: 128 } }]
        }
      }
    }),
    /faceBox.*hitBox/
  );
});

test("accepts a complete action manifest", () => {
  const { validateManifest } = require("../src/domain/animation-manifest");
  const manifest = validManifest();

  assert.deepEqual(validateManifest(manifest), manifest);
});

test("reports the action and frame when a required frame field is missing", () => {
  const { validateManifest } = require("../src/domain/animation-manifest");
  const manifest = validManifest();
  delete manifest.actions.idle.frames[0].contacts;

  assert.throws(
    () => validateManifest(manifest),
    /action "idle", frame index 0:.*contacts/
  );
});

test("rejects non-finite and negative metadata with its action and frame", () => {
  const { validateManifest } = require("../src/domain/animation-manifest");
  const nonFinite = validManifest();
  nonFinite.actions.idle.frames[0].source.x = Number.NaN;
  const negative = validManifest();
  negative.actions.idle.frames[0].hitBox.width = -1;

  assert.throws(() => validateManifest(nonFinite), /action "idle", frame index 0:.*finite/);
  assert.throws(() => validateManifest(negative), /action "idle", frame index 0:.*negative/);
});

test("rejects a source rectangle outside its sprite sheet", () => {
  const { validateManifest } = require("../src/domain/animation-manifest");
  const manifest = validManifest();
  manifest.actions.idle.frames[0].source.x = 80;

  assert.throws(
    () => validateManifest(manifest),
    /action "idle", frame index 0:.*outside sheet/
  );
});

test("loads the shipped placeholder animation manifest", () => {
  const { loadManifest } = require("../src/domain/animation-manifest");
  const manifest = loadManifest(path.join(__dirname, "..", "assets", "animations", "manifest.json"));

  assert.equal(manifest.actions.idle.fps, 1);
});

test("uses a manifest location marker when no action or frame exists", () => {
  const { validateManifest } = require("../src/domain/animation-manifest");

  assert.throws(
    () => validateManifest({ version: 1 }),
    /action "<manifest>", frame index n\/a:.*actions/
  );
});

test("returns a deeply frozen defensive copy", () => {
  const { validateManifest } = require("../src/domain/animation-manifest");
  const source = validManifest();
  const manifest = validateManifest(source);
  source.actions.idle.frames[0].source.x = 99;
  source.actions.idle.frames[0].contacts[0].x = 99;

  assert.notEqual(manifest, source);
  assert.equal(Object.isFrozen(manifest.actions.idle.frames[0].contacts[0]), true);
  assert.equal(manifest.actions.idle.frames[0].source.x, 0);
  assert.equal(manifest.actions.idle.frames[0].contacts[0].x, 16);
});

test("uses n/a for action-level validation errors", () => {
  const { validateManifest } = require("../src/domain/animation-manifest");
  const manifest = validManifest();
  delete manifest.actions.idle.sheet;

  assert.throws(
    () => validateManifest(manifest),
    /action "idle", frame index n\/a:.*sheet/
  );
});

test("rejects remote and traversal sprite sheet files", () => {
  const { validateManifest } = require("../src/domain/animation-manifest");
  const remote = validManifest();
  remote.actions.idle.sheet.file = "https://example.test/idle.png";
  const traversal = validManifest();
  traversal.actions.idle.sheet.file = "../idle.png";

  assert.throws(() => validateManifest(remote), /action "idle", frame index n\/a:.*local animation asset/);
  assert.throws(() => validateManifest(traversal), /action "idle", frame index n\/a:.*local animation asset/);
});
