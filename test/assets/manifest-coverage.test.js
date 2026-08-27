const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..", "..");
const animationRoot = path.join(projectRoot, "assets", "animations");
const { readPng } = require("../../scripts/assets/validate-action");
const { validateManifest } = require("../../src/domain/animation-manifest");

const releaseActions = [
  { runtime: "idle", source: "idle", fps: 4, loop: true, interruptible: true },
  { runtime: "crawl", source: "crawl-loop", fps: 8, loop: true, interruptible: true },
  { runtime: "kneel", source: "kneel-speak", fps: 8, loop: false, interruptible: false },
  { runtime: "sit", source: "sit", fps: 4, loop: true, interruptible: true },
  { runtime: "hang", source: "hang", fps: 4, loop: true, interruptible: true },
  { runtime: "wall-climb", source: "wall-climb", fps: 8, loop: true, interruptible: true },
  { runtime: "drag", source: "drag", fps: 6, loop: true, interruptible: true },
  { runtime: "fall", source: "fall", fps: 8, loop: true, interruptible: true },
  { runtime: "land", source: "land", fps: 8, loop: false, interruptible: false }
];

test("release manifest covers exactly the approved action aliases and packed source frames", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(animationRoot, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));

  assert.deepEqual(Object.keys(manifest.actions), releaseActions.map(({ runtime }) => runtime));
  assert.deepEqual(packageJson.build.files, [
    "src/**/*",
    "assets/animations/manifest.json",
    ...releaseActions.map(({ runtime }) => `assets/animations/sheets/${runtime}.png`)
  ]);

  for (const action of releaseActions) {
    const runtime = manifest.actions[action.runtime];
    const metadata = JSON.parse(await fs.readFile(path.join(animationRoot, "metadata", `${action.source}.json`), "utf8"));
    const sheetPath = path.join(animationRoot, "sheets", `${action.runtime}.png`);
    const sheet = await readPng(sheetPath);

    assert.equal(runtime.sheet.file, `sheets/${action.runtime}.png`);
    assert.equal(runtime.sheet.width, sheet.width);
    assert.equal(runtime.sheet.height, sheet.height);
    assert.equal(runtime.fps, action.fps);
    assert.equal(runtime.loop, action.loop);
    assert.equal(runtime.interruptible, action.interruptible);
    assert.notEqual(sheet.width * sheet.height, 1);
    assert.equal(runtime.frames.length, metadata.frames.length);
    assert.equal(sheet.width, 192 * metadata.frames.length);
    assert.equal(sheet.height, 208);

    let visibleKeyPixels = 0;
    let dirtyTransparentPixels = 0;
    for (let offset = 0; offset < sheet.pixels.length; offset += 4) {
      const red = sheet.pixels[offset];
      const green = sheet.pixels[offset + 1];
      const blue = sheet.pixels[offset + 2];
      const alpha = sheet.pixels[offset + 3];
      if (alpha > 0 && red === 255 && green === 0 && blue === 255) visibleKeyPixels += 1;
      if (alpha === 0 && (red !== 0 || green !== 0 || blue !== 0)) dirtyTransparentPixels += 1;
    }
    assert.equal(visibleKeyPixels, 0, `${action.runtime} sheet retains visible chroma-key pixels`);
    assert.equal(dirtyTransparentPixels, 0, `${action.runtime} sheet retains hidden RGB under alpha`);

    runtime.frames.forEach((frame, index) => {
      const approved = metadata.frames[index];
      assert.deepEqual(frame.source, { x: index * 192, y: 0, width: 192, height: 208 });
      assert.deepEqual(frame.faceBox, approved.faceBox);
      assert.deepEqual(frame.hitBox, approved.hitBox);
      assert.deepEqual(frame.contacts, approved.contacts);
      assert.deepEqual(frame.supportAnchor, approved.supportAnchor);
    });
  }

  assert.deepEqual(validateManifest(manifest), manifest);
});
