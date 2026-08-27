const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("Windows x64 release is a person-pet NSIS installer without private source photos", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.build.appId, "local.person.desktop.pet");
  assert.equal(pkg.build.productName, "人物桌宠");
  assert.equal(pkg.build.win.artifactName, "Person-Desktop-Pet-Setup-${version}-${arch}.${ext}");
  assert.deepEqual(pkg.build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.deepEqual(pkg.build.nsis, {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "人物桌宠"
  });
  assert.deepEqual(pkg.build.files, [
    "src/**/*",
    "assets/animations/manifest.json",
    ...["idle", "crawl", "kneel", "sit", "hang", "wall-climb", "drag", "fall", "land"]
      .map(name => `assets/animations/sheets/${name}.png`)
  ]);
  assert.deepEqual(Object.keys(pkg.dependencies), ["koffi"]);
});
