const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pkg = require("../package.json");

test("pins the supported Windows runtime", () => {
  assert.equal(pkg.devDependencies.electron, "41.10.4");
  assert.equal(pkg.build.win.target[0].arch[0], "x64");
  assert.equal(pkg.main, "src/main.js");
});

test("pet renderer permits only bundled local resources", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "render", "pet.html"), "utf8");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'/);
});
