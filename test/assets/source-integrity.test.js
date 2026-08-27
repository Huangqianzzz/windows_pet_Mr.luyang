const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..", "..");
const { validateSources } = require("../../scripts/assets/validate-source");

test("approved person sources match the recorded hashes", async () => {
  const result = await validateSources("assets/source/person/SHA256SUMS.txt");

  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unexpected, []);
  assert.equal(result.files.length, 2);
});

test("validator reports exact paths for missing, changed, and unexpected sources", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-pet-source-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const changedPath = path.join(directory, "changed.jpg");
  const missingPath = path.join(directory, "missing.jpg");
  const unexpectedPath = path.join(directory, "renamed.jpg");
  await fs.writeFile(changedPath, "changed");
  await fs.writeFile(unexpectedPath, "unexpected");
  await fs.writeFile(
    path.join(directory, "SHA256SUMS.txt"),
    `${"0".repeat(64)}  changed.jpg\n${"1".repeat(64)}  missing.jpg\n`
  );

  const result = await validateSources(path.join(directory, "SHA256SUMS.txt"));

  assert.deepEqual(result.changed, [changedPath]);
  assert.deepEqual(result.missing, [missingPath]);
  assert.deepEqual(result.unexpected, [unexpectedPath]);
});

test("the installer includes only runtime sheets and excludes private and working assets", () => {
  const packageJson = require(path.join(projectRoot, "package.json"));

  assert.deepEqual(packageJson.build.files, [
    "src/**/*",
    "assets/animations/manifest.json",
    ...["idle", "crawl", "kneel", "sit", "hang", "wall-climb", "drag", "fall", "land"]
      .map(name => `assets/animations/sheets/${name}.png`)
  ]);
  assert.match(packageJson.scripts.test, /test\/assets\/\*\.test\.js/);
});
