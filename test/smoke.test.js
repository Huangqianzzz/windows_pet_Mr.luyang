const { test } = require("node:test");
const assert = require("node:assert/strict");
const pkg = require("../package.json");

test("pins the supported Windows runtime", () => {
  assert.equal(pkg.devDependencies.electron, "41.10.4");
  assert.equal(pkg.build.win.target[0].arch[0], "x64");
  assert.equal(pkg.main, "src/main.js");
});
