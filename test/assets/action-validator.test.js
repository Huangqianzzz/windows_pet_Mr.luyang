const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const { validateAction } = require("../../scripts/assets/validate-action");
const { packAction } = require("../../scripts/assets/pack-action");

const fixtures = path.join(__dirname, "fixtures");

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function png(width, height, pixels) {
  const rows = [];
  for (let y = 0; y < height; y += 1) rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

async function actionDirectory(t, files = ["frame-0001.png", "frame-0002.png"]) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-pet-action-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  await Promise.all(files.map((file) => fs.writeFile(path.join(directory, file), png(2, 2, pixels))));
  return directory;
}

async function fixture(name) {
  return JSON.parse(await fs.readFile(path.join(fixtures, name), "utf8"));
}

test("accepts complete 30 FPS action metadata", async (t) => {
  const directory = await actionDirectory(t);
  const report = await validateAction(directory, await fixture("valid-action.json"));

  assert.deepEqual(report, { name: "idle", width: 2, height: 2, frames: ["frame-0001.png", "frame-0002.png"] });
});

test("rejects missing face boxes and discontinuous contacts", async (t) => {
  const directory = await actionDirectory(t);
  await assert.rejects(() => validateAction(directory, fixture("invalid-face-action.json")), /frame 2.*faceBox/);

  const metadata = await fixture("valid-action.json");
  metadata.frames[1].contacts[0].x = 2;
  metadata.frames[1].contacts[0].y = 0;
  await assert.rejects(() => validateAction(directory, metadata), /contact.*discontinuity/);
});

test("rejects gaps, dimension drift, and empty alpha", async (t) => {
  const directory = await actionDirectory(t, ["frame-0001.png", "frame-0003.png"]);
  const metadata = await fixture("valid-action.json");
  await assert.rejects(() => validateAction(directory, metadata), /frame-0002.png/);

  const driftDirectory = await actionDirectory(t);
  await fs.writeFile(path.join(driftDirectory, "frame-0002.png"), png(1, 2, Buffer.from([255, 0, 0, 255, 0, 255, 0, 255])));
  await assert.rejects(() => validateAction(driftDirectory, metadata), /dimension drift/);

  const transparentDirectory = await actionDirectory(t);
  await fs.writeFile(path.join(transparentDirectory, "frame-0002.png"), png(2, 2, Buffer.alloc(16)));
  await assert.rejects(() => validateAction(transparentDirectory, metadata), /empty alpha/);
});

test("rejects duplicate names, invalid FPS, and out-of-bounds geometry", async (t) => {
  const directory = await actionDirectory(t);
  const duplicate = await fixture("valid-action.json");
  duplicate.frames[1].file = duplicate.frames[0].file;
  await assert.rejects(() => validateAction(directory, duplicate), /duplicate frame filename/);

  const invalidFps = await fixture("valid-action.json");
  invalidFps.fps = 24;
  await assert.rejects(() => validateAction(directory, invalidFps), /30 FPS/);

  const outOfBounds = await fixture("valid-action.json");
  outOfBounds.frames[1].hitBox.width = 3;
  await assert.rejects(() => validateAction(directory, outOfBounds), /frame 2: hitBox is out of bounds/);
});

test("rejects nonexact PNG filename casing", async (t) => {
  const directory = await actionDirectory(t, ["frame-0001.png", "frame-0002.png", "frame-0003.PNG"]);
  const metadata = await fixture("valid-action.json");
  await assert.rejects(() => validateAction(directory, metadata), /invalid frame filename frame-0003.PNG/);
});

test("packs exact numeric frame names deterministically without partial output on failure", async (t) => {
  const directory = await actionDirectory(t, ["frame-0002.png", "frame-0001.png"]);
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-pet-sheet-"));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const outputPng = path.join(outputDirectory, "sheet.png");
  const outputJson = path.join(outputDirectory, "sheet.json");
  await packAction(directory, outputPng, outputJson);
  const firstPng = await fs.readFile(outputPng);
  const firstJson = await fs.readFile(outputJson);
  await packAction(directory, outputPng, outputJson);

  assert.deepEqual(await fs.readFile(outputPng), firstPng);
  assert.deepEqual(await fs.readFile(outputJson), firstJson);
  assert.deepEqual(JSON.parse(firstJson).frames.map((frame) => frame.file), ["frame-0001.png", "frame-0002.png"]);

  const brokenDirectory = await actionDirectory(t, ["frame-0001.png", "frame-0003.png"]);
  const brokenPng = path.join(outputDirectory, "broken.png");
  const brokenJson = path.join(outputDirectory, "broken.json");
  await assert.rejects(() => packAction(brokenDirectory, brokenPng, brokenJson), /frame-0002.png/);
  await assert.rejects(() => fs.stat(brokenPng), /ENOENT/);
  await assert.rejects(() => fs.stat(brokenJson), /ENOENT/);
});
