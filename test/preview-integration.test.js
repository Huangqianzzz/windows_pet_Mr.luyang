const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("preview uses the approved 192 by 208 window and normal image interpolation", () => {
  const sourceRoot = path.join(__dirname, "..", "src");
  const main = fs.readFileSync(path.join(sourceRoot, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(sourceRoot, "render", "pet.css"), "utf8");

  assert.match(main, /petWindow\s*=\s*new BrowserWindow\(\{[\s\S]*?width:\s*192,[\s\S]*?height:\s*208,/);
  assert.doesNotMatch(css, /image-rendering\s*:\s*pixelated/);
});
