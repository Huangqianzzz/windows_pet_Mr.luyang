const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const { readPng, validateAction } = require("../../scripts/assets/validate-action");
const { packAction } = require("../../scripts/assets/pack-action");

const fixtures = path.join(__dirname, "fixtures");

function pngChunk(type, data, checksum = crc32(Buffer.concat([Buffer.from(type), data]))) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const checksumBuffer = Buffer.alloc(4);
  checksumBuffer.writeUInt32BE(checksum);
  return Buffer.concat([length, name, data, checksumBuffer]);
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngHeader(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return header;
}

function pngFile(chunks) {
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), ...chunks]);
}

function png(width, height, pixels) {
  const rows = [];
  for (let y = 0; y < height; y += 1) rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", pngHeader(width, height)),
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

async function pngFilePath(t, contents) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-pet-png-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "frame-0001.png");
  await fs.writeFile(file, contents);
  return file;
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

test("rejects invalid PNG chunk order, CRCs, endings, and oversized dimensions", async (t) => {
  const header = pngHeader(1, 1);
  const idat = zlib.deflateSync(Buffer.from([0, 1, 2, 3, 255]));
  const outOfOrder = await pngFilePath(t, pngFile([pngChunk("IDAT", idat), pngChunk("IHDR", header), pngChunk("IEND", Buffer.alloc(0))]));
  const badCrc = await pngFilePath(t, pngFile([pngChunk("IHDR", header), pngChunk("IDAT", idat, 0), pngChunk("IEND", Buffer.alloc(0))]));
  const trailing = await pngFilePath(t, pngFile([pngChunk("IHDR", header), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0)), pngChunk("IEND", Buffer.alloc(0))]));
  const oversized = await pngFilePath(t, pngFile([pngChunk("IHDR", pngHeader(65536, 65536)), pngChunk("IEND", Buffer.alloc(0))]));
  const duplicateHeader = await pngFilePath(t, pngFile([pngChunk("IHDR", header), pngChunk("IHDR", header), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]));
  const nonemptyIend = await pngFilePath(t, pngFile([pngChunk("IHDR", header), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.from([1]))]));
  const missingIend = await pngFilePath(t, pngFile([pngChunk("IHDR", header), pngChunk("IDAT", idat)]));
  await assert.rejects(
    () => readPng(outOfOrder),
    /IHDR must be the first PNG chunk/
  );
  await assert.rejects(
    () => readPng(badCrc),
    /PNG CRC mismatch/
  );
  await assert.rejects(
    () => readPng(trailing),
    /PNG has trailing bytes/
  );
  await assert.rejects(
    () => readPng(oversized),
    /PNG dimensions exceed safety limit/
  );
  await assert.rejects(() => readPng(duplicateHeader), /PNG has duplicate IHDR/);
  await assert.rejects(() => readPng(nonemptyIend), /IEND must be empty/);
  await assert.rejects(() => readPng(missingIend), /PNG is missing IEND/);
});

test("requires stable contact ids and rejects output collisions before publishing", async (t) => {
  const directory = await actionDirectory(t);
  const noId = await fixture("valid-action.json");
  delete noId.frames[1].contacts[0].id;
  await assert.rejects(() => validateAction(directory, noId), /frame 2: contact id is required/);

  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-pet-collision-"));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  await assert.rejects(
    () => packAction(directory, path.join(directory, "frame-0001.png"), path.join(outputDirectory, "sheet.json")),
    /output path collides with an input frame/
  );
  await assert.rejects(
    () => packAction(directory, path.join(directory, "FRAME-0001.PNG"), path.join(outputDirectory, "case.json")),
    /output path collides with an input frame/
  );
  await assert.rejects(
    () => packAction(directory, path.join(outputDirectory, "same.out"), path.join(outputDirectory, "same.out")),
    /PNG and JSON outputs must differ/
  );
  await assert.rejects(
    () => packAction(directory, path.join(outputDirectory, "sheet.png"), path.join(directory, "metadata.json")),
    /output path must not be inside the action directory/
  );
});

test("restores both old outputs when the second publish rename fails", async (t) => {
  const directory = await actionDirectory(t);
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-pet-rollback-"));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const outputPng = path.join(outputDirectory, "sheet.png");
  const outputJson = path.join(outputDirectory, "sheet.json");
  const oldPng = Buffer.from("old-png");
  const oldJson = Buffer.from("old-json");
  await fs.writeFile(outputPng, oldPng);
  await fs.writeFile(outputJson, oldJson);
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (from.endsWith(".tmp") && to === outputJson) {
      const error = new Error("simulated second publish failure");
      error.code = "EIO";
      throw error;
    }
    return rename(from, to);
  };
  t.after(() => { fs.rename = rename; });

  await assert.rejects(() => packAction(directory, outputPng, outputJson), /simulated second publish failure/);
  assert.deepEqual(await fs.readFile(outputPng), oldPng);
  assert.deepEqual(await fs.readFile(outputJson), oldJson);
  assert.equal((await fs.readdir(outputDirectory)).some((name) => /\.(tmp|bak)$/.test(name)), false);
});

test("rejects a sheet that exceeds the total width safety limit before writing", async (t) => {
  const directory = await actionDirectory(t, ["frame-0001.png", "frame-0002.png", "frame-0003.png"]);
  const pixels = Buffer.alloc(8192 * 4, 255);
  await Promise.all(["frame-0001.png", "frame-0002.png", "frame-0003.png"].map((file) => fs.writeFile(path.join(directory, file), png(8192, 1, pixels))));
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-pet-sheet-limit-"));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const outputPng = path.join(outputDirectory, "sheet.png");
  const outputJson = path.join(outputDirectory, "sheet.json");

  await assert.rejects(() => packAction(directory, outputPng, outputJson), /sheet width exceeds safety limit/);
  await assert.rejects(() => fs.stat(outputPng), /ENOENT/);
  await assert.rejects(() => fs.stat(outputJson), /ENOENT/);
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
  assert.equal((await fs.readdir(outputDirectory)).some((name) => /\.(tmp|bak)$/.test(name)), false);

  const brokenDirectory = await actionDirectory(t, ["frame-0001.png", "frame-0003.png"]);
  const brokenPng = path.join(outputDirectory, "broken.png");
  const brokenJson = path.join(outputDirectory, "broken.json");
  await assert.rejects(() => packAction(brokenDirectory, brokenPng, brokenJson), /frame-0002.png/);
  await assert.rejects(() => fs.stat(brokenPng), /ENOENT/);
  await assert.rejects(() => fs.stat(brokenJson), /ENOENT/);
});
